/**
 * 覆盖式滚动条。
 *
 * 原生滚动条会占掉 10~15px 的宽度/高度, 表格右侧的列或底部行因此被挤;
 * 而在只看不滚的时候, 这条灰条又一直露在外面。这里把原生滚动条隐藏
 * (见 app.css 的 .osb-target 规则), 用一条绝对定位的浮层代替:
 *
 *   - 不占布局尺寸, 覆盖在内容边缘;
 *   - 只在滚动时出现, 停止约 800ms 后淡出;
 *   - 可拖拽, 保证隐藏原生条之后仍能精确控制位置。
 *
 * 组件必须放在目标滚动元素所在的定位容器里 (父元素需 position: relative),
 * 浮层位置按 targetRef 与父容器的 rect 差值计算, 因此也适用于对话框这种
 * "滚动区只是容器一部分"的场景。
 *
 * axis 决定接管哪个方向: vertical 贴右缘, horizontal 贴底边。
 */

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'

export interface OverlayScrollbarProps {
  /** 需要接管滚动条的目标滚动元素 */
  targetRef: RefObject<HTMLElement>
  /** 接管方向, 默认纵向 */
  axis?: 'vertical' | 'horizontal'
}

interface View {
  visible: boolean
  railStyle: CSSProperties
  thumbStyle: CSSProperties
}

const EMPTY_VIEW: View = { visible: false, railStyle: {}, thumbStyle: {} }

/** 静止多久后淡出 */
const IDLE_MS = 800
/** 滑块最短长度, 内容再长也要能被抓住 */
const MIN_THUMB = 28
/** 浮层在另一方向上的固定厚度 (与 CSS 的 10px 对应) */
const RAIL = 10

export default function OverlayScrollbar({
  targetRef,
  axis = 'vertical',
}: OverlayScrollbarProps) {
  const railRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>(EMPTY_VIEW)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const el = targetRef.current
    const thumb = thumbRef.current
    if (!el || !thumb) return

    let hideTimer: ReturnType<typeof setTimeout> | null = null
    let shown = false
    let lastScroll = axis === 'vertical' ? el.scrollTop : el.scrollLeft
    let drag: {
      start: number
      scroll: number
      travel: number
      max: number
    } | null = null

    const clearTimer = () => {
      if (hideTimer !== null) {
        clearTimeout(hideTimer)
        hideTimer = null
      }
    }

    const pointerPos = (e: PointerEvent) =>
      axis === 'vertical' ? e.clientY : e.clientX

    const measure = (visible: boolean) => {
      const host = railRef.current?.parentElement
      if (!host) return

      const targetRect = el.getBoundingClientRect()
      const hostRect = host.getBoundingClientRect()

      const viewportSize =
        axis === 'vertical' ? el.clientHeight : el.clientWidth
      const contentSize =
        axis === 'vertical' ? el.scrollHeight : el.scrollWidth
      const scrollPos = axis === 'vertical' ? el.scrollTop : el.scrollLeft
      const max = contentSize - viewportSize

      // 没有可滚动的余量时直接收起, 不留下一条空轨道
      if (max <= 1 || viewportSize <= 0) {
        if (shown) {
          shown = false
          setView((v) => ({ ...v, visible: false }))
        }
        return
      }

      const thumbSize = Math.max(
        MIN_THUMB,
        Math.round(viewportSize * (viewportSize / contentSize)),
      )
      const travel = Math.max(1, viewportSize - thumbSize)
      const thumbOffset = Math.round((scrollPos / max) * travel)

      let railStyle: CSSProperties
      let thumbStyle: CSSProperties
      if (axis === 'vertical') {
        railStyle = {
          top: targetRect.top - hostRect.top,
          height: viewportSize,
          right: hostRect.right - targetRect.right,
        }
        thumbStyle = { top: thumbOffset, height: thumbSize }
      } else {
        railStyle = {
          left: targetRect.left - hostRect.left,
          top:
            targetRect.top -
            hostRect.top +
            viewportSize -
            RAIL,
          width: viewportSize,
        }
        thumbStyle = { left: thumbOffset, width: thumbSize }
      }

      shown = visible
      setView({ visible, railStyle, thumbStyle })
    }

    const scheduleHide = () => {
      clearTimer()
      hideTimer = setTimeout(() => {
        hideTimer = null
        measure(false)
      }, IDLE_MS)
    }

    const onScroll = () => {
      const pos = axis === 'vertical' ? el.scrollTop : el.scrollLeft
      /*
       * 只有本方向的滚动位置变化才亮起。
       *
       * 同一个元素会同时挂纵向与横向两个浮层, 若不判断方向, 用户纵向
       * 滚表格时横向浮层也会跟着闪一下。
       */
      if (pos === lastScroll && !drag) return
      lastScroll = pos
      measure(true)
      // 拖拽过程中不重置计时, 否则长时间按住会被中途淡出
      if (!drag) scheduleHide()
    }

    const onResize = () => {
      // 尺寸变化时只刷新几何; 静止状态下不要把滚动条唤醒
      if (shown) measure(true)
    }

    const onDown = (e: PointerEvent) => {
      if (!e.isPrimary) return
      e.preventDefault()
      clearTimer()

      const viewportSize =
        axis === 'vertical' ? el.clientHeight : el.clientWidth
      const contentSize =
        axis === 'vertical' ? el.scrollHeight : el.scrollWidth
      const thumbSize = Math.max(
        MIN_THUMB,
        Math.round(viewportSize * (viewportSize / contentSize)),
      )

      drag = {
        start: pointerPos(e),
        scroll: axis === 'vertical' ? el.scrollTop : el.scrollLeft,
        travel: Math.max(1, viewportSize - thumbSize),
        max: contentSize - viewportSize,
      }
      setDragging(true)
      thumb.setPointerCapture(e.pointerId)
      measure(true)
    }

    const onMove = (e: PointerEvent) => {
      if (!drag) return
      const delta = pointerPos(e) - drag.start
      const next = drag.scroll + (delta / drag.travel) * drag.max
      if (axis === 'vertical') el.scrollTop = next
      else el.scrollLeft = next
    }

    const onUp = () => {
      if (!drag) return
      drag = null
      setDragging(false)
      measure(true)
      scheduleHide()
    }

    el.addEventListener('scroll', onScroll, { passive: true })
    thumb.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('resize', onResize)

    const ro =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(onResize)
    ro?.observe(el)

    return () => {
      clearTimer()
      el.removeEventListener('scroll', onScroll)
      thumb.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('resize', onResize)
      ro?.disconnect()
    }
  }, [targetRef, axis])

  return (
    <div
      ref={railRef}
      className={axis === 'vertical' ? 'osb osb--v' : 'osb osb--h'}
      data-visible={view.visible}
      data-dragging={dragging}
      style={view.railStyle}
      aria-hidden="true"
    >
      <div ref={thumbRef} className="osb__thumb" style={view.thumbStyle} />
    </div>
  )
}
