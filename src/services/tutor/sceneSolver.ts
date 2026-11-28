import { solveConstraints, type ConstraintStatus } from './constraintSolver.js'
import {
  buildParamMap,
  computeAngleDeg,
  computePolygonArea,
  computePolygonPerimeter,
  evalMovingPointRaw,
  resolveAuxiliaryGeometryInContext,
  resolveDerivedPoint,
  vecDist,
  type ResolveContext,
  type ResolvedAuxiliaryGeometry,
  type Vec2,
} from './geometryEngine.js'
import { evalMathExpr } from './mathEval.js'
import { runMotionScriptFrame, type DynamicAnnotation } from './scriptEngine.js'
import type { CoordinateState, CoordMeasurement, UserCoordPoint } from './types.js'

export type ComputedMeasurement = {
  measurement: CoordMeasurement
  numericValue: number
  display: string
  isOptimal: boolean
  relatedIds: string[]
}

export type SolvedScene = {
  /** 所有点（固定点、动点、派生点、辅助线派生点、用户点）的最终实时坐标 */
  points: Record<string, Vec2>
  /** 实时参数滑块值 */
  params: Record<string, number>
  /** 实时解析好的辅助线几何 */
  auxGeometries: Record<string, ResolvedAuxiliaryGeometry>
  /** 约束求解状态列表 */
  constraintStatuses: ConstraintStatus[]
  /** 脚本求解输出的动态标注、高亮、状态提示与错误 */
  scriptAnnotations: DynamicAnnotation[]
  scriptHighlights: string[]
  scriptStatus: string | null
  scriptError: string | null
  scriptRequestPause: boolean
  /** 本帧被脚本写入位置的点 ID 集合 */
  scriptControlledIds: string[]
  /** 约束求解后反推的最新 1D 动点 t 值（用于暖启动与滑块同步） */
  solvedT: Record<string, number>
  /** 约束/脚本影响后的最新点坐标（用于暖启动防跳支） */
  solvedOverrides: Record<string, Vec2>
  /** 实时度量计算结果 */
  measurements: ComputedMeasurement[]
}

const formatNum = (value: number): string => {
  if (!Number.isFinite(value)) {
    return '--'
  }
  if (Math.abs(value) < 1e-6) {
    return '0'
  }
  if (Math.abs(value - Math.round(value)) < 1e-3) {
    return String(Math.round(value))
  }
  return value.toFixed(2).replace(/\.?0+$/, '')
}

