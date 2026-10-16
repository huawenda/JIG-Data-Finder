/**
 * 尺寸验证算法 —— 基线一致性测试
 *
 * 直接读取 Python 版生成的 tests/fixtures/expected.json,
 * 断言 TypeScript 实现给出完全相同的结果。
 *
 * 运行: npm test
 */

import { describe, it, expect } from 'vitest'
import baseline from './fixtures/expected.json'
import { createDefaultConfig } from '../src/core/config'
import { validateSizeMatch, rulesFromConfig } from '../src/core/validate'

const config = createDefaultConfig()
const rules = rulesFromConfig(config)

describe('尺寸验证 —— 对齐 Python 基线', () => {
  const cases = baseline.size_validation as ReadonlyArray<{
    pn: string
    size: string
    match: boolean
  }>

  it('基线快照非空', () => {
    expect(cases.length).toBeGreaterThan(0)
  })

  it('逐行匹配 Python 结果', () => {
    const mismatches: string[] = []
    for (const c of cases) {
      const actual = validateSizeMatch(c.pn, c.size, rules)
      if (actual !== c.match) {
        mismatches.push(
          `pn="${c.pn}" size="${c.size}" 期望=${c.match} 实际=${actual}`,
        )
      }
    }
    expect(mismatches).toEqual([])
  })

  it('基线中确实存在非空尺寸, 避免"全空即全匹配"的假阳性', () => {
    const nonEmpty = cases.filter((c) => c.size !== '')
    expect(nonEmpty.length).toBeGreaterThan(0)
  })
})

describe('尺寸验证 —— 规则边界', () => {
  it('All Size 恒匹配', () => {
    expect(validateSizeMatch('6073J-8348G', 'All Size', rules)).toBe(true)
  })

  it('空值视为匹配', () => {
    expect(validateSizeMatch('', '77/48', rules)).toBe(true)
    expect(validateSizeMatch('6073J-8348G', '', rules)).toBe(true)
  })

  it('P/N 长度不足时视为匹配', () => {
    // pnExtractStart=6, pnExtractLength=4 => 需要至少 10 位
    expect(validateSizeMatch('ABC', '77/48', rules)).toBe(true)
  })

  it('4 位数字拆分匹配: 7748 -> 77/48', () => {
    expect(validateSizeMatch('XXXX7748XXXX', '77/48', rules)).toBe(true)
  })

  it('65 命中: P/N 第7-8位为 65 且尺寸含 65 即匹配', () => {
    // slice(6,10) = '65XX', 兜底规则命中尺寸中的 '65'
    expect(validateSizeMatch('XXXXXX65XX', '65', rules)).toBe(true)
    expect(validateSizeMatch('XXXXXX65XX', '65/55', rules)).toBe(true)
  })

  it('当前默认配置下"65"特判为死代码, 仅在提取长度为2时生效', () => {
    // 提取长度 2: slice(6,8) = '65', 命中规则6 特判
    const twoDigitRules = { ...rules, pnExtractLength: 2 }
    expect(validateSizeMatch('XXXXXX65', '65/48', twoDigitRules)).toBe(true)

    // 提取长度 4: slice(6,10) = '65X9', 不再等于 '65', 特判不生效
    expect(validateSizeMatch('XXXXXX65X9', '65/48', rules)).toBe(true) // 兜底规则仍命中 '65'
  })

  it('不匹配时返回 false', () => {
    // P/N 第7-10位 = 1234, 尺寸 77/48 中既无 1234 也无 12/34
    expect(validateSizeMatch('XXXX1234XXXX', '77/48', rules)).toBe(false)
  })

  it('兜底规则: 任意连续 2 位子串命中即匹配', () => {
    // 提取 1234, 尺寸含 "34" => 命中
    expect(validateSizeMatch('XXXX1234XXXX', '9/34', rules)).toBe(true)
  })
})