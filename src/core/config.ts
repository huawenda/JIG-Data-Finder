/**
 * 应用配置 —— 对应 Python 版 tools/legacy/src/app/config.py
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

  /**
   * 映射表的面板排列顺序 (型号列表)。
   *
   * 为什么要单列一个字段: jigSizeMapping 是 Record<string, string>, 而
   * JS 对象对「数组索引样式的键」是按数值升序排在所有字符串键之前的 ——
   * 也就是说无论怎么插入, '184' '252' '262' 这些纯数字型号永远排在
   * '420A' '502N' 前面且升序。面板里调整的顺序存不进去, 重开就没了。
   * 所以顺序单独存一份, 面板与配置互为对方的前置。
   */
  jigSizeMappingOrder: string[]

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
      'PNP 2nd': { order: 15 },
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

    // 与上面的 jigSizeMapping 一一对应。纯数字型号排在前面是 JS 对象的
    // 固有行为, 恰好与这里手写的顺序一致, 面板初次打开不会跳位。
    jigSizeMappingOrder: [
      '184',
      '420A',
      '420B',
      '477',
      '502',
      '502A',
      '430',
      '502N',
      '508',
      '509',
      '508N',
      '509N',
      '252',
      '252A',
      '256',
      '262',
    ],

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

/**
 * 把磁盘配置合并到默认配置上, 只接受已知字段。
 *
 * 关键: 旧版 Python 版写的是 snake_case (`table_default_row_height`),
 * 新版字段是 camelCase (`tableDefaultRowHeight`)。不做键名转换的话,
 * 每个字段都匹配不上, 配置读取等于空转 —— 用户升级后设置全丢。
 *
 * 所以这里同时尝试两种键名。
 */
export function mergeConfig(
  stored: Record<string, unknown> | null | undefined,
): AppConfig {
  const base = createDefaultConfig()
  if (!stored || typeof stored !== 'object') return base

  for (const key of Object.keys(base) as (keyof AppConfig)[]) {
    // 先按原样取, 再按 snake_case 取 (兼容旧版 Python 写出的配置)
    const direct = stored[key]
    const snake = stored[toSnakeCase(key)]
    const v = direct !== undefined && direct !== null ? direct : snake

    if (v === undefined || v === null) continue
    // 类型不匹配时保留默认值, 避免损坏的配置拖垮应用
    if (Array.isArray(base[key]) !== Array.isArray(v)) continue
    if (typeof base[key] !== typeof v) continue

    /*
     * 工序表要并集, 不能整体替换。
     *
     * 用户磁盘上的 config.json 里存着一份完整的 engineering_config,
     * 它会整个盖掉默认值 —— 于是以后再往默认值里加新工序(比如
     * "PNP 2nd"), 老用户永远看不到: 该工序不在他的配置文件里,
     * config 里就没有它, pivot.ts 取 order 时退回 999, 静默排到
     * 最后面。不报错、不提示, 只是位置不对, 极难察觉。
     *
     * 工序表没有用户可编辑的入口(能改的只有型号尺寸映射), 所以
     * 不存在"用户故意删掉某道工序"的情况, 并集是安全的。默认顺序
     * 打底, 磁盘值优先 —— 改过 order 的用户不受影响。
     */
    if (key === 'engineeringConfig' && isPlainObject(v) && isPlainObject(base[key])) {
      const merged: Record<string, { order: number }> = {
        ...(base[key] as Record<string, { order: number }>),
      }
      for (const [stage, cfgv] of Object.entries(v as Record<string, unknown>)) {
        const oc = (cfgv as { order?: unknown } | null)?.order
        if (typeof oc === 'number' && Number.isFinite(oc)) merged[stage] = { order: oc }
      }
      ;(base as unknown as Record<string, unknown>)[key] = merged
      continue
    }

    ;(base as unknown as Record<string, unknown>)[key] = v
  }

  /*
   * 排列顺序要对齐映射表的实际内容, 否则面板打开就是空的或多出幽灵行:
   *   - 映射里有、顺序里没有的型号 -> 追加到末尾 (旧配置没这个字段);
   *   - 顺序里有、映射里没有的型号 -> 丢弃 (用户删过规则);
   *   - 重复的顺序项 -> 只留第一次。
   * 不做这一步的话, 面板与磁盘配置会互相矛盾, 而且要等用户改配置
   * 才暴露出来。
   */
  const seen = new Set<string>()
  const order: string[] = []
  for (const m of base.jigSizeMappingOrder) {
    if (m in base.jigSizeMapping && !seen.has(m)) {
      order.push(m)
      seen.add(m)
    }
  }
  for (const m of Object.keys(base.jigSizeMapping)) {
    if (!seen.has(m)) {
      order.push(m)
      seen.add(m)
    }
  }
  base.jigSizeMappingOrder = order

  return base
}

/** tableDefaultRowHeight -> table_default_row_height */
function toSnakeCase(s: string): string {
  return s.replace(/([A-Z])/g, '_$1').toLowerCase()
}

/** 排除数组与 null: JSON.parse 出来的东西不该是这些 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 覆盖式更新运行时配置 */
export function applyConfig(patch: Partial<AppConfig>): void {
  Object.assign(config, patch)
}