import {
  compileMathExpr,
  evalEquationResidual,
  evalMathExpr,
  type PointLookup,
} from './mathEval.js'
import {
  computeAngleDeg,
  computePolygonArea,
  evalMovingPointRaw,
  projectOntoLine,
  projectOntoSegment,
  projectWorldToMovingPoint,
  reflectPointAcrossLine,
  resolveCircleParams,
  vecDist,
  type ResolveContext,
  type Vec2,
} from './geometryEngine.js'
import type { CoordConstraint, CoordinateState } from './types.js'

export type ConstraintStatus = {
  id: string
  label: string
  satisfied: boolean
  error: number
  enabled: boolean
}

export type ConstraintSolveResult = {
  /** 被约束求解器计算后的所有可移动点坐标 */
  solvedPositions: Record<string, Vec2>
  /** 若受约束点是 1D 动点，反推其对应的最新 t 值 */
  solvedT: Record<string, number>
  /** 每条约束的实时满足状态与误差 */
  statuses: ConstraintStatus[]
}

const EPS = 1e-9

const resolvePairFromConstraint = (
  coord: CoordinateState,
  c: CoordConstraint,
  idx: number
): [string, string] | null => {
  if (c.pairs && c.pairs[idx]) {
    return c.pairs[idx]
  }
  if (c.segmentIds && c.segmentIds[idx]) {
    const seg = coord.segments.find((s) => s.id === c.segmentIds?.[idx])
    if (seg?.fromId && seg.toId) {
      return [seg.fromId, seg.toId]
    }
  }
  if (idx === 0 && c.segmentId) {
    const seg = coord.segments.find((s) => s.id === c.segmentId)
    if (seg?.fromId && seg.toId) {
      return [seg.fromId, seg.toId]
    }
  }
  if (idx === 0 && c.fromId && c.toId) {
    return [c.fromId, c.toId]
  }
  if (idx === 0 && c.pointIds && c.pointIds.length >= 2) {
    return [c.pointIds[0], c.pointIds[1]]
  }
  if (idx === 1 && c.pointIds && c.pointIds.length >= 4) {
    return [c.pointIds[2], c.pointIds[3]]
  }
  if (idx === 1 && c.pointIds && c.pointIds.length === 3) {
    // [A, B, C] -> (B, A) and (B, C)
    return [c.pointIds[1], c.pointIds[2]]
  }
  return null
}

const evalNumericTarget = (
  value: number | undefined,
  expr: string | undefined,
  params: Record<string, number>,
  positions: PointLookup,
  fallback: number
): number => {
  if (expr && expr.trim()) {
    const v = evalMathExpr(expr, params, positions)
    if (Number.isFinite(v)) {
      return v
    }
  }
  if (value !== undefined && Number.isFinite(value)) {
    return value
  }
  return fallback
}

/**
 * 实时几何与代数约束求解器（混合解析投影 + 阻尼数值梯度迭代）。
 * 在动点被用户拖动、滑块调节或脚本驱动时，自动在每帧 (<0.2ms) 内求解并维持所有约束条件。
 */
