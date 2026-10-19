import type { AppConfig } from '../core/config'
import type { Table } from '../core/table'

export interface StageRailProps {
  table: Table
  config: AppConfig
}

/**
 * 工序轨道。
 *
 * engineeringConfig 里那 11 道工序 (PNP=10 → Jig入库=100) 本来就是
 * 产线流水顺序, 这是这个领域独有的信息, 所以画成一条轨道而不是
 * 普通表格列: 一眼能看出"今天还没有治具走到搬出"这类现场状态。
 *
 * 计数取自透视表的"总计"行 —— 那是当前查询范围内的真实数量。
 */
export default function StageRail({ table, config }: StageRailProps) {
  const stageNames = useMemoStageOrder(config)
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
    <div className="rail-stages" role="list" aria-label="工序分布">
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
            <div className="stage__count">{n}</div>
          </div>
        )
      })}
    </div>
  )
}

/** 按 engineeringConfig.order 取工序顺序 */
function useMemoStageOrder(config: AppConfig): string[] {
  return Object.entries(config.engineeringConfig)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([name]) => name)
}