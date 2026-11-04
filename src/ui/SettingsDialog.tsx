import { useEffect, useRef, useState } from 'react'
import type { AppConfig } from '../core/config'
import type { ThemeMode } from '../core/theme'
import { THEME_OPTIONS, prefersDark, themeLabel } from '../core/theme'
import OverlayScrollbar from './OverlayScrollbar'

export interface SettingsDraft {
  defaultFileDialogPath: string
  defaultExportPath: string
  tableDefaultRowHeight: number
  windowSize: [number, number]
  clipboardAutoProcessEnabled: boolean
  sizeValidationEnabled: boolean
  closeToTray: boolean
  trayEnabled: boolean
  exportTimestampEnabled: boolean
  theme: ThemeMode
}

export interface SettingsDialogProps {
  config: AppConfig
  initial: SettingsDraft
  onSave: (d: SettingsDraft) => void
  onClose: () => void
  /** 交由宿主层打开目录选择框 */
  pickDirectory: (current: string) => Promise<string | null>
  /**
   * 主题即时预览。
   *
   * 选主题必须当场看到效果 —— 否则用户点了"深色", 界面纹丝不动,
   * 根本无从判断。所以这个回调不走"保存"流程, 而是每次选择立刻应用;
   * 关闭面板时由本组件调回 initial 的值还原。
   */
  onThemePreview: (mode: ThemeMode) => void
}

