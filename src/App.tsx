import { useState } from 'react'

/**
 * 占位外壳 —— 数据层 (src/core) 已完成迁移并通过基线验证,
 * 本阶段先确认 Tauri 窗口 + 托盘 + 关闭到托盘能正常编译运行。
 */
export default function App() {
  const [msg] = useState('Tauri 宿主已就绪')

  return (
    <div style={{ padding: 24, fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif' }}>
      <h1 style={{ fontSize: 20, color: '#1E293B' }}>JIG Data Finder</h1>
      <p style={{ color: '#475569' }}>{msg}</p>
      <p style={{ color: '#94A3B8', fontSize: 13 }}>
        Phase 0-2 已完成: 基线快照 + 数据层迁移 (config / validate / clipboard / pivot),
        端到端逐格比对通过。
      </p>
    </div>
  )
}