export const solveConstraints = (options: {
  coord: CoordinateState
  basePositions: Record<string, Vec2>
  tValues: Record<string, number>
  params: Record<string, number>
  draggedId: string | null
  disabledConstraintIds: Record<string, boolean>
  /** 若某约束点已被脚本显式设置，则脚本驱动点优先级高 */
  scriptControlledIds?: Set<string>
}): ConstraintSolveResult => {
  const {
    coord,
    basePositions,
    tValues,
    params,
    draggedId,
    disabledConstraintIds,
    scriptControlledIds,
  } = options

  const activeConstraints = coord.constraints.filter(
    (c) => c.enabled && !disabledConstraintIds[c.id]
  )

  const positions: Record<string, Vec2> = {}
  for (const [id, pt] of Object.entries(basePositions)) {
    positions[id] = { x: pt.x, y: pt.y }
  }

  if (coord.constraints.length === 0) {
    return { solvedPositions: {}, solvedT: {}, statuses: [] }
  }

  // 收集可移动点集合
  const movingMap = new Map(coord.movingPoints.map((mp) => [mp.id, mp]))
  const fixedMap = new Map(coord.points.map((p) => [p.id, p]))
  const explicitTargetSet = new Set<string>()
  for (const c of activeConstraints) {
    if (c.targets) {
      for (const tid of c.targets) {
        explicitTargetSet.add(tid)
      }
    }
  }

  const isMovableBase = (id: string): boolean => {
    if (movingMap.has(id)) {
      return true
    }
    const fixed = fixedMap.get(id)
    if (fixed) {
      if (fixed.pinned) {
        return false
      }
      if (fixed.draggable || explicitTargetSet.has(id)) {
        return true
      }
      return false
    }
    // 未定义但显式在 targets 中的点也可移动
    return explicitTargetSet.has(id)
  }

  let allowDraggedYield = false

  const getWeight = (id: string, c: CoordConstraint, involvedIds: string[]): number => {
    if (!Object.hasOwn(positions, id)) {
      return 0
    }
    if (c.targets && c.targets.length > 0 && !c.targets.includes(id)) {
      return 0
    }
    if (!isMovableBase(id)) {
      return 0
    }
    // 第一阶段优先完全尊重用户正在拖动的点/脚本控制点，仅在不可达边界才进入第二阶段柔和回弹
    if (id === draggedId || scriptControlledIds?.has(id)) {
      const otherMovable = involvedIds.some(
        (other) =>
          other !== id &&
          other !== draggedId &&
          !scriptControlledIds?.has(other) &&
          isMovableBase(other) &&
          (!c.targets || c.targets.length === 0 || c.targets.includes(other))
      )
      return otherMovable ? (allowDraggedYield ? 0.25 : 0) : 1.0
    }
    return 1.0
  }

  const touchedIds = new Set<string>()
  const markTouched = (id: string) => {
    touchedIds.add(id)
  }

  // 辅助：解析某条线的两个端点坐标
  const resolveConstraintLine = (c: CoordConstraint): [Vec2, Vec2] | null => {
    if (c.axis === 'x') {
      return [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ]
    }
    if (c.axis === 'y') {
      return [
        { x: 0, y: 0 },
        { x: 0, y: 1 },
      ]
    }
    if (c.segmentId) {
      const seg = coord.segments.find((s) => s.id === c.segmentId)
      if (seg) {
        const a = seg.fromId ? positions[seg.fromId] : seg.from ? { x: seg.from[0], y: seg.from[1] } : null
        const b = seg.toId ? positions[seg.toId] : seg.to ? { x: seg.to[0], y: seg.to[1] } : null
        if (a && b) {
          return [a, b]
        }
      }
    }
    if (c.fromId && c.toId && positions[c.fromId] && positions[c.toId]) {
      return [positions[c.fromId], positions[c.toId]]
    }
    if (c.pointIds && c.pointIds.length >= 2 && positions[c.pointIds[0]] && positions[c.pointIds[1]]) {
      return [positions[c.pointIds[0]], positions[c.pointIds[1]]]
    }
    return null
  }

  const projectDistancePair = (idA: string, idB: string, targetLen: number, c: CoordConstraint) => {
    const a = positions[idA]
    const b = positions[idB]
    if (!a || !b || targetLen < 0) {
      return
    }
    const wA = getWeight(idA, c, [idA, idB])
    const wB = getWeight(idB, c, [idA, idB])
    const wSum = wA + wB
    if (wSum < EPS) {
      return
    }
    let dx = b.x - a.x
    let dy = b.y - a.y
    let d = Math.hypot(dx, dy)
    if (d < 1e-8) {
      dx = 1
      dy = 0
      d = 1
    }
    const diff = (d - targetLen) / d
    if (wA > 0) {
      a.x += dx * diff * (wA / wSum)
      a.y += dy * diff * (wA / wSum)
      markTouched(idA)
    }
    if (wB > 0) {
      b.x -= dx * diff * (wB / wSum)
      b.y -= dy * diff * (wB / wSum)
      markTouched(idB)
    }
  }

  // 通用数值梯度投影（用于垂直、平行、定角、定面积、通用代数方程等）
  const projectScalarConstraint = (
    ids: string[],
    c: CoordConstraint,
    evalResidual: () => number,
    damping = 0.85
  ) => {
    const uniqueIds = Array.from(new Set(ids))
    const weights = uniqueIds.map((id) => getWeight(id, c, uniqueIds))
    if (weights.every((w) => w < EPS)) {
      return
    }
    const f0 = evalResidual()
    if (!Number.isFinite(f0) || Math.abs(f0) < 1e-7) {
      return
    }
    const h = 1e-4
    const grads: { gx: number; gy: number }[] = []
    let weightedGradSq = 0
    for (let i = 0; i < uniqueIds.length; i += 1) {
      const w = weights[i]
      if (w < EPS) {
        grads.push({ gx: 0, gy: 0 })
        continue
      }
      const pt = positions[uniqueIds[i]]
      const ox = pt.x
      const oy = pt.y
      pt.x = ox + h
      const fpx = evalResidual()
      pt.x = ox - h
      const fmx = evalResidual()
      pt.x = ox
      pt.y = oy + h
      const fpy = evalResidual()
      pt.y = oy - h
      const fmy = evalResidual()
      pt.y = oy
      const gx = Number.isFinite(fpx) && Number.isFinite(fmx) ? (fpx - fmx) / (2 * h) : 0
      const gy = Number.isFinite(fpy) && Number.isFinite(fmy) ? (fpy - fmy) / (2 * h) : 0
      grads.push({ gx, gy })
      weightedGradSq += w * (gx * gx + gy * gy)
    }
    if (weightedGradSq < 1e-10) {
      return
    }
    const lambda = (-damping * f0) / (weightedGradSq + 1e-6)
    for (let i = 0; i < uniqueIds.length; i += 1) {
      const w = weights[i]
      if (w < EPS) {
        continue
      }
      const pt = positions[uniqueIds[i]]
      const stepX = Math.max(-2.5, Math.min(2.5, lambda * w * grads[i].gx))
      const stepY = Math.max(-2.5, Math.min(2.5, lambda * w * grads[i].gy))
      pt.x += stepX
      pt.y += stepY
      markTouched(uniqueIds[i])
    }
  }

  // 把受约束的 1D 动点重新贴回其自身路径（使多约束+路径联动，如梯子滑墙）
  const enforceMovingPointPaths = () => {
    const resolveCtx: ResolveContext = {
      coord,
      tValues,
      params,
      overrides: positions,
    }
    for (const mp of coord.movingPoints) {
      if (mp.path.type === 'free') {
        const pt = positions[mp.id]
        if (pt && mp.path.bounds) {
          if (mp.path.bounds.xMin !== undefined) {
            pt.x = Math.max(mp.path.bounds.xMin, pt.x)
          }
          if (mp.path.bounds.xMax !== undefined) {
            pt.x = Math.min(mp.path.bounds.xMax, pt.x)
          }
          if (mp.path.bounds.yMin !== undefined) {
            pt.y = Math.max(mp.path.bounds.yMin, pt.y)
          }
          if (mp.path.bounds.yMax !== undefined) {
            pt.y = Math.min(mp.path.bounds.yMax, pt.y)
          }
        }
        continue
      }
      if (!touchedIds.has(mp.id)) {
        continue
      }
      const pt = positions[mp.id]
      if (!pt) {
        continue
      }
      const proj = projectWorldToMovingPoint(resolveCtx, mp, pt.x, pt.y)
      if (proj.t !== undefined) {
        const snapped = evalMovingPointRaw(resolveCtx, mp, proj.t)
        if (snapped) {
          pt.x = snapped.x
          pt.y = snapped.y
        }
      }
    }
  }

  const applyOneConstraint = (c: CoordConstraint) => {
    switch (c.kind) {
      case 'fixed_length': {
        const pair = resolvePairFromConstraint(coord, c, 0)
        if (!pair) {
          return
        }
        const target = evalNumericTarget(c.value, c.expr, params, positions, 1)
        projectDistancePair(pair[0], pair[1], Math.max(0, target), c)
        return
      }

      case 'equal_length': {
        const p1 = resolvePairFromConstraint(coord, c, 0)
        const p2 = resolvePairFromConstraint(coord, c, 1)
        if (!p1 || !p2) {
          return
        }
        const a1 = positions[p1[0]]
        const b1 = positions[p1[1]]
        const a2 = positions[p2[0]]
        const b2 = positions[p2[1]]
        if (!a1 || !b1 || !a2 || !b2) {
          return
        }
        const allIds = [p1[0], p1[1], p2[0], p2[1]]
        projectScalarConstraint(allIds, c, () => vecDist(a1, b1) - vecDist(a2, b2), 0.9)
        return
      }

      case 'length_ratio': {
        const p1 = resolvePairFromConstraint(coord, c, 0)
        const p2 = resolvePairFromConstraint(coord, c, 1)
        if (!p1 || !p2) {
          return
        }
        const a1 = positions[p1[0]]
        const b1 = positions[p1[1]]
        const a2 = positions[p2[0]]
        const b2 = positions[p2[1]]
        if (!a1 || !b1 || !a2 || !b2) {
          return
        }
        const ratio = evalNumericTarget(c.ratio ?? c.value, c.expr, params, positions, 1)
        const allIds = [p1[0], p1[1], p2[0], p2[1]]
        projectScalarConstraint(allIds, c, () => vecDist(a1, b1) - ratio * vecDist(a2, b2), 0.85)
        return
      }

      case 'perpendicular': {
        let p1 = resolvePairFromConstraint(coord, c, 0)
        let p2 = resolvePairFromConstraint(coord, c, 1)
        if (c.pointIds && c.pointIds.length === 3 && !c.pairs && !c.segmentIds) {
          p1 = [c.pointIds[1], c.pointIds[0]]
          p2 = [c.pointIds[1], c.pointIds[2]]
        }
        if (!p1 || !p2) {
          return
        }
        const a1 = positions[p1[0]]
        const b1 = positions[p1[1]]
        const a2 = positions[p2[0]]
        const b2 = positions[p2[1]]
        if (!a1 || !b1 || !a2 || !b2) {
          return
        }
        const allIds = [p1[0], p1[1], p2[0], p2[1]]
        projectScalarConstraint(
          allIds,
          c,
          () => {
            const v1x = b1.x - a1.x
            const v1y = b1.y - a1.y
            const v2x = b2.x - a2.x
            const v2y = b2.y - a2.y
            const norm = Math.max(0.25, Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y))
            return (v1x * v2x + v1y * v2y) / norm
          },
          0.9
        )
        return
      }

      case 'parallel': {
        const p1 = resolvePairFromConstraint(coord, c, 0)
        const p2 = resolvePairFromConstraint(coord, c, 1)
        if (!p1 || !p2) {
          return
        }
        const a1 = positions[p1[0]]
        const b1 = positions[p1[1]]
        const a2 = positions[p2[0]]
        const b2 = positions[p2[1]]
        if (!a1 || !b1 || !a2 || !b2) {
          return
        }
        const allIds = [p1[0], p1[1], p2[0], p2[1]]
        projectScalarConstraint(
          allIds,
          c,
          () => {
            const v1x = b1.x - a1.x
            const v1y = b1.y - a1.y
            const v2x = b2.x - a2.x
            const v2y = b2.y - a2.y
            const norm = Math.max(0.25, Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y))
            return (v1x * v2y - v1y * v2x) / norm
          },
          0.9
        )
        return
      }

      case 'fixed_angle': {
        const ids = c.pointIds
        if (!ids || ids.length < 3) {
          return
        }
        const a = positions[ids[0]]
        const b = positions[ids[1]]
        const d = positions[ids[2]]
        if (!a || !b || !d) {
          return
        }
        const targetDeg = evalNumericTarget(c.angleDeg ?? c.value, c.expr, params, positions, 90)
        const targetCos = Math.cos((targetDeg * Math.PI) / 180)
        projectScalarConstraint(
          ids.slice(0, 3),
          c,
          () => {
            const v1x = a.x - b.x
            const v1y = a.y - b.y
            const v2x = d.x - b.x
            const v2y = d.y - b.y
            const l1 = Math.hypot(v1x, v1y)
            const l2 = Math.hypot(v2x, v2y)
            if (l1 < 1e-6 || l2 < 1e-6) {
              return 0
            }
            return (v1x * v2x + v1y * v2y) / (l1 * l2) - targetCos
          },
          0.8
        )
        return
      }

      case 'collinear': {
        const ids = c.pointIds
        if (!ids || ids.length < 3) {
          return
        }
        const a = positions[ids[0]]
        const b = positions[ids[1]]
        const d = positions[ids[2]]
        if (!a || !b || !d) {
          return
        }
        projectScalarConstraint(
          ids.slice(0, 3),
          c,
          () => {
            const base = Math.max(0.25, vecDist(a, b))
            return ((b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x)) / base
          },
          0.9
        )
        return
      }

      case 'on_line':
      case 'on_segment': {
        const pid = c.pointId ?? c.targets?.[0]
        if (!pid || !positions[pid]) {
          return
        }
        const line = resolveConstraintLine(c)
        if (!line) {
          return
        }
        const w = getWeight(pid, c, [pid])
        if (w < EPS) {
          return
        }
        const pt = positions[pid]
        const projected =
          c.kind === 'on_segment'
            ? projectOntoSegment(pt, line[0], line[1]).point
            : projectOntoLine(pt, line[0], line[1])
        pt.x = projected.x
        pt.y = projected.y
        markTouched(pid)
        return
      }

      case 'on_circle': {
        const pid = c.pointId ?? c.targets?.[0]
        if (!pid || !positions[pid]) {
          return
        }
        const w = getWeight(pid, c, [pid])
        if (w < EPS) {
          return
        }
        let center: Vec2 | null = null
        let radius = c.radius ?? c.value ?? 0
        if (c.circleId) {
          const circ = coord.circles.find((item) => item.id === c.circleId)
          if (circ) {
            const resolved = resolveCircleParams(
              { coord, tValues, params, overrides: positions },
              circ
            )
            if (resolved) {
              center = resolved.center
              radius = resolved.radius
            }
          }
        }
        if (!center && c.centerId && positions[c.centerId]) {
          center = positions[c.centerId]
        }
        if (c.expr) {
          radius = evalNumericTarget(radius, c.expr, params, positions, radius)
        }
        if (!center || radius <= 0) {
          return
        }
        const pt = positions[pid]
        let dx = pt.x - center.x
        let dy = pt.y - center.y
        let d = Math.hypot(dx, dy)
        if (d < 1e-8) {
          dx = 1
          dy = 0
          d = 1
        }
        pt.x = center.x + (dx / d) * radius
        pt.y = center.y + (dy / d) * radius
        markTouched(pid)
        return
      }

      case 'on_function': {
        const pid = c.pointId ?? c.targets?.[0]
        if (!pid || !positions[pid]) {
          return
        }
        const w = getWeight(pid, c, [pid])
        if (w < EPS) {
          return
        }
        let expr = c.expr ?? ''
        if (c.functionId) {
          const fn = coord.functions.find((f) => f.id === c.functionId)
          if (fn?.expr) {
            expr = fn.expr
          }
        }
        const compiled = compileMathExpr(expr)
        if (!compiled) {
          return
        }
        const pt = positions[pid]
        const y = compiled({ ...params, x: pt.x, t: pt.x }, positions)
        if (Number.isFinite(y)) {
          pt.y = y
          markTouched(pid)
        }
        return
      }

      case 'midpoint': {
        const pid = c.pointId ?? c.targets?.[0]
        const fromId = c.fromId ?? c.pointIds?.[0]
        const toId = c.toId ?? c.pointIds?.[1]
        if (!pid || !fromId || !toId || !positions[pid] || !positions[fromId] || !positions[toId]) {
          return
        }
        const ratio = evalNumericTarget(c.ratio, c.expr, params, positions, 0.5)
        const w = getWeight(pid, c, [pid, fromId, toId])
        if (w > EPS) {
          const a = positions[fromId]
          const b = positions[toId]
          positions[pid].x = a.x + (b.x - a.x) * ratio
          positions[pid].y = a.y + (b.y - a.y) * ratio
          markTouched(pid)
        }
        return
      }

      case 'symmetric': {
        const pid = c.pointId ?? c.targets?.[0]
        const srcId = c.sourceId ?? c.pointIds?.[0]
        if (!pid || !srcId || !positions[pid] || !positions[srcId]) {
          return
        }
        const w = getWeight(pid, c, [pid, srcId])
        if (w < EPS) {
          return
        }
        const src = positions[srcId]
        if (c.centerId && positions[c.centerId]) {
          const ctr = positions[c.centerId]
          positions[pid].x = 2 * ctr.x - src.x
          positions[pid].y = 2 * ctr.y - src.y
          markTouched(pid)
          return
        }
        const line = resolveConstraintLine(c)
        if (line) {
          const mir = reflectPointAcrossLine(src, line[0], line[1])
          positions[pid].x = mir.x
          positions[pid].y = mir.y
          markTouched(pid)
        }
        return
      }

      case 'fixed_area': {
        const ids = c.pointIds
        if (!ids || ids.length < 3) {
          return
        }
        const pts = ids.map((id) => positions[id]).filter((p): p is Vec2 => Boolean(p))
        if (pts.length < 3) {
          return
        }
        const target = evalNumericTarget(c.value, c.expr, params, positions, 4)
        projectScalarConstraint(ids, c, () => computePolygonArea(pts) - target, 0.85)
        return
      }

      case 'bounds': {
        const pid = c.pointId ?? c.targets?.[0]
        if (!pid || !positions[pid]) {
          return
        }
        const pt = positions[pid]
        if (c.xMin !== undefined && pt.x < c.xMin) {
          pt.x = c.xMin
          markTouched(pid)
        }
        if (c.xMax !== undefined && pt.x > c.xMax) {
          pt.x = c.xMax
          markTouched(pid)
        }
        if (c.yMin !== undefined && pt.y < c.yMin) {
          pt.y = c.yMin
          markTouched(pid)
        }
        if (c.yMax !== undefined && pt.y > c.yMax) {
          pt.y = c.yMax
          markTouched(pid)
        }
        return
      }

      case 'custom_equation': {
        if (!c.expr?.trim()) {
          return
        }
        const expr = c.expr
        const involved =
          c.targets && c.targets.length > 0
            ? c.targets
            : c.pointIds && c.pointIds.length > 0
              ? c.pointIds
              : coord.movingPoints.map((mp) => mp.id)
        projectScalarConstraint(
          involved,
          c,
          () => evalEquationResidual(expr, params, positions),
          0.75
        )
        return
      }

      case 'on_polyline': {
        const pid = c.pointId ?? c.targets?.[0]
        if (!pid || !positions[pid] || !c.pointIds || c.pointIds.length < 2) {
          return
        }
        const w = getWeight(pid, c, [pid])
        if (w < EPS) {
          return
        }
        const verts = c.pointIds.map((id) => positions[id]).filter((p): p is Vec2 => Boolean(p))
        if (verts.length < 2) {
          return
        }
        const pt = positions[pid]
        let best = verts[0]
        let bestD = Infinity
        for (let i = 0; i < verts.length - 1; i += 1) {
          const proj = projectOntoSegment(pt, verts[i], verts[i + 1]).point
          const d = vecDist(pt, proj)
          if (d < bestD) {
            bestD = d
            best = proj
          }
        }
        pt.x = best.x
        pt.y = best.y
        markTouched(pid)
      }
    }
  }

  // 计算单条约束的当前绝对误差（用于状态展示与提前收敛退出）
  const evaluateConstraintError = (c: CoordConstraint): number => {
    switch (c.kind) {
      case 'fixed_length': {
        const pair = resolvePairFromConstraint(coord, c, 0)
        if (!pair || !positions[pair[0]] || !positions[pair[1]]) {
          return 0
        }
        const target = evalNumericTarget(c.value, c.expr, params, positions, 1)
        return Math.abs(vecDist(positions[pair[0]], positions[pair[1]]) - target)
      }
      case 'equal_length': {
        const p1 = resolvePairFromConstraint(coord, c, 0)
        const p2 = resolvePairFromConstraint(coord, c, 1)
        if (!p1 || !p2 || !positions[p1[0]] || !positions[p1[1]] || !positions[p2[0]] || !positions[p2[1]]) {
          return 0
        }
        return Math.abs(vecDist(positions[p1[0]], positions[p1[1]]) - vecDist(positions[p2[0]], positions[p2[1]]))
      }
      case 'length_ratio': {
        const p1 = resolvePairFromConstraint(coord, c, 0)
        const p2 = resolvePairFromConstraint(coord, c, 1)
        if (!p1 || !p2 || !positions[p1[0]] || !positions[p1[1]] || !positions[p2[0]] || !positions[p2[1]]) {
          return 0
        }
        const ratio = evalNumericTarget(c.ratio ?? c.value, c.expr, params, positions, 1)
        return Math.abs(vecDist(positions[p1[0]], positions[p1[1]]) - ratio * vecDist(positions[p2[0]], positions[p2[1]]))
      }
      case 'perpendicular': {
        let p1 = resolvePairFromConstraint(coord, c, 0)
        let p2 = resolvePairFromConstraint(coord, c, 1)
        if (c.pointIds && c.pointIds.length === 3 && !c.pairs && !c.segmentIds) {
          p1 = [c.pointIds[1], c.pointIds[0]]
          p2 = [c.pointIds[1], c.pointIds[2]]
        }
        if (!p1 || !p2 || !positions[p1[0]] || !positions[p1[1]] || !positions[p2[0]] || !positions[p2[1]]) {
          return 0
        }
        const a1 = positions[p1[0]]
        const b1 = positions[p1[1]]
        const a2 = positions[p2[0]]
        const b2 = positions[p2[1]]
        const l1 = vecDist(a1, b1)
        const l2 = vecDist(a2, b2)
        if (l1 < 1e-6 || l2 < 1e-6) {
          return 0
        }
        return Math.abs(((b1.x - a1.x) * (b2.x - a2.x) + (b1.y - a1.y) * (b2.y - a2.y)) / (l1 * l2))
      }
      case 'parallel': {
        const p1 = resolvePairFromConstraint(coord, c, 0)
        const p2 = resolvePairFromConstraint(coord, c, 1)
        if (!p1 || !p2 || !positions[p1[0]] || !positions[p1[1]] || !positions[p2[0]] || !positions[p2[1]]) {
          return 0
        }
        const a1 = positions[p1[0]]
        const b1 = positions[p1[1]]
        const a2 = positions[p2[0]]
        const b2 = positions[p2[1]]
        const l1 = vecDist(a1, b1)
        const l2 = vecDist(a2, b2)
        if (l1 < 1e-6 || l2 < 1e-6) {
          return 0
        }
        return Math.abs(((b1.x - a1.x) * (b2.y - a2.y) - (b1.y - a1.y) * (b2.x - a2.x)) / (l1 * l2))
      }
      case 'fixed_angle': {
        const ids = c.pointIds
        if (!ids || ids.length < 3 || !positions[ids[0]] || !positions[ids[1]] || !positions[ids[2]]) {
          return 0
        }
        const targetDeg = evalNumericTarget(c.angleDeg ?? c.value, c.expr, params, positions, 90)
        const actual = computeAngleDeg(positions[ids[0]], positions[ids[1]], positions[ids[2]])
        return Number.isFinite(actual) ? Math.abs(actual - targetDeg) / 90 : 0
      }
      case 'collinear': {
        const ids = c.pointIds
        if (!ids || ids.length < 3 || !positions[ids[0]] || !positions[ids[1]] || !positions[ids[2]]) {
          return 0
        }
        const a = positions[ids[0]]
        const b = positions[ids[1]]
        const d = positions[ids[2]]
        const base = Math.max(0.25, vecDist(a, b))
        return Math.abs((b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x)) / base
      }
      case 'on_line':
      case 'on_segment': {
        const pid = c.pointId ?? c.targets?.[0]
        const line = resolveConstraintLine(c)
        if (!pid || !positions[pid] || !line) {
          return 0
        }
        const proj =
          c.kind === 'on_segment'
            ? projectOntoSegment(positions[pid], line[0], line[1]).point
            : projectOntoLine(positions[pid], line[0], line[1])
        return vecDist(positions[pid], proj)
      }
      case 'on_circle': {
        const pid = c.pointId ?? c.targets?.[0]
        if (!pid || !positions[pid]) {
          return 0
        }
        let center: Vec2 | null = null
        let radius = c.radius ?? c.value ?? 0
        if (c.circleId) {
          const circ = coord.circles.find((item) => item.id === c.circleId)
          if (circ) {
            const resolved = resolveCircleParams(
              { coord, tValues, params, overrides: positions },
              circ
            )
            if (resolved) {
              center = resolved.center
              radius = resolved.radius
            }
          }
        }
        if (!center && c.centerId && positions[c.centerId]) {
          center = positions[c.centerId]
        }
        if (!center) {
          return 0
        }
        return Math.abs(vecDist(positions[pid], center) - radius)
      }
      case 'on_function': {
        const pid = c.pointId ?? c.targets?.[0]
        if (!pid || !positions[pid]) {
          return 0
        }
        let expr = c.expr ?? ''
        if (c.functionId) {
          const fn = coord.functions.find((f) => f.id === c.functionId)
          if (fn?.expr) {
            expr = fn.expr
          }
        }
        const y = evalMathExpr(expr, { ...params, x: positions[pid].x, t: positions[pid].x }, positions)
        return Number.isFinite(y) ? Math.abs(positions[pid].y - y) : 0
      }
      case 'midpoint': {
        const pid = c.pointId ?? c.targets?.[0]
        const fromId = c.fromId ?? c.pointIds?.[0]
        const toId = c.toId ?? c.pointIds?.[1]
        if (!pid || !fromId || !toId || !positions[pid] || !positions[fromId] || !positions[toId]) {
          return 0
        }
        const ratio = evalNumericTarget(c.ratio, c.expr, params, positions, 0.5)
        const mx = positions[fromId].x + (positions[toId].x - positions[fromId].x) * ratio
        const my = positions[fromId].y + (positions[toId].y - positions[fromId].y) * ratio
        return Math.hypot(positions[pid].x - mx, positions[pid].y - my)
      }
      case 'symmetric': {
        const pid = c.pointId ?? c.targets?.[0]
        const srcId = c.sourceId ?? c.pointIds?.[0]
        if (!pid || !srcId || !positions[pid] || !positions[srcId]) {
          return 0
        }
        if (c.centerId && positions[c.centerId]) {
          const ctr = positions[c.centerId]
          return Math.hypot(
            positions[pid].x - (2 * ctr.x - positions[srcId].x),
            positions[pid].y - (2 * ctr.y - positions[srcId].y)
          )
        }
        const line = resolveConstraintLine(c)
        if (!line) {
          return 0
        }
        const mir = reflectPointAcrossLine(positions[srcId], line[0], line[1])
        return vecDist(positions[pid], mir)
      }
      case 'fixed_area': {
        const ids = c.pointIds
        if (!ids || ids.length < 3) {
          return 0
        }
        const pts = ids.map((id) => positions[id]).filter((p): p is Vec2 => Boolean(p))
        if (pts.length < 3) {
          return 0
        }
        const target = evalNumericTarget(c.value, c.expr, params, positions, 4)
        return Math.abs(computePolygonArea(pts) - target)
      }
      case 'bounds': {
        const pid = c.pointId ?? c.targets?.[0]
        if (!pid || !positions[pid]) {
          return 0
        }
        const pt = positions[pid]
        let err = 0
        if (c.xMin !== undefined && pt.x < c.xMin) {
          err += c.xMin - pt.x
        }
        if (c.xMax !== undefined && pt.x > c.xMax) {
          err += pt.x - c.xMax
        }
        if (c.yMin !== undefined && pt.y < c.yMin) {
          err += c.yMin - pt.y
        }
        if (c.yMax !== undefined && pt.y > c.yMax) {
          err += pt.y - c.yMax
        }
        return err
      }
      case 'custom_equation': {
        if (!c.expr?.trim()) {
          return 0
        }
        const res = evalEquationResidual(c.expr, params, positions)
        return Number.isFinite(res) ? Math.abs(res) : 1
      }
      case 'on_polyline': {
        const pid = c.pointId ?? c.targets?.[0]
        if (!pid || !positions[pid] || !c.pointIds || c.pointIds.length < 2) {
          return 0
        }
        const verts = c.pointIds.map((id) => positions[id]).filter((p): p is Vec2 => Boolean(p))
        let bestD = Infinity
        for (let i = 0; i < verts.length - 1; i += 1) {
          const proj = projectOntoSegment(positions[pid], verts[i], verts[i + 1]).point
          bestD = Math.min(bestD, vecDist(positions[pid], proj))
        }
        return Number.isFinite(bestD) ? bestD : 0
      }
    }
  }

  // 两阶段 Gauss-Seidel 迭代求解：
  // 阶段 1：严格固定用户拖动点，移动其余受约束点；
  // 阶段 2：若阶段 1 仍无法满足（如拖出定长可达范围），再柔和拉回拖动点
  if (activeConstraints.length > 0) {
    const computeMaxErr = () => {
      let maxErr = 0
      for (const c of activeConstraints) {
        maxErr = Math.max(maxErr, evaluateConstraintError(c))
      }
      return maxErr
    }

    for (let iter = 0; iter < 32; iter += 1) {
      for (const c of activeConstraints) {
        applyOneConstraint(c)
      }
      enforceMovingPointPaths()
      if (iter >= 4 && iter % 4 === 0 && computeMaxErr() < 1e-5) {
        break
      }
    }

    if (computeMaxErr() > 1e-3) {
      allowDraggedYield = true
      for (let iter = 0; iter < 24; iter += 1) {
        for (const c of activeConstraints) {
          applyOneConstraint(c)
        }
        enforceMovingPointPaths()
        if (iter >= 4 && iter % 4 === 0 && computeMaxErr() < 1e-5) {
          break
        }
      }
    }
  }

  const solvedPositions: Record<string, Vec2> = {}
  const solvedT: Record<string, number> = {}
  const resolveCtx: ResolveContext = {
    coord,
    tValues,
    params,
    overrides: positions,
  }

  for (const id of touchedIds) {
    if (positions[id]) {
      solvedPositions[id] = { x: positions[id].x, y: positions[id].y }
      const mp = movingMap.get(id)
      if (mp && mp.path.type !== 'free') {
        const proj = projectWorldToMovingPoint(resolveCtx, mp, positions[id].x, positions[id].y)
        if (proj.t !== undefined && Number.isFinite(proj.t)) {
          solvedT[id] = proj.t
        }
      }
    }
  }

  const statuses: ConstraintStatus[] = coord.constraints.map((c) => {
    const enabled = c.enabled && !disabledConstraintIds[c.id]
    const error = enabled ? evaluateConstraintError(c) : 0
    return {
      id: c.id,
      label: c.label,
      enabled,
      error,
      satisfied: !enabled || error < 0.035,
    }
  })

  return { solvedPositions, solvedT, statuses }
}
