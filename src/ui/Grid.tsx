import type { CSSProperties } from 'react'
import { useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Row, Table } from '../core/table'
import { SUMMARY_CST } from '../core/pivot'

export interface GridProps {
  table: Table
  /** 行号列: 明细表与审查页显示, 透视表不显示 */
  showRowNumbers?: boolean
  /** 触发尺寸校验标红的列名 */
  sizeColumn?: string
  /** P/N 列名, 用于尺寸校验取值 */
  pnColumn?: string
  /** 每行是否尺寸不匹配, 与 table.rows 同序 */
  mismatchFlags?: boolean[]
  emptyTitle: string
  emptyHint: string
  keywordTotal?: string
  /**
   * 需要贴右固定显示的汇总列名 (如 "总计")。
   * 富余宽度不分配给它, 而是分给前面的列, 让它始终紧贴右边缘。
   */
  pinLastColumn?: string
  /** 行高 (px), 需与 CSS --row-h 保持一致 */
  rowHeight?: number
}

/**
 * 显示宽度: CJK 字符按 2 个字位算, 其余按 1 个。
 * 与 CSS 里的等宽字体单位一致 —— 12.5px 的 Cascadia Mono 下, 一个
 * ASCII 约 7.6px, 一个汉字正好约两倍。
 */
function dispWidth(s: string): number {
  let n = 0
  for (const ch of s) n += ch.charCodeAt(0) > 255 ? 2 : 1
  return n
}

/** 判断一行是否为小计行 (CST ID == "--") */
function isSubtotal(row: Row): boolean {
  return row['CST ID'] === SUMMARY_CST
}

/** 判断一行是否为总计行 (P/N == "总计") */
function isTotal(row: Row, keywordTotal: string): boolean {
  return row['P/N'] === keywordTotal
}

/** 单元格内容: 空值统一渲染为非断空格, 保持列高稳定 */
function cell(v: string | undefined): string {
  return v === undefined || v === '' ? '\u00A0' : v
}

/** 计数类列用等宽表格数字, 便于纵向扫读比较大小 */
function isNumericColumn(c: string): boolean {
  return c === 'Slot No' || c === '总计'
}

/** 标识符类列用等宽 */
function isMonoColumn(c: string): boolean {
  return (
    c === 'Jig ID' ||
    c === 'P/N' ||
    c === 'Lot ID' ||
    c === 'CST ID' ||
    c === 'Jig 对应型号'
  )
}

/**
 * 行高常量。
 *
 * 必须与 CSS 的 --row-h 默认值一致 —— 虚拟滚动依赖精确的行高来算
 * 每行的 translateY, 两边不一致会导致滚动错位或露白。
 * 设置里改行高时会同步更新 --row-h, 此时此常量不再适用,
 * 所以 Grid 通过 rowHeight prop 接收实际值。
 */
const DEFAULT_ROW_H = 30
/** 上下各多渲染的行数, 快速滚动不露白 */
const OVERSCAN = 12
/** 行号列宽 */
const IDX_COL_W = 52
/**
 * 列宽估算: 按内容实际长度算, 每列自适应, 不与窗口宽度绑定。
 *
 * 之前有个例外 —— `sizeColumn` (对应尺寸) 被硬编码成 0, 于是落到
 * MIN_COL_W=96 的兜底值。真实值形如 `65_77/27_77/42_77/48_83/48`
 * (26 字符), 需要约 220px, 于是这一列无论窗口多宽都只有 96px,
 * 配合 .grid__td 的 overflow:hidden, 单元格从**左侧**被硬裁掉
 * (显示成 `77/27_77/42_77/48_83`), 头几个字符直接消失。
 * 注意 text-overflow:ellipsis 在这里不生效 —— 单元格是 display:flex,
 * 文本被当作匿名 flex item, 溢出直接被 overflow:hidden 裁掉, 连省略号
 * 都没有, 看起来像数据本身就这样。
 */
const MAX_COL_W = 360
/** 全量扫描的行数上限: 超过则只扫前 N 行, 避免 10 万行时卡顿 */
const MEASURE_ROWS = 5000

