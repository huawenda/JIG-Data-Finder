import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

import { config as globalConfig, mergeConfig, applyConfig } from './core/config'
import type { AppConfig } from './core/config'
import { drillPivotRows, generatePivot, SUMMARY_CST } from './core/pivot'
import type { PivotDrillKey } from './core/pivot'
import { buildDetailTable, queryData, processSourceData, NOT_FOUND } from './core/query'
import { processClipboardContent } from './core/clipboard'
import { rulesFromConfig } from './core/validate'
import {
  classifyReviewTable,
  isFlagged,
  matchesScope,
  REVIEW_SCOPES,
} from './core/review'
import type { ReviewKind, ReviewScope } from './core/review'
import { applyTheme, readCachedTheme, watchSystemTheme } from './core/theme'
import type { ThemeMode } from './core/theme'
import { readExcel, validateSource, writeExcel } from './core/excel'
import type { RedMark } from './core/excel'
import type { Row, Table } from './core/table'
import { emptyTable } from './core/table'

import Grid from './ui/Grid'
import StageRail from './ui/StageRail'
import SettingsDialog from './ui/SettingsDialog'
import type { SettingsDraft } from './ui/SettingsDialog'
import SizeMappingDialog from './ui/SizeMappingDialog'
import {
  IS_TAURI,
  basename,
  pickExcelFile,
  pickSavePath,
  pickDirectory,
  readPickedFile,
  saveToFile,
  readClipboardText,
  readConfigFile,
  writeConfigFile,
  setWindowTheme,
  withTimestamp,
} from './ui/bridge'
import type { PickedFile } from './ui/bridge'

import './styles/app.css'

type TabId = 'detail' | 'queryPivot' | 'pivot' | 'review'
type Status = 'idle' | 'ready' | 'busy' | 'error'
/**
 * 全量透视的显示范围。
 *
 * P/N 与"全部/生产中"共用同一个下拉框: 选某个 P/N 时就不再叠加
 * "生产中"筛选, 否则两个条件互斥却挤在一个单选框里, 用户无法判断
 * 当前到底生效了哪个。
 */
type PivotScope = 'all' | 'prod' | `pn:${string}`

/**
 * 透视下钻的当前定位。
 *
 * 只存"定位键 + 面包屑", 不存筛出来的行: 明细每次由源数据和配置
 * 现算, 所以改型号尺寸映射后「对应尺寸」会立刻跟上, 不会停在旧值。
 */
interface DrillState {
  from: 'pivot' | 'queryPivot'
  key: PivotDrillKey
  crumbs: string[]
  /** 该透视表构建时是否开了"生产中"筛选, 下钻必须用同一个口径 */
  filterProduction: boolean
}

interface Toast {
  kind: 'info' | 'ok' | 'error'
  text: string
}

const EMPTY_PIVOT: Table = emptyTable()
const EMPTY_ROWS: Row[] = []

/**
 * 审查页各档筛空时的文案。
 *
 * 分档以后"空"有多种原因, 只说"没有符合条件的数据"用户不知道是数据真的
 * 没问题、还是档位选窄了。所以每一档都要说清"这一档为什么可能为空"以及
 * "怎么放宽"。
 */
const REVIEW_EMPTY: Record<ReviewScope, { title: string; hint: string }> = {
  all: {
    title: '没有符合条件的数据',
    hint: '换一个 P/N, 或把 P/N 切回「全部」。',
  },
  mismatch: {
    title: '当前范围内没有尺寸不匹配的记录',
    hint: '这一档只保留尺寸对不上的行; 切到「所有对象」可看到该范围内的全部记录。',
  },
}

