/**
 * 例外对象 —— 命中判定、尺寸标注、配置清洗
 *
 * 这里最要紧的四条不变量:
 *   1. 判定看 (JIG ID, **尺寸族**) 的匹配, 与例外类型的文案无关
 *   2. 尺寸列上的标记只是显示, 不能反过来影响任何判定结果
 *   3. 同规格不同料号算命中 —— 例外说的是"做不了 65/55 这个规格",
 *      不是"做不了 6072J-6555H 这个料号"
 *   4. 7783 是一档而不是一个码: 7748 / 7742 / 7727 / 8348 全都算
 *
 * 第 2 条曾经被设计成"靠污染尺寸串让匹配失败", 结果类型里出现 4 位数字时
 * (如 `7748例外`) 会被 parseSizeCodes 认成规格码, 反而判成匹配。现在判定
 * 与显示已经分开, 但必须有测试守住这个边界。
 *
 * 第 3 条是后来改的: 早期按完整 P/N 精确比较, 换一批料号例外就失效, 而且
 * 面板里会列出一串显示几乎一样的完整 P/N。现在按尺寸族比, 同时兼容存量
 * 配置里存完整 P/N 或具体码的记录 —— 三种写法都归一到同一族。
 */

import { describe, it, expect } from 'vitest'
import {
  annotateSize,
  blankException,
  buildExceptionIndex,
  familyOf,
  findExceptionHit,
  JIG_ID_LENGTH,
  normalizeFamily,
  sizeCodeOf,
  SIZE_CODE_LENGTH,
  SIZE_FAMILIES,
  stripExceptionSuffix,
  suggestType,
  validateJigExceptions,
} from '../src/core/jigExceptions'
import type { JigException } from '../src/core/jigExceptions'
import { createDefaultConfig, mergeConfig } from '../src/core/config'
import { JIG_EXCEPTION_PRESET_VERSION } from '../src/core/jigExceptionPresets'
import { rulesFromConfig, validateSizeMatch } from '../src/core/validate'
import { processSourceData } from '../src/core/query'
import type { Row } from '../src/core/table'

const ex = (jigId: string, pn: string, type = '65例外'): JigException => ({ jigId, pn, type })

const JIG_A = 'C4M240701001'
const JIG_B = 'CJJ349000E07'
const PN_65 = '6073J-6555F'
const PN_77 = '6073J-7748K'
const CODE_65 = '6555'

describe('尺寸码提取 sizeCodeOf', () => {
  it('完整 P/N 取第 7~10 位', () => {
    expect(sizeCodeOf('6073J-6555F')).toBe('6555')
    expect(sizeCodeOf('6072J-7748K')).toBe('7748')
  })

  it('已经是 4 位码时原样返回', () => {
    expect(sizeCodeOf('6555')).toBe('6555')
    expect(sizeCodeOf(' 7748 ')).toBe('7748')
  })

  it('取不到 4 位时返回空串, 不返回半截', () => {
    expect(sizeCodeOf('')).toBe('')
    expect(sizeCodeOf('65')).toBe('')
    expect(sizeCodeOf('ABC')).toBe('')
  })

  it('约定的码长是 4 位', () => {
    expect(SIZE_CODE_LENGTH).toBe(4)
  })
})

