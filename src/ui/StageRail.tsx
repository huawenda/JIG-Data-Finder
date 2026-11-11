import { useEffect, useRef, useState } from 'react'
import type { AppConfig } from '../core/config'
import type { Table } from '../core/table'
import OverlayScrollbar from './OverlayScrollbar'

export interface StageRailProps {
  table: Table
  config: AppConfig
}

/**
 * 工序轨道 (「控制室」皮肤下是一条发光的产线流)。
 *
 * engineeringConfig 里那 11 道工序 (PNP=10 → Jig入库=100) 本来就是
 * 产线流水顺序, 这是这个领域独有的信息, 所以画成一条轨道而不是
 * 普通表格列: 一眼能看出"今天还没有 JIG 走到搬出"这类现场状态。
 *
 * 形态由 skin.css 的 .rail-stages / .stage 承担 (连接线、流动光带、
 * 节点圆点、呼吸脉冲); 本组件只负责数据与结构。
 *
 * 计数取自透视表的"总计"行 —— 那是当前查询范围内的真实数量。
 */
export default function StageRail({ table, config }: StageRailProps) {
  const stageNames = useMemoStageOrder(config)
  const scrollRef = useRef<HTMLDivElement>(null)
  if (stageNames.length === 0) return null

  const totalRow = table.rows[table.rows.length - 1]
  const counts = new Map<string, number>()

  if (totalRow) {
    for (const name of stageNames) {
      const raw = totalRow[name]
      const n = raw === undefined || raw === '' ? 0 : Number(raw)
      counts.set(name, Number.isFinite(n) ? n : 0)
    }
  }

  // 峰值用于归一化条形长度, 让"最多的一道工序"成为视觉锚点
  const peak = Math.max(1, ...counts.values())
  const lead = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]

  return (
    <div className="rail-stages-wrap">
      <div
        className="rail-stages"
        ref={scrollRef}
        role="list"
        aria-label="工序分布"
      >
        {stageNames.map((name) => {
          const n = counts.get(name) ?? 0
          const empty = n === 0
          // 0-4 档映射到透明度, 避免每道工序都画一条同长度的条
          const weight = n === 0 ? 0 : 0.25 + 0.75 * (n / peak)

          return (
            <div
              key={name}
              role="listitem"
              className="stage"
              data-empty={empty}
              data-active={!empty}
              data-lead={name === lead && !empty}
              title={`${name}: ${n}`}
            >
              <div
                className="stage__bar"
                style={{ opacity: weight }}
                aria-hidden="true"
              />
              <div className="stage__name">{name}</div>
              <div className="stage__count">
                <AnimatedCount value={n} />
              </div>
            </div>
          )
        })}
      </div>
      <OverlayScrollbar targetRef={scrollRef} axis="horizontal" />
    </div>
  )
}

/**
 * 数字入场滚动。
 *
 * 工序轨道上的计数从 0 滚到目标值, 让"数据刚刚刷新"这件事被感知到。
 * 尊重 prefers-reduced-motion: 系统开了"减少动态效果"就直接跳到终值,
 * 不引入多余的动画。
 *
 * 独立组件而非在父级放 Hook —— 这样它自己的 state 变化只重渲染这一个
 * 数字节点, 也避开父组件提前 return 带来的 Hook 顺序问题。
 */
function AnimatedCount({ value }: { value: number }) {
  const [shown, setShown] = useState(0)
  /*
   * 当前"已经显示到"的值, 用 ref 记而不是只看 value。
   *
   * 关键: React 18 StrictMode 在开发模式下会把挂载时的 effect 跑两遍
   * (setup → cleanup → setup)。若用"上一次的目标值"判断要不要起动画,
   * 第二遍 setup 会看到目标值没变而直接 return —— 第一遍被 cleanup 取消的
   * 动画再也不会重来, 数字永远停在 0。表现就是"从别的标签页切回全量透视时,
   * 工序轨道全部清零"(在那两个透视页之间切换不会卸载组件, 所以不触发)。
   *
   * 改成按"已显示到哪儿"判断, 第二遍 setup 会从当前进度重新起动画, 结果正确。
   */
  const shownRef = useRef(0)

  useEffect(() => {
    const from = shownRef.current
    if (from === value) return

    const reduceMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (reduceMotion || typeof requestAnimationFrame !== 'function') {
      shownRef.current = value
      setShown(value)
      return
    }

    let raf = 0
    const start = performance.now()
    const dur = 700
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / dur)
      const eased = 1 - Math.pow(1 - p, 3)
      const v = Math.round(from + (value - from) * eased)
      shownRef.current = v
      setShown(v)
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value])

  return <>{shown}</>
}

/** 按 engineeringConfig.order 取工序顺序 */
function useMemoStageOrder(config: AppConfig): string[] {
  return Object.entries(config.engineeringConfig)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([name]) => name)
}
