import { getCurrentCanvasBoard, useCanvasStore } from './canvasStore.js'
import { solveCoordinateScene } from './sceneSolver.js'

const fmt = (n: number): string => {
  if (!Number.isFinite(n)) {
    return '?'
  }
  return Math.abs(n - Math.round(n)) < 1e-4 ? String(Math.round(n)) : n.toFixed(2).replace(/\.?0+$/, '')
}

/**
 * 生成紧凑、结构化的「当前画板实时状态」上下文摘要，供 AI 在下一轮回复中感知：
 * - 学生当前正在看的画板（坐标系 / 流程图）
 * - 经过脚本与约束求解后的动点/派生点实时坐标、参数滑块值与测量数值
 * - 当前几何约束的满足状态与误差、AI 动点脚本运行状态或错误提示（方便 AI 自主调试修正！）
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
    '[当前画板实时状态（学生端可见，供你结合画面精确回应；无需重复已画元素，可用 coord_update/coord_remove 精准修改）]',
    `- 当前激活画板：${state.activeTab === 'flowchart' ? '思维流程图' : '数学坐标系'}`,
  ]

  if (board.hasCoordinate || hasUserCoord) {
    const coord = board.coordinate
    const solved = solveCoordinateScene({
      coord,
      tValues: state.tValues,
      freePositions: state.freePositions,
      paramValues: state.paramValues,
      userPoints: state.userPoints,
      draggedId: state.draggedPointId,
      disabledConstraintIds: state.disabledConstraintIds,
      scriptEnabled: state.scriptEnabled,
      scriptTime: state.scriptTime,
      scriptCodeOverride: state.scriptCodeOverride,
    })

    lines.push(
      `【坐标系画板】标题="${coord.title || '未命名'}" 视口=[${coord.viewport.xMin},${coord.viewport.xMax}]×[${coord.viewport.yMin},${coord.viewport.yMax}]`
    )
    if (coord.points.length > 0) {
      lines.push(
        `  - 点：${coord.points
          .map((p) => {
            const pos = solved.points[p.id] ?? { x: p.x, y: p.y }
            return `${p.id}(${fmt(pos.x)},${fmt(pos.y)})${p.draggable ? '[可拖]' : ''}`
          })
          .join(', ')}`
      )
    }
    if (coord.movingPoints.length > 0) {
      const mps = coord.movingPoints.map((mp) => {
        const t = Object.hasOwn(solved.solvedT, mp.id)
          ? solved.solvedT[mp.id]
          : Object.hasOwn(state.tValues, mp.id)
            ? state.tValues[mp.id]
            : mp.initialT
        const pos = solved.points[mp.id]
        if (mp.path.type === 'free') {
          return pos ? `${mp.id}[自由动点](${fmt(pos.x)},${fmt(pos.y)})` : `${mp.id}[自由动点]`
        }
        return pos
          ? `${mp.id}(当前=(${fmt(pos.x)},${fmt(pos.y)}), t=${fmt(t)}, 范围=[${fmt(mp.tMin)},${fmt(mp.tMax)}])`
          : `${mp.id}(t=${fmt(t)})`
      })
      lines.push(`  - 动点实时位置：${mps.join(', ')}`)
    }
    if (coord.derivedPoints.length > 0) {
      const dps = coord.derivedPoints.map((dp) => {
        const pos = solved.points[dp.id]
        return pos ? `${dp.id}[${dp.kind}](${fmt(pos.x)},${fmt(pos.y)})` : `${dp.id}[${dp.kind}:未解]`
      })
      lines.push(`  - 动态构造点：${dps.join(', ')}`)
    }
    if (coord.sliders.length > 0) {
      lines.push(
        `  - 参数滑块：${coord.sliders
          .map((s) => `${s.id}=${fmt(solved.params[s.id] ?? s.initialValue)}[${fmt(s.min)}..${fmt(s.max)}]`)
          .join(', ')}`
      )
    }
    if (coord.functions.length > 0) {
      lines.push(
        `  - 曲线/函数：${coord.functions
          .map((f) => `${f.id}: ${f.label || f.expr}`)
          .join('; ')}`
      )
    }
    if (coord.segments.length > 0) {
      lines.push(
        `  - 线段/直线：${coord.segments
          .map((s) => `${s.id}(${s.fromId ?? JSON.stringify(s.from)}->${s.toId ?? JSON.stringify(s.to)})`)
          .join(', ')}`
      )
    }
    if (coord.auxiliaryLines.length > 0) {
      lines.push(
        `  - 辅助线：${coord.auxiliaryLines
          .map((a) => `${a.id}[${a.kind}:${a.fromId}${a.derivedPointId ? `->${a.derivedPointId}` : ''}]`)
          .join(', ')}`
      )
    }
    if (solved.constraintStatuses.length > 0) {
      lines.push(
        `  - 约束条件：${solved.constraintStatuses
          .map((st) =>
            !st.enabled
              ? `${st.id}(${st.label})[已停用]`
              : st.satisfied
                ? `${st.id}(${st.label})[满足✓]`
                : `${st.id}(${st.label})[未完全满足,误差=${st.error.toFixed(3)}]`
          )
          .join('; ')}`
      )
    }
    if (coord.motionScript) {
      const scriptState = !state.scriptEnabled
        ? '已暂停/停用'
        : solved.scriptError
          ? `出错(${solved.scriptError})`
          : `运行正常(t=${fmt(state.scriptTime)}s/${fmt(coord.motionScript.duration)}s${solved.scriptStatus ? `, 状态="${solved.scriptStatus}"` : ''})`
      lines.push(`  - 动点控制程序：${coord.motionScript.title} [${scriptState}]`)
    }
    if (solved.measurements.length > 0) {
      lines.push(
        `  - 实时度量：${solved.measurements.map((m) => `${m.measurement.label}=${m.display}`).join(', ')}`
      )
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
