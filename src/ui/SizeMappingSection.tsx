/**
 * 型号尺寸匹配 —— 设置窗口里的一个分类面板
 *
 * 由原 SizeMappingDialog 的表格主体抽出: 去掉 .scrim/.dialog 外壳与底部
 * 操作条 (那部分交给设置窗口), 只留"工具栏 + 映射表 + 报错行"。
 *
 * 状态由父级持有 (rows / errors 都是 props): 父级需要用它做两件事 ——
 *   1. 左导航徽章上显示"几条规则 / 几处有误";
 *   2. 保存时若校验不过, 拦住保存并切到本分类。
 * 因此这里保持**受控**, 自己不存数据, 只负责渲染与交互。
 *
 * ## 排序: 指针拖拽 + 实时换位 + 补间
 *
 * 不用原生 HTML5 拖放, 因为它给不了两样东西:
 *   - 拖影没法样式化 (永远是浏览器截的那张半透明快照);
 *   - 拖动过程中无法平滑地让其它行让位。
 * 改成指针事件自己实现: 抓住手柄即接管, 行跟着指针走, 指针越过别人的中线
 * 就立刻换位, 其余行用 FLIP 补间滑过去 —— 也就是"实时排序"的观感。
 *
 * 行高并不固定 (带报错的行更高), 所以位移一律按实测的 offsetTop / offsetHeight
 * 算, 不用"行高 × 格数"的估算。
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MappingPair } from '../core/mapping'
import OverlayScrollbar from './OverlayScrollbar'

/** 映射行: 给 pair 裹一个稳定 id, 拖拽动效要靠它当 key */
export interface MapRow {
  id: string
  pair: MappingPair
}

