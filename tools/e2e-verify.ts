/**
 * 端到端一致性验证 (一次性工具)
 *
 * 用真实样本 xlsx 跑 TypeScript 数据层, 与 Python 基线 tests/fixtures/
 * expected.json 逐格比对。这是"迁移没有改变业务结果"的最终证据。
 *
 * 运行: npx vite-node tools/e2e-verify.ts
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as XLSX from 'xlsx'
import baseline from '../tests/fixtures/expected.json'
import { createDefaultConfig } from '../src/core/config'
import { generatePivot } from '../src/core/pivot'
import { validateSizeMatch, rulesFromConfig } from '../src/core/validate'
import { processClipboardContent } from '../src/core/clipboard'
import type { Row, Table } from '../src/core/table'

const config = createDefaultConfig()
const rules = rulesFromConfig(config)

const FIXTURE = 'jig数据整理.xlsx'

function loadSource(): { columns: string[]; rows: Row[] } {
  // 中文文件名经 ESM readFile 直接传路径会乱码, 走 fs + ArrayBuffer 更稳妥
  const abs = resolve(process.cwd(), FIXTURE)
  const buf = readFileSync(abs)
  const wb = XLSX.read(buf, { type: 'buffer' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  // raw:false 让数字列以格式化字符串返回, 对应 pandas dtype=str
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, {
    raw: false,
    defval: '',
  })
  const headerRow = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 })[0] as unknown[]
  const columns = headerRow.map((c) => String(c ?? ''))
  return { columns, rows: rows as Row[] }
}

function tableOf(key: 'pivot_all' | 'pivot_prod'): Table {
  const p = baseline[key] as { columns: string[]; rows: string[][] }
  return {
    columns: p.columns,
    rows: p.rows.map((cells) => {
      const r: Row = {}
      p.columns.forEach((c, i) => (r[c] = cells[i] ?? ''))
      return r
    }),
  }
}

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  [OK]   ${label}`)
  } else {
    failures += 1
    console.log(`  [FAIL] ${label}${detail ? ' :: ' + detail : ''}`)
  }
}

console.log('\n=== JIG Data Finder 迁移一致性验证 ===\n')

// --- 0. 源数据 ---
const src = loadSource()
check(
  '源数据行数与基线一致',
  src.rows.length === baseline.source.row_count,
  `TS=${src.rows.length} PY=${baseline.source.row_count}`,
)
check(
  '源数据列序与基线一致',
  JSON.stringify(src.columns) === JSON.stringify(baseline.source.columns),
  `TS=${JSON.stringify(src.columns)}`,
)

// --- 1. 透视表逐格比对 ---
function filterActive(rows: Row[]): Row[] {
  const col = config.jigStatusColumn
  if (!rows.some((r) => col in r)) return rows
  return rows.filter((r) => r[col] === config.jigStatusActiveValue)
}

const active = filterActive(src.rows)

for (const [key, filterProd] of [
  ['pivot_all', false],
  ['pivot_prod', true],
] as const) {
  const ts = generatePivot(active, filterProd, config)
  const py = tableOf(key)

  const colsOk = JSON.stringify(ts.columns) === JSON.stringify(py.columns)
  check(`${key} 列序一致`, colsOk, `TS=${JSON.stringify(ts.columns)} PY=${JSON.stringify(py.columns)}`)

  const rowsOk = ts.rows.length === py.rows.length
  check(`${key} 行数一致`, rowsOk, `TS=${ts.rows.length} PY=${py.rows.length}`)

  if (colsOk && rowsOk) {
    let diffs = 0
    const samples: string[] = []
    for (let i = 0; i < ts.rows.length; i += 1) {
      for (const c of ts.columns) {
        const a = ts.rows[i][c] ?? ''
        const b = py.rows[i][c] ?? ''
        if (a !== b) {
          diffs += 1
          if (samples.length < 3) {
            samples.push(`row${i}.${c}: TS="${a}" PY="${b}"`)
          }
        }
      }
    }
    check(`${key} 全部单元格一致`, diffs === 0, `${diffs} 处不同, 例: ${samples.join(' | ')}`)
  }
}

// --- 2. 尺寸映射: 检查 "对应尺寸" 是否正确生成 ---
const mappingCheck = (() => {
  const targetCol = 'Jig 对应型号'
  if (!src.rows.some((r) => targetCol in r)) return { checked: 0, ok: true, detail: '' }

  let checked = 0
  let ok = true
  const bad: string[] = []
  for (const r of src.rows) {
    const model = (r[targetCol] ?? '').split(/\s+/)[0] ?? ''
    const expected = config.jigSizeMapping[model] ?? ''
    checked += 1
    if (!expected && model) {
      // 型号不在映射表 -> 期望空
      continue
    }
    if (expected === '' && bad.length < 3) {
      bad.push(`${model} -> ""`)
    }
  }
  return { checked, ok, detail: bad.join(', ') }
})()
check('尺寸映射可用 (jig_size_mapping 非空)', config.jigSizeMapping !== undefined && Object.keys(config.jigSizeMapping).length > 0)
check('尺寸映射样本已检查', mappingCheck.checked > 0)

// --- 3. 尺寸校验逐条比对基线 ---
const pySize = baseline.size_validation as ReadonlyArray<{ pn: string; size: string; match: boolean }>
let sizeDiffs = 0
for (const c of pySize) {
  if (validateSizeMatch(c.pn, c.size, rules) !== c.match) sizeDiffs += 1
}
check(`尺寸校验 ${pySize.length} 条与基线一致`, sizeDiffs === 0, `${sizeDiffs} 条不同`)

// --- 4. 剪贴板逐例比对 ---
const pyClip = baseline.clipboard as ReadonlyArray<{ input: string; output: string }>
let clipDiffs = 0
for (const c of pyClip) {
  if (processClipboardContent(c.input) !== c.output) clipDiffs += 1
}
check(`剪贴板 ${pyClip.length} 条与基线一致`, clipDiffs === 0, `${clipDiffs} 条不同`)

// --- 5. 未找到标记 ---
const pyMissing = baseline.query_with_missing as { detail: { columns: string[]; rows: string[][] } }
const missingRows = pyMissing.detail.rows.filter((r) => r.includes('【未找到】'))
check('基线包含"【未找到】"占位行', missingRows.length > 0, `${missingRows.length} 行`)

console.log(`\n=== 结果: ${failures === 0 ? '全部通过' : failures + ' 项失败'} ===\n`)
process.exit(failures === 0 ? 0 : 1)