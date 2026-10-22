/**
 * 例外对象的出厂预设 —— 78 台「型号能做, 但这台具体治具做不到」的治具。
 *
 * ## 数据来源
 *
 * 车间提供的 `252 256 262例外.xlsx`: 78 个 Jig ID, 型号分布 252×7 / 256×51 /
 * 262×20。这三个型号本身都支持 65/55 (252 的尺寸串里有 65/55, 256/262 是
 * All Size), 但这 78 台实际做不到 —— 所以统一归到 **6555 档 + 65例外**。
 *
 * 型号在这里只当注释用: 面板里的「型号」列是从**当前源数据**实时查的,
 * 不写死在记录里。源数据按批次导出, 同一台治具今天不在表里不代表编号错了;
 * 把型号存进配置只会在换批次后变成一份过期的副本。
 *
 * ## 为什么写进代码而不是读文件
 *
 * 这是**出厂配置**, 不是用户数据: 全新安装、或点了「恢复默认」时, 面板就
 * 应该是这 78 条, 不需要用户手敲一遍(78 个 12 位编号, 敲错一个就是一次
 * 误放行)。放进代码的好处是随安装包一起走、离线可用、没有"文件丢了"的
 * 失败模式。
 *
 * 与 `tests/fixtures/jig-exceptions.json` 是同一份业务事实的两个副本 ——
 * 那个文件供 `tools/gen-test-xlsx.py` 生成测试数据用。两侧一旦漂移,
 * test-500 里会有一条断言直接失败, 不会静默走偏。
 *
 * ## 预设版本
 *
 * `JIG_EXCEPTION_PRESET_VERSION` 写进配置的 `jigExceptionsPresetVersion`。
 * 存在的唯一理由是让「补齐」只发生一次: 预设上线前写盘的配置里没有这个
 * 字段, 说明用户还没见过预设, 此时把预设补进去(磁盘已有记录优先, 不覆盖);
 * 之后再打开就完全以磁盘为准 —— 否则用户删掉的条目会在每次启动时复活。
 */

import type { JigException } from './jigExceptions'

/** 预设统一使用的例外 P/N 档: 65/55 */
export const PRESET_FAMILY = '6555'

/** 预设统一使用的例外类型 */
export const PRESET_TYPE = '65例外'

/**
 * 预设版本号。
 *
 * 改动预设清单(增删 ID)时**不要**加这个号 —— 加了会让所有老用户的清单被
 * 重新补齐一遍。它只标记"预设机制本身"引入过一次。
 */
export const JIG_EXCEPTION_PRESET_VERSION = 1

/** 型号 252 (7 台) */
const IDS_252: readonly string[] = [
  'C4M240701001',
  'C4M240702001',
  'C4M240700801',
  'C4M240701901',
  'C4M240702101',
  'C4M240701401',
  'CJJ349000E07',
]

/** 型号 256 (51 台) */
const IDS_256: readonly string[] = [
  'C4M250403601',
  'C4M250402401',
  'C4M250600201',
  'CJJ34B000221',
  'CJJ34B000107',
  'C4M250403801',
  'CJJ349000D18',
  'C4M250503501',
  'C4M250400401',
  'C4M250400301',
  'C4M250501601',
  'C4M250401101',
  'C4M250403001',
  'CJJ345000217',
  'C4M250401701',
  'C4M250403401',
  'C4M250501401',
  'C4M250501201',
  'C4M250404501',
  'C4M250402201',
  'CJJ352000719',
  'C4M250504401',
  'C4M250602201',
  'C4M250300201',
  'C4M250400501',
  'CJJ349000D08',
  'C4M250402901',
  'CJJ345000219',
  'C4M250400801',
  'C4M250402001',
  'CJJ34B000118',
  'C4M250500301',
  'C4M250402701',
  'CJJ34B000112',
  'C4M250400101',
  'C4M250404301',
  'C4M250503901',
  'C4M250401401',
  'CJJ349000C11',
  'C4M250600801',
  'CJJ349000C19',
  'C4M250501801',
  'CJJ34B000117',
  'C4M250302401',
  'C4M250600501',
  'C40250401901',
  'C4M250404001',
  'C4M250404201',
  'C4M250504001',
  'CJJ345000215',
  'C4M250601301',
]

/** 型号 262 (20 台) */
const IDS_262: readonly string[] = [
  'CJJ358000715',
  'C4M250704001',
  'C4M250700601',
  'CJJ35A000306',
  'C4M250900301',
  'CJJ35A000310',
  'CJJ358000801',
  'CJJ358000707',
  'CJJ361000115',
  'C4M250701401',
  'C4M250701101',
  'C4M250801401',
  'C4M250702101',
  'C4M251001101',
  'CJJ35A000312',
  'CJJ361000120',
  'CJJ361000114',
  'CJJ35A000317',
  'C4M250900201',
  'CJJ358000718',
]

function toRecords(ids: readonly string[]): JigException[] {
  return ids.map((jigId) => ({ jigId, pn: PRESET_FAMILY, type: PRESET_TYPE }))
}

/**
 * 预设清单 (只读)。顺序与来源表一致: 252 -> 256 -> 262。
 *
 * 冻结是为了防止调用方 push 进去污染"出厂状态" —— 这个数组会被
 * `createDefaultConfig()` 反复使用, 被改一次就再也没有干净的基准了。
 */
export const PRESET_JIG_EXCEPTIONS: readonly JigException[] = Object.freeze([
  ...toRecords(IDS_252),
  ...toRecords(IDS_256),
  ...toRecords(IDS_262),
])

/** 每次返回全新对象, 让面板可以随便改而不影响预设本身 */
export function createPresetExceptions(): JigException[] {
  return PRESET_JIG_EXCEPTIONS.map((e) => ({ ...e }))
}

/**
 * 把预设补进现有清单: **现有的优先**。
 *
 * 用于预设上线时的首次补齐。按 jigId 去重, 所以:
 *   - 用户手录过的编号保留他自己的 pn / type (哪怕与预设不同);
 *   - 预设里用户还没有的编号追加到末尾;
 *   - 用户在预设之外自建的编号原样留在最后。
 */
export function mergePresetExceptions(
  existing: ReadonlyArray<JigException>,
): JigException[] {
  const byId = new Map<string, JigException>()
  for (const e of createPresetExceptions()) byId.set(e.jigId, e)
  for (const e of existing) {
    const id = e.jigId.trim()
    if (!id) continue
    byId.set(id, { ...e, jigId: id })
  }
  return [...byId.values()]
}
