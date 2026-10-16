/**
 * 应用配置 —— 对应 Python 版 src/app/config.py
 *
 * 迁移要点:
 * 1. Python 版 jig_size_mapping 曾被误嵌在 error_messages 初始化分支内,
 *    从配置文件加载时整个分支被跳过, 导致映射表恒为 undefined,
 *    "对应尺寸"列永远为空。此处使用独立的 initJigSizeMapping()。
 * 2. 工程排序 order 值 10..100 必须与 Python 完全一致, 否则透视表列序不同。
 */

export interface AppConfig {
  /** 窗口配置 */
  windowTitle: string
  windowSize: [number, number]
  gapSize: number
  headerHeight: number
  leftPanelMinWidth: number
  leftPanelMaxWidth: number
  splitterSizes: [number, number]

  /** 表格配置 */
  tableRowNumberWidth: number
  tableDefaultColumnWidth: number
  adaptiveColumns: string[]
  tableDefaultRowHeight: number
  tableRowHeightMin: number
  tableRowHeightMax: number

  /** 数据配置 */
  outputColumns: string[]
  sortColumns: string[]
  numericSortColumns: string[]

  /** 文件配置 */
  excelFileFilter: string
  defaultFileDialogPath: string
  defaultExportPath: string

  /** 透视表配置 */
  pivotExcludePns: string[]
  pivotExcludeNames: string[]
  pivotValueCol: string
  pivotColumnKey: string
  productionIndicatorCode: string
  engineeringConfig: Record<string, { order: number }>

  /** JIG 型号 -> 尺寸映射 */
  jigSizeMapping: Record<string, string>

  /** JIG 状态配置 */
  jigStatusColumn: string
  jigStatusActiveValue: string

  /** 业务关键字 */
  keywordTotal: string

  /** 尺寸验证配置 */
  sizeValidationEnabled: boolean
  pnExtractStart: number
  pnExtractLength: number
  sizeSpecialMappings: Record<string, string>
  allSizeValue: string
  sizeMismatchColor: string

  /** 剪贴板 */
  clipboardAutoProcessEnabled: boolean

  /** 导出 */
  exportTimestampEnabled: boolean

  /** 系统托盘 */
  trayEnabled: boolean
  closeToTray: boolean

  /** 配置版本 */
  configVersion: number
}

export const CONFIG_VERSION = 2

/** 对应 Python config.py __post_init__ 的默认值 */
export function createDefaultConfig(): AppConfig {
  return {
    windowTitle: 'JIG Data Finder',
    windowSize: [1400, 800],
    gapSize: 16,
    headerHeight: 40,
    leftPanelMinWidth: 250,
    leftPanelMaxWidth: 300,
    splitterSizes: [280, 1000],

    tableRowNumberWidth: 60,
    tableDefaultColumnWidth: 106,
    adaptiveColumns: ['Slot No', 'Jig 对应型号', 'Glass判定', '对应尺寸', '工程名'],
    tableDefaultRowHeight: 30,
    tableRowHeightMin: 20,
    tableRowHeightMax: 30,

    outputColumns: [
      'P/N',
      'Lot ID',
      'CST ID',
      'Slot No',
      'Jig ID',
      '工程名',
      'Glass判定',
      'Jig 对应型号',
    ],
    sortColumns: ['P/N', 'Lot ID', 'CST ID', 'Slot No'],
    numericSortColumns: ['Slot No'],

    excelFileFilter: 'Excel Files (*.xlsx *.xls)',
    defaultFileDialogPath: '',
    defaultExportPath: '',

    pivotExcludePns: [],
    pivotExcludeNames: [],
    pivotValueCol: 'Jig ID',
    pivotColumnKey: '工程名',
    productionIndicatorCode: '50000',
    engineeringConfig: {
      PNP: { order: 10 },
      'Jig 洗净及检查': { order: 20 },
      'Jig Loading': { order: 30 },
      'Jig Unloading': { order: 40 },
      'Jig N判定 另外移载': { order: 50 },
      'Jig 分离': { order: 60 },
      目视Stage: { order: 70 },
      'Jig 搬出待机': { order: 80 },
      Jig搬出: { order: 90 },
      Jig入库: { order: 100 },
    },

    jigSizeMapping: {
      '184': '65',
      '420A': '65',
      '420B': '65',
      '477': '65',
      '502': '65',
      '502A': '65',
      '430': '65_77/48_83/48',
      '502N': '65_77/48_83/48',
      '508': '77/48_83/48',
      '509': '77/48_83/48',
      '508N': '77/27_77/42_77/48_83/48',
      '509N': '77/27_77/42_77/48_83/48',
      '252': '65_77/27_77/42_77/48_83/48',
      '252A': '39/31_77/27_77/42_77/48_83/48',
      '256': 'All Size',
      '262': 'All Size',
    },

    jigStatusColumn: 'Jig状态',
    jigStatusActiveValue: 'INPRODUCTION',

    keywordTotal: '总计',

    sizeValidationEnabled: false,
    pnExtractStart: 6,
    pnExtractLength: 4,
    sizeSpecialMappings: { '65': '65/55' },
    allSizeValue: 'All Size',
    sizeMismatchColor: '#EF4444',

    clipboardAutoProcessEnabled: true,
    exportTimestampEnabled: true,
    trayEnabled: true,
    closeToTray: true,

    configVersion: CONFIG_VERSION,
  }
}

/** 全局配置单例, 等价于 Python 版的 `config` 模块级实例 */
export const config: AppConfig = createDefaultConfig()

/** 把磁盘配置合并到默认配置上, 只接受已知字段 */
export function mergeConfig(
  stored: Record<string, unknown> | null | undefined,
): AppConfig {
  const base = createDefaultConfig()
  if (!stored || typeof stored !== 'object') return base

  for (const key of Object.keys(base) as (keyof AppConfig)[]) {
    const v = stored[key]
    if (v === undefined || v === null) continue
    // 类型不匹配时保留默认值, 避免损坏的配置拖垮应用
    if (Array.isArray(base[key]) !== Array.isArray(v)) continue
    if (typeof base[key] !== typeof v) continue
    ;(base as Record<string, unknown>)[key] = v
  }
  return base
}

/** 覆盖式更新运行时配置 */
export function applyConfig(patch: Partial<AppConfig>): void {
  Object.assign(config, patch)
}