export const solveCoordinateScene = (options: {
  coord: CoordinateState
  tValues: Record<string, number>
  freePositions: Record<string, Vec2>
  paramValues: Record<string, number>
  userPoints: UserCoordPoint[]
  draggedId: string | null
  disabledConstraintIds: Record<string, boolean>
  scriptEnabled: boolean
  scriptTime: number
  scriptDt?: number
  playing?: boolean
  isTimelineDriven?: boolean
  scriptCodeOverride?: string | null
  scriptPersistentState?: Record<string, unknown>
}): SolvedScene => {
  const {
    coord,
    tValues,
    freePositions,
    paramValues,
    userPoints,
    draggedId,
    disabledConstraintIds,
    scriptEnabled,
    scriptTime,
    scriptDt = 0,
    playing = false,
    isTimelineDriven = true,
    scriptCodeOverride,
    scriptPersistentState = {},
  } = options

  const params = buildParamMap(coord, paramValues)
  const effectiveTValues: Record<string, number> = { ...tValues }
  const positions: Record<string, Vec2> = {}

  // 1. 填充固定点（若有拖拽/暖启动覆盖坐标，则采用覆盖坐标）
  for (const pt of coord.points) {
    if (Object.hasOwn(freePositions, pt.id)) {
      positions[pt.id] = { ...freePositions[pt.id] }
    } else {
      positions[pt.id] = { x: pt.x, y: pt.y }
    }
  }

  // 2. 填充用户自绘点
  for (const up of userPoints) {
    positions[up.id] = { x: up.x, y: up.y }
  }

  // 3. 解析基础动点（支持 free 自由点覆盖 + 1D 路径动点）
  const baseCtx: ResolveContext = {
    coord,
    tValues: effectiveTValues,
    params,
    overrides: positions,
    userPoints,
  }

  for (const mp of coord.movingPoints) {
    if (Object.hasOwn(freePositions, mp.id)) {
      positions[mp.id] = { ...freePositions[mp.id] }
      continue
    }
    const pos = evalMovingPointRaw(baseCtx, mp)
    if (pos) {
      positions[mp.id] = pos
    }
  }

  // 预解析一次派生点，让脚本也能读取它们
  for (const dp of coord.derivedPoints) {
    const pos = resolveDerivedPoint(baseCtx, dp)
    if (pos) {
      positions[dp.id] = pos
    }
  }

  // 4. 运行 AI 可编程动点控制脚本（若已启用）
  let scriptAnnotations: DynamicAnnotation[] = []
  let scriptHighlights: string[] = []
  let scriptStatus: string | null = null
  let scriptError: string | null = null
  let scriptRequestPause = false
  const scriptControlledIds = new Set<string>()
  const activeCode = scriptCodeOverride ?? coord.motionScript?.code ?? null

  if (coord.motionScript && scriptEnabled && activeCode) {
    const res = runMotionScriptFrame({
      code: activeCode,
      t: scriptTime,
      duration: coord.motionScript.duration,
      dt: scriptDt,
      playing,
      isTimelineDriven,
      draggedId,
      basePoints: positions,
      tValues: effectiveTValues,
      params,
      persistentState: scriptPersistentState,
    })
    scriptAnnotations = res.annotations
    scriptHighlights = res.highlights
    scriptStatus = res.statusText
    scriptError = res.error
    scriptRequestPause = res.requestPause

    for (const [k, v] of Object.entries(res.paramUpdates)) {
      params[k] = v
    }
    for (const [id, tVal] of Object.entries(res.tOverrides)) {
      effectiveTValues[id] = tVal
      const mp = coord.movingPoints.find((m) => m.id === id)
      if (mp) {
        const pos = evalMovingPointRaw(
          { coord, tValues: effectiveTValues, params, overrides: positions, userPoints },
          mp,
          tVal
        )
        if (pos) {
          positions[id] = pos
          scriptControlledIds.add(id)
        }
      }
    }
    for (const [id, pt] of Object.entries(res.pointOverrides)) {
      positions[id] = { x: pt.x, y: pt.y }
      scriptControlledIds.add(id)
    }
  }

  // 5. 运行实时约束求解器
  const constraintRes = solveConstraints({
    coord,
    basePositions: positions,
    tValues: effectiveTValues,
    params,
    draggedId,
    disabledConstraintIds,
    scriptControlledIds,
  })

  for (const [id, pt] of Object.entries(constraintRes.solvedPositions)) {
    positions[id] = { x: pt.x, y: pt.y }
  }
  for (const [id, tVal] of Object.entries(constraintRes.solvedT)) {
    effectiveTValues[id] = tVal
  }

  // 6. 基于约束求解后的最终坐标，重算全部派生点与辅助线（最多两轮以支持链式派生）
  const derivedAndAuxIds = new Set<string>([
    ...coord.derivedPoints.map((dp) => dp.id),
    ...coord.auxiliaryLines
      .map((a) => a.derivedPointId)
      .filter((id): id is string => Boolean(id)),
  ])
  const baseSolvedPositions: Record<string, Vec2> = Object.fromEntries(
    Object.entries(positions).filter(([id]) => !derivedAndAuxIds.has(id))
  )
  const finalPositions: Record<string, Vec2> = { ...baseSolvedPositions }
  const finalCtx: ResolveContext = {
    coord,
    tValues: effectiveTValues,
    params,
    overrides: finalPositions,
    userPoints,
  }
  const auxGeometries: Record<string, ResolvedAuxiliaryGeometry> = {}

  for (let pass = 0; pass < 2; pass += 1) {
    for (const dp of coord.derivedPoints) {
      const lookupWithoutSelf: Record<string, Vec2> = Object.fromEntries(
        Object.entries(finalPositions).filter(([k]) => k !== dp.id)
      )
      const pos = resolveDerivedPoint({ ...finalCtx, overrides: lookupWithoutSelf }, dp)
      if (pos) {
        finalPositions[dp.id] = pos
      }
    }
    for (const aux of coord.auxiliaryLines) {
      const auxDerivedId = aux.derivedPointId
      const lookupWithoutSelf = auxDerivedId
        ? Object.fromEntries(Object.entries(finalPositions).filter(([k]) => k !== auxDerivedId))
        : finalPositions
      const geom = resolveAuxiliaryGeometryInContext(
        { ...finalCtx, overrides: lookupWithoutSelf },
        aux
      )
      if (geom) {
        auxGeometries[aux.id] = geom
        if (auxDerivedId && geom.derivedPoint) {
          finalPositions[auxDerivedId] = geom.derivedPoint
        }
      }
    }
  }

  for (const [id, pt] of Object.entries(finalPositions)) {
    positions[id] = pt
  }

  // 7. 计算全部实时度量指标
  const measurements: ComputedMeasurement[] = coord.measurements.map((m) => {
    let numericValue = Number.NaN
    let display = '--'
    const relatedIds: string[] = []
    const getP = (id: string | undefined): Vec2 | null => (id && positions[id] ? positions[id] : null)

    if (m.kind === 'coord' && m.pointIds?.[0]) {
      relatedIds.push(m.pointIds[0])
      const p = getP(m.pointIds[0])
      if (p) {
        display = `(${formatNum(p.x)}, ${formatNum(p.y)})`
      }
    } else if (m.kind === 'distance' && m.pointIds && m.pointIds.length >= 2) {
      relatedIds.push(m.pointIds[0], m.pointIds[1])
      const a = getP(m.pointIds[0])
      const b = getP(m.pointIds[1])
      if (a && b) {
        numericValue = vecDist(a, b)
        display = numericValue.toFixed(2)
      }
    } else if (m.kind === 'sum_distance' && m.pairs) {
      let total = 0
      let valid = true
      for (const [id1, id2] of m.pairs) {
        relatedIds.push(id1, id2)
        const a = getP(id1)
        const b = getP(id2)
        if (!a || !b) {
          valid = false
          break
        }
        total += vecDist(a, b)
      }
      if (valid) {
        numericValue = total
        display = total.toFixed(2)
      }
    } else if (m.kind === 'diff_distance' && m.pairs && m.pairs.length >= 2) {
      const [p1, p2] = m.pairs
      relatedIds.push(p1[0], p1[1], p2[0], p2[1])
      const a1 = getP(p1[0])
      const b1 = getP(p1[1])
      const a2 = getP(p2[0])
      const b2 = getP(p2[1])
      if (a1 && b1 && a2 && b2) {
        numericValue = Math.abs(vecDist(a1, b1) - vecDist(a2, b2))
        display = numericValue.toFixed(2)
      }
    } else if (m.kind === 'ratio' && m.pairs && m.pairs.length >= 2) {
      const [p1, p2] = m.pairs
      relatedIds.push(p1[0], p1[1], p2[0], p2[1])
      const a1 = getP(p1[0])
      const b1 = getP(p1[1])
      const a2 = getP(p2[0])
      const b2 = getP(p2[1])
      if (a1 && b1 && a2 && b2) {
        const d2 = vecDist(a2, b2)
        if (d2 > 1e-8) {
          numericValue = vecDist(a1, b1) / d2
          display = numericValue.toFixed(2)
        }
      }
    } else if (m.kind === 'area' && m.pointIds && m.pointIds.length >= 3) {
      relatedIds.push(...m.pointIds)
      const pts = m.pointIds.map((id) => getP(id)).filter((p): p is Vec2 => p !== null)
      if (pts.length >= 3) {
        numericValue = computePolygonArea(pts)
        display = numericValue.toFixed(2)
      }
    } else if (m.kind === 'perimeter' && m.pointIds && m.pointIds.length >= 3) {
      relatedIds.push(...m.pointIds)
      const pts = m.pointIds.map((id) => getP(id)).filter((p): p is Vec2 => p !== null)
      if (pts.length >= 3) {
        numericValue = computePolygonPerimeter(pts)
        display = numericValue.toFixed(2)
      }
    } else if (m.kind === 'angle' && m.pointIds && m.pointIds.length >= 3) {
      relatedIds.push(...m.pointIds.slice(0, 3))
      const a = getP(m.pointIds[0])
      const b = getP(m.pointIds[1])
      const c = getP(m.pointIds[2])
      if (a && b && c) {
        numericValue = computeAngleDeg(a, b, c)
        if (Number.isFinite(numericValue)) {
          display = `${numericValue.toFixed(1)}°`
        }
      }
    } else if (m.kind === 'slope' && m.pointIds && m.pointIds.length >= 2) {
      relatedIds.push(m.pointIds[0], m.pointIds[1])
      const a = getP(m.pointIds[0])
      const b = getP(m.pointIds[1])
      if (a && b) {
        if (Math.abs(b.x - a.x) < 1e-7) {
          display = '∞'
        } else {
          numericValue = (b.y - a.y) / (b.x - a.x)
          display = numericValue.toFixed(2)
        }
      }
    } else if (m.kind === 'expr' && m.expr) {
      if (m.pointIds) {
        relatedIds.push(...m.pointIds)
      }
      const val = evalMathExpr(m.expr, params, positions)
      if (Number.isFinite(val)) {
        numericValue = val
        display = val.toFixed(2)
      }
    }

    const isOptimal =
      m.optimalValue !== undefined &&
      Number.isFinite(m.optimalValue) &&
      Number.isFinite(numericValue) &&
      Math.abs(numericValue - m.optimalValue) < Math.max(0.08, Math.abs(m.optimalValue) * 0.012)

    return { measurement: m, numericValue, display, isOptimal, relatedIds }
  })

  const solvedOverrides: Record<string, Vec2> = { ...constraintRes.solvedPositions }
  for (const id of scriptControlledIds) {
    if (positions[id]) {
      solvedOverrides[id] = { x: positions[id].x, y: positions[id].y }
    }
  }

  return {
    points: positions,
    params,
    auxGeometries,
    constraintStatuses: constraintRes.statuses,
    scriptAnnotations,
    scriptHighlights,
    scriptStatus,
    scriptError,
    scriptRequestPause,
    scriptControlledIds: Array.from(scriptControlledIds),
    solvedT: constraintRes.solvedT,
    solvedOverrides,
    measurements,
  }
}