export default function App() {
  const [cfg, setCfg] = useState<AppConfig>(globalConfig)
  const rules = useMemo(() => rulesFromConfig(cfg), [cfg])

  const [source, setSource] = useState<{ columns: string[]; rows: Row[] } | null>(null)
  const [sourcePath, setSourcePath] = useState('')
  // 浏览只负责"记住选中的文件", 不读盘。「浏览」与「加载」是两个动作:
  //   浏览 -> 只设 sourcePath, 由用户自己决定何时加载
  //   加载 -> 每次点击都重新读盘, 所以源文件被外部改动后再次点即可刷新
  const [pendingFile, setPendingFile] = useState<PickedFile | null>(null)
  // 浏览器回退(<input type=file>)时文件只能当场读成 ArrayBuffer,
  // 没法留路径给"加载"再读一次。这种情况下直接把 buffer 暂存起来。
  const [pendingBuffer, setPendingBuffer] = useState<{
    buf: ArrayBuffer
    name: string
  } | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [log, setLog] = useState('等待加载源数据')
  const [toast, setToast] = useState<Toast | null>(null)

  const [tab, setTab] = useState<TabId>('detail')
  const [input, setInput] = useState('')
  const [canQuery, setCanQuery] = useState(false)

  // 全量透视: 全部 / 生产中 / 单个 P/N
  const [pivotAll, setPivotAll] = useState<Table>(EMPTY_PIVOT)
  const [pivotProd, setPivotProd] = useState<Table>(EMPTY_PIVOT)
  const [pivotScope, setPivotScope] = useState<PivotScope>('all')

  // 查询结果
  const [detail, setDetail] = useState<Table>(EMPTY_PIVOT)
  const [queryPivot, setQueryPivot] = useState<Table>(EMPTY_PIVOT)
  /*
   * 结果透视的底数据 (本次查询命中的源行)。
   *
   * 必须单独存一份: 透视表是查询那一刻的快照, 而输入框随时可改。若下钻时
   * 再从输入框重算命中行, 用户改了输入却没重新查询, 就会拿新命中集去解释
   * 旧透视表上的数字, 行数对不上。
   */
  const [queryHits, setQueryHits] = useState<Row[]>(EMPTY_ROWS)

  // 透视下钻 (null = 正常显示透视表)
  const [drill, setDrill] = useState<DrillState | null>(null)

  // 审查页
  const [reviewAll, setReviewAll] = useState<Table>(EMPTY_PIVOT)
  const [pnFilter, setPnFilter] = useState('全部')
  /*
   * 审查页的两档视野。默认「所有对象」—— 审查页默认是全量视图, 用户想
   * 收窄时自己切到「尺寸不匹配」。筛选同时作用于导出: 切到「尺寸不匹配」
   * 再导出, 拿到的就是一张纯异常清单。
   *
   * 用分段按钮而不是"只看不匹配"复选框: 两档各自带着行数, 不用先勾上
   * 才知道有多少行不匹配。
   */
  const [reviewScope, setReviewScope] = useState<ReviewScope>('all')

  const [sizeValidation, setSizeValidation] = useState(cfg.sizeValidationEnabled)
  const [showSettings, setShowSettings] = useState(false)
  const [showSizeMapping, setShowSizeMapping] = useState(false)
  /*
   * 当前生效的主题模式。
   *
   * 与 cfg.theme 刻意分开: 设置面板里选主题是**即时预览**的, 那时配置
   * 还没保存。若直接读 cfg.theme, 预览就得先改配置, 取消时再把磁盘配置
   * 改回去 —— 多一次写盘, 而且中途崩溃会把没确认的选择留下来。
   *
   * 初始值优先取 localStorage 缓存: 配置读取是异步的, 等它回来再上色
   * 会让深色用户每次启动闪一下白。缓存由 applyTheme 每次写入。
   */
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    return readCachedTheme() ?? cfg.theme
  })
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ---- 启动: 读配置 + 同步关闭到托盘开关给宿主层 ----
  useEffect(() => {
    if (!IS_TAURI) return
    let cancelled = false

    // 读取磁盘配置 (含旧版 Python 版留下的 config.json)。
    // mergeConfig 只接受已知字段, 损坏或过期的文件不会拖垮启动。
    readConfigFile()
      .then(async (stored) => {
        if (cancelled) return

        if (stored) {
          const merged = mergeConfig(stored)
          setCfg(merged)
          setSizeValidation(merged.sizeValidationEnabled)
          /* 配置是主题的权威来源, 覆盖 localStorage 缓存的首帧猜测 */
          setThemeMode(merged.theme)
          applyConfig(merged)
          document.documentElement.style.setProperty(
            '--row-h',
            `${merged.tableDefaultRowHeight}px`,
          )
          return
        }

        // 首次运行: 把默认配置落盘, 与旧版 Python 版
        // AppConfig.load() 的行为保持一致 —— 否则用户改了设置之后,
        // 配置目录还是空的, 排查问题时看不到任何痕迹。
        await writeConfigFile(globalConfig)
      })
      .catch(() => {
        /* 配置损坏或无写权限时静默使用默认值, 不打扰用户 */
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!IS_TAURI) return
    invoke('set_close_to_tray', { enabled: cfg.closeToTray }).catch(() => {})
    /*
     * 托盘图标开关同理。必须和 closeToTray 一起同步, 而不是各发一次
     * useEffect —— 两个开关在宿主层是"与"关系 (托盘关了还隐藏窗口
     * 会让程序无法找回), 分开发可能撞上中间态。
     */
    invoke('set_tray_enabled', { enabled: cfg.trayEnabled }).catch(() => {})
  }, [cfg.closeToTray, cfg.trayEnabled])

  // ---- 主题 ----
  /*
   * 所有配色变化都从这里出去: 写 <html data-theme>, 同步原生控件配色,
   * 再把窗口标题栏也改成一致的颜色。
   *
   * 'system' 模式下额外挂一个监听 —— 用户在 Windows 设置里切深浅色时,
   * 界面要立刻跟上, 不必等重启。显式 light/dark 时该监听是空操作。
   */
  useEffect(() => {
    const resolved = applyTheme(themeMode)
    void setWindowTheme(resolved)
    return watchSystemTheme(themeMode, (systemDark) => {
      const r = applyTheme(themeMode, systemDark)
      void setWindowTheme(r)
    })
  }, [themeMode])

  // ---- 提示条自动消失 ----
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4200)
    return () => clearTimeout(t)
  }, [toast])

  // ---- 加载源数据 ----
  const loadFromBuffer = useCallback(
    async (buf: ArrayBuffer, name: string, path: string) => {
      setStatus('busy')
      setLog(`正在读取 ${name} …`)
      try {
        const data = await readExcel(buf, name)
        const err = validateSource(data)
        if (err) {
          setStatus('error')
          setLog('加载失败')
          setToast({ kind: 'error', text: err })
          return
        }

        setSource({ columns: data.columns, rows: data.rows })
        setSourcePath(path)

        // 对应 Python 版 load_data: 过滤状态后生成两份透视表
        const active = filterActive(data.rows, cfg)
        const all = generatePivot(active, false, cfg)
        const prod = generatePivot(active, true, cfg)
        setPivotAll(all)
        setPivotProd(prod)

        // 审查页数据
        setReviewAll(processSourceData(data.rows, cfg))
        setPnFilter('全部')

        // 换了一份源数据, 旧的查询命中与下钻路径全部作废
        setQueryHits(EMPTY_ROWS)
        setDrill(null)
        // 之前选中的 P/N 未必还在新数据里, 范围退回"全部数据"
        setPivotScope('all')

        setCanQuery(true)
        setStatus('ready')
        setLog(`已加载 ${data.rows.length} 行 · ${data.columns.length} 列`)
        setToast({ kind: 'ok', text: `源数据加载成功` })
      } catch (e) {
        setStatus('error')
        setLog('加载失败')
        setToast({ kind: 'error', text: `读取失败:${errText(e)}` })
      }
    },
    [cfg],
  )

  /**
   * 只选定文件, 不读盘。
   *
   * 期望的行为是「浏览」和「加载」解耦: 选完先别急着把几百 MB 的
   * Excel 读进来, 用户可以先确认路径再决定加载。
   */
  const browse = useCallback(async () => {
    const picked = await pickExcelFile(cfg.defaultFileDialogPath)
    if (picked) {
      setPendingFile(picked)
      setPendingBuffer(null)
      setSourcePath(picked.path)
      // 只提示已选定, 不动 status —— 这里还什么都没加载。
      setLog(`已选择 ${picked.name}, 点「加载」读取`)
      setToast({ kind: 'info', text: `已选择 ${picked.name}, 点「加载」读取` })
    } else if (!IS_TAURI) {
      fileInputRef.current?.click()
    }
  }, [cfg.defaultFileDialogPath])

  /**
   * 读取并加载当前选定的文件。每次点击都重新读盘,
   * 所以外部改动了源文件后再点一次「加载」就能拿到最新内容。
   */
  const load = useCallback(async () => {
    if (pendingBuffer) {
      // 浏览器回退路径: buffer 已经在选择时读好了
      const { buf, name } = pendingBuffer
      await loadFromBuffer(buf, name, name)
      return
    }
    const file = pendingFile
    if (!file) {
      setToast({ kind: 'error', text: '请先用「浏览」选择文件' })
      return
    }
    setStatus('busy')
    setLog(`正在读取 ${file.name} …`)
    try {
      const buf = await readPickedFile(file.path)
      await loadFromBuffer(buf, file.name, file.path)
    } catch (e) {
      setStatus('error')
      setLog('加载失败')
      setToast({ kind: 'error', text: `读取失败:${errText(e)}` })
    }
  }, [pendingFile, pendingBuffer, loadFromBuffer])

  // ---- 查询 ----
  const runQuery = useCallback(() => {
    if (!source) {
      setToast({ kind: 'error', text: '请先加载源数据' })
      return
    }
    const ids = input
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (ids.length === 0) {
      setToast({ kind: 'error', text: '请输入要查询的 Jig ID' })
      return
    }

    setStatus('busy')
    const d = queryData(source.rows, ids, cfg)
    setDetail(d)
    // 结果透视基于命中的行, 与 Python 版一致
    const hits = source.rows.filter((r) => ids.includes(r['Jig ID']))
    setQueryHits(hits)
    setQueryPivot(generatePivot(hits, false, cfg))
    // 重新查询后旧的透视明细不再属于当前的透视表
    setDrill(null)

    const found = d.rows.filter((r) => r['P/N'] !== NOT_FOUND).length
    setStatus('ready')
    setLog(`查询 ${d.rows.length} 条 · 命中 ${found} · 未找到 ${d.rows.length - found}`)
    setTab('detail')
  }, [source, input, cfg])

  // ---- 智能粘贴 ----
  /**
   * 智能粘贴: 源自 v1.x jig_id_text_edit.py 的双通道处理。
   *
   * 关键点 1: 必须用系统级剪贴板读取, 不能用 navigator.clipboard。
   *   WebView2 里 navigator.clipboard.readText 在 onPaste 中基本必被拒绝,
   *   那样"从邮件正文直接粘贴"这个核心卖点就是失效的。
   *
   * 关键点 2: 读取是异步的, 所以必须同步 preventDefault 先掐断浏览器
   *   默认粘贴, 否则会出现"原文 + 提取结果"两份内容。
   *
   * 失败时返回 null, 文本框照常粘贴原文, 不阻塞用户。
   */
  const onPaste = useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (!cfg.clipboardAutoProcessEnabled) return

      // 先无条件阻断默认粘贴, 后面按需手动写入
      e.preventDefault()
      e.stopPropagation()

      const text = await readClipboardText()
      if (!text) {
        setToast({ kind: 'error', text: '无法读取剪贴板,请检查系统权限' })
        return
      }

      const processed = processClipboardContent(text)
      if (processed === text) {
        // 纯净列表或无 ID: 按原文粘贴, 与旧版行为一致
        setInput((prev) => prev + processed)
        return
      }

      const count = processed.split(/\r?\n/).filter(Boolean).length
      setInput((prev) => {
        const base = prev.replace(/\s*$/, '')
        return base ? `${base}\n${processed}` : processed
      })
      setToast({ kind: 'info', text: `已从粘贴内容提取 ${count} 个 Jig ID` })
    },
    [cfg.clipboardAutoProcessEnabled],
  )

  // ---- 审查页当前视图 ----
  //
  // 两个维度是正交的, 先后顺序不能反:
  //   先按 P/N 过滤 (用户在下拉框选的)
  //   再按审查范围过滤 (工具条的分段按钮)
  // 反过来的话, 计数会随档位变化, 而下拉框本身又依赖已过滤的结果,
  // 会出现"选了某个 P/N 却在收窄后没有该 P/N"的自相矛盾。
  const reviewByPn = useMemo(() => {
    if (reviewAll.rows.length === 0) return EMPTY_PIVOT
    if (pnFilter === '全部') return reviewAll
    return {
      columns: reviewAll.columns,
      rows: reviewAll.rows.filter((r) => r['P/N'] === pnFilter),
    }
  }, [reviewAll, pnFilter])

  const uniquePns = useMemo(() => {
    if (reviewAll.rows.length === 0) return []
    const set = new Set<string>()
    for (const r of reviewAll.rows) {
      const v = r['P/N']
      if (v && v !== NOT_FOUND) set.add(v)
    }
    return [...set].sort()
  }, [reviewAll])

  // ---- 尺寸校验标记 ----
  //
  // 开关只管查询结果页, 数据审查页无条件开启。
  //
  // 这条分歧来自 Python 版: main_window.py:564 / :610 在装载审查表时
  // 直接 model_review.set_size_validation_enabled(True), 把用户配置
  // 强行覆盖掉; 只有 model_detail 是读 checkbox 的 (main_window.py:502)。
  // 业务上也说得通 —— 审查页存在的意义就是挑出尺寸对不上的 JIG,
  // 关掉标红这页就没有内容了。
  //
  // 迁移时曾把开关一刀切在两个表上, 于是 size_validation_enabled=false
  // 的用户打开数据审查页看到的是一片"全部匹配", 与旧版行为不一致,
  // 很容易被误判成数据或算法有问题。
  /*
   * 标红标记 = 分类结果里非 ok 的那些。查询结果页只要一个布尔,
   * 分类本身留给审查页筛行用。
   */
  const mismatchFlags = useCallback(
    (table: Table): boolean[] => classifyReviewTable(table, rules).map(isFlagged),
    [rules],
  )

  const detailFlags = useMemo(
    () => (sizeValidation ? mismatchFlags(detail) : []),
    [detail, mismatchFlags, sizeValidation],
  )

  /*
   * 审查页的分类结果。审查页不过 sizeValidation 开关 —— 这一页的存在意义
   * 就是挑出对不上的 JIG, 关掉标红这页就没有内容了。
   *
   * 保留完整分类(而不是立刻折成布尔), 是因为两档视野要按它筛行;
   * 一行只判一次, 标红与筛选共用同一份结果。
   */
  const reviewKinds = useMemo<ReviewKind[]>(
    () => classifyReviewTable(reviewByPn, rules),
    [reviewByPn, rules],
  )

  const reviewFlags = useMemo(() => reviewKinds.map(isFlagged), [reviewKinds])

  // 两档的行数, 给分档按钮显示。all 用表长, 不另算一遍。
  const reviewCounts = useMemo(
    () => ({
      all: reviewByPn.rows.length,
      mismatch: reviewKinds.filter(isFlagged).length,
    }),
    [reviewKinds, reviewByPn],
  )

  /*
   * 按档筛行。分类数组在这之前算好, 所以这里只做过滤 —— 一行不重复判定。
   *
   * 表里没有「对应尺寸」列(reviewKinds 为空)时不做任何过滤: 否则会把整表
   * 清空, 用户会以为"数据全都不匹配"。这与改造前的处理一致。
   *
   * 过滤掉的行会让 reviewFlags 与新行序错位, 所以另存一份裁剪后的标记给
   * 表格和导出用, 不能直接复用 reviewFlags。
   */
  const reviewFiltered = useMemo(() => {
    if (reviewScope === 'all' || reviewKinds.length === 0) {
      return { table: reviewByPn, flags: reviewFlags }
    }
    const rows: Row[] = []
    const flags: boolean[] = []
    reviewByPn.rows.forEach((r, i) => {
      if (matchesScope(reviewKinds[i], reviewScope)) {
        rows.push(r)
        // 能进这一档的行一定标红, 不必再查一次
        flags.push(true)
      }
    })
    return { table: { columns: reviewByPn.columns, rows }, flags }
  }, [reviewByPn, reviewScope, reviewKinds, reviewFlags])

  const reviewTable = reviewFiltered.table
  const reviewViewFlags = reviewFiltered.flags

  // ---- 透视显示范围 ----
  /*
   * 透视的底数据: 源数据按 Jig 状态过滤后的行。
   * 单独缓存一份, 供 P/N 范围与下钻复用 —— 三处必须拿到同一批行。
   */
  const activeSourceRows = useMemo<Row[]>(
    () => (source ? filterActive(source.rows, cfg) : EMPTY_ROWS),
    [source, cfg],
  )

  const pivotPn = pivotScope.startsWith('pn:') ? pivotScope.slice(3) : ''

  /*
   * 当前透视实际使用的行。选某个 P/N 时先按 P/N 收窄, 再重新生成透视,
   * 而不是只把现有透视表的行筛一筛 —— 后者的总计行仍是全表的数, 与
   * 可见内容矛盾, 下钻也会跟着错。
   */
  const pivotBaseRows = useMemo(
    () =>
      pivotPn
        ? activeSourceRows.filter((r) => r['P/N'] === pivotPn)
        : activeSourceRows,
    [activeSourceRows, pivotPn],
  )

  const currentPivot = useMemo(() => {
    if (!pivotPn) return pivotScope === 'prod' ? pivotProd : pivotAll
    return generatePivot(pivotBaseRows, false, cfg)
  }, [pivotPn, pivotScope, pivotAll, pivotProd, pivotBaseRows, cfg])

  // 下拉框的 P/N 候选项: 取透视小计行的 P/N, 顺序与表格一致
  const pivotPnOptions = useMemo(() => {
    const out: string[] = []
    for (const r of pivotAll.rows) {
      const pn = r['P/N']
      if (r['CST ID'] === SUMMARY_CST && pn && pn !== cfg.keywordTotal) out.push(pn)
    }
    return out
  }, [pivotAll, cfg.keywordTotal])

  // ---- 透视下钻 ----
  const drillActive = drill !== null && drill.from === tab

  /*
   * 每一行所属的 P/N。
   *
   * 透视里明细行的 P/N 刻意留空 (视觉上属于上方的小计行), 总计行写「总计」。
   * 下钻时要把行下标还原成"哪一个 P/N", 必须做同样的上溯, 不能直接读
   * row['P/N'] —— 那样明细行全都变成空 P/N。
   */
  const pivotViewPns = useMemo(
    () =>
      resolvePivotPns(
        tab === 'queryPivot' ? queryPivot : currentPivot,
        cfg.keywordTotal,
      ),
    [tab, queryPivot, currentPivot, cfg.keywordTotal],
  )

  const openDrill = useCallback(
    (rowIndex: number, column: string) => {
      if (tab !== 'pivot' && tab !== 'queryPivot') return
      const from: 'pivot' | 'queryPivot' = tab
      const table = from === 'pivot' ? currentPivot : queryPivot
      const row = table.rows[rowIndex]
      if (!row) return

      const isTotalRow = row['P/N'] === cfg.keywordTotal
      const isSub = row['CST ID'] === SUMMARY_CST
      /*
       * P/N 范围下, 总计行的行内没有 P/N, 但当前视图只覆盖一个 P/N,
       * 点击它必须沿用该 P/N; 否则会被解释成"全表", 筛出其它 P/N 的行。
       */
      const pn = pivotPn || (isTotalRow ? '' : pivotViewPns[rowIndex] ?? '')

      const key: PivotDrillKey = {}
      if (pn) key.pn = pn
      // 只有 CST 明细行才下钻到单个 CST —— 小计行与总计行代表整个分组
      if (!isTotalRow && !isSub) key.cst = row['CST ID']
      // 「总计」列不代表某道工序, 对应"全部工序"
      if (column !== cfg.keywordTotal) key.eng = column

      const base =
        from === 'pivot'
          ? pivotScope === 'prod'
            ? '全量透视 · 生产中'
            : '全量透视'
          : '结果透视'
      const crumbs = [base]
      if (key.pn) crumbs.push(key.pn)
      if (key.cst) crumbs.push(key.cst)
      else if (key.pn) crumbs.push('全部 CST')
      if (key.eng) crumbs.push(key.eng)
      else if (key.pn) crumbs.push('全部工序')
      if (!key.pn && !key.cst && !key.eng) crumbs.push('全表')

      setDrill({
        from,
        key,
        crumbs,
        filterProduction: from === 'pivot' && pivotScope === 'prod',
      })
    },
    [tab, currentPivot, queryPivot, pivotViewPns, cfg.keywordTotal, pivotScope, pivotPn],
  )

  /*
   * 下钻的底数据: 必须与当前显示的透视表用同一批行。
   *   - 全量透视 -> 源数据状态过滤后的行, 选 P/N 时同样收窄到该 P/N
   *   - 结果透视 -> 本次查询命中的行 (快照)
   */
  const drillBaseRows = useMemo<Row[]>(() => {
    if (!drill) return EMPTY_ROWS
    if (drill.from === 'queryPivot') return queryHits
    return pivotBaseRows
  }, [drill, queryHits, pivotBaseRows])

  const drillRows = useMemo(() => {
    if (!drill) return EMPTY_ROWS
    return drillPivotRows(drillBaseRows, drill.key, drill.filterProduction, cfg)
  }, [drill, drillBaseRows, cfg])

  const drillTable = useMemo(
    () => (drill ? buildDetailTable(drillRows, cfg) : EMPTY_PIVOT),
    [drill, drillRows, cfg],
  )

  // 明细同样可以标出尺寸不匹配, 与查询结果页共用同一套分类
  const drillFlags = useMemo(
    () => (sizeValidation ? mismatchFlags(drillTable) : []),
    [sizeValidation, mismatchFlags, drillTable],
  )

  // Esc 退出明细
  useEffect(() => {
    if (!drill) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrill(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drill])

  // ---- 导出 ----
  const exportCurrent = useCallback(async () => {
    // 尺寸不匹配的红色标记只在查询页和审查页写入,
    // 沿用 v1.x main_window.py 里 apply_style 的判定条件。
    const targets: Record<TabId, { table: Table; name: string; red?: RedMark } | null> = {
      detail: detail.rows.length
        ? { table: detail, name: '查询结果', red: { rows: detailFlags, column: '对应尺寸' } }
        : null,
      queryPivot: queryPivot.rows.length ? { table: queryPivot, name: '结果透视表' } : null,
      pivot: currentPivot.rows.length
        ? { table: currentPivot, name: '全量透视表' }
        : null,
      review: reviewTable.rows.length
        ? { table: reviewTable, name: '审查数据', red: { rows: reviewViewFlags, column: '对应尺寸' } }
        : null,
    }

    /*
     * 下钻明细单独走一条: 此时 tab 仍是透视页, 但用户看到的是明细,
     * 导出必须跟着看到的内容走, 否则"导出全量透视"会导出看不见的表。
     */
    const t = drill
      ? {
          table: drillTable,
          name: `透视明细_${drill.crumbs.slice(1).join('_')}`,
          red: { rows: drillFlags, column: '对应尺寸' },
        }
      : targets[tab]
    if (!t) {
      setToast({ kind: 'error', text: '当前页面没有可导出的数据' })
      return
    }

    // 文件名不能含路径分隔符等非法字符 (P/N、工序名里可能出现)
    const safeName = t.name.replace(/[\\/:*?"<>|]/g, '')
    const fileName = cfg.exportTimestampEnabled
      ? withTimestamp(`${safeName}.xlsx`)
      : `${safeName}.xlsx`

    const path = await pickSavePath(fileName, cfg.defaultExportPath)
    if (!path) {
      setToast({ kind: 'error', text: '未选择保存位置' })
      return
    }

    try {
      // 没有任何不匹配时不必传 red, 保持输出文件干净
      const hasRed = t.red?.rows.some(Boolean) ?? false
      const buf = writeExcel(t.table, hasRed ? t.red : undefined)
      await saveToFile(path, new Uint8Array(buf))

      const redCount = t.red?.rows.filter(Boolean).length ?? 0
      setToast({
        kind: 'ok',
        text: redCount
          ? `已导出 ${basename(path)},${redCount} 处尺寸不匹配已标红`
          : `已导出 ${basename(path)}`,
      })
    } catch (e) {
      setToast({ kind: 'error', text: `导出失败:${errText(e)}` })
    }
  }, [detail, detailFlags, queryPivot, currentPivot, reviewTable, reviewViewFlags, tab, cfg, drill, drillTable, drillFlags])

  // ---- 设置 ----
  const draftFrom = (c: AppConfig): SettingsDraft => ({
    defaultFileDialogPath: c.defaultFileDialogPath,
    defaultExportPath: c.defaultExportPath,
    tableDefaultRowHeight: c.tableDefaultRowHeight,
    windowSize: c.windowSize,
    clipboardAutoProcessEnabled: c.clipboardAutoProcessEnabled,
    sizeValidationEnabled: c.sizeValidationEnabled,
    closeToTray: c.closeToTray,
    trayEnabled: c.trayEnabled,
    exportTimestampEnabled: c.exportTimestampEnabled,
    theme: c.theme,
  })

  const saveSettings = (d: SettingsDraft) => {
    const next = { ...cfg, ...d }
    setCfg(next)
    setShowSettings(false)
    setSizeValidation(d.sizeValidationEnabled)
    applyConfig(next)
    setThemeMode(d.theme)
    document.documentElement.style.setProperty('--row-h', `${d.tableDefaultRowHeight}px`)

    // 写回磁盘, 让设置跨启动保留
    writeConfigFile(next)
      .then(() => setToast({ kind: 'ok', text: '设置已保存' }))
      .catch((e) =>
        setToast({ kind: 'error', text: `保存失败:${errText(e)}` }),
      )
  }

  // ---- 型号尺寸匹配 ----
  /**
   * 配置改动后重算所有已加载的表。
   *
   * 「对应尺寸」列不是渲染时现算的, 而是在建表阶段由 query.ts 的
   * applySizeMapping 填进去的; 红字标记也是拿着表内容算的。所以只 setCfg
   * 的话, 界面上的列值还是旧的, 用户会以为保存没生效 —— 更糟的是导出
   * 文件里也是旧值, 拿去做尺寸核对会得出错误结论。
   */
  const rebuildTables = useCallback(
    (next: AppConfig) => {
      if (!source) return
      const active = filterActive(source.rows, next)
      setPivotAll(generatePivot(active, false, next))
      setPivotProd(generatePivot(active, true, next))
      setReviewAll(processSourceData(source.rows, next))

      // 查询结果依赖当前输入框里的 ID, 重新跑一遍同样的流程。
      // 这里不复用 runQuery: 它带状态与日志副作用, 而改配置不是查询动作。
      const ids = input
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
      if (ids.length > 0) {
        setDetail(queryData(source.rows, ids, next))
        const hits = source.rows.filter((r) => ids.includes(r['Jig ID']))
        setQueryHits(hits)
        setQueryPivot(generatePivot(hits, false, next))
      }
    },
    [source, input],
  )

  const saveSizeMapping = (mapping: Record<string, string>, order: string[]) => {
    // 只 patch 自己的两个字段, 不整体覆写配置 —— 那样会把磁盘上其它
    // 字段的当前值一起盖掉。
    const next = { ...cfg, jigSizeMapping: mapping, jigSizeMappingOrder: order }
    setCfg(next)
    setShowSizeMapping(false)
    applyConfig(next)
    rebuildTables(next)

    writeConfigFile(next)
      .then(() =>
        setToast({ kind: 'ok', text: `已保存 ${Object.keys(mapping).length} 条型号尺寸规则` }),
      )
      .catch((e) => setToast({ kind: 'error', text: `保存失败:${errText(e)}` }))
  }

  /**
   * 审查页筛空时的文案: 三种"空"要分开说。
   *
   *   源数据里没有 INPRODUCTION 记录 -> 没东西可审查
   *   该 P/N 下没有记录             -> 是筛选条件的问题, 不是数据的问题
   *   当前档筛空                   -> 换档就能看到别的
   */
  const reviewEmpty = useMemo(() => {
    if (reviewAll.rows.length === 0) {
      return {
        title: '没有可审查的数据',
        hint: '源数据里没有状态为 INPRODUCTION 的记录。',
      }
    }
    if (reviewByPn.rows.length === 0) return REVIEW_EMPTY.all
    return REVIEW_EMPTY[reviewScope]
  }, [reviewAll.rows.length, reviewByPn.rows.length, reviewScope])

  const TABS: { id: TabId; label: string; count: number }[] = [
    { id: 'detail', label: '查询结果', count: detail.rows.length },
    { id: 'queryPivot', label: '结果透视', count: queryPivot.rows.length },
    { id: 'pivot', label: '全量透视', count: currentPivot.rows.length },
    { id: 'review', label: '数据审查', count: reviewTable.rows.length },
  ]
  return (
    <div className="app">
      {/* ---- 第一层: 仪表头 ---- */}
      <header className="head">
        <div className="head__mark">
          <span className="head__name">JIG DATA FINDER</span>
        </div>
        <span
          className="head__path"
          data-empty={!sourcePath}
          title={sourcePath || '尚未选择文件'}
        >
          {sourcePath || '选择 MES 导出的 Excel 文件'}
        </span>
        <button className="btn" type="button" onClick={browse}>
          浏览…
        </button>
        <button
          className="btn btn--primary"
          type="button"
          disabled={status === 'busy' || (!pendingFile && !pendingBuffer)}
          onClick={load}
          title="重新读取当前选定的文件"
        >
          加载
        </button>
        <button className="btn" type="button" onClick={() => setShowSettings(true)}>
          设置
        </button>
        <button
          className="btn"
          type="button"
          title="编辑「Jig 对应型号」到「对应尺寸」的映射规则"
          onClick={() => setShowSizeMapping(true)}
        >
          型号尺寸匹配
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            // 浏览器回退: 路径拿不到, 只能当场读 buffer 暂存,
            // 「加载」按钮随后直接用它。
            const buf = await f.arrayBuffer()
            setPendingBuffer({ buf, name: f.name })
            setPendingFile(null)
            setSourcePath(f.name)
            setLog(`已选择 ${f.name}, 点「加载」读取`)
            e.target.value = ''
          }}
        />
      </header>

      {/* ---- 第二层: 工作区 ---- */}
      <div className="work">
        <aside className="side">
          <div className="side__head">
            <span className="side__label">输入 JIG ID</span>
            <button
              className="btn btn--danger"
              type="button"
              onClick={() => {
                setInput('')
                setDetail(EMPTY_PIVOT)
                setQueryPivot(EMPTY_PIVOT)
                setQueryHits(EMPTY_ROWS)
                setDrill(null)
              }}
            >
              清空
            </button>
          </div>
          <textarea
            className="side__input"
            value={input}
            placeholder={'在此粘贴 Jig ID,每行一个\n也支持从邮件正文直接粘贴'}
            onChange={(e) => setInput(e.target.value)}
            onPaste={onPaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runQuery()
            }}
          />
          <div>
            <button
              className="btn btn--primary btn--tall"
              type="button"
              style={{ width: '100%' }}
              disabled={!canQuery}
              onClick={runQuery}
            >
              开始查询
            </button>
            <div className="side__hint" style={{ marginTop: 8 }}>
              Ctrl+Enter 查询 · 粘贴时自动挑出 Jig ID
            </div>
          </div>
        </aside>

        <main className="main">
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                className="tab"
                role="tab"
                aria-selected={tab === t.id}
                type="button"
                onClick={() => {
                  setTab(t.id)
                  // 下钻属于某张透视表, 切页就退出, 避免"在审查页却挂着透视明细"
                  setDrill(null)
                }}
              >
                {t.label}
                {t.count > 0 && <span className="tab__badge">{t.count}</span>}
              </button>
            ))}
          </div>

          {/* 工序轨道: 透视类页面才显示, 因为它读的是总计行的工序分布 */}
          {(tab === 'pivot' || tab === 'queryPivot') && !drillActive && (
            <StageRail table={tab === 'pivot' ? currentPivot : queryPivot} config={cfg} />
          )}

          {/* 透视明细: 面包屑 + 返回 + 条数, 占原工具条的位置 */}
          {drillActive && drill && (
            <div className="toolbar drill-bar">
              <button
                className="btn"
                type="button"
                onClick={() => setDrill(null)}
                title="返回透视表 (Esc)"
              >
                ← 返回
              </button>
              <nav className="drill-bar__crumbs" aria-label="下钻路径">
                {drill.crumbs.map((c, i) => (
                  <span className="drill-bar__part" key={`${c}-${i}`}>
                    {i > 0 && (
                      <span className="drill-bar__sep" aria-hidden="true">
                        ›
                      </span>
                    )}
                    <span
                      className={
                        i === drill.crumbs.length - 1
                          ? 'drill-bar__crumb drill-bar__crumb--last'
                          : 'drill-bar__crumb'
                      }
                    >
                      {c}
                    </span>
                  </span>
                ))}
              </nav>
              <span className="toolbar__spacer" />
              {sizeValidation && drillFlags.some(Boolean) && (
                <span className="toolbar__label">
                  尺寸不匹配 {drillFlags.filter(Boolean).length} 行
                </span>
              )}
              <span className="toolbar__label">{drillTable.rows.length} 条</span>
            </div>
          )}

          {tab === 'detail' && (
            <div className="toolbar">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={sizeValidation}
                  onChange={(e) => setSizeValidation(e.target.checked)}
                />
                标出尺寸不匹配
              </label>
              <span className="toolbar__spacer" />
              {sizeValidation && (
                <span className="toolbar__label">
                  不匹配 {detailFlags.filter(Boolean).length} 行
                </span>
              )}
            </div>
          )}

          {tab === 'pivot' && !drillActive && (
            <div className="toolbar">
              <span className="toolbar__label">显示范围</span>
              <select
                className="select select--pn"
                value={pivotScope}
                onChange={(e) => setPivotScope(e.target.value as PivotScope)}
              >
                <option value="all">全部数据</option>
                <option value="prod">生产中</option>
                {pivotPnOptions.map((pn) => (
                  <option key={pn} value={`pn:${pn}`}>
                    {pn}
                  </option>
                ))}
              </select>
              <span className="toolbar__spacer" />
            </div>
          )}

          {tab === 'review' && (
            <div className="toolbar">
              <span className="toolbar__label">P/N</span>
              <select
                className="select select--pn"
                value={pnFilter}
                onChange={(e) => setPnFilter(e.target.value)}
              >
                <option value="全部">全部</option>
                {uniquePns.map((pn) => (
                  <option key={pn} value={pn}>
                    {pn}
                  </option>
                ))}
              </select>
              <span className="toolbar__spacer" />
              {/*
                两档视野: 全部 -> 只看标红。每档带行数, 不用先勾上才知道
                有多少行对不上; 导出也跟随当前档。
              */}
              <div className="scope" role="group" aria-label="审查范围">
                {REVIEW_SCOPES.map((s) => (
                  <button
                    key={s.id}
                    className="scope__btn"
                    type="button"
                    aria-pressed={reviewScope === s.id}
                    onClick={() => setReviewScope(s.id)}
                  >
                    {s.label}
                    <span className="scope__count">{reviewCounts[s.id]}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === 'detail' && (
            <Grid
              table={detail}
              mismatchFlags={detailFlags}
              rowHeight={cfg.tableDefaultRowHeight}
              sizeColumn="对应尺寸"
              pnColumn="P/N"
              emptyTitle="还没有查询结果"
              emptyHint="在左侧粘贴 Jig ID 后点「开始查询」。从邮件正文直接粘贴也可以, 程序会自动挑出其中的 ID。"
            />
          )}
          {/*
            透视类页面共用一块区域: 下钻时显示明细, 否则显示透视表。
            计数格传 onCellClick 后即可点击, 标识列与空值格不可点。
          */}
          {drillActive ? (
            <Grid
              table={drillTable}
              mismatchFlags={drillFlags}
              rowHeight={cfg.tableDefaultRowHeight}
              sizeColumn="对应尺寸"
              pnColumn="P/N"
              emptyTitle="这里没有明细"
              emptyHint="透视表的数字来自已加载的源数据; 如果这里为空, 请返回并重新加载文件。"
            />
          ) : tab === 'queryPivot' ? (
            <Grid
              table={queryPivot}
              showRowNumbers={false}
              rowHeight={cfg.tableDefaultRowHeight}
              pinLastColumn={cfg.keywordTotal}
              onCellClick={openDrill}
              emptyTitle="还没有结果透视"
              emptyHint="先执行一次查询, 这里会按 P/N 和工序汇总命中记录。"
            />
          ) : tab === 'pivot' ? (
            <Grid
              table={currentPivot}
              showRowNumbers={false}
              rowHeight={cfg.tableDefaultRowHeight}
              pinLastColumn={cfg.keywordTotal}
              onCellClick={openDrill}
              emptyTitle="还没有加载源数据"
              emptyHint="选择 MES 导出的 Excel 文件开始。支持 .xlsx 与 .xls, 程序只读取不修改源文件。"
            />
          ) : null}
          {tab === 'review' && (
            <Grid
              table={reviewTable}
              mismatchFlags={reviewViewFlags}
              rowHeight={cfg.tableDefaultRowHeight}
              sizeColumn="对应尺寸"
              pnColumn="P/N"
              emptyTitle={reviewEmpty.title}
              emptyHint={reviewEmpty.hint}
            />
          )}

          <div className="actions">
            <button
              className="btn btn--primary btn--tall"
              type="button"
              disabled={!canQuery}
              onClick={exportCurrent}
            >
              {drillActive
                ? '导出透视明细'
                : `导出${TABS.find((t) => t.id === tab)?.label}`}
            </button>
            <span className="actions__spacer" />
          </div>
        </main>
      </div>

      {/* ---- 第三层: 状态轨 ---- */}
      <footer className="rail">
        <span className="rail__dot" data-state={status} />
        <span>{log}</span>
        {status === 'busy' && <span className="rail__bar" aria-label="处理中" />}
        <span className="rail__spacer" />
        {source && (
          <span className="rail__meta">
            源 {source.rows.length} 行 · 当前{' '}
            {(
              drillActive
                ? drillTable
                : tab === 'detail'
                  ? detail
                  : tab === 'queryPivot'
                    ? queryPivot
                    : tab === 'pivot'
                      ? currentPivot
                      : reviewTable
            ).rows.length}{' '}
            行
          </span>
        )}
      </footer>

      {toast && (
        <div className="toast" data-kind={toast.kind} role="status">
          {toast.text}
        </div>
      )}

      {showSettings && (
        <SettingsDialog
          config={cfg}
          initial={draftFrom(cfg)}
          onSave={saveSettings}
          onClose={() => setShowSettings(false)}
          pickDirectory={pickDirectory}
          onThemePreview={setThemeMode}
        />
      )}

      {showSizeMapping && (
        <SizeMappingDialog
          config={cfg}
          onSave={saveSizeMapping}
          onClose={() => setShowSizeMapping(false)}
        />
      )}
    </div>
  )
}

/** 过滤 INPRODUCTION, 对应 Python 版 config.jig_status_column */
function filterActive(rows: Row[], cfg: AppConfig): Row[] {
  const col = cfg.jigStatusColumn
  if (!rows.some((r) => col in r)) return rows
  return rows.filter((r) => r[col] === cfg.jigStatusActiveValue)
}

/**
 * 解析透视表每一行所属的 P/N。
 *
 * 明细行的 P/N 是空串 (视觉上属于上方小计行), 总计行的 P/N 是「总计」,
 * 两者都不能直接当筛选条件用, 所以下钻前先还原成真实的 P/N。
 */
function resolvePivotPns(table: Table, keywordTotal: string): string[] {
  const out: string[] = []
  let current = ''
  for (const r of table.rows) {
    if (r['CST ID'] === SUMMARY_CST) current = r['P/N'] ?? ''
    out.push(r['P/N'] === keywordTotal ? '' : r['P/N'] || current)
  }
  return out
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}