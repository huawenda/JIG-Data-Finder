/**
 * 校验 test-500.xlsx 的覆盖面与正确性。
 *
 * ## 两份输入
 *
 *   test-500.xlsx                     源数据 (本地生成, .gitignore 排除)
 *   tests/fixtures/jig-exceptions.json 例外清单 + 每行期望红绿
 *
 * 为什么期望值放在 JSON 里而不是本文件里手写: 500 行的红绿取决于
 * (P/N, 型号, 例外) 三者, 手写不现实; 而"用生产代码推导期望"就成了
 * 自己验证自己。折中办法是**把生成时的构造意图导出成夹具** ——
 * 期望值来自分组设计, 不是来自被测函数的输出。
 *
 * 判定仍然直接调用 src/core 的 validateSizeMatch 与 findExceptionHit,
 * 不在校验脚本里复刻规则 —— 复刻会引入第二份逻辑, 两份一旦漂移,
 * 校验就成了自说自话。
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx-js-style'
import { validateSizeMatch, rulesFromConfig } from '../../src/core/validate'
import { createDefaultConfig } from '../../src/core/config'
import { generatePivot } from '../../src/core/pivot'
import { extractJigIds } from '../../src/core/clipboard'
import {
  buildExceptionIndex,
  familyOf,
  findExceptionHit,
  stripExceptionSuffix,
} from '../../src/core/jigExceptions'
import { processSourceData } from '../../src/core/query'
import { PRESET_JIG_EXCEPTIONS } from '../../src/core/jigExceptionPresets'

// ---------------------------------------------------------------------------
// 夹具加载
// ---------------------------------------------------------------------------

interface ExceptionFixture {
  rowCount: number
  pnList: string[]
  exceptions: { jigId: string; pn: string; type: string }[]
  groups: {
    name: string
    pn: string
    model: string
    rows: number
    expectRed: boolean
    jigIds: string[]
  }[]
}

const XLSX_PATH = resolve(__dirname, '..', '..', 'test-500.xlsx')
const JSON_PATH = resolve(__dirname, 'jig-exceptions.json')

// test-500.xlsx 是生成产物且被 .gitignore 排除, 新克隆下来的仓库里没有它。
// 裸 ENOENT 看不出该做什么, 这里换成一句可执行的提示。
function readFixtureXlsx(): Buffer {
  try {
    return readFileSync(XLSX_PATH)
  } catch {
    throw new Error(
      `找不到 ${XLSX_PATH}\n` +
        '这是生成产物, 不在版本库里。请先运行: python tools/gen-test-xlsx.py',
    )
  }
}

const fixture = JSON.parse(readFileSync(JSON_PATH, 'utf8')) as ExceptionFixture
const wb = XLSX.read(readFixtureXlsx())
const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], {
  raw: false,
  defval: '',
})

// 带上例外清单的配置 —— 这是真实使用状态 (面板里配了 78 条),
// 也是唯一能让例外规则生效的状态。
const cfg = { ...createDefaultConfig(), jigExceptions: fixture.exceptions }
const rules = rulesFromConfig(cfg)
const exceptionIndex = buildExceptionIndex(cfg.jigExceptions)

const strRows = rows.map((r) => {
  const o: Record<string, string> = {}
  for (const [k, v] of Object.entries(r)) o[k] = String(v ?? '')
  return o
})
const rowById = new Map(strRows.map((r) => [r['Jig ID'], r]))
const idToGroup = new Map<string, ExceptionFixture['groups'][number]>()
for (const g of fixture.groups) for (const id of g.jigIds) idToGroup.set(id, g)

// 复用生产代码生成透视表, 不在校验脚本里复刻一遍列序逻辑。
const active = strRows.filter((r) => r['Jig状态'] === cfg.jigStatusActiveValue)
const pivot = generatePivot(active, false, cfg)

/** 取一行的「对应尺寸」纯映射值 (不带例外标记) */
function mappedSize(row: Record<string, string>): string {
  const model = row['Jig 对应型号'].split(/\s+/)[0]
  return cfg.jigSizeMapping[model] ?? ''
}

/** 该行是否应当标红 —— 例外优先, 其次严格 4 位匹配 */
function isRed(row: Record<string, string>): boolean {
  const pn = row['P/N']
  if (findExceptionHit(exceptionIndex, row['Jig ID'], pn)) return true
  return !validateSizeMatch(pn, stripExceptionSuffix(mappedSize(row)), rules)
}

