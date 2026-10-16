import type { CSSProperties } from 'react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
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
/** 未指定宽度的列 (如"对应尺寸") 的兜底宽度 */
const MIN_COL_W = 96

export default function Grid({
  table,
  showRowNumbers = true,
  sizeColumn,
  pnColumn,
  mismatchFlags,
  emptyTitle,
  emptyHint,
  keywordTotal = '总计',
  rowHeight = DEFAULT_ROW_H,
}: GridProps & { rowHeight?: number }) {
  // 外层 wrap 负责画边框并提供可用宽度, 内层 scroll 负责滚动。
  // 分开是为了避免"滚动条宽度影响可用宽度, 可用宽度又影响列宽"的循环。
  const wrapRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [wrapW, setWrapW] = useState(0)
  const isEmpty = table.rows.length === 0

  // 列宽: 采样前 200 行估算, 避免大表全量扫描
  const widths = useMemo(() => {
    if (isEmpty) return [] as number[]
    const sample = table.rows.slice(0, 200)
    return table.columns.map((col) => {
      if (col === sizeColumn) return 0
      let max = [...col].reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 2 : 1), 0)
      for (const r of sample) {
        const w = [...(r[col] ?? '')].reduce(
          (n, ch) => n + (ch.charCodeAt(0) > 255 ? 2 : 1),
          0,
        )
        if (w > max) max = w
      }
      return Math.min(Math.max(max * 7.6 + 24, 68), 300)
    })
  }, [table, sizeColumn, isEmpty])

  const virtualizer = useVirtualizer({
    count: table.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN,
  })

  if (isEmpty) {
    return (
      <div className="grid-wrap">
        <div className="empty">
          <div className="empty__rule" />
          <div className="empty__title">{emptyTitle}</div>
          <div className="empty__hint">{emptyHint}</div>
        </div>
      </div>
    )
  }

  const offset = showRowNumbers ? 1 : 0
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
   */
  const idxW = showRowNumbers ? IDX_COL_W : 0
  // widths 本身来自 useMemo, 这里只做一次兜底替换, 结果同样缓存,
  // 否则每次渲染都是新数组, 下游 useMemo 的依赖永远在变。
  const baseWidths = useMemo(
    () => widths.map((w) => (w > 0 ? w : MIN_COL_W)),
    [widths],
  )

  /*
   * 容器宽度未知 (首帧还没测量), 且列宽总和小于容器时, 浏览器会把富余
   * 空间重新分配给各列 —— 各列内容长度不同, 分到的量也不同, 于是又
   * 出现错位 (实测最大偏 79px, 且随列号递增)。
   *
   * 解决办法: 测量滚动容器的实际可用宽度, 把富余量全部塞给最后一列。
   * 这样除最后一列外, 每列都是精确值, 表头与数据行必然对齐;
   * 最后一列多出来的宽度两边一致, 也不会错位。
   *
   * 注意必须测 .grid-scroll 的 clientWidth, 不能测外层 .grid-wrap:
   * 横向滚动条出现/消失会改变 scroll 的可用宽度, 而表格宽度是根据
   * scroll 的可用宽度算的, 用外层测会差出一个滚动条的宽度
   * (实测 10 万行时差 6px)。
   */

  useLayoutEffect(() => {
    const outer = wrapRef.current
    const inner = scrollRef.current
    if (!outer || !inner) return

    const measure = () => {
      // clientWidth 已扣除滚动条, 正是表格可以占用的宽度
      setWrapW(Math.round(inner.clientWidth))
    }

    const ro = new ResizeObserver(measure)
    ro.observe(outer)
    ro.observe(inner)
    measure()
    return () => ro.disconnect()
  }, [])

  const resolved = useMemo(() => {
    const sum = baseWidths.reduce((a, b) => a + b, 0)
    // 容器已测量且比列宽总和宽 -> 富余量给最后一列。
    // 若列宽总和本来就超过容器, 不做任何调整: 表格进入横向滚动,
    // 此时各列严格按给定宽度排布, 本来就对齐。
    const lastIdx = baseWidths.length - 1
    const cols =
      wrapW > sum && lastIdx >= 0
        ? baseWidths.map((w, i) => (i === lastIdx ? w + (wrapW - sum) : w))
        : baseWidths
    return {
      cols,
      sum: cols.reduce((a, b) => a + b, 0),
      idxW,
    }
  }, [baseWidths, wrapW, idxW])

  /*
   * grid-template-columns 的值。表头与所有数据行共用这一份定义,
   * 所以列边界必然一致 —— 这是修掉错位的关键。
   */
  const colTemplate = [
    ...(showRowNumbers ? [`${resolved.idxW}px`] : []),
    ...resolved.cols.map((w) => `${w}px`),
  ].join(' ')

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
            {table.columns.map((c) => (
              <div key={c} className="grid__th" role="columnheader">
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
                    const realIdx = ci - offset
                    const isSize = sizeIdx >= 0 && realIdx === sizeIdx
                    const cls = [
                      isNumericColumn(c) ? 'num' : isMonoColumn(c) ? 'mono' : '',
                      isSize && bad ? 'bad bad-bg' : '',
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