describe('尺寸族 familyOf', () => {
  it('6555 只认自己, 不做"65 宽度全算"', () => {
    expect(familyOf('6555')).toBe('6555')
    expect(familyOf('6073J-6555F')).toBe('6555')
    // 65/48 也是 65 宽度, 但它不是用户指名的 6555, 不能并进 65 例外
    expect(familyOf('6548')).toBeNull()
  })

  it('77 与 83 宽度的所有码都归 7783', () => {
    // 用户明确点名的四个
    expect(familyOf('7748')).toBe('7783')
    expect(familyOf('7742')).toBe('7783')
    expect(familyOf('8348')).toBe('7783')
    expect(familyOf('7727')).toBe('7783')
    // 完整 P/N 形态
    expect(familyOf('6073J-7748K')).toBe('7783')
    expect(familyOf('6072J-8348E')).toBe('7783')
  })

  it('族标识本身也认得 —— 它经过同一套归一', () => {
    expect(familyOf('7783')).toBe('7783')
    expect(familyOf(' 7783 ')).toBe('7783')
  })

  it('不在两族里的规格一律 null', () => {
    // 39/31 是真实规格, 但没有设例外
    expect(familyOf('3931')).toBeNull()
    expect(familyOf('6072J-3931H')).toBeNull()
  })

  it('取不到 4 位的输入返回 null', () => {
    expect(familyOf('')).toBeNull()
    expect(familyOf('65')).toBeNull()
    expect(familyOf('ABC')).toBeNull()
  })

  it('按宽度判断而不是"含 77 或 83 子串"', () => {
    // 6577 的宽度是 65, 高度才是 77 —— 归 7783 就是误判。
    // 当前数据里高度只有 27/31/42/48/55, 碰不到这种码, 但边界要写清楚。
    expect(familyOf('6577')).toBeNull()
  })

  it('normalizeFamily 把三种写法收敛成族标识', () => {
    expect(normalizeFamily('6072J-6555H')).toBe('6555')
    expect(normalizeFamily('7748')).toBe('7783')
    expect(normalizeFamily('7783')).toBe('7783')
    expect(normalizeFamily('3931')).toBe('')
  })

  it('面板下拉的两档与 familyOf 的取值集合一致', () => {
    expect([...SIZE_FAMILIES]).toEqual(['6555', '7783'])
    for (const f of SIZE_FAMILIES) {
      expect(familyOf(f)).toBe(f)
    }
  })
})

describe('例外对象 —— 按尺寸族命中', () => {
  it('存 4 位码时, 同规格的任意料号都命中', () => {
    // 这是本次改动的核心: 例外不是绑在某个料号上的
    const idx = buildExceptionIndex([ex(JIG_A, CODE_65)])
    expect(findExceptionHit(idx, JIG_A, '6073J-6555F')).toBeDefined()
    expect(findExceptionHit(idx, JIG_A, '6072J-6555H')).toBeDefined()
    expect(findExceptionHit(idx, JIG_A, '6073J-6555C')).toBeDefined()
  })

  it('存 7783 时, 77 与 83 宽度的四种码全部命中', () => {
    const idx = buildExceptionIndex([ex(JIG_A, '7783', '7783例外')])
    expect(findExceptionHit(idx, JIG_A, '6073J-7748K')).toBeDefined()
    expect(findExceptionHit(idx, JIG_A, '6073J-7742H')).toBeDefined()
    expect(findExceptionHit(idx, JIG_A, '6072J-7727C')).toBeDefined()
    expect(findExceptionHit(idx, JIG_A, '6072J-8348E')).toBeDefined()
  })

  it('存 7783 时, 6555 不命中 —— 两族互不越界', () => {
    const idx = buildExceptionIndex([ex(JIG_A, '7783', '7783例外')])
    expect(findExceptionHit(idx, JIG_A, '6073J-6555F')).toBeUndefined()
  })

  it('存 6555 时, 77/83 宽度的码不命中', () => {
    const idx = buildExceptionIndex([ex(JIG_A, CODE_65)])
    expect(findExceptionHit(idx, JIG_A, '6073J-7748K')).toBeUndefined()
    expect(findExceptionHit(idx, JIG_A, '6072J-8348E')).toBeUndefined()
  })

  it('存量具体码 (7748) 与族标识 (7783) 行为完全一致', () => {
    const legacy = buildExceptionIndex([ex(JIG_A, '7748', '7783例外')])
    const current = buildExceptionIndex([ex(JIG_A, '7783', '7783例外')])
    for (const pn of ['6073J-7748K', '6073J-7742H', '6072J-7727C', '6072J-8348E', '6073J-6555F']) {
      expect(!!findExceptionHit(legacy, JIG_A, pn)).toBe(!!findExceptionHit(current, JIG_A, pn))
    }
  })

  it('39/31 这类未设例外的规格永远不命中, 不管例外存的是哪一族', () => {
    for (const fam of ['6555', '7783']) {
      const idx = buildExceptionIndex([ex(JIG_A, fam)])
      expect(findExceptionHit(idx, JIG_A, '6072J-3931H')).toBeUndefined()
    }
  })

  it('存量记录存完整 P/N 也照样命中同规格的别的料号', () => {
    // 老配置里是 6073J-6555F, 源数据换成 6072J-6555H 仍然命中
    const idx = buildExceptionIndex([ex(JIG_A, PN_65)])
    expect(findExceptionHit(idx, JIG_A, '6072J-6555H')).toBeDefined()
  })

  it('尺寸码不同则一律不命中', () => {
    const idx = buildExceptionIndex([ex(JIG_A, CODE_65)])
    expect(findExceptionHit(idx, JIG_A, PN_77)).toBeUndefined()
  })

  it('P/N 取不到尺寸码时不命中 —— 不能让空串命中任何记录', () => {
    const idx = buildExceptionIndex([ex(JIG_A, CODE_65)])
    expect(findExceptionHit(idx, JIG_A, '')).toBeUndefined()
    expect(findExceptionHit(idx, JIG_A, '65')).toBeUndefined()
    expect(findExceptionHit(idx, JIG_A, 'SHORT')).toBeUndefined()
  })

  it('例外记录本身取不到码时也不命中', () => {
    const idx = buildExceptionIndex([ex(JIG_A, '65')])
    expect(findExceptionHit(idx, JIG_A, PN_65)).toBeUndefined()
  })

  it('不同治具 + 同尺寸码不命中 —— 别的治具照常做这个规格', () => {
    const idx = buildExceptionIndex([ex(JIG_A, CODE_65)])
    expect(findExceptionHit(idx, JIG_B, PN_65)).toBeUndefined()
  })

  it('空 JIG ID 不命中', () => {
    const idx = buildExceptionIndex([ex(JIG_A, CODE_65)])
    expect(findExceptionHit(idx, '', PN_65)).toBeUndefined()
  })

  it('首尾空格不影响匹配', () => {
    const idx = buildExceptionIndex([ex(JIG_A, CODE_65)])
    expect(findExceptionHit(idx, ` ${JIG_A} `, ` ${PN_65} `)).toBeDefined()
  })

  it('编号含字母也能精确匹配 (CJJ349000E07 / C40250401901 这类)', () => {
    const idx = buildExceptionIndex([ex('C40250401901', CODE_65)])
    expect(findExceptionHit(idx, 'C40250401901', PN_65)).toBeDefined()
  })
})

