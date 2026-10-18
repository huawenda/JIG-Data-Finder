/**
 * 校验 test-500.xlsx 的覆盖面与正确性。
 *
 * 关键点: 尺寸标红的判定直接调用 src/core/validate.ts 的 validateSizeMatch,
 * 而不是在校验脚本里复刻一遍规则 —— 复刻会引入第二份逻辑, 两份逻辑一旦
 * 漂移, 校验就成了自说自话。
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx-js-style'
import { validateSizeMatch, rulesFromConfig } from '../../src/core/validate'
import { createDefaultConfig } from '../../src/core/config'
import { extractJigIds } from '../../src/core/clipboard'

const FIXTURE = resolve(__dirname, '..', '..', 'test-500.xlsx')
const wb = XLSX.read(readFileSync(FIXTURE))
const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], {
  raw: false,
  defval: '',
})
const cfg = createDefaultConfig()
const rules = rulesFromConfig(cfg)

describe('test-500.xlsx', () => {
  it('有 500 行数据', () => {
    expect(rows.length).toBe(500)
  })

  it('列序与真实导出完全一致, 含末尾的 Jig状态', () => {
    expect(Object.keys(rows[0])).toEqual([
      'P/N', 'Lot ID', 'CST ID', 'Slot No', 'Jig ID',
      'Jig 对应型号', 'Glass判定', '工程', '工程名', 'Jig状态',
    ])
  })

  it('Jig状态 覆盖在产与已入库, 审查页应只显示在产部分', () => {
    const states = new Set(rows.map((r) => r['Jig状态']))
    // 不能全是 INPRODUCTION, 否则筛不出东西, 测不到过滤规则
    expect(states.has(cfg.jigStatusActiveValue)).toBe(true)
    expect(states.size).toBeGreaterThan(1)
    const inProd = rows.filter((r) => r['Jig状态'] === cfg.jigStatusActiveValue).length
    expect(inProd).toBeGreaterThan(0)
    expect(inProd).toBeLessThan(rows.length)
  })

  it('覆盖 engineeringConfig 的全部 10 道工序', () => {
    const present = new Set(rows.map((r) => r['工程名'] as string))
    for (const stage of Object.keys(cfg.engineeringConfig)) {
      expect(present.has(stage), `缺少工序 ${stage}`).toBe(true)
    }
    expect(present.size).toBe(10)
  })

  it('工程号覆盖多个, 且包含生产中判定值 50000', () => {
    const codes = new Set(rows.map((r) => String(r['工程'])))
    expect(codes.size).toBeGreaterThan(1)
    expect(codes.has(cfg.productionIndicatorCode)).toBe(true)
  })

  it('包含多个不同的 P/N', () => {
    expect(new Set(rows.map((r) => r['P/N'])).size).toBe(16)
  })

  // -----------------------------------------------------------------------
  // P/N 命名规则与型号白名单
  //
  // 这两条不是"重复生成脚本的 assert", 而是把规则钉在测试侧: 将来有人
  // 往 gen-test-xlsx.py 里加一个不符合真实编码规则的 P/N, 或随手填一个
  // 不在 jigSizeMapping 里的型号, 这里会先炸出来。
  //
  // 型号白名单尤其要独立校验 —— 型号查不到映射时对应尺寸是空串, 而
  // validateSizeMatch 规则 2 把空值判成"匹配", 于是未登记的型号会静默地
  // 变成"永远不标红", 标红回归直接失去意义。
  // -----------------------------------------------------------------------
  const PN_PREFIXES = ['6072J', '6073J']
  const PN_DIGITS = ['6555', '7748', '8348', '7727', '7742', '3931']
  const PN_SUFFIXES = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'K']
  const PN_RE = new RegExp(
    `^(?:${PN_PREFIXES.join('|')})-(?:${PN_DIGITS.join('|')})[${PN_SUFFIXES.join('')}]$`,
  )

  it('每个 P/N 都符合真实编码规则 <前缀>-<4位白名单><单字母后缀>', () => {
    const pns = [...new Set(rows.map((r) => String(r['P/N'])))]
    for (const pn of pns) {
      expect(PN_RE.test(pn), `P/N ${pn} 不符合编码规则`).toBe(true)
    }
    // 三段白名单都要被用到, 否则白名单本身写错了也发现不了
    for (const digits of PN_DIGITS) {
      expect(
        pns.some((pn) => pn.includes(`-${digits}`)),
        `4 位数字 ${digits} 未被覆盖`,
      ).toBe(true)
    }
    for (const prefix of PN_PREFIXES) {
      expect(pns.some((pn) => pn.startsWith(prefix)), `前缀 ${prefix} 未被覆盖`).toBe(true)
    }
  })

  it('型号全部来自 jigSizeMapping, 不出现规则之外的型号', () => {
    for (const r of rows) {
      // 源数据格式是 "型号 空格 型号", 取第一个词
      const model = String(r['Jig 对应型号']).split(' ')[0]
      expect(
        Object.prototype.hasOwnProperty.call(cfg.jigSizeMapping, model),
        `型号 ${model} 不在 jigSizeMapping 里`,
      ).toBe(true)
    }
  })

  it('尺寸标红行为与 gen-test-xlsx.py 的声明逐个吻合', () => {
    const modelByPn = new Map<string, string>()
    for (const r of rows) {
      // 源数据格式是 "型号 空格 型号", 取第一个词
      modelByPn.set(String(r['P/N']), String(r['Jig 对应型号']).split(' ')[0])
    }

    // 契约: 这 9 个 P/N 应当标红, 其余 7 个不标红。数值与
    // tools/gen-test-xlsx.py 的 PN_MODELS 第三个字段一一对应。
    //
    // 注意这里仍然直接调用 validateSizeMatch, 不复刻规则。
    const expectRed = new Set([
      '6073J-7748B', '6072J-7727C', '6073J-7742D', '6072J-8348E',
      '6073J-3931F', '6072J-7748G', '6073J-6555B', '6072J-6555D', '6073J-6555G',
    ])

    for (const [pn, model] of modelByPn) {
      const size = cfg.jigSizeMapping[model] ?? ''
      const matched = validateSizeMatch(pn, size, rules)
      expect(matched ? 'clear' : 'red', `${pn} / ${model} / size=${size}`).toBe(
        expectRed.has(pn) ? 'red' : 'clear',
      )
    }
    expect(expectRed.size).toBe(9)
  })

  it('多种尺寸映射都被覆盖 —— 不能只有一种', () => {
    const sizes = rows.map(
      (r) => cfg.jigSizeMapping[String(r['Jig 对应型号']).split(' ')[0]] ?? '',
    )
    expect(sizes.some((s) => s === cfg.allSizeValue)).toBe(true)
    // 型号全部合法, 所以不可能再出现空串 —— 这条从"必须有"翻成"不能有"
    expect(sizes.some((s) => s === '')).toBe(false)
    expect(new Set(sizes).size).toBeGreaterThanOrEqual(4)
  })

  it('多数 Jig ID 能被剪贴板正则提取出来', () => {
    const text = rows.map((r) => r['Jig ID']).join('\n')
    // 刻意留了 D8A 前缀(真实导出里也存在这类提取不到的治具),
    // 所以不追求 100%, 但主体必须能提出来。
    expect(extractJigIds(text).length / rows.length).toBeGreaterThan(0.7)
  })

  it('Jig ID 互不重复', () => {
    expect(new Set(rows.map((r) => r['Jig ID'])).size).toBe(500)
  })

  it('留有 CST ID 为空的行, 用于触发 Lot ID 回填', () => {
    expect(rows.filter((r) => r['CST ID'] === '').length).toBeGreaterThan(0)
  })
})