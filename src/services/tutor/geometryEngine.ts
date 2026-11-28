import { compileMathExpr, evalMathExpr, type PointLookup } from './mathEval.js'
import type {
  CoordAuxiliaryLine,
  CoordCircle,
  CoordDerivedPoint,
  CoordMovingPoint,
  CoordinateState,
  CoordSegment,
  UserCoordPoint,
} from './types.js'

export type Vec2 = { x: number; y: number }

export type ResolvedAuxiliaryGeometry = {
  from: Vec2
  to: Vec2
  derivedPoint?: Vec2
  /** 若需绘制直角符号，提供垂足和两条单位方向向量 */
  rightAngle?: {
    vertex: Vec2
    u: Vec2
    v: Vec2
  }
}

export const vecDist = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y)

export const projectOntoLine = (p: Vec2, a: Vec2, b: Vec2): Vec2 => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-12) {
    return { x: a.x, y: a.y }
  }
  const proj = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  return { x: a.x + proj * dx, y: a.y + proj * dy }
}

export const projectOntoSegment = (p: Vec2, a: Vec2, b: Vec2): { point: Vec2; ratio: number } => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-12) {
    return { point: { x: a.x, y: a.y }, ratio: 0 }
  }
  const ratio = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq))
  return { point: { x: a.x + ratio * dx, y: a.y + ratio * dy }, ratio }
}

export const reflectPointAcrossLine = (p: Vec2, a: Vec2, b: Vec2): Vec2 => {
  const foot = projectOntoLine(p, a, b)
  return { x: 2 * foot.x - p.x, y: 2 * foot.y - p.y }
}

export const rotatePointAround = (p: Vec2, center: Vec2, angleDeg: number): Vec2 => {
  const rad = (angleDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = p.x - center.x
  const dy = p.y - center.y
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  }
}

export const computePolygonArea = (points: Vec2[]): number => {
  if (points.length < 3) {
    return 0
  }
  let sum = 0
  for (let i = 0; i < points.length; i += 1) {
    const next = points[(i + 1) % points.length]
    sum += points[i].x * next.y - next.x * points[i].y
  }
  return Math.abs(sum) * 0.5
}

export const computePolygonPerimeter = (points: Vec2[]): number => {
  if (points.length < 2) {
    return 0
  }
  let total = 0
  for (let i = 0; i < points.length; i += 1) {
    const next = points[(i + 1) % points.length]
    total += vecDist(points[i], next)
  }
  return total
}

/** 计算 ∠ABC 的度数（0 ~ 180） */
export const computeAngleDeg = (a: Vec2, vertex: Vec2, c: Vec2): number => {
  const v1x = a.x - vertex.x
  const v1y = a.y - vertex.y
  const v2x = c.x - vertex.x
  const v2y = c.y - vertex.y
  const l1 = Math.hypot(v1x, v1y)
  const l2 = Math.hypot(v2x, v2y)
  if (l1 < 1e-9 || l2 < 1e-9) {
    return Number.NaN
  }
  const cosVal = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)))
  return (Math.acos(cosVal) * 180) / Math.PI
}

export const intersectLines = (a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null => {
  const x1 = a.x
  const y1 = a.y
  const x2 = b.x
  const y2 = b.y
  const x3 = c.x
  const y3 = c.y
  const x4 = d.x
  const y4 = d.y
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
  if (Math.abs(denom) < 1e-10) {
    return null
  }
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom
  return {
    x: x1 + t * (x2 - x1),
    y: y1 + t * (y2 - y1),
  }
}

export const intersectLineCircle = (a: Vec2, b: Vec2, center: Vec2, radius: number): Vec2[] => {
  if (radius < 0) {
    return []
  }
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-12) {
    return []
  }
  const fx = a.x - center.x
  const fy = a.y - center.y
  const B = 2 * (fx * dx + fy * dy)
  const C = fx * fx + fy * fy - radius * radius
  const disc = B * B - 4 * lenSq * C
  if (disc < -1e-7) {
    return []
  }
  const sqrtDisc = Math.sqrt(Math.max(0, disc))
  const t1 = (-B - sqrtDisc) / (2 * lenSq)
  const t2 = (-B + sqrtDisc) / (2 * lenSq)
  const p1 = { x: a.x + t1 * dx, y: a.y + t1 * dy }
  if (Math.abs(t2 - t1) < 1e-6) {
    return [p1]
  }
  const p2 = { x: a.x + t2 * dx, y: a.y + t2 * dy }
  return [p1, p2]
}

