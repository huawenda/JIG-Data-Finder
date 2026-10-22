/**
 * 数据审查的分档 —— 每行归入「例外 / 尺寸不匹配 / 正常」三者之一。
 *
 * ## 为什么分档, 而不是"标红 / 不标红"
 *
 * 标红只说明"这一行有问题", 但现场要做的动作截然不同:
 *
 *   例外        型号能力够, 但**这台具体治具**做不到
 *               -> 治具本身的问题, 报修或换治具
 *   尺寸不匹配  型号能力不够, P/N 要求的规格不在该型号的尺寸串里
 *               -> 派工/选型问题, 换治具型号或改派
 *
 * 混在一个"62 行不匹配"里, 用户还得逐行看「对应尺寸」列有没有 `(65例外)`
 * 后缀才能分辨。分档之后一眼就能看出这堆红字是治具毛病还是派工毛病。
 *
 * ## 三档互斥, 优先级固定
 *
 * 命中例外就归例外, **哪怕它的尺寸本身也对不上**。这样「仅例外」档看到的
 * 一定是纯治具问题, 不会混进型号能力问题 —— 这是分档的意义所在。
 *
 * 「尺寸不匹配」档包含例外 (用户口径就是"含例外"), 也就是所有标红的行;
 * 「仅例外」是它的子集。
 *
 * ## 与 validateSizeMatch 的分工
 *
 * 尺寸判定仍是 validateSizeMatch 的事, 这里只做**组合与归类**:
 * 先问例外 (治具维度, 优先级高于一切尺寸规则, 包括 All Size 恒匹配),
 * 再问尺寸 (型号维度)。两套规则各自的边界都留在原模块里, 不在这里重复实现。
 */

import type { JigException } from './jigExceptions'
import { findExceptionHit } from './jigExceptions'
import type { Row, Table } from './table'
import type { SizeValidationRules } from './validate'
import { validateSizeMatch } from './validate'

/** 一行的审查归类 */
export type ReviewKind = 'ok' | 'mismatch' | 'exception'

/**
 * 审查页的三档。
 *
 *   all        所有对象 —— 不筛
 *   mismatch   尺寸不匹配(含例外) —— 所有标红的行
 *   exception  仅例外 —— 只留命中例外对象的行
 */
export type ReviewScope = 'all' | 'mismatch' | 'exception'

/** 分档按钮的标签与顺序, 供 UI 直接遍历 */
export const REVIEW_SCOPES: ReadonlyArray<{ id: ReviewScope; label: string }> = [
  { id: 'all', label: '所有对象' },
  { id: 'mismatch', label: '尺寸不匹配(含例外)' },
  { id: 'exception', label: '仅例外' },
]

/**
 * 判定单行。
 *
 * 例外优先: 先查 (JIG ID, P/N) 是否命中例外清单, 命中直接归 `exception`,
 * 不再走尺寸判定 —— 这不是优化, 是语义要求。256/262 的尺寸是 All Size
 * (恒匹配), 若先判尺寸就会得到 `ok`, 例外被静默吞掉。
 */
export function classifyReviewRow(
  row: Row,
  rules: SizeValidationRules,
  exceptions: ReadonlyMap<string, JigException>,
): ReviewKind {
  const pn = row['P/N'] ?? ''
  if (findExceptionHit(exceptions, row['Jig ID'] ?? '', pn)) return 'exception'
  return validateSizeMatch(pn, row['对应尺寸'] ?? '', rules) ? 'ok' : 'mismatch'
}

/**
 * 整表判定。
 *
 * 表里没有「对应尺寸」列时返回**空数组**而不是全 `ok`: 调用方据此判断
 * "这张表不适用尺寸审查"(例如透视表), 与改造前 mismatchFlags 的返回约定
 * 一致。返回全 ok 会让调用方以为"审过了, 全都没问题"。
 */
export function classifyReviewTable(
  table: Table,
  rules: SizeValidationRules,
  exceptions: ReadonlyMap<string, JigException>,
): ReviewKind[] {
  if (!table.columns.includes('对应尺寸')) return []
  return table.rows.map((r) => classifyReviewRow(r, rules, exceptions))
}

/** 该行是否要标红。例外与尺寸不匹配都标红, 只是分在不同档里。 */
export function isFlagged(kind: ReviewKind): boolean {
  return kind !== 'ok'
}

/** 该行是否属于某一档 */
export function matchesScope(kind: ReviewKind, scope: ReviewScope): boolean {
  if (scope === 'all') return true
  if (scope === 'exception') return kind === 'exception'
  // mismatch 档含例外
  return kind !== 'ok'
}
