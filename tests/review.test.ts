/**
 * 数据审查三档 —— 分档判定与筛选语义
 *
 * 这一层只做**归类与筛选**, 不重新实现任何判定规则:
 *   例外 -> findExceptionHit (jigExceptions.ts)
 *   尺寸 -> validateSizeMatch  (validate.ts)
 * 所以测试重点不是"规则对不对"(那两个模块各自有测试), 而是:
 *   1. 优先级: 例外必须压过尺寸判定 (包括 All Size 恒匹配)
 *   2. 三档的包含关系: 尺寸不匹配 ⊇ 仅例外
 *   3. 缺列时不误判 (返回空数组, 而不是全 ok)
 */

import { describe, expect, it } from 'vitest'
import { createDefaultConfig } from '../src/core/config'
import { buildExceptionIndex } from '../src/core/jigExceptions'
import type { JigException } from '../src/core/jigExceptions'
import {
  classifyReviewRow,
  classifyReviewTable,
  isFlagged,
  matchesScope,
  REVIEW_SCOPES,
} from '../src/core/review'
import type { ReviewKind } from '../src/core/review'
import { rulesFromConfig } from '../src/core/validate'
import type { Row } from '../src/core/table'

const base = createDefaultConfig()

/** 例外: 252 型号的 C4M240701001 做不了 65/55 */
const EX_ID = 'C4M240701001'
const JIG_EXCEPTIONS: JigException[] = [{ jigId: EX_ID, pn: '6555', type: '65例外' }]

const exceptions = buildExceptionIndex(JIG_EXCEPTIONS)
const rules = rulesFromConfig({ ...base, jigExceptions: JIG_EXCEPTIONS })

const row = (jigId: string, pn: string, size: string): Row => ({
  'P/N': pn,
  'Jig ID': jigId,
  '对应尺寸': size,
})

/** 与 base.jigSizeMapping 一致的真实尺寸串 */
const SIZE_252 = base.jigSizeMapping['252']
const SIZE_508 = base.jigSizeMapping['508']
const SIZE_420A = base.jigSizeMapping['420A']

const kind = (r: Row) => classifyReviewRow(r, rules, exceptions)

describe('判定优先级', () => {
  it('命中例外 -> exception (即使尺寸本身是匹配的)', () => {
    // 252 的尺寸串里有 65/55, 6072J-6555H 能匹配上 —— 换句话说纯尺寸判定
    // 会得出 ok。例外必须在这之前拦下, 否则"治具做不了"就被静默放行了。
    expect(kind(row(EX_ID, '6072J-6555H', SIZE_252))).toBe('exception')
  })

  it('例外压过 All Size 恒匹配', () => {
    // 256 的尺寸是 All Size, validateSizeMatch 恒 true。例外仍要标出来。
    expect(kind(row(EX_ID, '6072J-6555H', base.jigSizeMapping['256']))).toBe('exception')
  })

  it('例外行即使尺寸也对不上, 仍归例外 (不混进 mismatch)', () => {
    // 508 只能做 77/48 与 83/48, P/N 是 6555 -> 纯尺寸判定会判 mismatch。
    // 但这台治具本身在例外表里, 归到 exception 才能让「仅例外」档保持纯净。
    expect(kind(row(EX_ID, '6072J-6555H', SIZE_508))).toBe('exception')
  })

  it('不在例外表里的治具, 尺寸对不上 -> mismatch', () => {
    // 420A 只能做 65/55, P/N 要求 7748
    expect(kind(row('CXX000000001', '6073J-7748K', SIZE_420A))).toBe('mismatch')
  })

  it('尺寸匹配 -> ok', () => {
    expect(kind(row('CXX000000001', '6073J-7748B', SIZE_508))).toBe('ok')
  })

  it('同治具但 P/N 属于别的档 -> 按尺寸判, 不命中例外', () => {
    // 例外是 (治具, 尺寸族) 的组合, 不是"这台治具什么都不行"
    expect(kind(row(EX_ID, '6073J-7748K', SIZE_508))).toBe('ok')
  })

  it('空 JIG ID 不会命中例外 (否则空串会匹配整表)', () => {
    // 例外表里有 (EX_ID, 6555)。空 ID 若被当成命中就会返回 exception;
    // 实际应走尺寸判定 —— 420A 做得了 65/55, 所以是 ok。
    expect(kind(row('', '6072J-6555H', SIZE_420A))).toBe('ok')
  })
})

describe('整表判定', () => {
  const table = (columns: string[], rows: Row[]) => ({ columns, rows })

  it('逐行给出分类', () => {
    const t = table(
      ['P/N', 'Jig ID', '对应尺寸'],
      [
        row(EX_ID, '6072J-6555H', SIZE_252), // exception
        row('CXX000000001', '6073J-7748K', SIZE_420A), // mismatch
        row('CXX000000001', '6073J-7748B', SIZE_508), // ok
      ],
    )
    expect(classifyReviewTable(t, rules, exceptions)).toEqual([
      'exception',
      'mismatch',
      'ok',
    ])
  })

  it('没有「对应尺寸」列时返回空数组, 不返回全 ok', () => {
    // 调用方靠空数组判断"这张表不适用尺寸审查"(如透视表)。
    // 返回全 ok 会被当成"审过了, 全没问题"。
    const t = table(['P/N', 'Jig ID'], [row('CXX000000001', '6073J-7748K', '')])
    expect(classifyReviewTable(t, rules, exceptions)).toEqual([])
  })

  it('空表返回空数组', () => {
    expect(classifyReviewTable(table(['对应尺寸'], []), rules, exceptions)).toEqual([])
  })
})

describe('标红与分档筛选', () => {
  it('例外和尺寸不匹配都标红', () => {
    expect(isFlagged('exception')).toBe(true)
    expect(isFlagged('mismatch')).toBe(true)
    expect(isFlagged('ok')).toBe(false)
  })

  it('三档的包含关系: 尺寸不匹配 ⊇ 仅例外', () => {
    const kinds: ReviewKind[] = ['exception', 'mismatch', 'ok']

    // 所有对象: 全收
    expect(kinds.filter((k) => matchesScope(k, 'all'))).toHaveLength(3)
    // 尺寸不匹配(含例外): 两种红都收
    expect(kinds.filter((k) => matchesScope(k, 'mismatch'))).toEqual(['exception', 'mismatch'])
    // 仅例外: 只留例外
    expect(kinds.filter((k) => matchesScope(k, 'exception'))).toEqual(['exception'])
  })

  it('ok 行在任何收窄档里都不出现', () => {
    for (const s of REVIEW_SCOPES) {
      if (s.id === 'all') continue
      expect(matchesScope('ok', s.id)).toBe(false)
    }
  })

  it('分档按钮的顺序与文案固定 (UI 直接遍历它)', () => {
    expect(REVIEW_SCOPES.map((s) => s.id)).toEqual(['all', 'mismatch', 'exception'])
    expect(REVIEW_SCOPES[0].label).toBe('所有对象')
    expect(REVIEW_SCOPES[1].label).toBe('尺寸不匹配(含例外)')
    expect(REVIEW_SCOPES[2].label).toBe('仅例外')
  })
})

describe('与真实源数据结构一致', () => {
  it('252 遇 6555 且治具在例外表 -> 例外而非"匹配"', () => {
    // 这是车间真实场景: 252 型号能力够 (65/55 在串里), 但这台做不到
    const r = row(EX_ID, '6072J-6555H', SIZE_252)
    expect(kind(r)).toBe('exception')
    expect(isFlagged(kind(r))).toBe(true)
  })
})