export const intersectCircles = (c1: Vec2, r1: number, c2: Vec2, r2: number): Vec2[] => {
  const dx = c2.x - c1.x
  const dy = c2.y - c1.y
  const d = Math.hypot(dx, dy)
  if (d < 1e-9 || d > r1 + r2 + 1e-6 || d < Math.abs(r1 - r2) - 1e-6) {
    return []
  }
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d)
  const hSq = r1 * r1 - a * a
  const h = Math.sqrt(Math.max(0, hSq))
  const xm = c1.x + (a * dx) / d
  const ym = c1.y + (a * dy) / d
  if (h < 1e-6) {
    return [{ x: xm, y: ym }]
  }
  const rx = (-dy * h) / d
  const ry = (dx * h) / d
  return [
    { x: xm + rx, y: ym + ry },
    { x: xm - rx, y: ym - ry },
  ]
}

export const computeTriangleCenter = (
  kind: 'centroid' | 'circumcenter' | 'incenter' | 'orthocenter',
  a: Vec2,
  b: Vec2,
  c: Vec2
): Vec2 | null => {
  if (kind === 'centroid') {
    return { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 }
  }
  if (kind === 'incenter') {
    const la = vecDist(b, c)
    const lb = vecDist(a, c)
    const lc = vecDist(a, b)
    const p = la + lb + lc
    if (p < 1e-9) {
      return null
    }
    return {
      x: (la * a.x + lb * b.x + lc * c.x) / p,
      y: (la * a.y + lb * b.y + lc * c.y) / p,
    }
  }
  if (kind === 'circumcenter') {
    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y))
    if (Math.abs(d) < 1e-9) {
      return null
    }
    const a2 = a.x * a.x + a.y * a.y
    const b2 = b.x * b.x + b.y * b.y
    const c2 = c.x * c.x + c.y * c.y
    return {
      x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d,
      y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d,
    }
  }
  // orthocenter: intersection of altitude from A to BC and altitude from B to AC
  const footA = projectOntoLine(a, b, c)
  const footB = projectOntoLine(b, a, c)
  return intersectLines(a, footA, b, footB)
}

/** 构造滑块参数字典（合并默认值与实时值） */
export const buildParamMap = (
  coord: CoordinateState,
  paramValues?: Record<string, number>
): Record<string, number> => {
  const vars: Record<string, number> = {}
  for (const s of coord.sliders) {
    vars[s.id] = paramValues && Object.hasOwn(paramValues, s.id) ? paramValues[s.id] : s.initialValue
  }
  if (paramValues) {
    for (const [k, v] of Object.entries(paramValues)) {
      if (Number.isFinite(v)) {
        vars[k] = v
      }
    }
  }
  return vars
}

export type ResolveContext = {
  coord: CoordinateState
  tValues: Record<string, number>
  params: Record<string, number>
  /** 被用户拖拽、脚本写入或约束求解器覆盖的精确坐标 */
  overrides?: Record<string, Vec2>
  userPoints?: UserCoordPoint[]
}

const getPolylineVertices = (
  ctx: ResolveContext,
  vertexIds: string[] | undefined,
  rawPoints: [number, number][] | undefined,
  closed: boolean,
  visited: Set<string>
): Vec2[] => {
  const verts: Vec2[] = []
  if (vertexIds && vertexIds.length > 0) {
    for (const vid of vertexIds) {
      const p = resolvePointInContext(ctx, vid, visited)
      if (p) {
        verts.push(p)
      }
    }
  } else if (rawPoints && rawPoints.length > 0) {
    for (const [x, y] of rawPoints) {
      verts.push({ x, y })
    }
  }
  if (closed && verts.length >= 2) {
    verts.push(verts[0])
  }
  return verts
}

export const samplePolylineAtRatio = (verts: Vec2[], ratio: number): Vec2 | null => {
  if (verts.length === 0) {
    return null
  }
  if (verts.length === 1) {
    return verts[0]
  }
  const segLens: number[] = []
  let totalLen = 0
  for (let i = 0; i < verts.length - 1; i += 1) {
    const l = vecDist(verts[i], verts[i + 1])
    segLens.push(l)
    totalLen += l
  }
  if (totalLen < 1e-9) {
    return verts[0]
  }
  const clamped = Math.max(0, Math.min(1, ratio))
  let target = clamped * totalLen
  for (let i = 0; i < segLens.length; i += 1) {
    const l = segLens[i]
    if (target <= l || i === segLens.length - 1) {
      const local = l < 1e-9 ? 0 : Math.max(0, Math.min(1, target / l))
      return {
        x: verts[i].x + (verts[i + 1].x - verts[i].x) * local,
        y: verts[i].y + (verts[i + 1].y - verts[i].y) * local,
      }
    }
    target -= l
  }
  return verts[verts.length - 1]
}

