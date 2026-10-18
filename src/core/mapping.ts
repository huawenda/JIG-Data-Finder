/**
 * 型号 -> 尺寸映射表的编辑逻辑
 *
 * 单独抽出来是因为 SettingsDialog / SizeMappingDialog 里的输入校验
 * 必须能被单测覆盖: 这张表一旦有一条错误, 整个「对应尺寸」列和标红
 * 结果都会错, 而错的表现往往在几百行之后才看得出来, 很难定位。
 *
 * 底层类型是 Record<string, string>, 也就是一个 key 只能有一个值。
 * 用户在面板里加两行相同型号是��容易犯的错, 而 JS 对象赋值不会报错,
 * 只是后者覆盖前者 —— 面板必须自己拦下来。
 */

/** 面板里的一行: 型号与对应尺寸 */
export interface MappingPair {
  model: string
  size: string
}

/** 行下标 -> 错误信息。空对象表示全部合法。 */
export type MappingErrors = Record<number, string>

/** 从配置对象还原成面板可编辑的行数组 */
export function mappingToPairs(mapping: Record<string, string>): MappingPair[] {
  return Object.entries(mapping).map(([model, size]) => ({ model, size }))
}

/** 行数组 -> 配置对象。逐行 trim, 保持键的大小写原样。 */
export function pairsToMapping(pairs: ReadonlyArray<MappingPair>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of pairs) {
    const model = p.model.trim()
    if (!model) continue
    out[model] = p.size.trim()
  }
  return out
}

/**
 * 校验每一行, 返回行下标到错误信息的映射。
 *
 * 尺寸串允许为空 —— 映射到空串时 validateSizeMatch 规则 2 会判成
 * "匹配", 也就是"这一型号不做尺寸校验"。有些治具确实没有尺寸概念,
 * 显式写成空串比删掉这行更清楚。
 */
export function validateMappingPairs(pairs: ReadonlyArray<MappingPair>): MappingErrors {
  const errors: MappingErrors = {}
  // 已用型号 -> 首次出现的行下标, 用于报"重复在第几行"
  const seen = new Map<string, number>()

  pairs.forEach((p, i) => {
    const model = p.model.trim()
    if (!model) {
      errors[i] = '型号不能为空'
      return
    }
    const first = seen.get(model)
    if (first !== undefined) {
      errors[i] = `型号 ${model} 与第 ${first + 1} 行重复`
      return
    }
    seen.set(model, i)
  })

  return errors
}

/** 面板里新增一行时用的空行 */
export function blankPair(): MappingPair {
  return { model: '', size: '' }
}