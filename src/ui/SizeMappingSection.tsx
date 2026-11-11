/**
 * 型号尺寸匹配 —— 设置窗口里的一个分类面板
 *
 * 由原 SizeMappingDialog 的表格主体抽出: 去掉 .scrim/.dialog 外壳与底部
 * 操作条 (那部分交给设置窗口), 只留"说明 + 工具栏 + 映射表"。
 *
 * 状态由父级持有 (pairs / errors 都是 props): 父级需要用它做两件事 ——
 *   1. 左导航徽章上显示"几条规则 / 几处有误";
 *   2. 保存时若校验不过, 拦住保存并切到本分类。
 * 因此这里保持**受控**, 自己不存 pairs, 只负责渲染与交互。
 */

import { useEffect, useRef, useState } from 'react'
import type { MappingPair } from '../core/mapping'
import OverlayScrollbar from './OverlayScrollbar'

export interface SizeMappingSectionProps {
  pairs: MappingPair[]
  /** validateMappingPairs 的结果: 行号 -> 错误文案 */
  errors: Record<number, string>
  /** 当前是否是可见的那个分类 (隐藏时不做滚动) */
  active: boolean
  onPatch: (i: number, p: Partial<MappingPair>) => void
  onAdd: () => void
  onRemove: (i: number) => void
  onMove: (from: number, to: number) => void
  onRestore: () => void
}

export default function SizeMappingSection({
  pairs,
  errors,
  active,
  onPatch,
  onAdd,
  onRemove,
  onMove,
  onRestore,
}: SizeMappingSectionProps) {
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])
  const bodyRef = useRef<HTMLDivElement>(null)
  const errorCount = Object.keys(errors).length

  /*
   * 报错信息在行内, 而列表随右面板整体滚动 —— 用户在末尾新增一行、填了
   * 重复型号, 红框确实出现了, 但提示文字往往落在可视区之外, 表现就是
   * "保存按钮没反应但不知道为什么"。所以切到本分类、或错误集合变化时,
   * 自动把第一处出错的行滚进视野。
   */
  useEffect(() => {
    if (!active) return
    const first = Object.keys(errors)
      .map(Number)
      .sort((a, b) => a - b)[0]
    if (first === undefined) return
    rowRefs.current[first]?.scrollIntoView({ block: 'nearest' })
  }, [active, errors])

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
    onMove(from, to)
  }

  return (
    <>
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
              <p className="map__empty">
                还没有任何映射规则, 点上方「新增」开始添加。
              </p>
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
                    onChange={(e) => onPatch(i, { model: e.target.value })}
                  />
                  <input
                    className="map__input map__input--size"
                    value={p.size}
                    aria-label={`第 ${i + 1} 行对应尺寸`}
                    placeholder="All Size"
                    onChange={(e) => onPatch(i, { size: e.target.value })}
                  />
                  <span className="map__move">
                    <button
                      className="btn btn--ghost btn--sm"
                      type="button"
                      aria-label={`第 ${i + 1} 行上移`}
                      disabled={i === 0}
                      onClick={() => onMove(i, i - 1)}
                    >
                      ↑
                    </button>
                    <button
                      className="btn btn--ghost btn--sm"
                      type="button"
                      aria-label={`第 ${i + 1} 行下移`}
                      disabled={i === pairs.length - 1}
                      onClick={() => onMove(i, i + 1)}
                    >
                      ↓
                    </button>
                  </span>
                  <button
                    className="btn btn--danger btn--sm"
                    type="button"
                    aria-label={`删除第 ${i + 1} 行`}
                    onClick={() => onRemove(i)}
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

      {/* 工具栏放在表格下方, 与原来独立面板时的位置一致 */}
      <div className="map__foot">
        <button className="btn" type="button" onClick={onAdd}>
          新增
        </button>
        <button className="btn" type="button" onClick={onRestore}>
          恢复默认
        </button>
        <span className="map__spacer" />
        <span
          className="map__count"
          data-bad={errorCount > 0 ? 'true' : undefined}
        >
          {errorCount > 0 ? `${errorCount} 处有误` : `${pairs.length} 条规则`}
        </span>
      </div>

      {errorCount > 0 && (
        <p className="map__note">存在重复或空型号, 修正后才能保存。</p>
      )}
    </>
  )
}
