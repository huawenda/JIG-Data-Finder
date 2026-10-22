/**
 * 主题 —— 解析、应用、缓存、系统跟随
 *
 * 背景: 主题原先是纯 CSS 的 @media (prefers-color-scheme: dark) 决定的,
 * 而 tauri.conf.json 的 theme:"Light" 把 WebView2 钉死成 light, 那套深色
 * 令牌从未生效过。改成 data-theme 属性驱动后, 这里守住三条:
 *   1. 三模式解析正确, system 真的跟随系统
 *   2. applyTheme 同时写 dataset.theme 与 colorScheme —— 少了后者,
 *      原生 select 下拉、滚动条仍是浅色, 深色界面里会弹白底列表
 *   3. 非法配置值不会让界面进入"看起来生效了其实没有"的状态
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  applyTheme,
  cacheTheme,
  isThemeMode,
  prefersDark,
  readCachedTheme,
  resolveTheme,
  themeLabel,
  watchSystemTheme,
  THEME_CACHE_KEY,
  THEME_OPTIONS,
} from '../src/core/theme'
import { createDefaultConfig, mergeConfig } from '../src/core/config'

describe('主题 —— 模式解析', () => {
  it('显式 light/dark 不理会系统设置', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('light', false)).toBe('light')
    expect(resolveTheme('dark', true)).toBe('dark')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('system 跟随系统深浅', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('isThemeMode 只认三个合法值', () => {
    expect(isThemeMode('light')).toBe(true)
    expect(isThemeMode('dark')).toBe(true)
    expect(isThemeMode('system')).toBe(true)
    // 磁盘配置被手工改坏时的典型形态
    expect(isThemeMode('Dark')).toBe(false)
    expect(isThemeMode('深色')).toBe(false)
    expect(isThemeMode('')).toBe(false)
    expect(isThemeMode(null)).toBe(false)
    expect(isThemeMode(1)).toBe(false)
  })

  it('themeLabel 在 system 下点明当前实际是深是浅', () => {
    expect(themeLabel('light', true)).toBe('浅色')
    expect(themeLabel('dark', false)).toBe('深色')
    expect(themeLabel('system', true)).toBe('跟随系统(当前深色)')
    expect(themeLabel('system', false)).toBe('跟随系统(当前浅色)')
  })

  it('下拉选项与类型一一对应, 顺序固定', () => {
    expect(THEME_OPTIONS.map((o) => o.value)).toEqual(['light', 'dark', 'system'])
    expect(THEME_OPTIONS.every((o) => o.label.length > 0)).toBe(true)
  })
})

describe('主题 —— 应用到 DOM', () => {
  let dataset: Record<string, string>
  let style: Record<string, string>
  let store: Record<string, string>

  beforeEach(() => {
    dataset = {}
    style = {}
    store = {}
    vi.stubGlobal('document', { documentElement: { dataset, style } })
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => {
          store[k] = v
        },
      },
      matchMedia: () => ({ matches: false }),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('写 data-theme 与 color-scheme, 并返回实际主题', () => {
    expect(applyTheme('dark')).toBe('dark')
    expect(dataset.theme).toBe('dark')
    // color-scheme 决定原生部件的配色, 不能漏
    expect(style.colorScheme).toBe('dark')
  })

  it('浅色模式同样显式写属性, 不依赖已有值', () => {
    dataset.theme = 'dark'
    expect(applyTheme('light')).toBe('light')
    expect(dataset.theme).toBe('light')
    expect(style.colorScheme).toBe('light')
  })

  it('system 模式落到具体的 light/dark 上', () => {
    expect(applyTheme('system', false)).toBe('light')
    expect(dataset.theme).toBe('light')
    expect(applyTheme('system', true)).toBe('dark')
    expect(dataset.theme).toBe('dark')
  })

  it('应用时顺带缓存, 供下次启动首帧使用', () => {
    applyTheme('dark')
    expect(store[THEME_CACHE_KEY]).toBe('dark')
    expect(readCachedTheme()).toBe('dark')
  })

  it('缓存可读写往返', () => {
    cacheTheme('system')
    expect(readCachedTheme()).toBe('system')
  })

  it('缓存缺失或值非法时返回 null, 由调用方兜底', () => {
    expect(readCachedTheme()).toBeNull()
    store[THEME_CACHE_KEY] = 'purple'
    expect(readCachedTheme()).toBeNull()
  })

  it('localStorage 抛异常时不影响上色', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('storage disabled')
        },
        setItem: () => {
          throw new Error('storage disabled')
        },
      },
      matchMedia: () => ({ matches: true }),
    })
    // 抛了也要正常返回, 界面照旧变深
    expect(applyTheme('dark')).toBe('dark')
    expect(dataset.theme).toBe('dark')
    expect(readCachedTheme()).toBeNull()
  })
})

describe('主题 —— 环境探测与系统跟随', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('没有 matchMedia 的环境按浅色处理, 不抛异常', () => {
    vi.stubGlobal('window', {})
    expect(prefersDark()).toBe(false)
  })

  it('matchMedia 抛异常时也不崩', () => {
    vi.stubGlobal('window', {
      matchMedia: () => {
        throw new Error('not supported')
      },
    })
    expect(prefersDark()).toBe(false)
  })

  it('显式 light/dark 不挂系统监听', () => {
    let attached = 0
    const mq = {
      matches: false,
      addEventListener: () => {
        attached++
      },
      removeEventListener: () => {},
    }
    vi.stubGlobal('window', { matchMedia: () => mq })
    const off = watchSystemTheme('dark', () => {})
    expect(attached).toBe(0)
    expect(() => off()).not.toThrow()
  })

  it('system 模式挂监听, 系统变化时回调收到新值', () => {
    let handler: ((e: { matches: boolean }) => void) | null = null
    const mq = {
      matches: false,
      addEventListener: (_: string, h: (e: { matches: boolean }) => void) => {
        handler = h
      },
      removeEventListener: () => {
        handler = null
      },
    }
    vi.stubGlobal('window', { matchMedia: () => mq })

    const seen: boolean[] = []
    const off = watchSystemTheme('system', (d) => seen.push(d))
    expect(handler).not.toBeNull()

    handler!({ matches: true })
    handler!({ matches: false })
    expect(seen).toEqual([true, false])

    off()
    expect(handler).toBeNull()
  })
})

describe('主题 —— 配置接入', () => {
  it('默认浅色, 保证升级前后观感一致', () => {
    expect(createDefaultConfig().theme).toBe('light')
  })

  it('读取磁盘上的合法值', () => {
    expect(mergeConfig({ theme: 'dark' }).theme).toBe('dark')
    expect(mergeConfig({ theme: 'system' }).theme).toBe('system')
  })

  it('snake_case 键名同样认得 (旧版配置风格)', () => {
    expect(mergeConfig({ theme: 'dark' }).theme).toBe('dark')
  })

  it('非法值退回默认, 不把界面带进说不清的状态', () => {
    for (const bad of ['Dark', '深色', '', 123, true, [] as unknown]) {
      expect(mergeConfig({ theme: bad }).theme).toBe('light')
    }
  })

  it('缺失字段时用默认值', () => {
    expect(mergeConfig({}).theme).toBe('light')
    expect(mergeConfig(null).theme).toBe('light')
  })
})
