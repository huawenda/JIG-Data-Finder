/**
 * 配置迁移 —— 单元测试
 *
 * 覆盖真机验证发现的两个缺陷:
 *   1. 键名 snake_case (旧版 Python) vs camelCase (新版) 不兼容,
 *      导致 mergeConfig 全程匹配不上, 配置读取等于空转
 *   2. BOM 与损坏 JSON 的容错
 */

import { describe, it, expect } from 'vitest'
import { createDefaultConfig, mergeConfig } from '../src/core/config'

describe('配置迁移: 旧版 snake_case 键名', () => {
  /** 真实的旧版 config.json 结构节选 (来自用户机器) */
  const legacyConfig = {
    window_title: 'JIG Data Finder',
    window_size: [1200, 700],
    table_default_row_height: 26,
    default_file_dialog_path: 'D:\\MES',
    default_export_path: 'D:\\Out',
    clipboard_auto_process_enabled: false,
    export_timestamp_enabled: false,
    close_to_tray: false,
    size_validation_enabled: true,
    jig_size_mapping: { '999': '88' },
    engineering_config: { PNP: { order: 10 } },
  }

  it('读取旧版 snake_case 的窗口尺寸', () => {
    expect(mergeConfig(legacyConfig).windowSize).toEqual([1200, 700])
  })

  it('读取旧版 snake_case 的行高', () => {
    expect(mergeConfig(legacyConfig).tableDefaultRowHeight).toBe(26)
  })

  it('读取旧版 snake_case 的路径', () => {
    const c = mergeConfig(legacyConfig)
    expect(c.defaultFileDialogPath).toBe('D:\\MES')
    expect(c.defaultExportPath).toBe('D:\\Out')
  })

  it('读取旧版 snake_case 的布尔开关', () => {
    const c = mergeConfig(legacyConfig)
    expect(c.clipboardAutoProcessEnabled).toBe(false)
    expect(c.exportTimestampEnabled).toBe(false)
    expect(c.closeToTray).toBe(false)
    expect(c.sizeValidationEnabled).toBe(true)
  })

  it('读取旧版嵌套字典', () => {
    const c = mergeConfig(legacyConfig)
    expect(c.jigSizeMapping['999']).toBe('88')
    expect(c.engineeringConfig.PNP.order).toBe(10)
  })

  it('旧版缺失的字段回落到默认值', () => {
    const c = mergeConfig(legacyConfig)
    const d = createDefaultConfig()
    expect(c.gapSize).toBe(d.gapSize)
    expect(c.allSizeValue).toBe(d.allSizeValue)
    expect(c.keywordTotal).toBe(d.keywordTotal)
  })

  it('camelCase 键同样被接受 (新版自己写的配置)', () => {
    const c = mergeConfig({
      tableDefaultRowHeight: 22,
      closeToTray: false,
      defaultExportPath: 'E:\\X',
    })
    expect(c.tableDefaultRowHeight).toBe(22)
    expect(c.closeToTray).toBe(false)
    expect(c.defaultExportPath).toBe('E:\\X')
  })

  it('camelCase 优先于 snake_case (新写法胜出)', () => {
    const c = mergeConfig({
      tableDefaultRowHeight: 22,
      table_default_row_height: 28,
    })
    expect(c.tableDefaultRowHeight).toBe(22)
  })
})

describe('配置迁移: 容错', () => {
  it('null / undefined 回落默认值', () => {
    expect(mergeConfig(null).tableDefaultRowHeight).toBe(
      createDefaultConfig().tableDefaultRowHeight,
    )
    expect(mergeConfig(undefined).windowSize).toEqual([1400, 800])
  })

  it('空对象回落默认值', () => {
    expect(mergeConfig({}).tableDefaultRowHeight).toBe(30)
  })

  it('类型不匹配的字段被忽略', () => {
    const c = mergeConfig({
      // 行高写成字符串, 应被丢弃
      table_default_row_height: 'abc',
      // 布尔写成数组, 应被丢弃
      close_to_tray: [1, 2],
    })
    const d = createDefaultConfig()
    expect(c.tableDefaultRowHeight).toBe(d.tableDefaultRowHeight)
    expect(c.closeToTray).toBe(d.closeToTray)
  })

  it('null 字段被忽略而非覆盖', () => {
    const c = mergeConfig({ defaultExportPath: null })
    expect(c.defaultExportPath).toBe('')
  })

  it('未知字段被忽略, 不污染配置对象', () => {
    const c = mergeConfig({ 完全不存在的字段: 'x', sizeValidationEnabled: true })
    expect(c.sizeValidationEnabled).toBe(true)
    expect('完全不存在的字段' in c).toBe(false)
  })
})