export const resolveSegmentEndpoints = (
  ctx: ResolveContext,
  seg: CoordSegment,
  visited: Set<string> = new Set()
): [Vec2, Vec2] | null => {
  const a = seg.fromId
    ? resolvePointInContext(ctx, seg.fromId, visited)
    : seg.from
      ? { x: seg.from[0], y: seg.from[1] }
      : null
  const b = seg.toId
    ? resolvePointInContext(ctx, seg.toId, visited)
    : seg.to
      ? { x: seg.to[0], y: seg.to[1] }
      : null
  return a && b ? [a, b] : null
}

export const resolveCircleParams = (
  ctx: ResolveContext,
  circle: CoordCircle,
  visited: Set<string> = new Set()
): { center: Vec2; radius: number } | null => {
  const center = resolvePointInContext(ctx, circle.centerId, visited)
  if (!center) {
    return null
  }
  let radius = circle.radius ?? 0
  if (circle.radiusPointId) {
    const rp = resolvePointInContext(ctx, circle.radiusPointId, visited)
    if (rp) {
      radius = vecDist(center, rp)
    }
  } else if (circle.radiusExpr) {
    const r = evalMathExpr(circle.radiusExpr, ctx.params, ctx.overrides)
    if (Number.isFinite(r) && r >= 0) {
      radius = r
    }
  }
  return radius > 0 ? { center, radius } : null
}

const resolveLinePairFromSpec = (
  ctx: ResolveContext,
  spec: {
    axis?: 'x' | 'y'
    targetSegmentId?: string
    targetLineFromId?: string
    targetLineToId?: string
  },
  visited: Set<string>
): [Vec2, Vec2] | null => {
  if (spec.axis === 'x') {
    return [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]
  }
  if (spec.axis === 'y') {
    return [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
    ]
  }
  if (spec.targetSegmentId) {
    const seg = ctx.coord.segments.find((s) => s.id === spec.targetSegmentId)
    if (seg) {
      return resolveSegmentEndpoints(ctx, seg, visited)
    }
  }
  if (spec.targetLineFromId && spec.targetLineToId) {
    const a = resolvePointInContext(ctx, spec.targetLineFromId, visited)
    const b = resolvePointInContext(ctx, spec.targetLineToId, visited)
    if (a && b) {
      return [a, b]
    }
  }
  return null
}

/** 计算动点在给定参数 t 下的未覆盖基础坐标 */
export const evalMovingPointRaw = (
  ctx: ResolveContext,
  mp: CoordMovingPoint,
  tOverride?: number,
  visited: Set<string> = new Set()
): Vec2 | null => {
  const { path } = mp
  if (path.type === 'free') {
    return { x: path.x, y: path.y }
  }
  const tRaw = tOverride ?? (Object.hasOwn(ctx.tValues, mp.id) ? ctx.tValues[mp.id] : mp.initialT)
  const clampedT = Math.max(mp.tMin, Math.min(mp.tMax, tRaw))
  const ratio = mp.tMax === mp.tMin ? 0 : (clampedT - mp.tMin) / (mp.tMax - mp.tMin)

  if (path.type === 'segment' || path.type === 'line' || path.type === 'ray') {
    let a: Vec2 | null = null
    let b: Vec2 | null = null
    if (path.segmentId) {
      const seg = ctx.coord.segments.find((s) => s.id === path.segmentId)
      const pair = seg ? resolveSegmentEndpoints(ctx, seg, visited) : null
      if (pair) {
        a = pair[0]
        b = pair[1]
      }
    }
    if (!a) {
      a = path.fromId
        ? resolvePointInContext(ctx, path.fromId, visited)
        : path.from
          ? { x: path.from[0], y: path.from[1] }
          : null
    }
    if (!b) {
      b = path.toId
        ? resolvePointInContext(ctx, path.toId, visited)
        : path.to
          ? { x: path.to[0], y: path.to[1] }
          : null
    }
    if (!a || !b) {
      return null
    }
    if (path.type === 'segment') {
      return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio }
    }
    // line / ray: use clampedT directly as signed distance along unit direction from a -> b
    const len = vecDist(a, b)
    if (len < 1e-9) {
      return a
    }
    const ux = (b.x - a.x) / len
    const uy = (b.y - a.y) / len
    const dist = path.type === 'ray' ? Math.max(0, clampedT) : clampedT
    return { x: a.x + ux * dist, y: a.y + uy * dist }
  }

  if (path.type === 'function') {
    let expr = path.expr
    if (path.functionId) {
      const fn = ctx.coord.functions.find((f) => f.id === path.functionId)
      if (fn?.expr) {
        expr = fn.expr
      }
    }
    const y = evalMathExpr(expr, { ...ctx.params, x: clampedT, t: clampedT })
    return Number.isFinite(y) ? { x: clampedT, y } : null
  }

  if (path.type === 'circle') {
    let center: Vec2 | null = null
    let radius = path.radius ?? 0
    if (path.circleId) {
      const c = ctx.coord.circles.find((item) => item.id === path.circleId)
      const resolved = c ? resolveCircleParams(ctx, c, visited) : null
      if (resolved) {
        center = resolved.center
        radius = resolved.radius
      }
    }
    if (!center) {
      center = path.centerId
        ? resolvePointInContext(ctx, path.centerId, visited)
        : path.center
          ? { x: path.center[0], y: path.center[1] }
          : null
    }
    if (center && path.radiusPointId) {
      const rp = resolvePointInContext(ctx, path.radiusPointId, visited)
      if (rp) {
        radius = vecDist(center, rp)
      }
    }
    if (!center || radius <= 0) {
      return null
    }
    // t in radians (default 0..2*pi)
    return {
      x: center.x + radius * Math.cos(clampedT),
      y: center.y + radius * Math.sin(clampedT),
    }
  }

  if (path.type === 'polyline') {
    const verts = getPolylineVertices(ctx, path.vertexIds, path.points, Boolean(path.closed), visited)
    return samplePolylineAtRatio(verts, ratio)
  }

  if (path.type === 'parametric') {
    const vars = { ...ctx.params, t: clampedT, x: clampedT, theta: clampedT }
    const x = evalMathExpr(path.xExpr, vars)
    const y = evalMathExpr(path.yExpr, vars)
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
  }

  return null
}

