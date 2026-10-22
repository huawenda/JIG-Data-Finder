/**
 * 主题 —— 浅色 / 深色 / 跟随系统
 *
 * ## 为什么改成运行时切换
 *
 * 原先是纯 CSS 的 `@media (prefers-color-scheme: dark)` 决定, 而
 * tauri.conf.json 里 `theme: "Light"` 把 WebView2 的 prefers-color-scheme
 * 钉死成 light —— 结果就是 CSS 里那套深色令牌从来没有生效过, 谁也切不了。
 *
 * 现在改由 `data-theme` 属性驱动: CSS 只认 `[data-theme='dark']`,
 * 'system' 由本模块解析成 light/dark 再写属性。这样:
 *   - 单一事实来源, CSS 里不用把深色令牌块重复两遍
 *   - 系统主题变化能被 JS 捕获并即时跟随
 *   - 首帧可以靠 localStorage 缓存抢先应用, 不闪白
 *
 * ## 为什么要 localStorage
 *
 * 配置读取是异步的 (readConfigFile), 等它回来再上色, 深色用户每次启动
 * 都会先闪一下白屏。所以把最后选择缓存在 localStorage 里, 供 main.tsx
 * 在首次渲染前同步应用; config.json 读到后再以它为准覆盖 —— 权威来源
 * 始终是配置文件, 缓存只是"上一次的样子"。
 */

/** 用户可选的三种模式 */
export type ThemeMode = 'light' | 'dark' | 'system'

/** 实际生效的两种主题 */
export type ResolvedTheme = 'light' | 'dark'

export const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system']

/** 供设置面板渲染, 顺序即展示顺序 */
export const THEME_OPTIONS: readonly { value: ThemeMode; label: string }[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
]

/** localStorage 键。加前缀避免与宿主页其它键冲突。 */
export const THEME_CACHE_KEY = 'jigdatafinder.theme'

const SYSTEM_QUERY = '(prefers-color-scheme: dark)'

export function isThemeMode(v: unknown): v is ThemeMode {
  return v === 'light' || v === 'dark' || v === 'system'
}

/**
 * 当前系统是否深色。
 *
 * 用 try 包住: 某些 WebView / 测试环境没有 matchMedia,
 * 这时按浅色处理, 而不是让整个应用崩在启动阶段。
 */
export function prefersDark(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.(SYSTEM_QUERY).matches
  } catch {
    return false
  }
}

/**
 * 把模式解析成实际主题。
 *
 * `systemDark` 作参数传入而非内部读取 matchMedia —— 这样是纯函数,
 * 单测不用伪造全局 window。
 */
export function resolveTheme(mode: ThemeMode, systemDark: boolean): ResolvedTheme {
  if (mode === 'light') return 'light'
  if (mode === 'dark') return 'dark'
  return systemDark ? 'dark' : 'light'
}

/** 设置面板右上角那种一行文字, 用于提示实际生效结果 */
export function themeLabel(mode: ThemeMode, systemDark: boolean): string {
  if (mode === 'system') {
    return `跟随系统(当前${systemDark ? '深色' : '浅色'})`
  }
  return mode === 'dark' ? '深色' : '浅色'
}

/**
 * 应用主题: 写 DOM 属性 + 原生控件配色 + 缓存。
 *
 * `color-scheme` 不能省 —— 滚动条、select 下拉、输入框光标、系统菜单
 * 这些由浏览器原生绘制的部件只认它, 不认我们的 CSS 变量。少了这一行,
 * 深色模式下点开 select 会弹出一个刺眼的白底列表。
 *
 * @returns 实际生效的主题, 便于调用方同步窗口标题栏
 */
export function applyTheme(mode: ThemeMode, systemDark = prefersDark()): ResolvedTheme {
  const resolved = resolveTheme(mode, systemDark)
  const root = document.documentElement
  root.dataset.theme = resolved
  root.style.colorScheme = resolved
  cacheTheme(mode)
  return resolved
}

/** 读缓存; 读不到或值非法时返回 null */
export function readCachedTheme(): ThemeMode | null {
  try {
    const raw = window.localStorage.getItem(THEME_CACHE_KEY)
    return isThemeMode(raw) ? raw : null
  } catch {
    /* 隐私模式 / 存储被禁用时静默降级 */
    return null
  }
}

export function cacheTheme(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_CACHE_KEY, mode)
  } catch {
    /* 同上, 缓存失败不影响本次生效 */
  }
}

/**
 * 监听系统主题变化。
 *
 * 只在 'system' 模式下需要 —— 显式 light/dark 时系统怎么变都与我们无关,
 * 这时直接返回空清理函数, 不挂监听。
 *
 * @returns 取消监听的函数
 */
export function watchSystemTheme(
  mode: ThemeMode,
  onChange: (systemDark: boolean) => void,
): () => void {
  if (mode !== 'system' || typeof window === 'undefined' || !window.matchMedia) {
    return () => {}
  }
  const mq = window.matchMedia(SYSTEM_QUERY)
  /* 老旧 WebView 只有 addListener, 新标准是 addEventListener */
  if (mq.addEventListener) {
    const handler = (e: MediaQueryListEvent) => onChange(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }
  const legacy = (e: MediaQueryListEvent) => onChange(e.matches)
  mq.addListener(legacy)
  return () => mq.removeListener(legacy)
}