describe('例外对象 —— 索引构建', () => {
  it('空 JIG ID 被跳过', () => {
    const idx = buildExceptionIndex([ex('', PN_65), ex(JIG_A, PN_65)])
    expect(idx.size).toBe(1)
  })

  it('重复 JIG ID 时后者覆盖, 不抛错', () => {
    const idx = buildExceptionIndex([ex(JIG_A, PN_65), ex(JIG_A, PN_77)])
    expect(idx.get(JIG_A)?.pn).toBe(PN_77)
  })
})

describe('例外对象 —— 录入校验', () => {
  it('合法行没有错误', () => {
    expect(validateJigExceptions([ex(JIG_A, PN_65)])).toEqual({})
  })

  it('空 JIG ID 报错', () => {
    const e = validateJigExceptions([blankException()])
    expect(e[0]).toContain('JIG ID')
  })

  it(`长度不是 ${JIG_ID_LENGTH} 位报错`, () => {
    const e = validateJigExceptions([ex('C4M24070', PN_65)])
    expect(e[0]).toContain(`${JIG_ID_LENGTH}`)
  })

  it('重复 JIG ID 报错, 并指出是第几行', () => {
    const e = validateJigExceptions([ex(JIG_A, PN_65), ex(JIG_A, PN_77)])
    expect(e[1]).toContain('重复')
    expect(e[1]).toContain('1')
  })

  it('空 P/N 报错', () => {
    const e = validateJigExceptions([ex(JIG_A, '')])
    expect(e[0]).toContain('P/N')
  })

  it('归不到尺寸族时报错', () => {
    // 面板里 P/N 是下拉选的, 正常进不来这种值; 但配置被手改过就可能出现,
    // 而且这类脏数据在判定时会静默不命中, 不拦下来很难查。
    expect(validateJigExceptions([ex(JIG_A, '65')])[0]).toContain('6555')
    expect(validateJigExceptions([ex(JIG_A, 'ABC')])[0]).toContain('6555')
    // 39/31 是真实规格, 但不属于任何例外族 —— 录进来也永远不会命中
    expect(validateJigExceptions([ex(JIG_A, '3931')])[0]).toContain('6555')
  })

  it('族标识 / 具体码 / 完整 P/N 三种写法都算合法 —— 兼容存量配置', () => {
    expect(validateJigExceptions([ex(JIG_A, CODE_65)])).toEqual({})
    expect(validateJigExceptions([ex(JIG_A, PN_65)])).toEqual({})
    expect(validateJigExceptions([ex(JIG_A, '7783')])).toEqual({})
    // 上一版存的是具体码, 打开旧配置不能满屏报错
    expect(validateJigExceptions([ex(JIG_A, '7748')])).toEqual({})
  })

  it('空类型报错', () => {
    const e = validateJigExceptions([ex(JIG_A, PN_65, '')])
    expect(e[0]).toContain('类型')
  })

  it('一个治具只配一条 —— 两行同编号必然有一行报错', () => {
    expect(Object.keys(validateJigExceptions([ex(JIG_A, PN_65), ex(JIG_A, PN_65)]))).toHaveLength(1)
  })
})

