/**
 * 尺寸验证算法 —— 逻辑源自 v1.x data_model.py 的 _validate_size_match
 *
 * 这是迁移中风险最高的纯函数: 任何一处规则顺序或边界判断的偏差, 都会导致
 * 红字标记的行集合不同, 用户据此判断治具是否可用。
 *
 * ## 判定模型
 *
 * 判定的是"这个 P/N 代表的玻璃, 这个 Jig 型号能不能做"。
 *
 * P/N 里的尺寸信息是 4 位连续数字 (取 pnExtractStart 起 pnExtractLength 位),
 * 含义是"宽x高": 6555 = 65宽55高, 7742 = 77宽42高, 8348 = 83宽48高。
 *
 * 尺寸串 (来自 型号 -> 对应尺寸 映射表) 用 "_" 分隔若干互斥组, 每组是
 * "宽/高" 形式, 同一组内的数字也是连写的:
 *   "65/55_77/27_77/42_77/48_83/48"
 *     -> 6555, 7727, 7742, 7748, 8348  (5 个互斥的尺寸规格)
 *
 * 所以两边其实是**同一套 4 位编码, 只是分隔符不同**:
 *   尺寸串 "65/55"  ==  P/N 提取段 "6555"
 *
 * 因此匹配就是: 把尺寸串的每一组都拆成纯数字, 拼成 4 位码, 看提取段
 * 是否**精确等于**其中某一个。全等, 不做子串、不做拆半、不做兜底。
 *
 * ## 与旧算法的差异
 *
 * 旧实现用字符串包含判定 (size.includes(digits) / 拆两半 / 任意连续2位子串),
 * 存在两类误判:
 *   1. 假阳性 —— 尺寸串 "77/48_83/48" 遇到提取段 "7727" 时, 旧规则的
 *      "任意连续2位" 兜底会因为 "77" 子串存在而判成匹配, 但 7727 (77x27)
 *      根本不在这个治具的规格里, 应当判不匹配。
 *   2. 假阴性 —— 旧规则没有把 "65/55" 与 "6555" 视为等价, 只能靠兜底
 *      规则侥幸命中, 一旦格式微调就漏判。
 *
 * 严格 4 位匹配同时消除了这两类误判, 且判定结果与规格表**逐位对应**,
 * 用户看到"不匹配"时能直接对照出是哪个尺寸规格对不上。
 *
 * ## 保留不变的行为
 *
 * 以下三条是业务共识, 不因匹配方式改变而改变:
 *   1. All Size 恒匹配 (本轮不改动 All Size 语义)
 *   2. 空值视为匹配 —— 型号不在映射表里时尺寸为空, 静默不标红
 *   3. P/N 太短提取不到数字时视为匹配
 */

import type { AppConfig } from './config'
import { stripExceptionSuffix } from './jigExceptions'

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
 * 把尺寸串拆成 4 位尺寸码集合。
 *
 * 尺寸串语法: "_" 分隔互斥组, 组内 "/" 分隔宽高。
 * 每组去掉所有非数字字符后, 若恰好是 4 位数字, 就是一个可匹配的尺寸码。
 *
 * 例: "65/55_77/27_77/42_77/48_83/48" -> ["6555","7727","7742","7748","8348"]
 *
 * 为什么要按组拆而不是整串去分隔符:
 *   整串去分隔符会得到 "65557727774277488348", 里面会出现
 *   "5772"、"7277" 这类跨组的假码, 让不匹配的 P/N 蒙混过关。
 *   按组拆才保证每个码都是**一个真实存在的规格**。
 *
 * 组内数字不足 4 位时 (如 "65" 这种只写宽的), 无法构成完整规格,
 * 予以忽略 —— 它本来也匹配不上任何 4 位提取段。
 */
export function parseSizeCodes(size: string): string[] {
  if (!size) return []
  const codes: string[] = []
  for (const group of size.split('_')) {
    const digits = group.replace(/\D/g, '')
    if (digits.length === 4) codes.push(digits)
  }
  return codes
}

/**
 * 验证 P/N 与对应尺寸是否匹配。
 *
 * ## 例外对象不在这里判定
 *
 * 「某些具体治具做不了某个 P/N」是治具维度的规则, 需要 Jig ID 才能判,
 * 而且优先级高于这里所有规则(包括 All Size 恒匹配)。它由调用方先判,
 * 命中就直接标红, 不会进到这个函数。
 *
 * 这样切分的理由: 本函数保持"只看 P/N 和尺寸串"的纯粹形态, 输入决定
 * 输出, 便于覆盖边界; 例外那条依赖外部清单, 放进来会让每次调用都带着
 * 一张表, 反而不好测。组合点在 App.tsx 的 mismatchFlags。
 *
 * 但「对应尺寸」列可能带例外标记(如 `All Size(65例外)`), 所以入口要剥离,
 * 保证即使带标记的串漏进来也按纯尺寸判定, 不会把标记里的数字当规格码。
 *
 * @param pnValue  P/N 字符串
 * @param sizeValue 对应尺寸字符串, 可带例外标记
 * @param rules 规则参数, 通常由 rulesFromConfig 构造
 * @returns true 表示匹配 (或不适用验证)
 */
export function validateSizeMatch(
  pnValue: string,
  sizeValue: string,
  rules: SizeValidationRules,
): boolean {
  const size = stripExceptionSuffix(sizeValue)

  // 1. All Size 恒匹配
  if (size === rules.allSizeValue) return true

  // 2. 空值无法验证, 视为匹配
  if (!pnValue || !size) return true

  // 3. 提取 P/N 中的尺寸编码; 长度不足视为匹配
  const start = rules.pnExtractStart
  const end = start + rules.pnExtractLength
  if (pnValue.length < end) return true
  const pnDigits = pnValue.slice(start, end)

  // 4. 严格 4 位匹配: 提取段必须精确等于某个规格码
  //
  // 提取长度由配置决定 (默认 4)。若被改成其他长度, 规格码只有 4 位,
  // 此时无法做全等比较, 保守地判为不匹配 —— 宁可标红提示人工确认,
  // 也不放行一个可能装错的治具。
  if (pnDigits.length !== 4) return false

  return parseSizeCodes(size).includes(pnDigits)
}
