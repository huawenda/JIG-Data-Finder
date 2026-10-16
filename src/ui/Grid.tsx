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
  const scrollRef = useRef<HTMLDivElement>(null)
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

  return (
    <div className="grid-wrap" ref={scrollRef}>
      <table className="grid grid--virtual">
        <colgroup>
          {showRowNumbers && <col style={{ width: 52 }} />}
          {widths.map((w, i) => (
            <col key={table.columns[i]} style={w > 0 ? { width: w } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {showRowNumbers && <th scope="col">No</th>}
            {table.columns.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        {/*
          虚拟行: 只渲染可视区附近的行, 用绝对定位落在预留高度上。
          表格高度撑满 totalSize, 滚动条长度才有意义。
        */}
        <tbody style={{ height: totalH, position: 'relative' }}>
          {items.map((vi) => {
            const row = table.rows[vi.index]
            const sub = isSubtotal(row)
            const total = isTotal(row, keywordTotal)
            const bad = mismatchFlags?.[vi.index] === true

            return (
              <tr
                key={vi.key}
                className={total ? 'is-total' : sub ? 'is-sub' : undefined}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: vi.size,
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                {showRowNumbers && <td className="idx">{vi.index + 1}</td>}
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
                    <td key={c} className={cls} title={title}>
                      {cell(row[c])}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}