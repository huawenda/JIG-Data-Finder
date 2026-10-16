import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

import { config as globalConfig, mergeConfig, applyConfig } from './core/config'
import type { AppConfig } from './core/config'
import { generatePivot } from './core/pivot'
import { queryData, processSourceData, NOT_FOUND } from './core/query'
import { processClipboardContent } from './core/clipboard'
import { validateSizeMatch, rulesFromConfig } from './core/validate'
import { readExcel, validateSource, writeExcel } from './core/excel'
import type { RedMark } from './core/excel'
import type { Row, Table } from './core/table'
import { emptyTable } from './core/table'

import Grid from './ui/Grid'
import StageRail from './ui/StageRail'
import SettingsDialog from './ui/SettingsDialog'
import type { SettingsDraft } from './ui/SettingsDialog'
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
  withTimestamp,
} from './ui/bridge'

import './styles/app.css'

type TabId = 'detail' | 'queryPivot' | 'pivot' | 'review'
type Status = 'idle' | 'ready' | 'busy' | 'error'

interface Toast {
  kind: 'info' | 'ok' | 'error'
  text: string
}

const EMPTY_PIVOT: Table = emptyTable()

export default function App() {
  const [cfg, setCfg] = useState<AppConfig>(globalConfig)
  const rules = useMemo(() => rulesFromConfig(cfg), [cfg])

  const [source, setSource] = useState<{ columns: string[]; rows: Row[] } | null>(null)
  const [sourcePath, setSourcePath] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [log, setLog] = useState('等待加载源数据')
  const [toast, setToast] = useState<Toast | null>(null)

  const [tab, setTab] = useState<TabId>('detail')
  const [input, setInput] = useState('')
  const [canQuery, setCanQuery] = useState(false)

  // 全量透视: 全部 / 生产中
  const [pivotAll, setPivotAll] = useState<Table>(EMPTY_PIVOT)
  const [pivotProd, setPivotProd] = useState<Table>(EMPTY_PIVOT)
  const [pivotScope, setPivotScope] = useState<'all' | 'prod'>('all')

  // 查询结果
  const [detail, setDetail] = useState<Table>(EMPTY_PIVOT)
  const [queryPivot, setQueryPivot] = useState<Table>(EMPTY_PIVOT)

  // 审查页
  const [reviewAll, setReviewAll] = useState<Table>(EMPTY_PIVOT)
  const [pnFilter, setPnFilter] = useState('全部')

  const [sizeValidation, setSizeValidation] = useState(cfg.sizeValidationEnabled)
  const [showSettings, setShowSettings] = useState(false)
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
  }, [cfg.closeToTray])

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

  const browse = useCallback(async () => {
    const picked = await pickExcelFile(cfg.defaultFileDialogPath)
    if (picked) {
      setStatus('busy')
      setLog(`正在读取 ${picked.name} …`)
      try {
        const buf = await readPickedFile(picked.path)
        await loadFromBuffer(buf, picked.name, picked.path)
      } catch (e) {
        setStatus('error')
        setLog('打开失败')
        setToast({ kind: 'error', text: `打开失败:${errText(e)}` })
      }
    } else if (!IS_TAURI) {
      fileInputRef.current?.click()
    }
  }, [cfg.defaultFileDialogPath, loadFromBuffer])

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
    setQueryPivot(generatePivot(hits, false, cfg))

    const found = d.rows.filter((r) => r['P/N'] !== NOT_FOUND).length
    setStatus('ready')
    setLog(`查询 ${d.rows.length} 条 · 命中 ${found} · 未找到 ${d.rows.length - found}`)
    setTab('detail')
  }, [source, input, cfg])

  // ---- 智能粘贴 ----
  /**
   * 智能粘贴: 对应旧版 tools/legacy/src/ui/jig_id_text_edit.py 的双通道处理。
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
  const reviewTable = useMemo(() => {
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
  const mismatchFlags = useCallback(
    (table: Table): boolean[] => {
      if (!sizeValidation) return []
      if (!table.columns.includes('对应尺寸')) return []
      return table.rows.map((r) => !validateSizeMatch(r['P/N'] ?? '', r['对应尺寸'] ?? '', rules))
    },
    [sizeValidation, rules],
  )

  const detailFlags = useMemo(() => mismatchFlags(detail), [detail, mismatchFlags])
  const reviewFlags = useMemo(() => mismatchFlags(reviewTable), [reviewTable, mismatchFlags])

  // ---- 导出 ----
  const exportCurrent = useCallback(async () => {
    const currentPivot = pivotScope === 'all' ? pivotAll : pivotProd

    // 尺寸不匹配的红色标记只在查询页和审查页写入,
    // 对应旧版 tools/legacy/src/ui/main_window.py 里 apply_style 的判定条件。
    const targets: Record<TabId, { table: Table; name: string; red?: RedMark } | null> = {
      detail: detail.rows.length
        ? { table: detail, name: '查询结果', red: { rows: detailFlags, column: '对应尺寸' } }
        : null,
      queryPivot: queryPivot.rows.length ? { table: queryPivot, name: '结果透视表' } : null,
      pivot: currentPivot.rows.length
        ? { table: currentPivot, name: '全量透视表' }
        : null,
      review: reviewTable.rows.length
        ? { table: reviewTable, name: '审查数据', red: { rows: reviewFlags, column: '对应尺寸' } }
        : null,
    }

    const t = targets[tab]
    if (!t) {
      setToast({ kind: 'error', text: '当前页面没有可导出的数据' })
      return
    }

    const fileName = cfg.exportTimestampEnabled
      ? withTimestamp(`${t.name}.xlsx`)
      : `${t.name}.xlsx`

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
  }, [detail, detailFlags, queryPivot, pivotAll, pivotProd, pivotScope, reviewTable, reviewFlags, tab, cfg])

  // ---- 设置 ----
  const draftFrom = (c: AppConfig): SettingsDraft => ({
    defaultFileDialogPath: c.defaultFileDialogPath,
    defaultExportPath: c.defaultExportPath,
    tableDefaultRowHeight: c.tableDefaultRowHeight,
    windowSize: c.windowSize,
    clipboardAutoProcessEnabled: c.clipboardAutoProcessEnabled,
    sizeValidationEnabled: c.sizeValidationEnabled,
    closeToTray: c.closeToTray,
    exportTimestampEnabled: c.exportTimestampEnabled,
  })

  const saveSettings = (d: SettingsDraft) => {
    const next = { ...cfg, ...d }
    setCfg(next)
    setShowSettings(false)
    setSizeValidation(d.sizeValidationEnabled)
    applyConfig(next)
    document.documentElement.style.setProperty('--row-h', `${d.tableDefaultRowHeight}px`)

    // 写回磁盘, 让设置跨启动保留
    writeConfigFile(next)
      .then(() => setToast({ kind: 'ok', text: '设置已保存' }))
      .catch((e) =>
        setToast({ kind: 'error', text: `保存失败:${errText(e)}` }),
      )
  }

  const currentPivot = pivotScope === 'all' ? pivotAll : pivotProd

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
          disabled={status === 'busy' || !sourcePath}
          onClick={browse}
        >
          加载
        </button>
        <button className="btn" type="button" onClick={() => setShowSettings(true)}>
          设置
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            await loadFromBuffer(await f.arrayBuffer(), f.name, f.name)
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
                onClick={() => setTab(t.id)}
              >
                {t.label}
                {t.count > 0 && <span className="tab__badge">{t.count}</span>}
              </button>
            ))}
          </div>

          {/* 工序轨道: 透视类页面才显示, 因为它读的是总计行的工序分布 */}
          {(tab === 'pivot' || tab === 'queryPivot') && (
            <StageRail table={tab === 'pivot' ? currentPivot : queryPivot} config={cfg} />
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

          {tab === 'pivot' && (
            <div className="toolbar">
              <span className="toolbar__label">显示范围</span>
              <select
                className="select"
                value={pivotScope}
                onChange={(e) => setPivotScope(e.target.value as 'all' | 'prod')}
              >
                <option value="all">全部数据</option>
                <option value="prod">生产中</option>
              </select>
              <span className="toolbar__spacer" />
            </div>
          )}

          {tab === 'review' && (
            <div className="toolbar">
              <span className="toolbar__label">P/N</span>
              <select
                className="select"
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
              <span className="toolbar__label">
                尺寸不匹配 {reviewFlags.filter(Boolean).length} 行
              </span>
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
          {tab === 'queryPivot' && (
            <Grid
              table={queryPivot}
              showRowNumbers={false}
              rowHeight={cfg.tableDefaultRowHeight}
              emptyTitle="还没有结果透视"
              emptyHint="先执行一次查询, 这里会按 P/N 和工序汇总命中记录。"
            />
          )}
          {tab === 'pivot' && (
            <Grid
              table={currentPivot}
              showRowNumbers={false}
              rowHeight={cfg.tableDefaultRowHeight}
              emptyTitle="还没有加载源数据"
              emptyHint="选择 MES 导出的 Excel 文件开始。支持 .xlsx 与 .xls, 程序只读取不修改源文件。"
            />
          )}
          {tab === 'review' && (
            <Grid
              table={reviewTable}
              mismatchFlags={reviewFlags}
              rowHeight={cfg.tableDefaultRowHeight}
              sizeColumn="对应尺寸"
              pnColumn="P/N"
              emptyTitle="没有可审查的数据"
              emptyHint="源数据里没有状态为 INPRODUCTION 的记录。"
            />
          )}

          <div className="actions">
            <button
              className="btn btn--primary btn--tall"
              type="button"
              disabled={!canQuery}
              onClick={exportCurrent}
            >
              导出{TABS.find((t) => t.id === tab)?.label}
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
              tab === 'detail'
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

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}