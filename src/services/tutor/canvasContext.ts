import { getCurrentCanvasBoard, useCanvasStore } from './canvasStore.js'
import { computePolygonArea, resolvePointCoords } from './toolExecutor.js'

const fmt = (n: number): string => {
  if (!Number.isFinite(n)) {
    return '?'
  }
  return Math.abs(n - Math.round(n)) < 1e-4 ? String(Math.round(n)) : n.toFixed(2).replace(/\.?0+$/, '')
}

/**
 * 生成紧凑、结构化的「当前画板实时状态」上下文摘要，供 AI 在下一轮回复中感知：
 * - 学生当前正在看的画板（坐标系 / 流程图）
 * - 动点被学生拖动后的实时坐标 (x, y) 与参数 t，以及当前测量指标数值
 * - 学生自主在画板上标出的探索点、辅助线段或函数曲线
 * - 流程图当前全部节点状态、连线关系，以及学生当前点选的节点
 */
export const buildCanvasContextSummary = (): string => {
  const state = useCanvasStore.getState()
  const board = getCurrentCanvasBoard(state)
  const hasUserCoord =
    state.userPoints.length > 0 || state.userSegments.length > 0 || state.userFunctions.length > 0

  if (!board.hasCoordinate && !board.hasFlowchart && !hasUserCoord) {
    return ''
  }

  const lines: string[] = [
    '[当前画板实时状态（学生端可见，供你结合画面精确回应；无需重复已画元素）]',
    `- 当前激活画板：${state.activeTab === 'flowchart' ? '思维流程图' : '数学坐标系'}`,
  ]

  if (board.hasCoordinate || hasUserCoord) {
    const coord = board.coordinate
    lines.push(
      `【坐标系画板】标题="${coord.title || '未命名'}" 视口=[${coord.viewport.xMin},${coord.viewport.xMax}]×[${coord.viewport.yMin},${coord.viewport.yMax}]`
    )
    if (coord.points.length > 0) {
      lines.push(
        `  - 固定点：${coord.points.map((p) => `${p.id}(${fmt(p.x)},${fmt(p.y)})`).join(', ')}`
      )
    }
    if (coord.movingPoints.length > 0) {
      const mps = coord.movingPoints.map((mp) => {
        const t = Object.hasOwn(state.tValues, mp.id) ? state.tValues[mp.id] : mp.initialT
        const pos = resolvePointCoords(coord, mp.id, state.tValues)
        return pos
          ? `${mp.id}(当前位置=(${fmt(pos.x)},${fmt(pos.y)}), t=${fmt(t)}, 范围=[${fmt(mp.tMin)},${fmt(mp.tMax)}])`
          : `${mp.id}(t=${fmt(t)})`
      })
      lines.push(`  - 动点实时位置：${mps.join(', ')}`)
    }
    if (coord.functions.length > 0) {
      lines.push(`  - 函数曲线：${coord.functions.map((f) => `${f.id}: y=${f.expr}`).join('; ')}`)
    }
    if (coord.segments.length > 0) {
      lines.push(
        `  - 线段：${coord.segments.map((s) => `${s.id}(${s.fromId ?? JSON.stringify(s.from)}->${s.toId ?? JSON.stringify(s.to)})`).join(', ')}`
      )
    }
    if (coord.auxiliaryLines.length > 0) {
      lines.push(
        `  - 辅助线：${coord.auxiliaryLines.map((a) => `${a.id}[${a.kind}:${a.fromId}${a.derivedPointId ? `->${a.derivedPointId}` : ''}]`).join(', ')}`
      )
    }
    if (coord.measurements.length > 0) {
      const meas = coord.measurements.map((m) => {
        if (m.kind === 'distance' && m.pointIds && m.pointIds.length >= 2) {
          const a = resolvePointCoords(coord, m.pointIds[0], state.tValues)
          const b = resolvePointCoords(coord, m.pointIds[1], state.tValues)
          if (a && b) {
            return `${m.label}=${Math.hypot(b.x - a.x, b.y - a.y).toFixed(2)}`
          }
        } else if (m.kind === 'sum_distance' && m.pairs) {
          let total = 0
          let ok = true
          for (const [id1, id2] of m.pairs) {
            const a = resolvePointCoords(coord, id1, state.tValues)
            const b = resolvePointCoords(coord, id2, state.tValues)
            if (!a || !b) {
              ok = false
              break
            }
            total += Math.hypot(b.x - a.x, b.y - a.y)
          }
          if (ok) {
            return `${m.label}=${total.toFixed(2)}`
          }
        } else if (m.kind === 'area' && m.pointIds && m.pointIds.length >= 3) {
          const pts = m.pointIds
            .map((id) => resolvePointCoords(coord, id, state.tValues))
            .filter((p): p is { x: number; y: number } => p !== null)
          if (pts.length >= 3) {
            return `${m.label}=${computePolygonArea(pts).toFixed(2)}`
          }
        }
        return m.label
      })
      lines.push(`  - 实时度量：${meas.join(', ')}`)
    }
    if (hasUserCoord) {
      if (state.userPoints.length > 0) {
        lines.push(
          `  - 学生自己标出的探索点：${state.userPoints.map((p) => `${p.id}(${fmt(p.x)},${fmt(p.y)})`).join(', ')}`
        )
      }
      if (state.userSegments.length > 0) {
        lines.push(
          `  - 学生自己连接的探索线段：${state.userSegments.map((s) => `${s.fromId}-${s.toId}`).join(', ')}`
        )
      }
      if (state.userFunctions.length > 0) {
        lines.push(
          `  - 学生自己绘制的函数：${state.userFunctions.map((f) => `y=${f.expr}`).join('; ')}`
        )
      }
    }
    if (state.selectedCoordId) {
      lines.push(`  - 学生当前选中的坐标系元素：${state.selectedCoordId}`)
    }
  }

  if (board.hasFlowchart) {
    const flow = board.flowchart
    lines.push(
      `【思维流程图】标题="${flow.title || '未命名'}" 方向=${state.flowDirectionOverride ?? flow.direction} 节点数=${flow.nodes.length}`
    )
    if (flow.nodes.length > 0) {
      lines.push(
        `  - 节点：${flow.nodes
          .map((n) => {
            const effectiveStatus = state.flowStatusOverrides[n.id] ?? n.status
            return `${n.id}[${n.kind}/${effectiveStatus}: ${n.label}${n.sublabel ? ` (${n.sublabel})` : ''}]`
          })
          .join(' | ')}`
      )
    }
    if (flow.edges.length > 0) {
      lines.push(
        `  - 连线：${flow.edges.map((e) => `${e.from}->${e.to}${e.label ? `(${e.label})` : ''}`).join(', ')}`
      )
    }
    if (state.selectedFlowNodeId) {
      const sel = flow.nodes.find((n) => n.id === state.selectedFlowNodeId)
      if (sel) {
        lines.push(`  - 学生当前点选聚焦的节点：${sel.id}「${sel.label}」`)
      }
    }
  }

  return lines.join('\n')
}
