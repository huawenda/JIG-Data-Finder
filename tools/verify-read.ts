/**
 * 读文件链路验证 —— 确认 readExcel 对真实 xlsx 的解析结果
 *
 * 这条链路在 Tauri 里是: dialog 选路径 -> plugin-fs readFile ->
 * Uint8Array -> ArrayBuffer -> XLSX.read。
 * 这里覆盖 ArrayBuffer 之后的部分, plugin-fs 由真机验证覆盖。
 *
 * 运行: npx vite-node tools/verify-read.ts
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readExcel, validateSource } from '../src/core/excel'

const FIXTURE = 'jig数据整理.xlsx'

// plugin-fs 返回 Uint8Array, 这里同样走一遍转换
const bytes = readFileSync(resolve(process.cwd(), FIXTURE))
const arrayBuffer = bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
) as ArrayBuffer

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  [OK]   ${label}`)
  } else {
    failures += 1
    console.log(`  [FAIL] ${label}${detail ? ' :: ' + detail : ''}`)
  }
}

console.log('\n=== Excel 读取链路验证 ===\n')

const data = await readExcel(arrayBuffer, FIXTURE)

check('读出行数 = 205', data.rows.length === 205, `实际 ${data.rows.length}`)
check(
  '读出 9 列',
  data.columns.length === 9,
  `实际 ${data.columns.length}: ${data.columns.join(' | ')}`,
)
check('列序与基线一致', JSON.stringify(data.columns) === JSON.stringify([
  'P/N', 'Lot ID', 'CST ID', 'Slot No', 'Jig ID',
  'Jig 对应型号', 'Glass判定', '工程', '工程名',
]), data.columns.join(' | '))

const err = validateSource(data)
check('Jig ID 列校验通过', err === null, err ?? '')

// 所有单元格都必须是字符串, 否则 Slot No 会变成数字, 破坏排序
const sample = data.rows[0]
check('单元格均为字符串类型', typeof sample['Slot No'] === 'string', `类型 ${typeof sample['Slot No']}`)
check('Slot No 无小数点后缀', !String(sample['Slot No']).includes('.'), `值 "${sample['Slot No']}"`)

const uniqueIds = new Set(data.rows.map((r) => r['Jig ID']))
check('Jig ID 全部唯一 (205 个)', uniqueIds.size === 205, `实际 ${uniqueIds.size}`)

console.log(`\n首行样例: ${JSON.stringify(sample, null, 0).slice(0, 200)}`)
console.log(`\n=== 结果: ${failures === 0 ? '全部通过' : failures + ' 项失败'} ===\n`)
process.exit(failures === 0 ? 0 : 1)