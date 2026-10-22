/**
 * 例外对象 —— 型号能做, 但这台具体治具做不到。
 *
 * ## 为什么需要这张表
 *
 * 252 / 256 / 262 三个型号本身支持 65/55 尺寸, 但车间的部分具体治具有缺陷,
 * 做不到。这是**治具维度**的事实, 而 `jigSizeMapping` 是**型号维度**的映射
 * (型号 -> 尺寸串), 表达不了"同型号里个别治具例外"。
 *
 * 所以单列一张表, 一条记录 = (JIG ID, P/N, 类型)。
 *
 * ## 为什么是「尺寸族」而不是具体尺寸码
 *
 * 例外说的是一件事: **这台治具做不了某一类玻璃**, 不是"做不了 6072J-6555H
 * 这个料号", 也不是"做不了 7748 这一个规格"。
 *
 * 实际业务里只有两族:
 *   6555   — 65/55, 就这一个码
 *   7783   — 宽度 77 或 83 的全部规格: 7748 / 7742 / 7727 / 8348 …
 *
 * 把 7783 做成一族而不是四个独立值, 是因为车间说的是"这台做不了 77/83 那一档",
 * 逐码录入既啰嗦又容易漏 —— 四码要录四遍, 漏一个就是一次误放行。
 *
 * 判定时两边都归一成族再比 (`familyOf`), 所以存量配置里存的是 `7748`
 * 这类具体码也照样命中, 不需要重录。
 *
 * ## 为什么 6555 精确匹配而 7783 按宽度匹配
 *
 * 两者的来源不同: `6555` 是用户指名的一个具体码, 而 `7783` 是"77 和 83 两类
 * 宽度"的合并代号。若把 6555 也做成"65 开头全算", 将来出现 65/48 之类的
 * 规格时会被无声地并入 65 例外, 没人会发现。
 *
 * 所以 `familyOf` 里 6555 走全等, 7783 走宽度判断。当前数据下两者结果一致
 * (65/55 是唯一的 65 宽度码), 但语义边界清楚。
 *
 * ## type 字段不参与任何计算
 *
 * 类型只用于在「对应尺寸」列末尾追加标记, 例如 `All Size(65例外)`。
 * 判定**完全**由 (JIG ID, P/N) 的精确匹配决定, 与 type 无关。
 *
 * 这条边界必须守住。早期设想是"把类型拼进尺寸串, 让尺寸解析失败, 从而
 * 自然判为不匹配", 看似省事, 实则会翻车: `parseSizeCodes` 的规则是
 * "去掉非数字字符后恰好 4 位才算规格码", 所以类型写成 `7748例外` 时,
 * `All Size(7748例外)` 会被解析出规格码 `7748` —— 若该行 P/N 正好是
 * 7748, 例外反而被判成匹配。把判定和显示揉在一起就会出这种事。
 *
 * ## 编号格式
 *
 * 实测 78 台全部是 12 位, 但**含字母且位置不固定**:
 *   C4M240701001   CJJ349000E07   CJJ34B000221   C40250401901
 * 因此只做长度校验, 绝不做"前缀必须 C4M/CJJ"这类推断 ——
 * 曾经把 C40250401901 误判成"漏了 M 的笔误", 实际它在源数据里真实存在。
 * 匹配一律用精确字符串相等, 不做任何数字提取。
 */

/** 一条例外记录 */
export interface JigException {
  /** 治具编号, 12 位, 原样保存 */
  jigId: string
  /**
   * 该治具做不到的**尺寸族**, 取值见 `SIZE_FAMILIES`。
   *
   * 写成族而不是具体码, 是因为业务上按族管理: 6555 只有它自己,
   * 7783 覆盖 7748 / 7742 / 7727 / 8348 全部 77 与 83 宽度规格。
   *
   * 兼容三种历史形态 (读取时都归一成族, 见 `familyOf`):
   *   - 完整 P/N   `6072J-6555H`  (最早期的行为)
   *   - 具体尺寸码 `7748`          (上一版的行为)
   *   - 族标识     `7783`          (当前)
   */
  pn: string
  /** 例外类型, 纯展示用, 如 "65例外" */
  type: string
}

/**
 * 例外的粒度: 尺寸族。
 *
 * 6555 — 只有 65/55 一个码
 * 7783 — 宽度 77 或 83 的全部规格
 */
export type SizeFamily = '6555' | '7783'

