/**
 * 剪贴板处理 —— 基线一致性测试
 */

import { describe, it, expect } from 'vitest'
import baseline from './fixtures/expected.json'
import {
  processClipboardContent,
  extractJigIds,
  isPureJigIds,
} from '../src/core/clipboard'

describe('剪贴板 —— 对齐 Python 基线', () => {
  const cases = baseline.clipboard as ReadonlyArray<{
    input: string
    output: string
  }>

  it('基线用例非空', () => {
    expect(cases.length).toBeGreaterThan(0)
  })

  it('逐例匹配 Python 结果', () => {
    const mismatches: string[] = []
    for (const c of cases) {
      const actual = processClipboardContent(c.input)
      if (actual !== c.output) {
        mismatches.push(
          `in=${JSON.stringify(c.input)} 期望=${JSON.stringify(c.output)} 实际=${JSON.stringify(actual)}`,
        )
      }
    }
    expect(mismatches).toEqual([])
  })
})

describe('剪贴板 —— 提取规则', () => {
  it('识别 CJ 格式 12 位', () => {
    expect(extractJigIds('id=CJJ349000910 end')).toEqual(['CJJ349000910'])
  })

  it('识别 C4M 格式 12 位', () => {
    expect(extractJigIds('id=C4M123456789 end')).toEqual(['C4M123456789'])
  })

  it('排除末两位为 00 的 CJ 号 (与 Lot ID 区分)', () => {
    expect(extractJigIds('CJJ349000000')).toEqual([])
  })

  it('不匹配紧邻字母数字的片段', () => {
    expect(extractJigIds('XCJJ349000910X')).toEqual([])
  })

  it('去重且保持顺序', () => {
    expect(extractJigIds('CJJ349000919 CJJ349000910 CJJ349000919')).toEqual([
      'CJJ349000919',
      'CJJ349000910',
    ])
  })

  it('中文语境可提取', () => {
    expect(extractJigIds('请查 CJJ349000910 谢谢')).toEqual(['CJJ349000910'])
  })
})

describe('剪贴板 —— 纯净列表判定', () => {
  it('每行一个且全部合法 -> true', () => {
    expect(isPureJigIds('CJJ349000910\nCJJ349000919')).toBe(true)
  })

  it('含非 ID 文本 -> false', () => {
    expect(isPureJigIds('CJJ349000910\nhello')).toBe(false)
  })

  it('空文本 -> false', () => {
    expect(isPureJigIds('')).toBe(false)
  })

  it('纯净列表不去重, 原样保留', () => {
    const dup = 'CJJ349000910\nCJJ349000910'
    expect(processClipboardContent(dup)).toBe(dup)
  })
})