describe('例外对象 —— 尺寸标记', () => {
  it('追加标记, 不加空格', () => {
    expect(annotateSize('All Size', '65例外')).toBe('All Size(65例外)')
  })

  it('原尺寸为空时只留标记', () => {
    expect(annotateSize('', '65例外')).toBe('(65例外)')
  })

  it('类型为空时原样返回', () => {
    expect(annotateSize('77/48', '  ')).toBe('77/48')
  })

  it('幂等: 重复标注不会叠加', () => {
    const once = annotateSize('All Size', '65例外')
    expect(annotateSize(once, '65例外')).toBe(once)
  })

  it('换类型时替换而非追加', () => {
    expect(annotateSize('All Size(65例外)', '77/48例外')).toBe('All Size(77/48例外)')
  })

  it('剥离标记', () => {
    expect(stripExceptionSuffix('All Size(65例外)')).toBe('All Size')
  })

  it('无标记时保持不变', () => {
    expect(stripExceptionSuffix('65/55_77/48')).toBe('65/55_77/48')
  })

  it('尺寸串自带的括号不被误剥 (只剥末尾一组)', () => {
    expect(stripExceptionSuffix('All Size(a)(b)')).toBe('All Size(a)')
  })
})

describe('例外对象 —— 类型推导', () => {
  it('6555 -> 65例外', () => {
    expect(suggestType(PN_65)).toBe('65例外')
  })

  it('77 与 83 宽度的任何码都推成 7783例外', () => {
    expect(suggestType('6073J-7742H')).toBe('7783例外')
    expect(suggestType('6072J-7727C')).toBe('7783例外')
    expect(suggestType('6073J-8348K')).toBe('7783例外')
  })

  it('直接给族标识或具体码也能推 —— 面板传的就是族标识', () => {
    expect(suggestType(CODE_65)).toBe('65例外')
    expect(suggestType('6555')).toBe('65例外')
    expect(suggestType('7783')).toBe('7783例外')
    expect(suggestType('7748')).toBe('7783例外')
    expect(suggestType('8348')).toBe('7783例外')
  })

  it('认不出的 P/N 返回空串, 交给用户填', () => {
    // 39/31 是真实规格但不在任何例外族里
    expect(suggestType('6073J-3931H')).toBe('')
    expect(suggestType('6073J-9999Z')).toBe('')
  })
})

describe('例外对象 —— 与尺寸判定互不干扰', () => {
  const rules = rulesFromConfig(createDefaultConfig())

  it('带标记的 All Size 仍按 All Size 处理', () => {
    expect(validateSizeMatch(PN_65, 'All Size(65例外)', rules)).toBe(true)
  })

  it('标记里含 4 位数字也不会被当成规格码', () => {
    // 这正是"靠污染尺寸串判定"会翻车的写法: 7748 会被解析成规格码
    expect(validateSizeMatch(PN_65, 'All Size(7748例外)', rules)).toBe(true)
  })

  it('带标记的 65/55 仍能正常匹配 6555', () => {
    expect(validateSizeMatch(PN_65, '65/55(65例外)', rules)).toBe(true)
  })

  it('例外本身不由 validateSizeMatch 判定 —— 它不认识 JIG ID', () => {
    // 同一行, 无论 JIG ID 是哪台, 函数结果只由 P/N 与尺寸决定
    expect(validateSizeMatch(PN_65, 'All Size', rules)).toBe(true)
  })
})