/** 可选的族, 顺序即面板下拉顺序。 */
export const SIZE_FAMILIES: readonly SizeFamily[] = ['6555', '7783']

/** 行下标 -> 错误信息。空对象表示全部合法。 */
export type JigExceptionErrors = Record<number, string>

/** 治具编号约定长度。只校验长度, 不校验字符构成。 */
export const JIG_ID_LENGTH = 12

/**
 * P/N 里尺寸码的位置与长度。
 *
 * 与 config 的 `pnExtractStart` / `pnExtractLength` 的默认值一致。
 * 这里写常量而不是读配置: 例外记录是**持久化数据**, 字段语义不能跟着
 * 运行时配置漂移 —— 否则用户改一次 pnExtractStart, 已经存下的例外
 * 全部对不上, 而且没有任何提示。
 */
export const SIZE_CODE_START = 6
export const SIZE_CODE_LENGTH = 4

/**
 * 取尺寸码。入参给完整 P/N 或已经是 4 位码都可以。
 *
 * 兼容两种形态是刻意的: 面板里选的是 4 位码, 而源数据的 P/N 是完整串,
 * 判定时两边都要能算出同一个值。
 */
export function sizeCodeOf(value: string): string {
  const v = value.trim()
  if (v.length === SIZE_CODE_LENGTH) return v
  return v.slice(SIZE_CODE_START, SIZE_CODE_START + SIZE_CODE_LENGTH)
}

/**
 * 把任意形态的输入归一成尺寸族。认不出的返回 null。
 *
 * 入参可以是完整 P/N、具体 4 位码、或族标识本身, 三者都收敛到同一答案 ——
 * 这是"存量配置不用重录"的实现方式, 也是判定时两边能直接比的依据。
 *
 * 7783 按**宽度**(前两位)判断, 而不是"字符串里含 77 或 83"。
 * 尺寸码是「宽+高」, 77/83 指的是宽度; 按包含判断的话, 将来出现
 * 65/77 这类规格会被无声并进 7783 族, 属于误判且极难发现。
 * 当前数据里高度只有 27/31/42/48/55, 两种判法结果一致。
 */
export function familyOf(value: string): SizeFamily | null {
  const code = sizeCodeOf(value)
  // 6555 是用户指名的具体码, 只认全等。做成"65 宽度全算"的话,
  // 将来出现 65/48 之类的规格会被静默并进 65 例外。
  if (code === '6555') return '6555'
  if (!/^\d{4}$/.test(code)) return null
  const width = code.slice(0, 2)
  return width === '77' || width === '83' ? '7783' : null
}

/**
 * 归一成族标识字符串, 认不出返回空串。
 *
 * 面板保存时用它把存量写法 (完整 P/N、7748 这类具体码) 收敛成
 * `6555` / `7783`, 让磁盘上的配置只有一种形态。
 */
export function normalizeFamily(value: string): string {
  return familyOf(value) ?? ''
}

/**
 * 预设的例外类型, 供面板下拉提示。
 *
 * 与尺寸族一一对应, 只保留业务上真实存在的两类。之前按尺寸码列了六项
 * (77/27例外 / 77/42例外 …) 是过度拆分: 车间说的是"77/83 那一档",
 * 细分到具体规格反而要求录入者记住哪些码属于哪档。
 *
 * 只做提示, 不限制输入 —— 车间以后可能出现别的例外, 用户可以直接写。
 */
export const PRESET_TYPES: ReadonlyArray<string> = ['65例外', '7783例外']

/** 族 -> 预设类型。用于选中族时自动填文案。 */
const TYPE_BY_FAMILY: Record<SizeFamily, string> = {
  '6555': '65例外',
  '7783': '7783例外',
}

/** 尺寸串末尾的例外标记, 形如 `(65例外)` */
const SUFFIX_RE = /\([^()]*\)\s*$/

/** 新增一行时用的空行 */
export function blankException(): JigException {
  return { jigId: '', pn: '', type: '' }
}

/**
 * 从尺寸族推导默认的例外类型。
 *
 * 入参可以是完整 P/N、具体码或族标识 —— 面板里传的是族标识, 单测里
 * 三种都会用到。认不出的返回空串, 让用户自己填。
 */
export function suggestType(pn: string): string {
  const family = familyOf(pn)
  return family ? TYPE_BY_FAMILY[family] : ''
}