/** 解析派生几何点 */
export const resolveDerivedPoint = (
  ctx: ResolveContext,
  dp: CoordDerivedPoint,
  visited: Set<string> = new Set()
): Vec2 | null => {
  switch (dp.kind) {
    case 'midpoint':
    case 'ratio': {
      const aId = dp.fromId ?? dp.pointIds?.[0]
      const bId = dp.toId ?? dp.pointIds?.[1]
      if (!aId || !bId) {
        return null
      }
      const a = resolvePointInContext(ctx, aId, visited)
      const b = resolvePointInContext(ctx, bId, visited)
      if (!a || !b) {
        return null
      }
      let ratio = dp.kind === 'midpoint' ? 0.5 : (dp.ratio ?? 0.5)
      if (dp.ratioExpr) {
        const val = evalMathExpr(dp.ratioExpr, ctx.params, ctx.overrides)
        if (Number.isFinite(val)) {
          ratio = val
        }
      }
      return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio }
    }

    case 'perpendicular_foot': {
      const srcId = dp.fromId ?? dp.pointIds?.[0]
      if (!srcId) {
        return null
      }
      const src = resolvePointInContext(ctx, srcId, visited)
      const line = resolveLinePairFromSpec(ctx, dp, visited)
      if (!src || !line) {
        return null
      }
      return projectOntoLine(src, line[0], line[1])
    }

    case 'symmetry': {
      const srcId = dp.fromId ?? dp.pointIds?.[0]
      if (!srcId) {
        return null
      }
      const src = resolvePointInContext(ctx, srcId, visited)
      if (!src) {
        return null
      }
      if (dp.centerId) {
        const center = resolvePointInContext(ctx, dp.centerId, visited)
        return center ? { x: 2 * center.x - src.x, y: 2 * center.y - src.y } : null
      }
      const line = resolveLinePairFromSpec(ctx, dp, visited)
      return line ? reflectPointAcrossLine(src, line[0], line[1]) : null
    }

    case 'rotate': {
      const srcId = dp.fromId ?? dp.pointIds?.[0]
      const centerId = dp.centerId ?? dp.pointIds?.[1]
      if (!srcId || !centerId) {
        return null
      }
      const src = resolvePointInContext(ctx, srcId, visited)
      const center = resolvePointInContext(ctx, centerId, visited)
      if (!src || !center) {
        return null
      }
      let deg = dp.angleDeg ?? 90
      if (dp.angleExpr) {
        const v = evalMathExpr(dp.angleExpr, ctx.params, ctx.overrides)
        if (Number.isFinite(v)) {
          deg = v
        }
      }
      return rotatePointAround(src, center, deg)
    }

    case 'translate': {
      const srcId = dp.fromId ?? dp.pointIds?.[0]
      if (!srcId) {
        return null
      }
      const src = resolvePointInContext(ctx, srcId, visited)
      if (!src) {
        return null
      }
      if (dp.vectorFromId && dp.vectorToId) {
        const vf = resolvePointInContext(ctx, dp.vectorFromId, visited)
        const vt = resolvePointInContext(ctx, dp.vectorToId, visited)
        if (!vf || !vt) {
          return null
        }
        return { x: src.x + (vt.x - vf.x), y: src.y + (vt.y - vf.y) }
      }
      return { x: src.x + (dp.dx ?? 0), y: src.y + (dp.dy ?? 0) }
    }

    case 'centroid':
    case 'circumcenter':
    case 'incenter':
    case 'orthocenter': {
      const ids = dp.pointIds ?? []
      if (ids.length < 3) {
        return null
      }
      const a = resolvePointInContext(ctx, ids[0], visited)
      const b = resolvePointInContext(ctx, ids[1], visited)
      const c = resolvePointInContext(ctx, ids[2], visited)
      if (!a || !b || !c) {
        return null
      }
      return computeTriangleCenter(dp.kind, a, b, c)
    }

    case 'intersection': {
      const idx = dp.index ?? 0
      // Circle-circle
      const c1Id = dp.circleId ?? dp.target1Id
      const c2Id = dp.circle2Id ?? dp.target2Id
      const circle1 = c1Id ? ctx.coord.circles.find((c) => c.id === c1Id) : undefined
      const circle2 = c2Id ? ctx.coord.circles.find((c) => c.id === c2Id) : undefined
      if (circle1 && circle2) {
        const p1 = resolveCircleParams(ctx, circle1, visited)
        const p2 = resolveCircleParams(ctx, circle2, visited)
        if (!p1 || !p2) {
          return null
        }
        const hits = intersectCircles(p1.center, p1.radius, p2.center, p2.radius)
        return hits[idx] ?? hits[0] ?? null
      }
      // Line-circle
      const line1FromSeg = dp.target1Id
        ? ctx.coord.segments.find((s) => s.id === dp.target1Id)
        : undefined
      const line2FromSeg = dp.target2Id
        ? ctx.coord.segments.find((s) => s.id === dp.target2Id)
        : undefined
      const line1 =
        line1FromSeg
          ? resolveSegmentEndpoints(ctx, line1FromSeg, visited)
          : dp.line1FromId && dp.line1ToId
            ? (() => {
                const a = resolvePointInContext(ctx, dp.line1FromId, visited)
                const b = resolvePointInContext(ctx, dp.line1ToId, visited)
                return a && b ? ([a, b] as [Vec2, Vec2]) : null
              })()
            : null
      const activeCircle = circle1 ?? circle2
      if (line1 && activeCircle) {
        const cp = resolveCircleParams(ctx, activeCircle, visited)
        if (!cp) {
          return null
        }
        const hits = intersectLineCircle(line1[0], line1[1], cp.center, cp.radius)
        return hits[idx] ?? hits[0] ?? null
      }
      // Line-line
      const line2 =
        line2FromSeg
          ? resolveSegmentEndpoints(ctx, line2FromSeg, visited)
          : dp.line2FromId && dp.line2ToId
            ? (() => {
                const a = resolvePointInContext(ctx, dp.line2FromId, visited)
                const b = resolvePointInContext(ctx, dp.line2ToId, visited)
                return a && b ? ([a, b] as [Vec2, Vec2]) : null
              })()
            : null
      if (line1 && line2) {
        return intersectLines(line1[0], line1[1], line2[0], line2[1])
      }
      return null
    }

    case 'formula': {
      if (!dp.xExpr || !dp.yExpr) {
        return null
      }
      const lookup: PointLookup = { ...(ctx.overrides ?? {}) }
      for (const p of ctx.coord.points) {
        if (!Object.hasOwn(lookup, p.id)) {
          lookup[p.id] = { x: p.x, y: p.y }
        }
      }
      for (const mp of ctx.coord.movingPoints) {
        if (!Object.hasOwn(lookup, mp.id) && !visited.has(mp.id)) {
          const pos = resolvePointInContext(ctx, mp.id, visited)
          if (pos) {
            lookup[mp.id] = pos
          }
        }
      }
      const x = evalMathExpr(dp.xExpr, ctx.params, lookup)
      const y = evalMathExpr(dp.yExpr, ctx.params, lookup)
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
    }
  }
}