describe('例外对象 —— 配置合并与清洗', () => {
  /*
   * 一份「已经见过出厂预设」的磁盘配置。
   *
   * 不带 jigExceptionsPresetVersion 的话 mergeConfig 会走首次补齐逻辑,
   * 把 78 条预设并进来 —— 下面的用例只关心清洗规则, 所以显式声明已迁移。
   */
  const migrated = (extra: Record<string, unknown>) => ({
    jigExceptionsPresetVersion: JIG_EXCEPTION_PRESET_VERSION,
    ...extra,
  })

  it('默认就是出厂预设的 78 条', () => {
    const list = createDefaultConfig().jigExceptions
    expect(list).toHaveLength(78)
    // 252×7 + 256×51 + 262×20 全部是 6555 档 / 65例外
    expect(list.every((e) => e.pn === '6555' && e.type === '65例外')).toBe(true)
  })

  it('预设里没有重复编号, 且全部是 12 位', () => {
    const list = createDefaultConfig().jigExceptions
    expect(new Set(list.map((e) => e.jigId)).size).toBe(list.length)
    expect(list.every((e) => e.jigId.length === JIG_ID_LENGTH)).toBe(true)
  })

  it('每次取默认配置都是新对象, 改一份不影响另一份', () => {
    const a = createDefaultConfig()
    const b = createDefaultConfig()
    a.jigExceptions[0].pn = '7783'
    expect(b.jigExceptions[0].pn).toBe('6555')
  })

  it('磁盘上的合法记录被读入', () => {
    const c = mergeConfig(
      migrated({ jigExceptions: [{ jigId: JIG_A, pn: PN_65, type: '65例外' }] }),
    )
    expect(c.jigExceptions).toHaveLength(1)
    expect(c.jigExceptions[0].jigId).toBe(JIG_A)
  })

  it('缺 jigId 的项被丢弃, 不会让建索引时崩', () => {
    const c = mergeConfig(
      migrated({
        jigExceptions: [{ pn: PN_65, type: 'x' }, { jigId: JIG_A, pn: PN_65, type: 'y' }],
      }),
    )
    expect(c.jigExceptions).toHaveLength(1)
  })

  it('非对象元素被丢弃', () => {
    const c = mergeConfig(
      migrated({
        jigExceptions: [null, 'x', 42, { jigId: JIG_A, pn: PN_65, type: 'z' }],
      }),
    )
    expect(c.jigExceptions).toHaveLength(1)
  })

  it('pn / type 缺失时补空串, 保留记录以便在面板里补全', () => {
    const c = mergeConfig(migrated({ jigExceptions: [{ jigId: JIG_A }] }))
    expect(c.jigExceptions[0]).toEqual({ jigId: JIG_A, pn: '', type: '' })
  })

  it('snake_case 键名也能读 (与整体配置策略一致)', () => {
    const c = mergeConfig(
      migrated({ jigExceptions: [{ jig_id: JIG_A, pn: PN_65, type: 't' }] }),
    )
    expect(c.jigExceptions[0].jigId).toBe(JIG_A)
  })

  it('不是数组时保留默认预设', () => {
    const c = mergeConfig(migrated({ jigExceptions: { bad: true } }))
    expect(c.jigExceptions).toHaveLength(78)
  })
})

