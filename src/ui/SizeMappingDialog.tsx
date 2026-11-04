/**
 * 型号尺寸匹配设置面板
 *
 * 独立于「设置」对话框, 而不是做成设置里的一个分组, 原因有二:
 *   1. 现有对话框是固定宽 660px 的三段式表单, 内含表格后会撑得很高;
 *      映射表通常有十几行, 塞进去会把整页挤到需要滚动。
 *   2. 这个表是使用频率最高、也最容易出错的一块, 值得一个单独的入口。
 *
 * 编辑的是 draft, 点「保存」才回传; 点「取消」原样丢弃。
 * 保存时若存在校验错误一律不提交, 避免写出一份半成品配置。
 */

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
import OverlayScrollbar from './OverlayScrollbar'

export interface SizeMappingDialogProps {
  config: AppConfig
  /**
   * 同时回传排列顺序。见 jigSizeMappingOrder 的注释: 映射表是
   * Record<string,string>, 存不下用户排的顺序, 顺序必须单列一份传回来。
   */
  onSave: (mapping: Record<string, string>, order: string[]) => void
  onClose: () => void
}

export default function SizeMappingDialog({
  config,
  onSave,
  onClose,
}: SizeMappingDialogProps) {
  const [pairs, setPairs] = useState<MappingPair[]>(() =>
    orderedPairs(config.jigSizeMapping, config.jigSizeMappingOrder),
  )

  const errors = useMemo(() => validateMappingPairs(pairs), [pairs])
  const errorCount = Object.keys(errors).length

  const bodyRef = useRef<HTMLDivElement>(null)
  const dialogBodyRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])

  /*
   * 报错信息在行内, 列表又是可滚动的 —— 用户在末尾新增一行、填了重复
   * 型号, 红框确实出现了, 但提示文字往往落在可视区之外, 表现就是
   * "保存按钮灰了但不知道为什么"。所以第一处出错时自动滚过去。
   */
  useEffect(() => {
    const first = rowRefs.current[Object.keys(errors).map(Number)[0]]
    first?.scrollIntoView({ block: 'nearest' })
  }, [errors])

  const patch = (i: number, p: Partial<MappingPair>) =>
    setPairs((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...p } : row)))

  const add = () => setPairs((prev) => [...prev, blankPair()])

  const remove = (i: number) => setPairs((prev) => prev.filter((_, idx) => idx !== i))

  const move = (from: number, to: number) => setPairs((prev) => movePair(prev, from, to))

  /*
   * 拖拽排序。
   *
   * 用原生 HTML5 拖放而不是 react-dnd 之类的库: 这里只需要"上下换位"
   * 一种手势, 而拖放真正的难点从来不是位移计算, 是拖拽过程中的视觉
   * 反馈 —— 原生 dragstart 能拿到浏览器内置的拖影, 不必自己画。
   *
   * dragIndex 用 ref 而不是 state: 它只在 dragover 里读, 一旦存进 state
   * 每经过一行就会触发一次重渲, 十几行的表会明显发涩。
   */
  const dragIndex = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  const onDrop = (to: number) => {
    const from = dragIndex.current
    dragIndex.current = null
    setDragOver(null)
    if (from === null || from === to) return
    move(from, to)
  }

  /*
   * 「恢复默认」恢复的是**内置默认映射**, 不是当前配置里的那份。
   *
   * 一开始这里传的是 config.jigSizeMapping, 结果是: 用户改完规则保存,
   * 下次打开面板点「恢复默认」, 拿回的正是他自己刚存的那份 —— 按钮看着
   * 有反应, 但什么也没恢复。要撤回上一次的误操作只能去改配置文件,
   * 这个按钮等于白给。默认表是代码里的 createDefaultConfig(), 不会
   * 被用户配置污染。
   */
  const restore = () => {
    const d = createDefaultConfig()
    setPairs(orderedPairs(d.jigSizeMapping, d.jigSizeMappingOrder))
  }

  // ESC 关闭。与遮罩点击是同一套退路的两种入口。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="scrim"
      role="presentation"
      /*
       * 点遮罩空白处不关闭, 只有「取消」和 Esc 能关。
       * 型号尺寸映射是逐行录入的活儿, 误触空白就会把没保存的配对全丢掉。
       * 与设置面板保持同一套关闭规则。
       */
    >
      <div
        className="dialog dialog--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="map-title"
      >
        <div className="dialog__body" ref={dialogBodyRef}>
          <h2 className="dialog__title" id="map-title">
            型号尺寸匹配
          </h2>
          <div className="map">
            <div className="map__head">
              <span className="map__col map__col--grip" />
              <span className="map__col">型号</span>
              <span className="map__col map__col--size">对应尺寸</span>
              <span className="map__col map__col--move">顺序</span>
              <span className="map__col map__col--act" />
            </div>

            <div className="map__body-wrap">
              <div className="map__body" ref={bodyRef}>
              {pairs.length === 0 ? (
                <p className="map__empty">还没有任何映射规则, 点下方「新增」开始添加。</p>
              ) : (
                pairs.map((p, i) => (
                  <div
                    className="map__row"
                    key={i}
                    ref={(el) => {
                      rowRefs.current[i] = el
                    }}
                    data-over={dragOver === i ? 'true' : undefined}
                    onDragOver={(e) => {
                      // 必须 preventDefault, 否则 drop 根本不触发。
                      // dropEffect 用 'move' 才显示移动光标而非禁止符号。
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                      if (dragOver !== i) setDragOver(i)
                    }}
                    onDragLeave={() => {
                      if (dragOver === i) setDragOver(null)
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      onDrop(i)
                    }}
                  >
                    <button
                      className="map__grip"
                      type="button"
                      aria-label={`拖动第 ${i + 1} 行调整顺序`}
                      draggable
                      onDragStart={(e) => {
                        dragIndex.current = i
                        e.dataTransfer.effectAllowed = 'move'
                        // Firefox 不设置数据就不会触发 dragover
                        e.dataTransfer.setData('text/plain', String(i))
                      }}
                      onDragEnd={() => {
                        dragIndex.current = null
                        setDragOver(null)
                      }}
                    >
                      ⠿
                    </button>
                    <input
                      className="map__input"
                      value={p.model}
                      aria-label={`第 ${i + 1} 行型号`}
                      aria-invalid={errors[i] ? 'true' : undefined}
                      data-invalid={errors[i] ? 'true' : undefined}
                      onChange={(e) => patch(i, { model: e.target.value })}
                    />
                    <input
                      className="map__input map__input--size"
                      value={p.size}
                      aria-label={`第 ${i + 1} 行对应尺寸`}
                      placeholder="All Size"
                      onChange={(e) => patch(i, { size: e.target.value })}
                    />
                    <span className="map__move">
                      <button
                        className="btn btn--ghost btn--sm"
                        type="button"
                        aria-label={`第 ${i + 1} 行上移`}
                        disabled={i === 0}
                        onClick={() => move(i, i - 1)}
                      >
                        ↑
                      </button>
                      <button
                        className="btn btn--ghost btn--sm"
                        type="button"
                        aria-label={`第 ${i + 1} 行下移`}
                        disabled={i === pairs.length - 1}
                        onClick={() => move(i, i + 1)}
                      >
                        ↓
                      </button>
                    </span>
                    <button
                      className="btn btn--danger btn--sm"
                      type="button"
                      aria-label={`删除第 ${i + 1} 行`}
                      onClick={() => remove(i)}
                    >
                      删除
                    </button>
                    {errors[i] && <span className="map__err">{errors[i]}</span>}
                  </div>
                ))
              )}
              </div>
              <OverlayScrollbar targetRef={bodyRef} />
            </div>
          </div>

          <div className="map__foot">
            <button className="btn" type="button" onClick={add}>
              新增
            </button>
            <button className="btn" type="button" onClick={restore}>
              恢复默认
            </button>
            <span className="map__spacer" />
            <span className="map__count" data-bad={errorCount > 0 ? 'true' : undefined}>
              {errorCount > 0 ? `${errorCount} 处有误` : `${pairs.length} 条规则`}
            </span>
          </div>

          {errorCount > 0 && (
            <p className="map__note">存在重复或空型号, 修正后才能保存。</p>
          )}
        </div>

        <OverlayScrollbar targetRef={dialogBodyRef} />

        <div className="dialog__foot">
          <button className="btn" type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn--primary"
            type="button"
            disabled={errorCount > 0}
            onClick={() => onSave(pairsToMapping(pairs), pairs.map((p) => p.model))}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}