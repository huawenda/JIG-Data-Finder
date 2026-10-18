/**
 * 型号尺寸匹配面板的编辑逻辑 —— 单元测试
 *
 * 重点不是"能不能增删改", 而是重复型号会不会被静默吃掉:
 * pairsToMapping 底层是 Record<string, string>, 同一个型号写两次
 * 后者直接覆盖前者, 既不报错也不提示 —— 用户以为自己配了三条规则,
 * 实际生效只有两条, 而且丢的是哪条取决于输入顺序。
 * validateMappingPairs 就是在面板上堵这个洞, 所以它的行为必须钉死。
 */

import { describe, it, expect } from 'vitest'
import {
  blankPair,
  mappingToPairs,
  pairsToMapping,
  validateMappingPairs,
} from '../src/core/mapping'
import { createDefaultConfig } from '../src/core/config'

describe('映射表: 配置对象 <-> 行数组', () => {
  it('默认配置能完整往返', () => {
    const cfg = createDefaultConfig()
    expect(pairsToMapping(mappingToPairs(cfg.jigSizeMapping))).toEqual(cfg.jigSizeMapping)
  })

  it('mappingToPairs 保留型号的大小写与后缀', () => {
    // 252 与 252A 映射不同, 大小写或后缀一旦被规范化掉就会串
    const pairs = mappingToPairs({ '252': 'x', '252A': 'y', '502N': 'z' })
    expect(pairs).toEqual([
      { model: '252', size: 'x' },
      { model: '252A', size: 'y' },
      { model: '502N', size: 'z' },
    ])
  })

  it('pairsToMapping 逐行 trim 两侧空白', () => {
    expect(pairsToMapping([{ model: '  256  ', size: '  All Size ' }])).toEqual({
      '256': 'All Size',
    })
  })

  it('空型号的行被跳过, 不会产生空字符串键', () => {
    // 空键会被 firstModel 查得到, 命中任何空型号的行都会判成
    // "匹配空尺寸" —— 静默丢掉反而更安全, 但面板必须先拦住它
    expect(pairsToMapping([{ model: '   ', size: 'x' }, { model: '256', size: 'y' }])).toEqual({
      '256': 'y',
    })
  })

  it('空尺寸是合法值, 表示该型号不做尺寸校验', () => {
    expect(pairsToMapping([{ model: '184', size: '' }])).toEqual({ '184': '' })
  })
})

describe('映射表: 校验', () => {
  it('合法输入没有错误', () => {
    expect(validateMappingPairs(mappingToPairs(createDefaultConfig().jigSizeMapping))).toEqual({})
  })

  it('空型号报错', () => {
    const errors = validateMappingPairs([{ model: '', size: 'x' }])
    expect(errors[0]).toBe('型号不能为空')
  })

  it('只有空格的型号同样报错', () => {
    expect(validateMappingPairs([{ model: '   ', size: 'x' }])[0]).toBe('型号不能为空')
  })

  it('重复型号在第二行报错, 并指明首次出现的行号', () => {
    const errors = validateMappingPairs([
      { model: '256', size: 'All Size' },
      { model: '252', size: 'a' },
      { model: '256', size: 'b' },
    ])
    expect(errors[2]).toBe('型号 256 与第 1 行重复')
    expect(errors[0]).toBeUndefined()
    expect(errors[1]).toBeUndefined()
  })

  it('三处重复会逐个报出各自的来源行', () => {
    const errors = validateMappingPairs([
      { model: 'x', size: '' },
      { model: 'x', size: '' },
      { model: 'x', size: '' },
    ])
    expect(errors[1]).toBe('型号 x 与第 1 行重复')
    expect(errors[2]).toBe('型号 x 与第 1 行重复')
  })

  it('trim 之后才算重复 —— " 256 " 与 "256" 是同一个型号', () => {
    const errors = validateMappingPairs([
      { model: '256', size: 'a' },
      { model: ' 256 ', size: 'b' },
    ])
    expect(errors[1]).toBe('型号 256 与第 1 行重复')
  })

  it('空型号不参与去重, 两行都空则两行都报错', () => {
    const errors = validateMappingPairs([
      { model: '', size: '' },
      { model: '', size: '' },
    ])
    expect(errors[0]).toBe('型号不能为空')
    expect(errors[1]).toBe('型号不能为空')
  })

  it('空数组没有错误, 面板允许清空全部规则', () => {
    expect(validateMappingPairs([])).toEqual({})
  })
})

describe('映射表: 新增行', () => {
  it('blankPair 返回独立对象, 不会被共用引用串改', () => {
    const a = blankPair()
    const b = blankPair()
    expect(a).toEqual({ model: '', size: '' })
    expect(a).not.toBe(b)
  })
})