describe('test-500.xlsx', () => {
  // -------------------------------------------------------------------------
  // 基础结构
  // -------------------------------------------------------------------------

  it('有 500 行数据', () => {
    expect(rows.length).toBe(500)
    expect(rows.length).toBe(fixture.rowCount)
  })

  it('列序与真实导出完全一致, 含末尾的 Jig状态', () => {
    expect(Object.keys(rows[0])).toEqual([
      'P/N', 'Lot ID', 'CST ID', 'Slot No', 'Jig ID',
      'Jig 对应型号', 'Glass判定', '工程', '工程名', 'Jig状态',
    ])
  })

  it('Jig状态 覆盖在产与已入库, 审查页应只显示在产部分', () => {
    const states = new Set(rows.map((r) => r['Jig状态']))
    expect(states.has(cfg.jigStatusActiveValue)).toBe(true)
    expect(states.size).toBeGreaterThan(1)
    const inProd = rows.filter((r) => r['Jig状态'] === cfg.jigStatusActiveValue).length
    expect(inProd).toBeGreaterThan(0)
    expect(inProd).toBeLessThan(rows.length)
  })

  it('覆盖 engineeringConfig 的全部 11 道工序', () => {
    const present = new Set(rows.map((r) => r['工程名'] as string))
    for (const stage of Object.keys(cfg.engineeringConfig)) {
      expect(present.has(stage), `缺少工序 ${stage}`).toBe(true)
    }
    expect(present.size).toBe(11)
  })

  it('PNP 2nd 排在 PNP 与 Jig 洗净及检查之间', () => {
    const orders = Object.entries(cfg.engineeringConfig)
      .sort((a, b) => a[1].order - b[1].order)
      .map(([name]) => name)
    const iPnp = orders.indexOf('PNP')
    const i2nd = orders.indexOf('PNP 2nd')
    const iWash = orders.indexOf('Jig 洗净及检查')
    expect(iPnp).toBeGreaterThanOrEqual(0)
    expect(i2nd).toBeGreaterThanOrEqual(0)
    expect(iWash).toBeGreaterThanOrEqual(0)
    expect(iPnp).toBeLessThan(i2nd)
    expect(i2nd).toBeLessThan(iWash)
  })

  it('透视表的列序与工序顺序一致', () => {
    const order = new Map(
      Object.entries(cfg.engineeringConfig).map(([k, v]) => [k, v.order]),
    )
    const nonStage = new Set(['P/N', 'CST ID', cfg.keywordTotal])
    const stages = pivot.columns.filter((c) => !nonStage.has(c))
    expect(stages.length).toBe(Object.keys(cfg.engineeringConfig).length)
    const rank = stages.map((s) => {
      const r = order.get(s)
      expect(r, `列 ${s} 不在 engineeringConfig 里, 会被排到最后`).toBeDefined()
      return r as number
    })
    for (let i = 1; i < rank.length; i++) {
      expect(rank[i - 1], `第 ${i} 列 ${stages[i]} 排在了 ${stages[i - 1]} 之后`)
        .toBeLessThanOrEqual(rank[i])
    }
  })

  it('工程号覆盖多个, 且包含生产中判定值 50000', () => {
    const codes = new Set(rows.map((r) => String(r['工程'])))
    expect(codes.size).toBeGreaterThan(1)
    expect(codes.has(cfg.productionIndicatorCode)).toBe(true)
  })

  // -------------------------------------------------------------------------
  // P/N 命名规则与型号白名单
  //
  // 把规则钉在测试侧: 将来有人往 gen-test-xlsx.py 里加一个不符合真实编码
  // 规则的 P/N, 或随手填一个不在 jigSizeMapping 里的型号, 这里会先炸出来。
  //
  // 型号白名单尤其要独立校验 —— 型号查不到映射时对应尺寸是空串, 而
  // validateSizeMatch 规则 2 把空值判成"匹配", 于是未登记的型号会静默地
  // 变成"永远不标红", 标红回归直接失去意义。
  // -------------------------------------------------------------------------

  const PN_PREFIXES = ['6072J', '6073J']
  const PN_DIGITS = ['6555', '7748', '8348', '7727', '7742', '3931']
  const PN_SUFFIXES = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'K']
  const PN_RE = new RegExp(
    `^(?:${PN_PREFIXES.join('|')})-(?:${PN_DIGITS.join('|')})[${PN_SUFFIXES.join('')}]$`,
  )

  it('每个 P/N 都符合真实编码规则 <前缀>-<4位白名单><单字母后缀>', () => {
    const pns = [...new Set(rows.map((r) => String(r['P/N'])))]
    for (const pn of pns) {
      expect(PN_RE.test(pn), `P/N ${pn} 不符合编码规则`).toBe(true)
    }
    // 三段白名单都要被用到, 否则白名单本身写错了也发现不了
    for (const digits of PN_DIGITS) {
      expect(
        pns.some((pn) => pn.includes(`-${digits}`)),
        `尺寸码 ${digits} 未被覆盖`,
      ).toBe(true)
    }
    for (const prefix of PN_PREFIXES) {
      expect(pns.some((pn) => pn.startsWith(prefix)), `前缀 ${prefix} 未被覆盖`).toBe(true)
    }
    // 单字母后缀也应铺满, 避免全是同一个字母导致编码规则形同虚设
    const suffixes = new Set(pns.map((pn) => pn.slice(-1)))
    for (const s of PN_SUFFIXES) {
      expect(suffixes.has(s), `后缀 ${s} 未被覆盖`).toBe(true)
    }
  })

  it('型号全部来自 jigSizeMapping, 不出现规则之外的型号', () => {
    for (const r of rows) {
      const model = String(r['Jig 对应型号']).split(' ')[0]
      expect(
        Object.prototype.hasOwnProperty.call(cfg.jigSizeMapping, model),
        `型号 ${model} 不在 jigSizeMapping 里`,
      ).toBe(true)
    }
  })

  it('多种尺寸映射都被覆盖 —— All Size 与多规格串都在', () => {
    const sizes = strRows.map(mappedSize)
    expect(sizes.some((s) => s === cfg.allSizeValue)).toBe(true)
    expect(sizes.some((s) => s === '')).toBe(false)
    expect(new Set(sizes).size).toBeGreaterThanOrEqual(4)
  })

  // -------------------------------------------------------------------------
  // 例外对象覆盖
  //
  // 这是 2026-10 重构的重点。旧版 500 行里例外 ID 命中数为 0, 例外功能
  // 上线后没有任何数据能证明它生效。现在 78 条全部铺进源数据。
  // -------------------------------------------------------------------------

  it('例外清单是 78 条, 编号 12 位且互不重复', () => {
    expect(fixture.exceptions).toHaveLength(78)
    const ids = fixture.exceptions.map((e) => e.jigId)
    expect(new Set(ids).size).toBe(78)
    for (const e of fixture.exceptions) {
      expect(e.jigId.length, `JIG ID ${e.jigId} 长度应为 12`).toBe(12)
      expect(e.pn, `${e.jigId} 缺 P/N`).not.toBe('')
      expect(e.type, `${e.jigId} 缺类型`).not.toBe('')
    }
  })

  it('夹具里的例外清单与生产预设完全一致 (两份副本不能漂移)', () => {
    /*
     * 同一个业务事实存了两处: 运行时的出厂预设 (src/core/jigExceptionPresets.ts)
     * 和这份夹具的 exceptions (tools/gen-test-xlsx.py 生成源数据时的输入)。
     * 后者不能直接 import 生产代码(生成脚本在 Python 侧), 所以只能在这里
     * 把两边钉在一起 —— 车间更新清单时漏改一处, 这条会立刻失败。
     */
    const preset = PRESET_JIG_EXCEPTIONS.map((e) => ({
      jigId: e.jigId,
      pn: e.pn,
      type: e.type,
    }))
    // 比内容不比顺序: 两边的排列来源不同 (夹具按源数据铺开的次序,
    // 预设按型号分组), 顺序差异不影响任何判定, 钉住顺序只会带来无谓的维护。
    const byId = (a: { jigId: string }, b: { jigId: string }) => a.jigId.localeCompare(b.jigId)
    expect([...fixture.exceptions].sort(byId)).toEqual(preset.sort(byId))
  })

  it('78 条例外 ID 全部出现在源数据里, 且型号与所在组一致', () => {
    for (const e of fixture.exceptions) {
      const row = rowById.get(e.jigId)
      expect(row, `例外 ${e.jigId} 不在源数据里 —— 例外规则测不到`).toBeDefined()
      const group = idToGroup.get(e.jigId)
      expect(group, `${e.jigId} 不属于任何分组`).toBeDefined()
      // 源数据格式是 "型号 空格 型号", 取第一个词
      const model = row!['Jig 对应型号'].split(/\s+/)[0]
      expect(model, `${e.jigId} 源数据型号 ${model} 与分组 ${group!.model} 不符`)
        .toBe(group!.model)
    }
  })

  it('例外针对的是"型号能做但这台做不到", 不是"型号不支持"', () => {
    // 这条决定了例外的存在意义。若某个例外记录的尺寸族, **本来就不在
    // 该型号的规格里**, 那常规判定已经会标红, 例外纯属冗余。
    //
    // 三种型号的情况不同, 分开核对:
    //   252   -> 规格含 65/55, 常规判定为"匹配", 靠例外翻转成红
    //   256/262 -> All Size 恒匹配, 同样靠例外翻转
    //
    // 这些夹具记录的例外档是 6555。改成 7783 的话 A 组会连带命中 B 组的
    // 7748, B 组「不该红」的前提就不成立了 —— 所以这里必须钉住族。
    for (const e of fixture.exceptions) {
      expect(familyOf(e.pn), `${e.jigId} 的例外档应为 6555`).toBe('6555')
      const group = idToGroup.get(e.jigId)!
      if (group.model === '252') {
        // 用一个真实的 6555 P/N 探针: 252 的规格码集合里确实有 6555,
        // 所以常规判定是"匹配", 标红完全由例外产生。
        expect(validateSizeMatch('6072J-6555H', cfg.jigSizeMapping['252'], rules)).toBe(true)
      } else {
        expect(cfg.jigSizeMapping[group.model]).toBe(cfg.allSizeValue)
      }
    }
  })

  it('256/262 遇 6555 的行真实存在 —— All Size 恒匹配必须被例外穿透', () => {
    // 这是最容易写错的一条路径: 若例外判定放在 validateSizeMatch 内部、
    // 位于 All Size 分支之后, 这些行会全部漏掉。数据里必须有这样的行,
    // 否则"穿透"这件事无从验证。
    for (const model of ['256', '262']) {
      const hit = strRows.filter(
        (r) =>
          r['P/N'].slice(6, 10) === '6555' &&
          r['Jig 对应型号'].split(/\s+/)[0] === model &&
          exceptionIndex.has(r['Jig ID']),
      )
      expect(hit.length, `${model} 缺少"例外 JIG + 6555"的行`).toBeGreaterThan(0)
    }
  })

  // -------------------------------------------------------------------------
  // 红绿契约
  // -------------------------------------------------------------------------

  it('每行红绿与 gen-test-xlsx.py 的分组意图逐行吻合', () => {
    const mismatches: string[] = []
    let red = 0
    for (const g of fixture.groups) {
      for (const id of g.jigIds) {
        const row = rowById.get(id)
        if (!row) {
          mismatches.push(`${id} 不在源数据里`)
          continue
        }
        const actual = isRed(row)
        if (actual) red++
        if (actual !== g.expectRed) {
          const hit = findExceptionHit(exceptionIndex, id, row['P/N'])
          mismatches.push(
            `[${g.name}] ${id} 型号=${row['Jig 对应型号'].split(/\s+/)[0]} P/N=${row['P/N']} ` +
              `实际=${actual ? '红' : '不红'} 期望=${g.expectRed ? '红' : '不红'} ` +
              `例外命中=${hit ? '是' : '否'}`,
          )
        }
      }
    }
    expect(mismatches).toEqual([])
    expect(red).toBeGreaterThan(0)
    expect(red).toBeLessThan(rows.length)
  })

  it('三组例外场景的红绿各自符合设计意图', () => {
    // 按组名前缀分区核对, 比"总数对得上"更能定位问题:
    // 万一 A 组和 B 组正好错反, 总数仍然正确, 但这里是分开断言的。
    const buckets = { 'exc-hit': '红', 'exc-other-pn': '不红', plain: '不红' } as const
    for (const [prefix, want] of Object.entries(buckets)) {
      const groups = fixture.groups.filter((g) => g.name.startsWith(prefix))
      expect(groups.length, `缺少 ${prefix} 分组`).toBeGreaterThan(0)
      for (const g of groups) {
        for (const id of g.jigIds) {
          const row = rowById.get(id)
          expect(row, `${id} 不在源数据里`).toBeDefined()
          const actual = isRed(row!)
          expect(actual ? '红' : '不红', `${g.name} / ${id}`).toBe(want)
        }
      }
    }
  })

  it('例外只影响名单内的治具 —— 同型号普通 JIG 判红率不受影响', () => {
    // 反证: 若实现写成"型号在例外名单里就整型号判红", C 组会全部变红。
    const plainGroups = fixture.groups.filter((g) => g.name.startsWith('plain-'))
    expect(plainGroups.length).toBe(3)
    for (const g of plainGroups) {
      expect(g.expectRed).toBe(false)
    }
  })

  // -------------------------------------------------------------------------
  // 例外标记 (显示层)
  // -------------------------------------------------------------------------

  it('审查页的「对应尺寸」在命中例外时带类型标记, 未命中不带', () => {
    const review = processSourceData(strRows, cfg)
    const byId = new Map(review.rows.map((r) => [r['Jig ID'], r]))

    let annotated = 0
    let plain = 0
    for (const e of fixture.exceptions) {
      const row = byId.get(e.jigId)
      // 审查页只显示 INPRODUCTION, STORED 的行不在其中
      if (!row) continue
      const size = String(row['对应尺寸'] ?? '')
      const hit = findExceptionHit(exceptionIndex, e.jigId, String(row['P/N']))
      if (hit) {
        expect(size.endsWith(`(${hit.type})`), `${e.jigId} 应带 (${hit.type}) 标记, 实际 ${size}`)
          .toBe(true)
        annotated++
      } else {
        expect(size.includes('('), `${e.jigId} 不应带标记, 实际 ${size}`).toBe(false)
        plain++
      }
    }
    // 两种状态都要在审查页里出现, 否则等于只测了一半
    expect(annotated).toBeGreaterThan(0)
    expect(plain).toBeGreaterThan(0)
  })

  it('标记只加在命中例外的行上, 不污染其它行', () => {
    const review = processSourceData(strRows, cfg)
    for (const row of review.rows) {
      const size = String(row['对应尺寸'] ?? '')
      const hasMark = size.includes('(')
      const hit = findExceptionHit(exceptionIndex, String(row['Jig ID']), String(row['P/N']))
      expect(hasMark, `${row['Jig ID']} 标记状态与例外命中状态不符: ${size}`).toBe(!!hit)
    }
  })

  it('剥离标记后仍能还原为映射表原值 —— 标记不改变尺寸语义', () => {
    for (const row of strRows) {
      const size = String(row['对应尺寸'] ?? '')
      if (!size.includes('(')) continue
      expect(stripExceptionSuffix(size)).toBe(mappedSize(row))
    }
  })

  // -------------------------------------------------------------------------
  // 其它覆盖面
  // -------------------------------------------------------------------------

  it('多数 Jig ID 能被剪贴板正则提取出来', () => {
    const text = rows.map((r) => r['Jig ID']).join('\n')
    // 刻意留了 D8A 前缀(真实导出里也存在这类提取不到的治具),
    // 例外表里还有一个 C402 前缀的编号同样提不出来, 所以不追求 100%。
    expect(extractJigIds(text).length / rows.length).toBeGreaterThan(0.7)
  })

  it('Jig ID 互不重复', () => {
    expect(new Set(rows.map((r) => r['Jig ID'])).size).toBe(500)
  })

  it('留有 CST ID 为空的行, 用于触发 Lot ID 回填', () => {
    expect(rows.filter((r) => r['CST ID'] === '').length).toBeGreaterThan(0)
  })

  it('分组行数合计与夹具声明一致', () => {
    const total = fixture.groups.reduce((s, g) => s + g.rows, 0)
    expect(total).toBe(fixture.rowCount)
    for (const g of fixture.groups) {
      expect(g.jigIds.length, `${g.name} 声明 ${g.rows} 行但给了 ${g.jigIds.length} 个 ID`)
        .toBe(g.rows)
    }
  })
})