/** 计算辅助线几何（支持 connect / perpendicular / parallel / symmetry / bisector） */
export const resolveAuxiliaryGeometryInContext = (
  ctx: ResolveContext,
  aux: CoordAuxiliaryLine,
  visited: Set<string> = new Set()
): ResolvedAuxiliaryGeometry | null => {
  const from = resolvePointInContext(ctx, aux.fromId, visited)
  if (!from) {
    return null
  }

  if (aux.kind === 'connect') {
    if (!aux.toId) {
      return null
    }
    const to = resolvePointInContext(ctx, aux.toId, visited)
    return to ? { from, to } : null
  }

  if (aux.kind === 'bisector') {
    const vertex = aux.vertexId ? resolvePointInContext(ctx, aux.vertexId, visited) : from
    const ray1Pt = aux.vertexId ? from : null
    const ray2Pt = aux.toId ? resolvePointInContext(ctx, aux.toId, visited) : null
    if (!vertex || !ray1Pt || !ray2Pt) {
      return null
    }
    const u1x = ray1Pt.x - vertex.x
    const u1y = ray1Pt.y - vertex.y
    const u2x = ray2Pt.x - vertex.x
    const u2y = ray2Pt.y - vertex.y
    const l1 = Math.hypot(u1x, u1y)
    const l2 = Math.hypot(u2x, u2y)
    if (l1 < 1e-9 || l2 < 1e-9) {
      return null
    }
    let bx = u1x / l1 + u2x / l2
    let by = u1y / l1 + u2y / l2
    const bl = Math.hypot(bx, by)
    if (bl < 1e-9) {
      bx = -u1y / l1
      by = u1x / l1
    } else {
      bx /= bl
      by /= bl
    }
    const span = Math.max(ctx.coord.viewport.xMax - ctx.coord.viewport.xMin, 6) * 0.55
    const end = { x: vertex.x + bx * span, y: vertex.y + by * span }
    return { from: vertex, to: end, derivedPoint: end }
  }

  const line = resolveLinePairFromSpec(ctx, aux, visited)
  if (!line) {
    return null
  }
  const [la, lb] = line

  if (aux.kind === 'perpendicular') {
    const foot = projectOntoLine(from, la, lb)
    const dirX = lb.x - la.x
    const dirY = lb.y - la.y
    const dirLen = Math.hypot(dirX, dirY) || 1
    const perpX = from.x - foot.x
    const perpY = from.y - foot.y
    const perpLen = Math.hypot(perpX, perpY)
    const rightAngle =
      aux.showRightAngle !== false && perpLen > 1e-4
        ? {
            vertex: foot,
            u: { x: dirX / dirLen, y: dirY / dirLen },
            v: { x: perpX / perpLen, y: perpY / perpLen },
          }
        : undefined
    return {
      from,
      to: foot,
      derivedPoint: foot,
      rightAngle,
    }
  }

  if (aux.kind === 'symmetry') {
    const foot = projectOntoLine(from, la, lb)
    const mirror = {
      x: 2 * foot.x - from.x,
      y: 2 * foot.y - from.y,
    }
    const dirX = lb.x - la.x
    const dirY = lb.y - la.y
    const dirLen = Math.hypot(dirX, dirY) || 1
    const perpX = from.x - foot.x
    const perpY = from.y - foot.y
    const perpLen = Math.hypot(perpX, perpY)
    const rightAngle =
      aux.showRightAngle !== false && perpLen > 1e-4
        ? {
            vertex: foot,
            u: { x: dirX / dirLen, y: dirY / dirLen },
            v: { x: perpX / perpLen, y: perpY / perpLen },
          }
        : undefined
    return {
      from,
      to: mirror,
      derivedPoint: mirror,
      rightAngle,
    }
  }

  // parallel
  const dx = lb.x - la.x
  const dy = lb.y - la.y
  const len = Math.hypot(dx, dy) || 1
  const span = Math.max(ctx.coord.viewport.xMax - ctx.coord.viewport.xMin, 6) * 0.55
  return {
    from: { x: from.x - (dx / len) * span, y: from.y - (dy / len) * span },
    to: { x: from.x + (dx / len) * span, y: from.y + (dy / len) * span },
  }
}