/**
 * 校验每一行, 返回行下标到错误信息的映射。
 *
 * JIG ID 必须 12 位且不重复 —— 一个治具只配一条例外, 重复行在索引里
 * 会互相覆盖, 表现为"明明配了却不生效", 很难查。
 */
export function validateJigExceptions(
  list: ReadonlyArray<JigException>,
): JigExceptionErrors {
  const errors: JigExceptionErrors = {}
  const seen = new Map<string, number>()

  list.forEach((e, i) => {
    const id = e.jigId.trim()
    if (!id) {
      errors[i] = 'JIG ID 不能为空'
      return
    }
    if (id.length !== JIG_ID_LENGTH) {
      errors[i] = `JIG ID 应为 ${JIG_ID_LENGTH} 位, 当前 ${id.length} 位`
      return
    }
    const first = seen.get(id)
    if (first !== undefined) {
      errors[i] = `JIG ID ${id} 与第 ${first + 1} 行重复`
      return
    }
    seen.set(id, i)

    if (!e.pn.trim()) {
      errors[i] = '例外 P/N 不能为空'
      return
    }
    /*
     * 只接受能归到族的取值。存量的完整 P/N 和具体码都能通过,
     * 保存时由调用方归一成族 (见面板的 save)。
     *
     * 不能在这里要求"必须等于 6555 或 7783": 那样打开旧配置就会满屏报错,
     * 而这些记录其实完全有效 —— 只是写法和现在不同。
     */
    if (!familyOf(e.pn)) {
      errors[i] = '例外 P/N 只能是 6555 或 7783 (含 77/83 宽度的全部规格)'
      return
    }
    if (!e.type.trim()) {
      errors[i] = '例外类型不能为空'
      return
    }
  })

  return errors
}

/**
 * 建索引: JIG ID -> 记录。
 *
 * 标红是逐行计算的, 十万行乘以几十条例外, 若每次遍历数组会到千万级比较。
 * 索引后是 O(1)。重复 JIG ID 时后者覆盖前者 —— 面板的校验会拦住这种情况,
 * 这里只是保证即使配置里有脏数据也不会崩。
 */
export function buildExceptionIndex(
  list: ReadonlyArray<JigException>,
): Map<string, JigException> {
  const index = new Map<string, JigException>()
  for (const e of list) {
    const id = e.jigId.trim()
    if (id) index.set(id, e)
  }
  return index
}

/**
 * 判定某行是否命中例外。
 *
 * 两个条件都必须成立: JIG ID 相同, 且该行 P/N 与本条例外的**尺寸族**
 * 相同。只匹配 JIG ID 不够 —— 例外是针对特定规格档的, 同一台治具做
 * 别的宽度仍然正常。
 *
 * 归不到族的 P/N (太短、或 39/31 这类未设例外的宽度) 一律不命中:
 * 不能让空串和任何记录相等, 否则一条脏数据能命中整表。
 */
export function findExceptionHit(
  index: ReadonlyMap<string, JigException>,
  jigId: string,
  pn: string,
): JigException | undefined {
  const id = jigId.trim()
  if (!id) return undefined
  const hit = index.get(id)
  if (!hit) return undefined

  const rowFamily = familyOf(pn)
  if (!rowFamily) return undefined
  return familyOf(hit.pn) === rowFamily ? hit : undefined
}

/**
 * 给尺寸串追加例外标记, 形如 `All Size(65例外)`。
 *
 * 先剥离已有标记再加, 保证**幂等**: 同一行重复处理不会叠成
 * `All Size(65例外)(65例外)`。重算全表时这条很关键 ——
 * 「对应尺寸」列会被反复重建, 不幂等就会越滚越长。
 */
export function annotateSize(size: string, type: string): string {
  const t = type.trim()
  if (!t) return size
  return `${stripExceptionSuffix(size)}(${t})`
}

/**
 * 剥离末尾的例外标记。
 *
 * `validateSizeMatch` 的入参是「对应尺寸」列的值, 而该列现在可能带标记。
 * 判定必须基于纯尺寸串, 否则 `All Size` 会比对不上、`parseSizeCodes`
 * 也会把标记里的数字当规格码。
 *
 * 为什么不靠"例外命中就提前返回"来省掉这一步: 那是隐式契约, 一旦调用方
 * 忘了传例外索引, 带标记的串就会流进解析逻辑, 错得很安静。显式剥离更稳。
 */
export function stripExceptionSuffix(size: string): string {
  return size.replace(SUFFIX_RE, '').trim()
}
