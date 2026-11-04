/**
 * 宿主桥接层 —— 隔离 @tauri-apps/api 依赖
 *
 * 浏览器里跑 (npm run dev) 时这些能力不可用, 全部降级为合理的模拟,
 * 这样 UI 组件不需要到处写 "if (isTauri)" 分支。
 */

import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { readFile, writeFile as fsWriteFile, mkdir } from '@tauri-apps/plugin-fs'
import { readText } from '@tauri-apps/plugin-clipboard-manager'
import { invoke } from '@tauri-apps/api/core'

export const IS_TAURI =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in (window as never)

export interface PickedFile {
  path: string
  name: string
}

export async function pickExcelFile(
  defaultPath: string,
): Promise<PickedFile | null> {
  if (!IS_TAURI) {
    // 浏览器回退: 交给 <input type=file>, 由调用方处理
    return null
  }
  const picked = await openDialog({
    title: '选择 Excel',
    multiple: false,
    directory: false,
    defaultPath: defaultPath || undefined,
    filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
  })
  if (typeof picked !== 'string') return null
  return { path: picked, name: basename(picked) }
}

/**
 * 读取用户选中的文件内容。
 *
 * 必须走 tauri-plugin-fs 的 readFile —— WebView 的 fetch 无法访问
 * 本地磁盘路径, 也不存在 asset.localhost 这种 URL。
 */
export async function readPickedFile(path: string): Promise<ArrayBuffer> {
  if (!IS_TAURI) throw new Error('浏览器环境请用文件选择框读取')
  const bytes = await readFile(path)
  // plugin-fs 返回 Uint8Array, xlsx 需要 ArrayBuffer。
  // 只复制底层缓冲区, 不重复拷贝数据本体。
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
}

/** 把内容写到用户选中的位置 */
export async function saveToFile(path: string, data: Uint8Array): Promise<void> {
  if (!IS_TAURI) throw new Error('浏览器环境无法写入本地文件')
  await fsWriteFile(path, data)
}

export async function pickSavePath(
  suggestedName: string,
  defaultPath: string,
): Promise<string | null> {
  if (!IS_TAURI) return null
  const picked = await saveDialog({
    title: '保存文件',
    defaultPath: joinPath(defaultPath, suggestedName),
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  })
  return typeof picked === 'string' ? picked : null
}

export async function pickDirectory(current: string): Promise<string | null> {
  if (!IS_TAURI) return null
  const picked = await openDialog({
    title: '选择目录',
    directory: true,
    multiple: false,
    defaultPath: current || undefined,
  })
  return typeof picked === 'string' ? picked : null
}

export function basename(p: string): string {
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] || p
}

export function joinPath(dir: string, name: string): string {
  if (!dir) return name
  return `${dir.replace(/[\\/]+$/, '')}\\${name}`
}

/** 把文件名加上时间戳, 对应 Python 版 add_timestamp_to_filename */
export function withTimestamp(
  fileName: string,
  now = new Date(),
): string {
  const p = fileName.lastIndexOf('.')
  const stem = p > 0 ? fileName.slice(0, p) : fileName
  const ext = p > 0 ? fileName.slice(p) : ''
  const pad = (n: number) => String(n).padStart(2, '0')
  const ts =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `${stem}${ts}${ext}`
}

/* ============ 剪贴板 ============ */

/**
 * 读取剪贴板文本。
 *
 * 必须走 tauri-plugin-clipboard-manager 而不是 navigator.clipboard:
 * WebView2 里 navigator.clipboard.readText 需要额外的用户激活与权限,
 * 在 onPaste 里调用基本会被拒绝。旧版 Qt 用的是系统级剪贴板, 这里对齐。
 *
 * 失败时返回 null, 调用方退回浏览器默认粘贴行为。
 */
export async function readClipboardText(): Promise<string | null> {
  if (!IS_TAURI) {
    try {
      return await navigator.clipboard.readText()
    } catch {
      return null
    }
  }
  try {
    return await readText()
  } catch {
    return null
  }
}

/* ============ 配置持久化 ============ */

/**
 * 配置目录: %APPDATA%\JIG Data Finder
 *
 * 与 v1.x 的 get_config_dir 完全一致, 便于平滑升级:
 * 新版首次启动能直接读到旧版留下的设置。
 *
 * 路径由 Rust 侧的 legacy_config_dir 命令给出, 前端不猜环境变量 ——
 * APPDATA 可能被重定向到非 C 盘, 硬编码会读错位置。
 */
async function configDir(): Promise<string> {
  return invoke<string>('legacy_config_dir')
}

/** 配置完整路径 */
export async function configPath(): Promise<string> {
  return `${await configDir()}\\config.json`
}

/** 读取配置 JSON; 不存在或损坏时返回 null */
export async function readConfigFile(): Promise<Record<string, unknown> | null> {
  if (!IS_TAURI) return null
  try {
    const bytes = await readFile(await configPath())
    // 旧版 Python 用 utf-8-sig 保存, 带 BOM, 必须容忍
    const text = new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '')
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * 写回配置 JSON。
 *
 * 键名转成 snake_case, 与旧版 Python 版保持一致 —— 这样用户在两版之间
 * 来回切换时配置仍然通用。mergeConfig 同时认两种键名, 但写出一致更
 * 利于人工排查配置内容。
 */
export async function writeConfigFile(data: object): Promise<void> {
  if (!IS_TAURI) return
  const dir = await configDir()
  await mkdir(dir, { recursive: true })

  const snake: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    snake[k.replace(/([A-Z])/g, '_$1').toLowerCase()] = v
  }

  const json = JSON.stringify(snake, null, 2)
  await fsWriteFile(await configPath(), new TextEncoder().encode(json))
}
/**
 * 同步窗口标题栏配色。
 *
 * 窗口是 decorations:true (系统绘制标题栏), 它只认 Tauri 的 window theme,
 * 不认我们的 CSS。不同步的话, 深色界面会顶着一个浅色标题栏, 割裂感很重。
 *
 * 浏览器里是空操作 —— npm run dev 时没有窗口可管。
 */
export async function setWindowTheme(theme: 'light' | 'dark'): Promise<void> {
  if (!IS_TAURI) return
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().setTheme(theme)
  } catch {
    /* 个别平台不支持设置标题栏主题, 静默降级 —— 内容区仍然正确 */
  }
}

/**
 * 同步原生窗口标题。
 *
 * 标题栏由系统绘制, 不会跟随 document.title, 必须走 Tauri API 才会立刻生效。
 * 浏览器回退由调用方自己写 document.title。
 */
export async function setWindowTitle(title: string): Promise<void> {
  if (!IS_TAURI) return
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().setTitle(title)
  } catch {
    /* 个别平台不支持运行时改标题, 静默降级 */
  }
}
