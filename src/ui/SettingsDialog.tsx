import { useEffect, useMemo, useRef, useState } from 'react'
import { createDefaultConfig } from '../core/config'
import type { AppConfig } from '../core/config'
import {
  blankPair,
  movePair,
  orderedPairs,
  pairsToMapping,
  validateMappingPairs,
} from '../core/mapping'
import type { MappingPair } from '../core/mapping'
import type { ThemeMode } from '../core/theme'
import { THEME_OPTIONS, prefersDark, themeLabel } from '../core/theme'
import SizeMappingSection from './SizeMappingSection'

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
  /**
   * 一次保存全部: 设置草稿 + 型号尺寸映射 + 映射排序。
   *
   * 融合前是两套独立保存 (saveSettings / saveSizeMapping 各写一次盘),
   * 现在合成一次 —— 否则同一个对话框点一下"保存"要写两次配置, 中途失败
   * 会留下"设置存了、映射没存"的半成品。
   */
  onSave: (
    d: SettingsDraft,
    mapping: Record<string, string>,
    order: string[],
  ) => void
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

/** 设置窗口的左导航分类 */
type PrefsCategory = 'file' | 'ui' | 'data' | 'map'

const CATEGORIES: readonly { id: PrefsCategory; label: string }[] = [
  { id: 'file', label: '文件' },
  { id: 'ui', label: '界面' },
  { id: 'data', label: '数据处理' },
  { id: 'map', label: '型号尺寸匹配' },
]

export default function SettingsDialog({
  config,
  initial,
  onSave,
  onClose,
  pickDirectory,
  onThemePreview,
}: SettingsDialogProps) {
  const [d, setD] = useState<SettingsDraft>(initial)
  /*
   * 型号尺寸映射的草稿。
   *
   * 放在这里而不是映射面板内部: 左导航徽章要读它的条数/错误数, 保存时还要
   * 靠它决定"能不能存"。切分类时这个 state 一直活着, 所以来回切不丢改动。
   */
  const [pairs, setPairs] = useState<MappingPair[]>(() =>
    orderedPairs(config.jigSizeMapping, config.jigSizeMappingOrder),
  )
  /*
   * 默认停在「文件」分类 (与融合前"点设置先看到文件路径"的观感一致)。
   */
  const [cat, setCat] = useState<PrefsCategory>('file')

  const paneRef = useRef<HTMLDivElement>(null)

  const errors = useMemo(() => validateMappingPairs(pairs), [pairs])
  const errorCount = Object.keys(errors).length

  const patch = (p: Partial<SettingsDraft>) => setD((prev) => ({ ...prev, ...p }))

  const patchPair = (i: number, p: Partial<MappingPair>) =>
    setPairs((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...p } : row)))
  const addPair = () => setPairs((prev) => [...prev, blankPair()])
  const removePair = (i: number) =>
    setPairs((prev) => prev.filter((_, idx) => idx !== i))
  const movePairAt = (from: number, to: number) =>
    setPairs((prev) => movePair(prev, from, to))

  /*
   * 「恢复默认」恢复的是**内置默认映射**, 不是当前配置里的那份。
   *
   * 一开始这里传的是 config.jigSizeMapping, 结果是: 用户改完规则保存,
   * 下次打开面板点「恢复默认」, 拿回的正是他自己刚存的那份 —— 按钮看着
   * 有反应, 但什么也没恢复。默认表是代码里的 createDefaultConfig(),
   * 不会被用户配置污染。
   */
  const restorePairs = () => {
    const def = createDefaultConfig()
    setPairs(orderedPairs(def.jigSizeMapping, def.jigSizeMappingOrder))
  }

  /*
   * 关闭前把预览过的主题还原。
   *
   * 点取消 / 按 ESC 两条路都得还原 —— 少还原一条, 用户就会带着一个
   * "没保存却生效了"的颜色退出, 下次启动又变回去, 像配置损坏。
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

  /*
   * 保存。
   *
   * 映射表存在校验错误时**拦住保存**, 并自动切到「型号尺寸匹配」分类 ——
   * 面板里那处错误会自动滚进视野 (见 SizeMappingSection)。这样不会写出
   * 一份半成品配置, 用户也不用自己去猜"哪里错了"。
   */
  const submit = () => {
    if (errorCount > 0) {
      setCat('map')
      return
    }
    onSave(d, pairsToMapping(pairs), pairs.map((p) => p.model))
  }

  const switchCategory = (id: PrefsCategory) => {
    setCat(id)
    // 换分类回到顶部, 免得停在上一类的滚动位置
    paneRef.current?.scrollTo({ top: 0 })
  }

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
        className="dialog dialog--prefs"
        role="dialog"
        aria-modal="true"
        aria-labelledby="set-title"
      >
        <div className="dialog__head">
          <h2 className="dialog__title" id="set-title">
            设置
          </h2>
          <p className="dialog__note">改动在下次启动时完全生效。</p>
        </div>

        <div className="dialog__main">
          <nav className="prefs-nav" role="tablist" aria-label="设置分类">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                className="prefs-nav__item"
                type="button"
                role="tab"
                aria-selected={cat === c.id}
                onClick={() => switchCategory(c.id)}
              >
                {c.label}
                {c.id === 'map' && (
                  <span
                    className="prefs-nav__badge"
                    data-bad={errorCount > 0 ? 'true' : undefined}
                  >
                    {errorCount > 0 ? `${errorCount} 处有误` : `${pairs.length} 条`}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <div className="prefs-pane" ref={paneRef}>
            {cat === 'file' && (
              <section className="fieldset" role="tabpanel" aria-label="文件">
                <div className="field">
                  <label className="field__label">源文件默认目录</label>
                  <div className="field__control">
                    <span
                      className="field__text"
                      data-empty={!d.defaultFileDialogPath}
                    >
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
              </section>
            )}

            {cat === 'ui' && (
              <section className="fieldset" role="tabpanel" aria-label="界面">
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
                          windowSize: [
                            clamp(Number(e.target.value), 800, 1920),
                            d.windowSize[1],
                          ],
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
                          windowSize: [
                            d.windowSize[0],
                            clamp(Number(e.target.value), 600, 1080),
                          ],
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
              </section>
            )}

            {cat === 'data' && (
              <section className="fieldset" role="tabpanel" aria-label="数据处理">
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
                      onChange={(e) =>
                        patch({ sizeValidationEnabled: e.target.checked })
                      }
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
              </section>
            )}

            {cat === 'map' && (
              <section role="tabpanel" aria-label="型号尺寸匹配">
                <SizeMappingSection
                  pairs={pairs}
                  errors={errors}
                  active={cat === 'map'}
                  onPatch={patchPair}
                  onAdd={addPair}
                  onRemove={removePair}
                  onMove={movePairAt}
                  onRestore={restorePairs}
                />
              </section>
            )}
          </div>
        </div>

        <div className="dialog__foot">
          <button className="btn" type="button" onClick={closeWithoutSave}>
            取消
          </button>
          <button className="btn btn--primary" type="button" onClick={submit}>
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