/** 统一解析坐标系中任意点的实时坐标（带环检测，支持覆盖层、固定点、动点、派生点、辅助线派生点、用户自绘点） */
export const resolvePointInContext = (
  ctx: ResolveContext,
  pointId: string,
  visited: Set<string> = new Set()
): Vec2 | null => {
  if (ctx.overrides && Object.hasOwn(ctx.overrides, pointId)) {
    return ctx.overrides[pointId]
  }
  if (visited.has(pointId) || visited.size > 24) {
    return null
  }
  const nextVisited = new Set(visited)
  nextVisited.add(pointId)

  const fixed = ctx.coord.points.find((p) => p.id === pointId)
  if (fixed) {
    return { x: fixed.x, y: fixed.y }
  }

  const moving = ctx.coord.movingPoints.find((p) => p.id === pointId)
  if (moving) {
    return evalMovingPointRaw(ctx, moving, undefined, nextVisited)
  }

  const derived = ctx.coord.derivedPoints.find((p) => p.id === pointId)
  if (derived) {
    return resolveDerivedPoint(ctx, derived, nextVisited)
  }

  const aux = ctx.coord.auxiliaryLines.find((line) => line.derivedPointId === pointId)
  if (aux) {
    const geom = resolveAuxiliaryGeometryInContext(ctx, aux, nextVisited)
    return geom?.derivedPoint ?? null
  }

  if (ctx.userPoints) {
    const up = ctx.userPoints.find((p) => p.id === pointId)
    if (up) {
      return { x: up.x, y: up.y }
    }
  }

  return null
}

