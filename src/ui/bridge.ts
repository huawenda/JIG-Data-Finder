/**
 * 宿主桥接层 —— 隔离 @tauri-apps/api 依赖
 *
 * 浏览器里跑 (npm run dev) 时这些能力不可用, 全部降级为合理的模拟,
 * 这样 UI 组件不需要到处写 "if (isTauri)" 分支。
 */

import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'

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