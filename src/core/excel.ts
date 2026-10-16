/**
 * Excel 读写 —— 封装 xlsx 库, 对齐 pandas dtype=str + keep_default_na=False
 */

import * as XLSX from 'xlsx'
import type { Row } from './table'

export interface SourceData {
  columns: string[]
  rows: Row[]
  fileName: string
}

export async function readExcel(
  arrayBuffer: ArrayBuffer,
  fileName: string,
): Promise<SourceData> {
  const wb = XLSX.read(arrayBuffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) throw new Error('这个文件里没有可读的工作表')

  // raw:false 让数字列以格式化字符串返回, 对应 pandas 的 dtype=str,
  // 否则 Slot No 之类的编号会变成 "7" 与 7 混用, 破坏排序与字符串比较。
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    raw: false,
    defval: '',
  })

  const headerRow = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 })[0]
  const columns = (Array.isArray(headerRow) ? headerRow : []).map((c) =>
    String(c ?? '').trim(),
  )

  const rows: Row[] = raw.map((rec) => {
    const out: Row = {}
    for (const c of columns) {
      const v = rec[c]
      out[c] = v === undefined || v === null ? '' : String(v)
    }
    return out
  })

  return { columns, rows, fileName }
}

/** 校验关键列, 对应 Python 版 missing_jig_id_column 检查 */
export function validateSource(data: SourceData): string | null {
  if (!data.columns.includes('Jig ID')) {
    return "源文件中未找到 Jig ID 列,请检查表头。"
  }
  return null
}

/** 写出表格为 xlsx */
export function writeExcel(table: { columns: string[]; rows: Row[] }): ArrayBuffer {
  const ws = XLSX.utils.json_to_sheet(table.rows, { header: table.columns })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return out as ArrayBuffer
}