/**
 * 将鼠标世界坐标精确反推为动点参数 t（或自由点 2D 坐标）。
 * 修复了旧版用 gridStep/4 吸附导致 [0,1] 区间动点卡死不可拖动的问题：
 * 默认连续丝滑拖动，仅在用户按住 Shift 时按路径合理步进吸附！
 */
export const projectWorldToMovingPoint = (
  ctx: ResolveContext,
  mp: CoordMovingPoint,
  worldX: number,
  worldY: number,
  options?: { snapShift?: boolean; gridStep?: number }
): { t?: number; freePos?: Vec2 } => {
  const { path, tMin, tMax } = mp
  const snapShift = Boolean(options?.snapShift)
  const gridStep = options?.gridStep ?? 1

  if (path.type === 'free') {
    let x = worldX
    let y = worldY
    if (snapShift) {
      const step = gridStep / 2
      x = Math.round(x / step) * step
      y = Math.round(y / step) * step
    }
    if (path.bounds) {
      if (path.bounds.xMin !== undefined) {
        x = Math.max(path.bounds.xMin, x)
      }
      if (path.bounds.xMax !== undefined) {
        x = Math.min(path.bounds.xMax, x)
      }
      if (path.bounds.yMin !== undefined) {
        y = Math.max(path.bounds.yMin, y)
      }
      if (path.bounds.yMax !== undefined) {
        y = Math.min(path.bounds.yMax, y)
      }
    }
    return { freePos: { x, y } }
  }

  let rawT = Object.hasOwn(ctx.tValues, mp.id) ? ctx.tValues[mp.id] : mp.initialT

  if (path.type === 'segment' || path.type === 'line' || path.type === 'ray') {
    let a: Vec2 | null = null
    let b: Vec2 | null = null
    if (path.segmentId) {
      const seg = ctx.coord.segments.find((s) => s.id === path.segmentId)
      const pair = seg ? resolveSegmentEndpoints(ctx, seg) : null
      if (pair) {
        a = pair[0]
        b = pair[1]
      }
    }
    if (!a) {
      a = path.fromId
        ? resolvePointInContext(ctx, path.fromId)
        : path.from
          ? { x: path.from[0], y: path.from[1] }
          : null
    }
    if (!b) {
      b = path.toId
        ? resolvePointInContext(ctx, path.toId)
        : path.to
          ? { x: path.to[0], y: path.to[1] }
          : null
    }
    if (!a || !b) {
      return { t: rawT }
    }
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lenSq = dx * dx + dy * dy
    if (lenSq < 1e-12) {
      return { t: tMin }
    }
    if (path.type === 'segment') {
      const ratio = Math.max(0, Math.min(1, ((worldX - a.x) * dx + (worldY - a.y) * dy) / lenSq))
      rawT = tMin + ratio * (tMax - tMin)
    } else {
      const len = Math.sqrt(lenSq)
      const projDist = ((worldX - a.x) * dx + (worldY - a.y) * dy) / len
      rawT = Math.max(tMin, Math.min(tMax, projDist))
    }
  } else if (path.type === 'function') {
    let expr = path.expr
    if (path.functionId) {
      const fn = ctx.coord.functions.find((f) => f.id === path.functionId)
      if (fn?.expr) {
        expr = fn.expr
      }
    }
    const compiled = compileMathExpr(expr)
    if (!compiled) {
      rawT = Math.max(tMin, Math.min(tMax, worldX))
    } else {
      // 2D 最近点投影：粗采样 + 两次局部精细化，陡峭曲线上垂直拖动也丝滑跟手！
      const samples = 140
      let bestT = Math.max(tMin, Math.min(tMax, worldX))
      let bestDistSq = Infinity
      const evalDistSq = (xVal: number): number => {
        const yVal = compiled({ ...ctx.params, x: xVal, t: xVal })
        if (!Number.isFinite(yVal)) {
          return Infinity
        }
        const dx = xVal - worldX
        const dy = yVal - worldY
        return dx * dx + dy * dy
      }
      bestDistSq = evalDistSq(bestT)
      for (let i = 0; i <= samples; i += 1) {
        const xVal = tMin + ((tMax - tMin) * i) / samples
        const dSq = evalDistSq(xVal)
        if (dSq < bestDistSq) {
          bestDistSq = dSq
          bestT = xVal
        }
      }
      // 局部精细搜索（黄金分割 / 窄窗口扫描）
      let halfWindow = (tMax - tMin) / samples
      for (let pass = 0; pass < 3; pass += 1) {
        const lo = Math.max(tMin, bestT - halfWindow)
        const hi = Math.min(tMax, bestT + halfWindow)
        for (let j = 0; j <= 16; j += 1) {
          const cand = lo + ((hi - lo) * j) / 16
          const dSq = evalDistSq(cand)
          if (dSq < bestDistSq) {
            bestDistSq = dSq
            bestT = cand
          }
        }
        halfWindow = (hi - lo) / 8
      }
      rawT = bestT
    }
  } else if (path.type === 'circle') {
    let center: Vec2 | null = null
    if (path.circleId) {
      const c = ctx.coord.circles.find((item) => item.id === path.circleId)
      const resolved = c ? resolveCircleParams(ctx, c) : null
      if (resolved) {
        center = resolved.center
      }
    }
    if (!center) {
      center = path.centerId
        ? resolvePointInContext(ctx, path.centerId)
        : path.center
          ? { x: path.center[0], y: path.center[1] }
          : null
    }
    if (center) {
      let angle = Math.atan2(worldY - center.y, worldX - center.x)
      // 将 angle 展开到最接近当前区间 [tMin, tMax] 的同终边角
      const twoPi = Math.PI * 2
      while (angle < tMin) {
        angle += twoPi
      }
      while (angle > tMax && angle - twoPi >= tMin) {
        angle -= twoPi
      }
      if (angle > tMax) {
        const distHi = Math.abs(angle - tMax)
        const distLo = Math.abs(angle - twoPi - tMin)
        angle = distLo < distHi ? tMin : tMax
      }
      rawT = Math.max(tMin, Math.min(tMax, angle))
    }
  } else if (path.type === 'polyline') {
    const verts = getPolylineVertices(ctx, path.vertexIds, path.points, Boolean(path.closed), new Set())
    if (verts.length >= 2) {
      const segLens: number[] = []
      let totalLen = 0
      for (let i = 0; i < verts.length - 1; i += 1) {
        const l = vecDist(verts[i], verts[i + 1])
        segLens.push(l)
        totalLen += l
      }
      if (totalLen > 1e-9) {
        let accum = 0
        let bestDist = Infinity
        let bestRatio = 0
        for (let i = 0; i < verts.length - 1; i += 1) {
          const proj = projectOntoSegment({ x: worldX, y: worldY }, verts[i], verts[i + 1])
          const d = vecDist({ x: worldX, y: worldY }, proj.point)
          if (d < bestDist) {
            bestDist = d
            bestRatio = (accum + proj.ratio * segLens[i]) / totalLen
          }
          accum += segLens[i]
        }
        rawT = tMin + bestRatio * (tMax - tMin)
      }
    }
  } else {
    // parametric: 粗采样 + 局部精细化
    const samples = 140
    let bestT = rawT
    let bestDistSq = Infinity
    for (let i = 0; i <= samples; i += 1) {
      const t = tMin + ((tMax - tMin) * i) / samples
      const pos = evalMovingPointRaw(ctx, mp, t)
      if (!pos) {
        continue
      }
      const dx = pos.x - worldX
      const dy = pos.y - worldY
      const dSq = dx * dx + dy * dy
      if (dSq < bestDistSq) {
        bestDistSq = dSq
        bestT = t
      }
    }
    let halfWindow = (tMax - tMin) / samples
    for (let pass = 0; pass < 3; pass += 1) {
      const lo = Math.max(tMin, bestT - halfWindow)
      const hi = Math.min(tMax, bestT + halfWindow)
      for (let j = 0; j <= 16; j += 1) {
        const cand = lo + ((hi - lo) * j) / 16
        const pos = evalMovingPointRaw(ctx, mp, cand)
        if (!pos) {
          continue
        }
        const dx = pos.x - worldX
        const dy = pos.y - worldY
        const dSq = dx * dx + dy * dy
        if (dSq < bestDistSq) {
          bestDistSq = dSq
          bestT = cand
        }
      }
      halfWindow = (hi - lo) / 8
    }
    rawT = bestT
  }

  if (snapShift) {
    // Shift 微调吸附：根据 t 区间跨度动态选择步长，绝不会把 [0,1] 锁死！
    const span = tMax - tMin
    const step =
      path.type === 'function'
        ? Math.min(gridStep / 4, span / 10)
        : span <= 1.01
          ? 0.05
          : Math.min(gridStep / 4, span / 20)
    if (step > 1e-6) {
      rawT = Math.round(rawT / step) * step
    }
  }

  return { t: Math.max(tMin, Math.min(tMax, rawT)) }
}