export interface SizeMappingSectionProps {
  rows: MapRow[]
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

/** 让位/归位的补间时长 (与 CSS 里刻意不加 transition 相配合) */
const FLIP_MS = 160

export default function SizeMappingSection({
  rows,
  errors,
  active,
  onPatch,
  onAdd,
  onRemove,
  onMove,
  onRestore,
}: SizeMappingSectionProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  /** id -> 行元素。用 Map 而不是数组: 拖拽中顺序会变, 下标会失效 */
  const rowEls = useRef(new Map<string, HTMLDivElement>())
  /** 上一次布局后各行的 offsetTop, 供 FLIP 求位移差 */
  const prevTops = useRef(new Map<string, number>())

  const [dragId, setDragId] = useState<string | null>(null)
  /** 拖拽会话: 被抓行的 id 与"抓取点距行顶"的距离 */
  const dragInfo = useRef<{ id: string; grab: number } | null>(null)
  const pointerY = useRef(0)
  /** 指向最新一次渲染的 placeDragged, 供 layout effect 调用 */
  const placeRef = useRef<() => void>(() => {})

  const errorCount = Object.keys(errors).length

  /*
   * 报错信息在行内, 而列表随面板滚动 —— 用户在末尾新增一行、填了重复型号,
   * 红框确实出现了, 但提示文字往往落在可视区之外, 表现就是"保存按钮没反应
   * 但不知道为什么"。所以切到本分类、或错误集合变化时, 把第一处出错的行
   * 滚进视野。
   */
  useEffect(() => {
    if (!active) return
    const first = Object.keys(errors)
      .map(Number)
      .sort((a, b) => a - b)[0]
    if (first === undefined) return
    const row = rows[first]
    if (row) rowEls.current.get(row.id)?.scrollIntoView({ block: 'nearest' })
  }, [active, errors, rows])

  /**
   * 把正在拖的行摆到指针下面。
   *
   * 位移写成"指针想要的行顶 - 行当前的行顶": 行的当前行顶由 body 的视口位置、
   * 滚动量与 offsetTop 三者算得。用 offsetTop 而不是 getBoundingClientRect,
   * 是为了拿"布局位置" —— 换位后它立刻更新, 于是同一段代码在换位前后都成立。
   */
  const placeDragged = () => {
    const info = dragInfo.current
    const body = bodyRef.current
    if (!info || !body) return
    const el = rowEls.current.get(info.id)
    if (!el) return
    const currentTop =
      body.getBoundingClientRect().top - body.scrollTop + el.offsetTop
    el.style.transform = `translateY(${pointerY.current - info.grab - currentTop}px)`
  }
  placeRef.current = placeDragged

  /*
   * FLIP: 顺序变化后, 让"位置变了但没被拖"的行从旧位置滑到新位置。
   *
   * 用 Web Animations 而不是 CSS transition —— 拖拽中的行由内联 transform 驱动,
   * 若再给 .map__row 挂一条 transform 过渡, 两者会互相打架。
   */
  useLayoutEffect(() => {
    const nextTops = new Map<string, number>()
    rowEls.current.forEach((el, id) => nextTops.set(id, el.offsetTop))

    const prev = prevTops.current
    const reduceMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (prev.size > 0 && !reduceMotion) {
      rowEls.current.forEach((el, id) => {
        const p = prev.get(id)
        const n = nextTops.get(id)
        // 位置没变、或者这行正被拖着 (它的位置由指针决定) —— 都不参与补间
        if (p === undefined || n === undefined || p === n) return
        if (dragInfo.current?.id === id) return
        if (typeof el.animate !== 'function') return
        el.animate(
          [
            { transform: `translateY(${p - n}px)` },
            { transform: 'translateY(0)' },
          ],
          { duration: FLIP_MS, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
        )
      })
    }

    prevTops.current = nextTops
    /*
     * 换位后必须立刻重新摆一次被拖的行: 它的 offsetTop 变了, 而内联 transform
     * 还停在旧值上。不补这一下, 换位那一帧它会跳。
     */
    placeRef.current()
  }, [rows])

  /* ---- 拖拽会话 ---- */

  const startDrag = (e: React.PointerEvent<HTMLButtonElement>, id: string) => {
    if (e.button !== 0) return
    const el = rowEls.current.get(id)
    if (!el) return
    // 阻止默认行为, 免得拖着拖着把输入框里的文字选中/拖走
    e.preventDefault()
    pointerY.current = e.clientY
    dragInfo.current = { id, grab: e.clientY - el.getBoundingClientRect().top }
    setDragId(id)
    placeRef.current()
  }

  useEffect(() => {
    if (!dragId) return

    const move = (e: PointerEvent) => {
      const info = dragInfo.current
      const body = bodyRef.current
      if (!info || !body) return

      pointerY.current = e.clientY
      placeRef.current()

      const cur = rows.findIndex((r) => r.id === info.id)
      if (cur < 0) return

      /*
       * 目标格 = "指针越过了多少个别人的中线"。这个计数直接就是换位后的下标,
       * 且与 from 在前还是在后无关 (先摘掉再插入的语义)。
       */
      const bodyTop = body.getBoundingClientRect().top - body.scrollTop
      let target = 0
      for (let i = 0; i < rows.length; i += 1) {
        if (i === cur) continue
        const el = rowEls.current.get(rows[i].id)
        if (!el) continue
        if (e.clientY > bodyTop + el.offsetTop + el.offsetHeight / 2) {
          target += 1
        }
      }
      // 不动就不调, 免得白白触发一轮渲染
      if (target !== cur) onMove(cur, target)
    }

    const finish = () => {
      const info = dragInfo.current
      dragInfo.current = null
      setDragId(null)
      if (info) {
        const el = rowEls.current.get(info.id)
        // 顺序已经实时落定, 直接撤掉位移即可, 视觉上是无缝衔接
        if (el) el.style.transform = ''
      }
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
  }, [dragId, rows, onMove])

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
          <div
            className="map__body"
            ref={bodyRef}
            data-dragging={dragId ? 'true' : undefined}
          >
            {rows.length === 0 ? (
              <p className="map__empty">
                还没有任何映射规则, 点下方「新增」开始添加。
              </p>
            ) : (
              rows.map((row, i) => (
                <div
                  className="map__row"
                  key={row.id}
                  ref={(el) => {
                    if (el) rowEls.current.set(row.id, el)
                    else rowEls.current.delete(row.id)
                  }}
                  data-dragging={dragId === row.id ? 'true' : undefined}
                >
                  <button
                    className="map__grip"
                    type="button"
                    aria-label={`拖动第 ${i + 1} 行调整顺序`}
                    onPointerDown={(e) => startDrag(e, row.id)}
                  >
                    ⠿
                  </button>
                  <input
                    className="map__input"
                    value={row.pair.model}
                    aria-label={`第 ${i + 1} 行型号`}
                    aria-invalid={errors[i] ? 'true' : undefined}
                    data-invalid={errors[i] ? 'true' : undefined}
                    onChange={(e) => onPatch(i, { model: e.target.value })}
                  />
                  <input
                    className="map__input map__input--size"
                    value={row.pair.size}
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
                      disabled={i === rows.length - 1}
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
          {errorCount > 0 ? `${errorCount} 处有误` : `${rows.length} 条规则`}
        </span>
      </div>

      {errorCount > 0 && (
        <p className="map__note">存在重复或空型号, 修正后才能保存。</p>
      )}
    </>
  )
}