export default function SettingsDialog({
  config,
  initial,
  onSave,
  onClose,
  pickDirectory,
  onThemePreview,
}: SettingsDialogProps) {
  const [d, setD] = useState<SettingsDraft>(initial)
  const bodyRef = useRef<HTMLDivElement>(null)

  const patch = (p: Partial<SettingsDraft>) => setD((prev) => ({ ...prev, ...p }))

  /*
   * 关闭前把预览过的主题还原。
   *
   * 点取消 / 点遮罩 / 按 ESC 三条路都得还原 —— 少还原一条, 用户就会
   * 带着一个"没保存却生效了"的颜色退出, 下次启动又变回去, 像配置损坏。
   */
  const closeWithoutSave = () => {
    if (d.theme !== initial.theme) onThemePreview(initial.theme)
    onClose()
  }

  /*
   * ESC 关闭。故意不写依赖数组: closeWithoutSave 读的是当前 d.theme,
   * 若只在挂载时绑定, 闭包里会一直是初始值, 还原就还原错了。
   * 设置面板的渲染频率极低, 每次重挂监听没有实际代价。
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeWithoutSave()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div
      className="scrim"
      role="presentation"
      /*
       * 点遮罩空白处不关闭 —— 只有「取消」按钮和 Esc 能关。
       *
       * 这些面板里做的都是录入工作: 逐行敲路径、改数值、配对型号与尺寸。
       * 鼠标从面板里移到外面一点, 或者在面板边缘附近想点下拉却落空, 一次
       * 误触就会把刚敲的十几行连同未保存的改动一起丢掉, 而且没有任何确认。
       * 关闭动作只留给明确意图的按钮和 Esc 键, 代价只是多点一下。
       */
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="set-title"
      >
        <div className="dialog__body" ref={bodyRef}>
          <h2 className="dialog__title" id="set-title">
            设置
          </h2>
          <p className="dialog__note">改动在下次启动时完全生效。</p>

          <fieldset className="fieldset">
            <legend className="fieldset__legend">文件</legend>

            <div className="field">
              <label className="field__label">源文件默认目录</label>
              <div className="field__control">
                <span className="field__text" data-empty={!d.defaultFileDialogPath}>
                  {d.defaultFileDialogPath || '使用系统默认'}
                </span>
                <button
                  className="btn"
                  type="button"
                  onClick={async () => {
                    const r = await pickDirectory(d.defaultFileDialogPath)
                    if (r) patch({ defaultFileDialogPath: r })
                  }}
                >
                  更换
                </button>
              </div>
            </div>

            <div className="field">
              <label className="field__label">导出文件默认目录</label>
              <div className="field__control">
                <span className="field__text" data-empty={!d.defaultExportPath}>
                  {d.defaultExportPath || '使用系统默认'}
                </span>
                <button
                  className="btn"
                  type="button"
                  onClick={async () => {
                    const r = await pickDirectory(d.defaultExportPath)
                    if (r) patch({ defaultExportPath: r })
                  }}
                >
                  更换
                </button>
              </div>
            </div>
          </fieldset>

          <fieldset className="fieldset">
            <legend className="fieldset__legend">界面</legend>

            <div className="field">
              <label className="field__label" htmlFor="set-theme">
                主题
              </label>
              <div className="field__control">
                <select
                  id="set-theme"
                  className="select"
                  value={d.theme}
                  onChange={(e) => {
                    const mode = e.target.value as ThemeMode
                    patch({ theme: mode })
                    onThemePreview(mode)
                  }}
                >
                  {THEME_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <span className="field__label">
                  {themeLabel(d.theme, prefersDark())}
                </span>
              </div>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="set-rowh">
                表格行高
              </label>
              <div className="field__control">
                <input
                  id="set-rowh"
                  className="field__num"
                  type="number"
                  min={config.tableRowHeightMin}
                  max={config.tableRowHeightMax}
                  value={d.tableDefaultRowHeight}
                  onChange={(e) =>
                    patch({
                      tableDefaultRowHeight: clamp(
                        Number(e.target.value),
                        config.tableRowHeightMin,
                        config.tableRowHeightMax,
                      ),
                    })
                  }
                />
                <span className="field__label">px</span>
              </div>
            </div>

            <div className="field">
              <span className="field__label">窗口尺寸</span>
              <div className="field__control">
                <input
                  className="field__num"
                  type="number"
                  min={800}
                  max={1920}
                  value={d.windowSize[0]}
                  aria-label="窗口宽度"
                  onChange={(e) =>
                    patch({
                      windowSize: [clamp(Number(e.target.value), 800, 1920), d.windowSize[1]],
                    })
                  }
                />
                <span className="field__label">×</span>
                <input
                  className="field__num"
                  type="number"
                  min={600}
                  max={1080}
                  value={d.windowSize[1]}
                  aria-label="窗口高度"
                  onChange={(e) =>
                    patch({
                      windowSize: [d.windowSize[0], clamp(Number(e.target.value), 600, 1080)],
                    })
                  }
                />
                <span className="field__label">px</span>
              </div>
            </div>

            <div className="field">
              <span className="field__label">系统托盘</span>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={d.trayEnabled}
                  onChange={(e) =>
                    patch({
                      trayEnabled: e.target.checked,
                      /*
                       * 托盘图标是关闭后把窗口找回来的唯一入口。
                       * 关掉它就必须同时关掉"关闭到托盘", 否则用户点关闭
                       * 窗口会隐藏起来, 而系统托盘里什么都没有 —— 程序
                       * 变成打不开的僵尸, 只能去任务管理器杀。
                       *
                       * 反过来 (开启托盘) 不必动 closeToTray, 由用户自己
                       * 决定关窗口是退出还是藏起来。
                       */
                      closeToTray: e.target.checked ? d.closeToTray : false,
                    })
                  }
                />
                在系统托盘显示图标
              </label>
            </div>

            <div className="field">
              <span className="field__label">关闭按钮</span>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={d.closeToTray}
                  disabled={!d.trayEnabled}
                  onChange={(e) => patch({ closeToTray: e.target.checked })}
                />
                {d.trayEnabled
                  ? '最小化到系统托盘,不退出'
                  : '关闭即退出程序(托盘图标已关闭)'}
              </label>
            </div>
          </fieldset>

          <fieldset className="fieldset">
            <legend className="fieldset__legend">数据处理</legend>

            <div className="field">
              <span className="field__label">粘贴时提取 JIG ID</span>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={d.clipboardAutoProcessEnabled}
                  onChange={(e) =>
                    patch({ clipboardAutoProcessEnabled: e.target.checked })
                  }
                />
                从邮件等混合文本里自动挑出 ID
              </label>
            </div>

            <div className="field">
              <span className="field__label">尺寸验证</span>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={d.sizeValidationEnabled}
                  onChange={(e) => patch({ sizeValidationEnabled: e.target.checked })}
                />
                启动时默认标出不匹配的尺寸
              </label>
            </div>

            <div className="field">
              <span className="field__label">导出文件名</span>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={d.exportTimestampEnabled}
                  onChange={(e) =>
                    patch({ exportTimestampEnabled: e.target.checked })
                  }
                />
                附加时间戳,避免覆盖旧文件
              </label>
            </div>
          </fieldset>
        </div>

        <OverlayScrollbar targetRef={bodyRef} />

        <div className="dialog__foot">
          <button className="btn" type="button" onClick={closeWithoutSave}>
            取消
          </button>
          <button
            className="btn btn--primary"
            type="button"
            onClick={() => onSave(d)}
          >
            保存设置
          </button>
        </div>
      </div>
    </div>
  )
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.min(Math.max(Math.round(n), lo), hi)
}