import { useState } from 'react'
import type { AppConfig } from '../core/config'

export interface SettingsDraft {
  defaultFileDialogPath: string
  defaultExportPath: string
  tableDefaultRowHeight: number
  windowSize: [number, number]
  clipboardAutoProcessEnabled: boolean
  sizeValidationEnabled: boolean
  closeToTray: boolean
  exportTimestampEnabled: boolean
}

export interface SettingsDialogProps {
  config: AppConfig
  initial: SettingsDraft
  onSave: (d: SettingsDraft) => void
  onClose: () => void
  /** 交由宿主层打开目录选择框 */
  pickDirectory: (current: string) => Promise<string | null>
}

export default function SettingsDialog({
  config,
  initial,
  onSave,
  onClose,
  pickDirectory,
}: SettingsDialogProps) {
  const [d, setD] = useState<SettingsDraft>(initial)

  const patch = (p: Partial<SettingsDraft>) => setD((prev) => ({ ...prev, ...p }))

  return (
    <div
      className="scrim"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="set-title"
      >
        <div className="dialog__body">
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
              <span className="field__label">关闭按钮</span>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={d.closeToTray}
                  onChange={(e) => patch({ closeToTray: e.target.checked })}
                />
                最小化到系统托盘,不退出
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

        <div className="dialog__foot">
          <button className="btn" type="button" onClick={onClose}>
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