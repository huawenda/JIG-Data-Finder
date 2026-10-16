/**
 * 尺寸验证算法 —— 对应 Python 版 tools/legacy/src/core/data_model.py 的 _validate_size_match
 *
 * 这是迁移中风险最高的纯函数: 任何一处规则顺序或边界判断的偏差, 都会导致
 * 红字标记的行集合不同, 用户据此判断治具是否可用。
 *
 * 验证规则严格按 Python 源码顺序实现, 不可调整顺序:
 *   1. All Size 恒匹配
 *   2. 空值视为匹配
 *   3. 提取 P/N 第 pnExtractStart 起 pnExtractLength 位; 长度不足视为匹配
 *   4. 提取结果被尺寸串直接包含 -> 匹配
 *   5. 4 位数字时, 前 2 位与后 2 位都在尺寸串中 -> 匹配
 *   6. "65" 特判: 尺寸串含 "65" 或 "65/55" -> 匹配
 *   7. 特殊映射表: 提取值命中 key 时, 映射值或 key 出现在尺寸串 -> 匹配
 *   8. 兜底: 提取值任意连续 2 位子串出现在尺寸串 -> 匹配
 *   9. 以上都不满足 -> 不匹配
 */

import type { AppConfig } from './config'

export interface SizeValidationRules {
  pnExtractStart: number
  pnExtractLength: number
  sizeSpecialMappings: Record<string, string>
  allSizeValue: string
}

export function rulesFromConfig(cfg: AppConfig): SizeValidationRules {
  return {
    pnExtractStart: cfg.pnExtractStart,
    pnExtractLength: cfg.pnExtractLength,
    sizeSpecialMappings: cfg.sizeSpecialMappings,
    allSizeValue: cfg.allSizeValue,
  }
}

/**
 * 验证 P/N 与对应尺寸是否匹配。
 *
 * @param pnValue  P/N 字符串
 * @param sizeValue 对应尺寸字符串
 * @param rules  规则参数, 通常由 rulesFromConfig 构造
 * @returns true 表示匹配 (或不适用验证)
 */
export function validateSizeMatch(
  pnValue: string,
  sizeValue: string,
  rules: SizeValidationRules,
): boolean {
  // 1. All Size 恒匹配
  if (sizeValue === rules.allSizeValue) return true

  // 2. 空值无法验证, 视为匹配 (与 Python 一致)
  if (!pnValue || !sizeValue) return true

  // 3. 提取 P/N 中的数字片段; 长度不足视为匹配
  const start = rules.pnExtractStart
  const end = start + rules.pnExtractLength
  if (pnValue.length < end) return true
  const pnDigits = pnValue.slice(start, end)

  // 4. 直接包含
  if (sizeValue.includes(pnDigits)) return true

  // 5. 4 位数字时拆成前后 2 位分别匹配
  if (pnDigits.length === 4) {
    const firstTwo = pnDigits.slice(0, 2)
    const lastTwo = pnDigits.slice(2, 4)
    if (sizeValue.includes(firstTwo) && sizeValue.includes(lastTwo)) return true
  }

  // 6. "65" 特判
  if (pnDigits === '65') {
    if (sizeValue.includes('65') || sizeValue.includes('65/55')) return true
  }

  // 7. 特殊映射表
  for (const [key, mappedValue] of Object.entries(rules.sizeSpecialMappings)) {
    if (pnDigits === key) {
      if (sizeValue.includes(mappedValue)) return true
      if (sizeValue.includes(key)) return true
    }
  }

  // 8. 兜底: 任意连续 2 位子串
  if (pnDigits.length >= 2) {
    for (let i = 0; i < pnDigits.length - 1; i += 1) {
      if (sizeValue.includes(pnDigits.slice(i, i + 2))) return true
    }
  }

  return false
}

/** 批量标记: 返回每行是否需要标红, 与 DataFrame 行序一致 */
export function markSizeMismatches(
  rows: ReadonlyArray<{ pn: string; size: string }>,
  rules: SizeValidationRules,
): boolean[] {
  return rows.map((r) => !validateSizeMatch(r.pn, r.size, rules))
}