describe('例外对象 —— 出厂预设的补齐', () => {
  it('预设上线前写盘的配置会被补上预设', () => {
    // 没有 jigExceptionsPresetVersion 字段 = 老配置
    const c = mergeConfig({ jigExceptions: [{ jigId: JIG_A, pn: '6555', type: '65例外' }] })
    expect(c.jigExceptions).toHaveLength(78)
    expect(c.jigExceptionsPresetVersion).toBe(JIG_EXCEPTION_PRESET_VERSION)
  })

  it('补齐时磁盘已有记录优先, 不被预设覆盖', () => {
    // JIG_A 在预设里, 但用户手写的是 7783 / 自定义类型
    const c = mergeConfig({
      jigExceptions: [{ jigId: JIG_A, pn: '7783', type: '我自己写的' }],
    })
    const hit = c.jigExceptions.find((e) => e.jigId === JIG_A)
    expect(hit).toEqual({ jigId: JIG_A, pn: '7783', type: '我自己写的' })
    expect(c.jigExceptions).toHaveLength(78)
  })

  it('补齐保留磁盘上预设之外的自建编号, 且排在预设之后', () => {
    const own = 'CXX000000001'
    const c = mergeConfig({ jigExceptions: [{ jigId: own, pn: '6555', type: '65例外' }] })
    expect(c.jigExceptions).toHaveLength(79)
    expect(c.jigExceptions[c.jigExceptions.length - 1].jigId).toBe(own)
  })

  it('空表也会被补齐 —— 那时还分不清"没录过"和"故意清空"', () => {
    const c = mergeConfig({ jigExceptions: [] })
    expect(c.jigExceptions).toHaveLength(78)
  })

  it('用户真实配置形态 (snake_case + 手录 1 条 + 无版本号) 补齐到 78 条', () => {
    // 这正是升级现场: 磁盘上是 jig_exceptions, 里面只有用户手敲的一条,
    // 且没有 jig_exceptions_preset_version。那一条恰好在预设里 -> 仍 78 条。
    const c = mergeConfig({
      jig_exceptions: [{ jigId: 'C4M240701401', pn: '6555', type: '65例外' }],
    })
    expect(c.jigExceptions).toHaveLength(78)
    expect(c.jigExceptionsPresetVersion).toBe(JIG_EXCEPTION_PRESET_VERSION)
  })

  it('已迁移过的配置不再补齐: 用户删掉的条目不会复活', () => {
    const c = mergeConfig({
      jigExceptionsPresetVersion: JIG_EXCEPTION_PRESET_VERSION,
      jigExceptions: [{ jigId: JIG_A, pn: '6555', type: '65例外' }],
    })
    expect(c.jigExceptions).toHaveLength(1)
  })

  it('已迁移过 + 空表 -> 就是空表 (用户主动清空要留得住)', () => {
    const c = mergeConfig({
      jigExceptionsPresetVersion: JIG_EXCEPTION_PRESET_VERSION,
      jigExceptions: [],
    })
    expect(c.jigExceptions).toEqual([])
  })

  it('版本字段用 snake_case 也能识别', () => {
    const c = mergeConfig({
      jig_exceptions_preset_version: JIG_EXCEPTION_PRESET_VERSION,
      jig_exceptions: [{ jigId: JIG_A, pn: '6555', type: '65例外' }],
    })
    expect(c.jigExceptions).toHaveLength(1)
  })
})

describe('例外对象 —— 源数据标注', () => {
  const base = createDefaultConfig()
  const source: Row[] = [
    {
      'P/N': PN_65,
      'Jig ID': JIG_A,
      'Jig 对应型号': '256 256',
      'Jig状态': 'INPRODUCTION',
    },
    {
      'P/N': PN_65,
      'Jig ID': JIG_B,
      'Jig 对应型号': '256 256',
      'Jig状态': 'INPRODUCTION',
    },
    {
      'P/N': PN_77,
      'Jig ID': JIG_A,
      'Jig 对应型号': '256 256',
      'Jig状态': 'INPRODUCTION',
    },
  ]

  it('命中例外的行追加类型标记', () => {
    const cfg = { ...base, jigExceptions: [ex(JIG_A, PN_65)] }
    const t = processSourceData(source, cfg)
    const row = t.rows.find((r) => r['Jig ID'] === JIG_A && r['P/N'] === PN_65)
    expect(row!['对应尺寸']).toBe('All Size(65例外)')
  })

  it('同治具但 P/N 不同 -> 不加标记', () => {
    const cfg = { ...base, jigExceptions: [ex(JIG_A, PN_65)] }
    const t = processSourceData(source, cfg)
    const row = t.rows.find((r) => r['Jig ID'] === JIG_A && r['P/N'] === PN_77)
    expect(row!['对应尺寸']).toBe('All Size')
  })

  it('同 P/N 但治具不同 -> 不加标记', () => {
    const cfg = { ...base, jigExceptions: [ex(JIG_A, PN_65)] }
    const t = processSourceData(source, cfg)
    const row = t.rows.find((r) => r['Jig ID'] === JIG_B)
    expect(row!['对应尺寸']).toBe('All Size')
  })

  it('例外表为空时一个字符都不改', () => {
    // 默认配置现在带 78 条预设, 而 JIG_A / JIG_B 恰好都在里面 ——
    // 要测"空表零影响"就得显式清空
    const t = processSourceData(source, { ...base, jigExceptions: [] })
    expect(t.rows.every((r) => r['对应尺寸'] === 'All Size')).toBe(true)
  })
})