export default function Grid({
  table,
  showRowNumbers = true,
  sizeColumn,
  pnColumn,
  mismatchFlags,
  emptyTitle,
  emptyHint,
  keywordTotal = '总计',
  pinLastColumn,
  rowHeight = DEFAULT_ROW_H,
}: GridProps) {
  // 外层 wrap 负责画边框, 内层 scroll 负责滚动。
  // 分开是为了避免"滚动条宽度影响可用宽度, 可用宽度又影响列宽"的循环。
  // 注意: 列宽已不再依赖容器宽度, 这里只留 ref 供虚拟滚动的
  // getScrollElement 使用, 不再需要测量 clientWidth。
  const scrollRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const isEmpty = table.rows.length === 0

  /*
   * 列宽: 每列独立按内容实际长度自适应, 与窗口宽度无关。
   *
   * 之前的做法是把富余量分给某一列, 等于让列宽跟着窗口变 ——
   * 窗口一拉宽, 某列就独吞宽度 (末列"对应尺寸"被拉到 470px);
   * 窗口一收窄, 内容就被 overflow:hidden 从侧面裁掉。现在列宽只由
   * 内容决定: 表格要么刚好放下, 要么整体横向滚动。
   */
  const widths = useMemo(() => {
    if (isEmpty) return [] as number[]
    const sample =
      table.rows.length > MEASURE_ROWS
        ? table.rows.slice(0, MEASURE_ROWS)
        : table.rows
    return table.columns.map((col) => {
      // 表头本身也要放得下 (如 "Glass判定" 比任何数据都宽一点)
      let max = dispWidth(col)
      for (const r of sample) {
        const w = dispWidth(r[col] ?? '')
        if (w > max) max = w
      }
      return Math.min(Math.max(max * 7.6 + 24, 68), MAX_COL_W)
    })
  }, [table, isEmpty])

  const virtualizer = useVirtualizer({
    count: table.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN,
  })

  const sizeIdx = sizeColumn ? table.columns.indexOf(sizeColumn) : -1
  const items = virtualizer.getVirtualItems()
  const totalH = virtualizer.getTotalSize()

  /*
   * 列宽必须由 JS 统一计算并同时绑定到表头和数据单元格。
   *
   * 为什么不能只靠 <colgroup>: 虚拟行是 position:absolute, 已脱离表格的
   * 正常布局流程, 浏览器对绝对定位的表格行不再应用列宽算法。结果是
   * 表头按 <col> 布局、数据行各自按内容撑开, 两边列边界对不上, 且偏差
   * 随列号递增 (实测第 10 列偏了 266px)。
   *
   * 这里给每一列算好确定像素宽, 表头与数据行共用, 不依赖任何表格布局。
   *
   * 列宽**不与容器宽度挂钩**: 宽度只由该列最长内容决定。容器比表格窄
   * 就整体横向滚动, 比表格宽则右侧留白。之前是"把富余量分给某一列",
   * 那等于让列宽跟着窗口变 —— 窗口一拉宽某列就独吞, 一收窄内容就被
   * overflow:hidden 从侧面裁掉, 两个现象是同一个设计缺陷的两面。
   */
  const idxW = showRowNumbers ? IDX_COL_W : 0
  // widths 已保证每项都 > 0, 这里再兜一层, 保证 colTemplate 合法。
  const cols = useMemo(() => widths.map((w) => (w > 0 ? w : 68)), [widths])

  // 汇总列在 column 索引中的位置 (-1 表示无)
  const pinIdx = useMemo(
    () => (pinLastColumn ? table.columns.indexOf(pinLastColumn) : -1),
    [pinLastColumn, table.columns],
  )

  /*
   * 表格可能比容器窄 (窗口很宽时), 这时右侧会空出一块。空隙必须有个
   * 归属, 否则浏览器会自动拉伸某些轨道, 又回到"某列独吞"的老问题。
   *
   * 归属规则: 一律在末尾追加一条空的弹性轨道 (filler), 富余量全部归它。
   * 绝不能给任何内容列 —— 否则最后一列 (审查页的"对应尺寸"、透视页的
   * "总计") 会随窗口拉伸而变宽, 内容居中后两侧留出大片空白。
   *
   * 汇总列「总计」曾经是例外 (用 minmax(w,1fr) 吃掉富余量), 结果在
   * 2043px 窗口下被撑到 479px, 数字孤零零挂在中间。所以现在它和其余
   * 列一样固定宽, 右缘由 filler 顶到容器边界, "总计"照样紧贴右侧。
   *
   * 容器比表格窄时弹性轨道收缩到 0, 表格整体横向滚动, 不影响内容。
   */
  const colTemplate = [
    ...(showRowNumbers ? [`${idxW}px`] : []),
    ...cols.map((w) => `${w}px`),
    'minmax(0px, 1fr)',
  ].join(' ')

  /*
   * 空状态必须放在所有 Hook 之后。
   *
   * 之前它写在使用 ResizeObserver 的 useLayoutEffect 之前, 于是
   * "空表 -> 有数据" 切换时 Hook 调用数量发生跳变, React 抛 #310
   * (渲染时对象结构变了), 整个界面白屏。Rules of Hooks 要求每次
   * 渲染执行相同数量、相同顺序的 Hook, 条件 return 不能出现在中间。
   */
  if (isEmpty) {
    return (
      <div className="grid-wrap" ref={wrapRef}>
        <div className="empty">
          <div className="empty__rule" />
          <div className="empty__title">{emptyTitle}</div>
          <div className="empty__hint">{emptyHint}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid-wrap" ref={wrapRef}>
      <div className="grid-scroll" ref={scrollRef}>
        {/*
          用 CSS Grid 而不是 <table>。
          表格布局对 position:absolute 的 <tr> 有专门处理 —— 不对其应用
          列宽, 导致表头按 <col> 排布、数据行各自按内容撑开, 两边列边界
          对不上 (实测偏差最大 266px)。Grid 没有这个特例: 表头和数据行
          共用同一份 grid-template-columns, 必然对齐。
        */}
        <div className="grid" style={{ '--cols': colTemplate } as CSSProperties}>
          <div className="grid__head" role="row">
            {showRowNumbers && (
              <div className="grid__th" role="columnheader">
                No
              </div>
            )}
            {table.columns.map((c, ci) => (
              <div
                key={c}
                className={[
                  'grid__th',
                  ci === pinIdx ? 'grid__th--total' : '',
                  /*
                   * 表格右缘画一条竖规, 把内容区封闭起来。
                   *
                   * .grid 有 min-width:100%, 表格通常正好占满容器, 所以
                   * 外层 .grid-wrap 的边框就是右缘; 但列宽总和超过容器时
                   * (横向滚动), 右缘会跑到可视区之外, 内容看起来像没有
                   * 收尾。这里给最后一列补一条 border-right, 无论滚动与否
                   * 都有明确的结束边界。
                   */
                  ci === table.columns.length - 1 ? 'grid__th--edge' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                role="columnheader"
              >
                {c}
              </div>
            ))}
          </div>

          <div className="grid__body" style={{ height: totalH }}>
            {items.map((vi) => {
              const row = table.rows[vi.index]
              const sub = isSubtotal(row)
              const total = isTotal(row, keywordTotal)
              const bad = mismatchFlags?.[vi.index] === true

              return (
                <div
                  key={vi.key}
                  role="row"
                  className={[
                    'grid__tr',
                    sub ? 'is-sub' : '',
                    total ? 'is-total' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: vi.size,
                    transform: `translateY(${vi.start}px)`,
                  }}
                >
                  {showRowNumbers && (
                    <div className="grid__td grid__td--idx">{vi.index + 1}</div>
                  )}
                  {table.columns.map((c, ci) => {
                    /*
                     * ci 就是 table.columns 的下标, 与 sizeIdx / pinIdx
                     * 同处一个坐标空间, 不能减 offset。
                     *
                     * 早先这里写了 `const realIdx = ci - offset`, 理由大概是
                     * 想抵消行号列, 但 table.columns.map 根本不包含行号列,
                     * 多减一次导致后面每一列的判定都错位一格: 显示行号的表
                     * (明细/审查页) 里 isSize 永远为 false, 尺寸验证的红字
                     * 一行都不会出现 —— 而透视页 showRowNumbers=false 时
                     * offset 恰为 0, 反而正常, 所以只有这两页坏掉, 很容易
                     * 误判成数据或开关的问题。
                     */
                    const isSize = sizeIdx >= 0 && ci === sizeIdx
                    const isLast = ci === table.columns.length - 1
                    const cls = [
                      isNumericColumn(c) ? 'num' : isMonoColumn(c) ? 'mono' : '',
                      isSize && bad ? 'bad bad-bg' : '',
                      /*
                       * 汇总列: 数字右对齐 + 左侧竖规。
                       * 右对齐是报表惯例 —— 数字位数不同时个位能扫成
                       * 一条竖线; 竖规则把它与明细列在视觉上分开。
                       */
                      ci === pinIdx ? 'grid__td--total' : '',
                      // 末列右缘竖规, 与表头对齐, 封闭表格 (见上方说明)
                      isLast ? 'grid__td--edge' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')

                    const title =
                      isSize && bad && pnColumn
                        ? `P/N ${row[pnColumn] ?? ''} 与尺寸 ${row[c] ?? ''} 不匹配`
                        : undefined

                    return (
                      <div
                        key={c}
                        className={cls ? `grid__td ${cls}` : 'grid__td'}
                        title={title}
                      >
                        {cell(row[c])}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
