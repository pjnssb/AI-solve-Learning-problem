import {
  buildParamMap,
  computePolygonArea as computePolygonAreaCore,
  resolveAuxiliaryGeometryInContext,
  resolvePointInContext,
  type ResolvedAuxiliaryGeometry,
} from './geometryEngine.js'
import {
  createEmptyCoordinateState,
  createEmptyFlowchartState,
  type CoordAngle,
  type CoordAuxiliaryKind,
  type CoordAuxiliaryLine,
  type CoordCircle,
  type CoordConstraint,
  type CoordConstraintKind,
  type CoordDerivedPoint,
  type CoordFunction,
  type CoordFunctionKind,
  type CoordMeasurement,
  type CoordMeasurementKind,
  type CoordMotionScript,
  type CoordMovingPoint,
  type CoordPoint,
  type CoordPolygon,
  type CoordSegment,
  type CoordSlider,
  type CoordinateState,
  type DerivedPointKind,
  type FlowEdge,
  type FlowNode,
  type FlowNodeKind,
  type MovingPointPath,
  type TutorBoardState,
  type TutorToolCall,
} from './types.js'

export type { ResolvedAuxiliaryGeometry }
export const computePolygonArea = computePolygonAreaCore

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))
      ? Number(value)
      : fallback

const optNum = (value: unknown): number | undefined => {
  const n = num(value, Number.NaN)
  return Number.isFinite(n) ? n : undefined
}

const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback

const numPair = (value: unknown): [number, number] | undefined => {
  if (Array.isArray(value) && value.length >= 2) {
    const a = num(value[0], Number.NaN)
    const b = num(value[1], Number.NaN)
    if (Number.isFinite(a) && Number.isFinite(b)) {
      return [a, b]
    }
  }
  return undefined
}

const strArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

const upsertById = <T extends { id: string }>(list: T[], item: T): T[] => {
  const index = list.findIndex((existing) => existing.id === item.id)
  if (index === -1) {
    return [...list, item]
  }
  const next = [...list]
  next[index] = item
  return next
}

const strEndpointId = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const extractXY = (args: Record<string, unknown>): { x: number; y: number } | null => {
  const pair = numPair(args.coords) ?? numPair(args.pos) ?? numPair(args.point)
  if (pair) {
    return { x: pair[0], y: pair[1] }
  }
  if (typeof args.position === 'object' && args.position !== null && !Array.isArray(args.position)) {
    const pos = args.position as Record<string, unknown>
    const px = num(pos.x, Number.NaN)
    const py = num(pos.y, Number.NaN)
    if (Number.isFinite(px) && Number.isFinite(py)) {
      return { x: px, y: py }
    }
  }
  const x = num(args.x, Number.NaN)
  const y = num(args.y, Number.NaN)
  if (Number.isFinite(x) && Number.isFinite(y)) {
    return { x, y }
  }
  return null
}

const normalizeViewport = (
  rawXMin: number,
  rawXMax: number,
  rawYMin: number,
  rawYMax: number
) => {
  let xMin = Math.min(rawXMin, rawXMax)
  let xMax = Math.max(rawXMin, rawXMax)
  let yMin = Math.min(rawYMin, rawYMax)
  let yMax = Math.max(rawYMin, rawYMax)
  if (xMax - xMin < 1) {
    xMin -= 2
    xMax += 2
  }
  if (yMax - yMin < 1) {
    yMin -= 2
    yMax += 2
  }
  return { xMin, xMax, yMin, yMax }
}

const expandViewportForPoints = (
  coord: CoordinateState,
  coords: { x: number; y: number }[]
): CoordinateState['viewport'] => {
  if (coord.hasExplicitViewport || coords.length === 0) {
    return coord.viewport
  }
  let { xMin, xMax, yMin, yMax } = coord.viewport
  let changed = false
  for (const pt of coords) {
    if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
      continue
    }
    if (pt.x <= xMin + 0.4) {
      xMin = Math.floor(pt.x - 1.5)
      changed = true
    }
    if (pt.x >= xMax - 0.4) {
      xMax = Math.ceil(pt.x + 1.5)
      changed = true
    }
    if (pt.y <= yMin + 0.4) {
      yMin = Math.floor(pt.y - 1.5)
      changed = true
    }
    if (pt.y >= yMax - 0.4) {
      yMax = Math.ceil(pt.y + 1.5)
      changed = true
    }
  }
  return changed ? { xMin, xMax, yMin, yMax } : coord.viewport
}

/** 向后兼容：解析坐标系中任意点的实时坐标 */
export const resolvePointCoords = (
  coord: CoordinateState,
  pointId: string,
  tValues: Record<string, number>
): { x: number; y: number } | null =>
  resolvePointInContext(
    {
      coord,
      tValues,
      params: buildParamMap(coord),
    },
    pointId
  )

/** 向后兼容：计算辅助线端点 */
export const resolveAuxiliaryGeometry = (
  coord: CoordinateState,
  aux: CoordAuxiliaryLine,
  tValues: Record<string, number>
): ResolvedAuxiliaryGeometry | null =>
  resolveAuxiliaryGeometryInContext(
    {
      coord,
      tValues,
      params: buildParamMap(coord),
    },
    aux
  )

const VALID_DERIVED_KINDS = new Set<DerivedPointKind>([
  'midpoint',
  'ratio',
  'intersection',
  'perpendicular_foot',
  'symmetry',
  'rotate',
  'translate',
  'centroid',
  'circumcenter',
  'incenter',
  'orthocenter',
  'formula',
])

const VALID_CONSTRAINT_KINDS = new Set<CoordConstraintKind>([
  'fixed_length',
  'equal_length',
  'length_ratio',
  'perpendicular',
  'parallel',
  'fixed_angle',
  'collinear',
  'on_segment',
  'on_line',
  'on_circle',
  'on_function',
  'on_polyline',
  'midpoint',
  'symmetric',
  'fixed_area',
  'bounds',
  'custom_equation',
])

const normalizeConstraintKind = (raw: string): CoordConstraintKind => {
  const lower = raw.trim().toLowerCase()
  if (VALID_CONSTRAINT_KINDS.has(lower as CoordConstraintKind)) {
    return lower as CoordConstraintKind
  }
  if (lower === 'distance' || lower === 'length' || lower === 'segment_length') {
    return 'fixed_length'
  }
  if (lower === 'equal' || lower === 'congruent') {
    return 'equal_length'
  }
  if (lower === 'ratio') {
    return 'length_ratio'
  }
  if (lower === 'angle' || lower === 'right_angle') {
    return 'fixed_angle'
  }
  if (lower === 'ortho' || lower === 'orthogonal' || lower === 'perp') {
    return 'perpendicular'
  }
  if (lower === 'area') {
    return 'fixed_area'
  }
  if (lower === 'equation' || lower === 'expr' || lower === 'formula' || lower === 'algebraic') {
    return 'custom_equation'
  }
  if (lower === 'symmetry' || lower === 'reflect') {
    return 'symmetric'
  }
  return 'custom_equation'
}

const VALID_MEASUREMENT_KINDS = new Set<CoordMeasurementKind>([
  'distance',
  'sum_distance',
  'diff_distance',
  'ratio',
  'area',
  'perimeter',
  'angle',
  'slope',
  'coord',
  'expr',
])

/**
 * 纯函数工具执行器：按 Agent 发出的单个工具调用增量更新画板状态。
 */
export const applyToolCall = (
  state: TutorBoardState,
  call: TutorToolCall,
  stepIndex: number
): TutorBoardState => {
  const { tool, args } = call
  switch (tool) {
    case 'coord_clear':
      return {
        ...state,
        activeMode: 'coordinate',
        coordinate: {
          ...createEmptyCoordinateState(),
          setupVersion: state.coordinate.setupVersion + 1,
        },
      }

    case 'coord_setup': {
      const vpObj =
        typeof args.viewport === 'object' && args.viewport !== null && !Array.isArray(args.viewport)
          ? (args.viewport as Record<string, unknown>)
          : args
      const xRange = numPair(args.xRange)
      const yRange = numPair(args.yRange)
      const nextViewport = normalizeViewport(
        xRange ? xRange[0] : num(vpObj.xMin, state.coordinate.viewport.xMin),
        xRange ? xRange[1] : num(vpObj.xMax, state.coordinate.viewport.xMax),
        yRange ? yRange[0] : num(vpObj.yMin, state.coordinate.viewport.yMin),
        yRange ? yRange[1] : num(vpObj.yMax, state.coordinate.viewport.yMax)
      )
      return {
        ...state,
        activeMode: 'coordinate',
        hasCoordinate: true,
        coordinate: {
          ...state.coordinate,
          title: str(args.title, state.coordinate.title),
          viewport: nextViewport,
          hasExplicitViewport: true,
          setupVersion: state.coordinate.setupVersion + 1,
          showGrid: bool(args.showGrid, state.coordinate.showGrid),
        },
      }
    }

    case 'coord_plot_point': {
      const id = str(args.id, `P${state.coordinate.points.length + 1}`)
      const xy = extractXY(args) ?? { x: 0, y: 0 }
      const rawSymbol = str(args.symbol, 'dot')
      const symbol: CoordPoint['symbol'] =
        rawSymbol === 'hollow' || rawSymbol === 'cross' ? rawSymbol : 'dot'
      const point: CoordPoint = {
        id,
        label: str(args.label, `${id}(${xy.x}, ${xy.y})`),
        x: xy.x,
        y: xy.y,
        color: str(args.color, '#3964FE'),
        draggable: bool(args.draggable, false),
        pinned: bool(args.pinned, false),
        trace: bool(args.trace, false),
        traceColor: typeof args.traceColor === 'string' ? args.traceColor : undefined,
        symbol,
        visible: bool(args.visible, true),
        stepIndex,
      }
      return {
        ...state,
        activeMode: 'coordinate',
        hasCoordinate: true,
        coordinate: {
          ...state.coordinate,
          viewport: expandViewportForPoints(state.coordinate, [xy]),
          points: upsertById(state.coordinate.points, point),
          highlightedIds: [id],
        },
      }
    }

    case 'coord_add_moving_point': {
      const id = str(args.id, 'P')
      const rawPathType = str(args.pathType, str(args.kind, ''))
      const inferredType =
        rawPathType ||
        (args.circleId || args.centerId || args.radius !== undefined
          ? 'circle'
          : Array.isArray(args.vertexIds) || Array.isArray(args.points)
            ? 'polyline'
            : typeof args.xExpr === 'string' && typeof args.yExpr === 'string'
              ? 'parametric'
              : args.functionId || (typeof args.expr === 'string' && args.expr.trim())
                ? 'function'
                : args.segmentId || args.fromId || args.toId || args.from || args.to
                  ? 'segment'
                  : 'free')

      let path: MovingPointPath
      const extraCoords: { x: number; y: number }[] = []

      if (inferredType === 'free') {
        const xy = extractXY(args) ?? { x: 2, y: 2 }
        extraCoords.push(xy)
        const boundsObj =
          typeof args.bounds === 'object' && args.bounds !== null && !Array.isArray(args.bounds)
            ? (args.bounds as Record<string, unknown>)
            : args
        const xMin = optNum(boundsObj.xMin)
        const xMax = optNum(boundsObj.xMax)
        const yMin = optNum(boundsObj.yMin)
        const yMax = optNum(boundsObj.yMax)
        path = {
          type: 'free',
          x: xy.x,
          y: xy.y,
          bounds:
            xMin !== undefined || xMax !== undefined || yMin !== undefined || yMax !== undefined
              ? { xMin, xMax, yMin, yMax }
              : undefined,
        }
      } else if (inferredType === 'function') {
        path = {
          type: 'function',
          functionId: strEndpointId(args.functionId),
          expr: str(args.expr, 'x'),
        }
      } else if (inferredType === 'parametric') {
        path = {
          type: 'parametric',
          xExpr: str(args.xExpr, 'cos(t)'),
          yExpr: str(args.yExpr, 'sin(t)'),
        }
      } else if (inferredType === 'circle') {
        const centerPair = numPair(args.center)
        if (centerPair) {
          extraCoords.push({ x: centerPair[0], y: centerPair[1] })
        }
        path = {
          type: 'circle',
          circleId: strEndpointId(args.circleId),
          centerId: strEndpointId(args.centerId) ?? strEndpointId(args.center),
          center: centerPair,
          radius: optNum(args.radius ?? args.r),
          radiusPointId: strEndpointId(args.radiusPointId),
        }
      } else if (inferredType === 'polyline' || inferredType === 'polygon') {
        const vertexIds = strArray(args.vertexIds).length
          ? strArray(args.vertexIds)
          : strArray(args.vertices)
        const rawPoints = Array.isArray(args.points)
          ? args.points.map(numPair).filter((p): p is [number, number] => Boolean(p))
          : undefined
        if (rawPoints) {
          for (const [px, py] of rawPoints) {
            extraCoords.push({ x: px, y: py })
          }
        }
        path = {
          type: 'polyline',
          vertexIds: vertexIds.length > 0 ? vertexIds : undefined,
          points: rawPoints && rawPoints.length > 0 ? rawPoints : undefined,
          closed: bool(args.closed, inferredType === 'polygon'),
        }
      } else if (inferredType === 'line' || inferredType === 'ray') {
        const fromPair = numPair(args.from)
        const toPair = numPair(args.to)
        path = {
          type: inferredType,
          segmentId: strEndpointId(args.segmentId),
          fromId: strEndpointId(args.fromId) ?? strEndpointId(args.from),
          toId: strEndpointId(args.toId) ?? strEndpointId(args.to),
          from: fromPair ?? [0, 0],
          to: toPair ?? [6, 0],
        }
      } else {
        const fromPair = numPair(args.from)
        const toPair = numPair(args.to)
        const fromId = strEndpointId(args.fromId) ?? strEndpointId(args.from)
        const toId = strEndpointId(args.toId) ?? strEndpointId(args.to)
        path = {
          type: 'segment',
          segmentId: strEndpointId(args.segmentId),
          fromId,
          toId,
          from: fromPair ?? [0, 0],
          to: toPair ?? [6, 0],
        }
        if (!fromId && !toId && fromPair && toPair) {
          extraCoords.push({ x: fromPair[0], y: fromPair[1] }, { x: toPair[0], y: toPair[1] })
        }
      }

      const defaultTMin =
        path.type === 'function'
          ? state.coordinate.viewport.xMin
          : path.type === 'line'
            ? -10
            : 0
      const defaultTMax =
        path.type === 'function'
          ? state.coordinate.viewport.xMax
          : path.type === 'circle'
            ? Number((Math.PI * 2).toFixed(4))
            : path.type === 'segment' || path.type === 'polyline'
              ? 1
              : path.type === 'line' || path.type === 'ray'
                ? 10
                : 4
      const rawTMin = num(args.tMin, defaultTMin)
      const rawTMax = num(args.tMax, defaultTMax)
      const tMin = Math.min(rawTMin, rawTMax)
      const tMax = Math.max(rawTMin, rawTMax)
      const initialT = Math.max(tMin, Math.min(tMax, num(args.initialT, (tMin + tMax) / 2)))
      const mp: CoordMovingPoint = {
        id,
        label: str(args.label, id),
        path,
        tMin,
        tMax,
        initialT,
        color: str(args.color, '#EF4444'),
        draggable: bool(args.draggable, true),
        trace: bool(args.trace, false),
        traceColor: typeof args.traceColor === 'string' ? args.traceColor : undefined,
        visible: bool(args.visible, true),
        stepIndex,
      }
      return {
        ...state,
        activeMode: 'coordinate',
        hasCoordinate: true,
        coordinate: {
          ...state.coordinate,
          viewport: expandViewportForPoints(state.coordinate, extraCoords),
          movingPoints: upsertById(state.coordinate.movingPoints, mp),
          highlightedIds: [id],
        },
      }
    }

    case 'coord_add_derived_point': {
      const id = str(args.id, `D${state.coordinate.derivedPoints.length + 1}`)
      const rawKind = str(args.kind, 'midpoint').trim().toLowerCase()
      const kind: DerivedPointKind = VALID_DERIVED_KINDS.has(rawKind as DerivedPointKind)
        ? (rawKind as DerivedPointKind)
        : rawKind === 'foot' || rawKind === 'projection'
          ? 'perpendicular_foot'
          : rawKind === 'reflect' || rawKind === 'mirror'
            ? 'symmetry'
            : 'midpoint'
      const targetLineArr = strArray(args.targetLine)
      const line1Arr = strArray(args.line1)
      const line2Arr = strArray(args.line2)
      const derived: CoordDerivedPoint = {
        id,
        label: str(args.label, id),
        kind,
        pointIds: strArray(args.pointIds).length
          ? strArray(args.pointIds)
          : strArray(args.vertexIds).length
            ? strArray(args.vertexIds)
            : strArray(args.points),
        fromId: strEndpointId(args.fromId) ?? strEndpointId(args.from) ?? strEndpointId(args.pointId),
        toId: strEndpointId(args.toId) ?? strEndpointId(args.to),
        ratio: optNum(args.ratio),
        ratioExpr: typeof args.ratioExpr === 'string' ? args.ratioExpr : undefined,
        axis: args.axis === 'x' || args.axis === 'y' ? args.axis : undefined,
        targetLineFromId:
          strEndpointId(args.targetLineFromId) ?? strEndpointId(targetLineArr[0]),
        targetLineToId:
          strEndpointId(args.targetLineToId) ?? strEndpointId(targetLineArr[1]),
        targetSegmentId: strEndpointId(args.targetSegmentId) ?? strEndpointId(args.segmentId),
        centerId: strEndpointId(args.centerId) ?? strEndpointId(args.center),
        angleDeg: optNum(args.angleDeg ?? args.angle),
        angleExpr: typeof args.angleExpr === 'string' ? args.angleExpr : undefined,
        dx: optNum(args.dx),
        dy: optNum(args.dy),
        vectorFromId: strEndpointId(args.vectorFromId),
        vectorToId: strEndpointId(args.vectorToId),
        target1Id: strEndpointId(args.target1Id) ?? strEndpointId(args.segment1Id),
        target2Id: strEndpointId(args.target2Id) ?? strEndpointId(args.segment2Id),
        line1FromId: strEndpointId(args.line1FromId) ?? strEndpointId(line1Arr[0]),
        line1ToId: strEndpointId(args.line1ToId) ?? strEndpointId(line1Arr[1]),
        line2FromId: strEndpointId(args.line2FromId) ?? strEndpointId(line2Arr[0]),
        line2ToId: strEndpointId(args.line2ToId) ?? strEndpointId(line2Arr[1]),
        circleId: strEndpointId(args.circleId) ?? strEndpointId(args.circle1Id),
        circle2Id: strEndpointId(args.circle2Id),
        index: optNum(args.index),
        xExpr: typeof args.xExpr === 'string' ? args.xExpr : undefined,
        yExpr: typeof args.yExpr === 'string' ? args.yExpr : undefined,
        color: str(args.color, '#10B981'),
        trace: bool(args.trace, false),
        traceColor: typeof args.traceColor === 'string' ? args.traceColor : undefined,
        visible: bool(args.visible, true),
        stepIndex,
      }
      return {
        ...state,
        activeMode: 'coordinate',
        hasCoordinate: true,
        coordinate: {
          ...state.coordinate,
          derivedPoints: upsertById(state.coordinate.derivedPoints, derived),
          highlightedIds: [id],
        },
      }
    }

    case 'coord_draw_segment': {
      const pointsList = Array.isArray(args.points) ? args.points : undefined
      const fromId =
        strEndpointId(args.fromId) ??
        strEndpointId(args.from) ??
        strEndpointId(args.start) ??
        strEndpointId(pointsList?.[0])
      const toId =
        strEndpointId(args.toId) ??
        strEndpointId(args.to) ??
        strEndpointId(args.end) ??
        strEndpointId(pointsList?.[1])
      const from = numPair(args.from) ?? numPair(args.start) ?? numPair(pointsList?.[0])
      const to = numPair(args.to) ?? numPair(args.end) ?? numPair(pointsList?.[1])
      if ((!fromId && !from) || (!toId && !to)) {
        return state
      }
      const id = str(
        args.id,
        `seg-${fromId ?? 'pt'}-${toId ?? state.coordinate.segments.length + 1}`
      )
      const rawKind = str(args.kind, 'segment')
      const kind: CoordSegment['kind'] =
        rawKind === 'line' || rawKind === 'ray' || rawKind === 'vector' ? rawKind : 'segment'
      const segment: CoordSegment = {
        id,
        fromId,
        toId,
        from,
        to,
        kind,
        color: str(args.color, '#2563EB'),
        label: typeof args.label === 'string' ? args.label : undefined,
        showLength: bool(args.showLength, false),
        showSlope: bool(args.showSlope, false),
        ticks: optNum(args.ticks),
        dashed: bool(args.dashed, false),
        width: optNum(args.width),
        visible: bool(args.visible, true),
        stepIndex,
      }
      const extraCoords = [
        ...(from ? [{ x: from[0], y: from[1] }] : []),
        ...(to ? [{ x: to[0], y: to[1] }] : []),
      ]
      return {
        ...state,
        activeMode: 'coordinate',
        hasCoordinate: true,
        coordinate: {
          ...state.coordinate,
          viewport: expandViewportForPoints(state.coordinate, extraCoords),
          segments: upsertById(state.coordinate.segments, segment),
          highlightedIds: [id],
        },
      }
    }

    case 'coord_draw_function': {
      const rawKind = str(args.kind, '')
      const xExpr = typeof args.xExpr === 'string' ? args.xExpr : undefined
      const yExpr = typeof args.yExpr === 'string' ? args.yExpr : undefined
      const rExpr = typeof args.rExpr === 'string' ? args.rExpr : undefined
      const ineq =
        args.inequality === '<' ||
        args.inequality === '<=' ||
        args.inequality === '>' ||
        args.inequality === '>='
          ? args.inequality
          : undefined
      const kind: CoordFunctionKind =
        rawKind === 'parametric' || rawKind === 'polar' || rawKind === 'inequality'
          ? rawKind
          : xExpr && yExpr
            ? 'parametric'
            : rExpr
              ? 'polar'
              : ineq
                ? 'inequality'
                : 'explicit'

      const expr = str(args.expr)
      if (kind === 'explicit' && !expr) {
        return state
      }
      if (kind === 'inequality' && !expr) {
        return state
      }
      if (kind === 'parametric' && (!xExpr || !yExpr)) {
        return state
      }
      if (kind === 'polar' && !rExpr && !expr) {
        return state
      }

      const id = str(args.id, `fn-${state.coordinate.functions.length + 1}`)
      const defaultLabel =
        kind === 'parametric'
          ? `(${xExpr}, ${yExpr})`
          : kind === 'polar'
            ? `r = ${rExpr ?? expr}`
            : kind === 'inequality'
              ? `y ${ineq ?? '<='} ${expr}`
              : `y = ${expr}`
      const fn: CoordFunction = {
        id,
        kind,
        expr,
        xExpr,
        yExpr,
        rExpr: rExpr ?? (kind === 'polar' ? expr : undefined),
        inequality: ineq,
        fill:
          typeof args.fill === 'string'
            ? args.fill
            : kind === 'inequality'
              ? 'rgba(57, 100, 254, 0.14)'
              : undefined,
        label: typeof args.label === 'string' ? args.label : defaultLabel,
        color: str(args.color, '#3964FE'),
        domain: numPair(args.domain),
        tDomain: numPair(args.tDomain),
        dashed: bool(args.dashed, ineq === '<' || ineq === '>'),
        visible: bool(args.visible, true),
        stepIndex,
      }
      return {
        ...state,
        activeMode: 'coordinate',
        hasCoordinate: true,
        coordinate: {
          ...state.coordinate,
          functions: upsertById(state.coordinate.functions, fn),
          highlightedIds: [id],
        },
      }
    }

    case 'coord_draw_polygon': {
      let vertexIds = strArray(args.vertexIds)
      if (vertexIds.length === 0) {
        vertexIds = strArray(args.vertices)
      }
      let extraPoints = state.coordinate.points
      const rawPoints = Array.isArray(args.points) ? args.points : undefined
      if (vertexIds.length === 0 && rawPoints) {
        const stringIds = strArray(rawPoints)
        if (stringIds.length >= 3) {
          vertexIds = stringIds
        } else {
          const pairs = rawPoints.map(numPair).filter((p): p is [number, number] => Boolean(p))
          if (pairs.length >= 3) {
            const polyIdSeed = str(args.id, `poly-${state.coordinate.polygons.length + 1}`)
            vertexIds = pairs.map(([x, y], idx) => {
              const pid = `${polyIdSeed}_v${idx + 1}`
              extraPoints = upsertById(extraPoints, {
                id: pid,
                label: '',
                x,
                y,
                color: str(args.stroke, '#3964FE'),
                stepIndex,
              })
              return pid
            })
          }
        }
      }
      if (vertexIds.length < 3) {
        return state
      }
      const id = str(args.id, `poly-${vertexIds.join('-')}`)
      const poly: CoordPolygon = {
        id,
        vertexIds,
        fill: str(args.fill, 'rgba(57, 100, 254, 0.14)'),
        stroke: str(args.stroke, '#3964FE'),
        label: typeof args.label === 'string' ? args.label : undefined,
        showArea: bool(args.showArea, false),
        showPerimeter: bool(args.showPerimeter, false),
        dashed: bool(args.dashed, false),
        visible: bool(args.visible, true),
        stepIndex,
      }
      return {
        ...state,
        activeMode: 'coordinate',
        hasCoordinate: true,
        coordinate: {
          ...state.coordinate,
          points: extraPoints,
          polygons: upsertById(state.coordinate.polygons, poly),
          highlightedIds: [id],
        },
      }
    }

    case 'coord_draw_circle': {
      let centerId = strEndpointId(args.centerId) ?? strEndpointId(args.center)
      let extraPoints = state.coordinate.points
      const centerPair = numPair(args.center)
      if (!centerId && centerPair) {
        centerId = `center_${str(args.id, String(state.coordinate.circles.length + 1))}`
        extraPoints = upsertById(extraPoints, {
          id: centerId,
          label: `${centerId}(${centerPair[0]}, ${centerPair[1]})`,
          x: centerPair[0],
          y: centerPair[1],
          color: str(args.color, '#0EA5E9'),
          stepIndex,
        })
      }
      if (!centerId) {
        return state
      }
      const id = str(args.id, `circle-${centerId}`)
      const rawRadius = args.radius ?? args.r
      const circle: CoordCircle = {
        id,
        centerId,
        radius:
          typeof rawRadius === 'number' || (typeof rawRadius === 'string' && Number.isFinite(Number(rawRadius)))
            ? Math.abs(num(rawRadius, 1))
            : undefined,
        radiusExpr:
          typeof args.radiusExpr === 'string'
            ? args.radiusExpr
            : typeof rawRadius === 'string' && !Number.isFinite(Number(rawRadius))
              ? rawRadius
              : undefined,
        radiusPointId:
          strEndpointId(args.radiusPointId) ?? strEndpointId(args.radiusPoint) ?? undefined,
        color: str(args.color, '#0EA5E9'),
        fill: typeof args.fill === 'string' ? args.fill : undefined,
        dashed: bool(args.dashed, false),
        label: typeof args.label === 'string' ? args.label : undefined,
        visible: bool(args.visible, true),
        stepIndex,
      }
      return {
        ...state,
        activeMode: 'coordinate',
        hasCoordinate: true,
        coordinate: {
          ...state.coordinate,
          points: extraPoints,
          circles: upsertById(state.coordinate.circles, circle),
          highlightedIds: [id],
        },
      }
    }

    case 'coord_draw_angle': {
      const pts = strArray(args.points).length ? strArray(args.points) : strArray(args.pointIds)
      const fromId = strEndpointId(args.fromId) ?? strEndpointId(args.from) ?? pts[0]
      const vertexId = strEndpointId(args.vertexId) ?? strEndpointId(args.vertex) ?? pts[1]
      const toId = strEndpointId(args.toId) ?? strEndpointId(args.to) ?? pts[2]
      if (!fromId || !vertexId || !toId) {
        return state
      }
      const id = str(args.id, `angle-${fromId}-${vertexId}-${toId}`)
      const angle: CoordAngle = {
        id,
        fromId,
        vertexId,
        toId,
        label: typeof args.label === 'string' ? args.label : undefined,
        showValue: bool(args.showValue, true),
        rightAngle: bool(args.rightAngle, false),
        radius: optNum(args.radius),
        color: str(args.color, '#F59E0B'),
        visible: bool(args.visible, true),
        stepIndex,
      }
      return {
        ...state,
        activeMode: 'coordinate',
        hasCoordinate: true,
        coordinate: {
          ...state.coordinate,
          angles: upsertById(state.coordinate.angles, angle),
          highlightedIds: [id],
        },
      }
    }

    case 'coord_draw_auxiliary_line': {
      const fromId = strEndpointId(args.fromId) ?? strEndpointId(args.from)
      if (!fromId) {
        return state
      }
      const rawKind = str(args.kind, 'connect')
      const kind: CoordAuxiliaryKind =
        rawKind === 'perpendicular' ||
        rawKind === 'parallel' ||
        rawKind === 'symmetry' ||
        rawKind === 'bisector'
          ? rawKind
          : 'connect'
      const id = str(args.id, `aux-${state.coordinate.auxiliaryLines.length + 1}`)
      const axis =
        args.axis === 'x' || args.axis === 'y'
          ? args.axis
          : args.line === 'x' || args.line === 'y'
            ? args.line
            : undefined
      const targetLineArr = strArray(args.targetLine)
      const aux: CoordAuxiliaryLine = {
        id,
        kind,
        fromId,
        toId: strEndpointId(args.toId) ?? strEndpointId(args.to),
        vertexId: strEndpointId(args.vertexId) ?? strEndpointId(args.vertex),
        targetLineFromId:
          strEndpointId(args.targetLineFromId) ?? strEndpointId(targetLineArr[0]),
        targetLineToId: strEndpointId(args.targetLineToId) ?? strEndpointId(targetLineArr[1]),
        targetSegmentId: strEndpointId(args.targetSegmentId) ?? strEndpointId(args.segmentId),
        axis,
        derivedPointId: strEndpointId(args.derivedPointId),
        derivedPointLabel:
          typeof args.derivedPointLabel === 'string' ? args.derivedPointLabel : undefined,
        label: typeof args.label === 'string' ? args.label : undefined,
        color: str(args.color, '#F59E0B'),
        showRightAngle: bool(args.showRightAngle, kind === 'perpendicular' || kind === 'symmetry'),
        visible: bool(args.visible, true),
        stepIndex,
      }
      return {
        ...state,
        activeMode: 'coordinate',
        hasCoordinate: true,
        coordinate: {
          ...state.coordinate,
          auxiliaryLines: upsertById(state.coordinate.auxiliaryLines, aux),
          highlightedIds: [id, ...(aux.derivedPointId ? [aux.derivedPointId] : [])],
        },
      }
    }

    case 'coord_add_measurement': {
      const id = str(args.id, `measure-${state.coordinate.measurements.length + 1}`)
      const rawKind = str(args.kind, typeof args.expr === 'string' ? 'expr' : 'distance')
      const kind: CoordMeasurementKind = VALID_MEASUREMENT_KINDS.has(rawKind as CoordMeasurementKind)
        ? (rawKind as CoordMeasurementKind)
        : 'distance'
      const rawPairs = Array.isArray(args.pairs)
        ? args.pairs.filter(
            (pair): pair is [string, string] =>
              Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'string'
          )
        : undefined
      const measurement: CoordMeasurement = {
        id,
        label: str(args.label, '度量'),
        kind,
        pointIds: strArray(args.pointIds).length ? strArray(args.pointIds) : strArray(args.points),
        pairs: rawPairs,
        expr: typeof args.expr === 'string' ? args.expr : undefined,
        optimalValue:
          args.optimalValue !== undefined ? num(args.optimalValue, Number.NaN) : undefined,
        optimalHint: typeof args.optimalHint === 'string' ? args.optimalHint : undefined,
        color: str(args.color, '#10B981'),
        stepIndex,
      }
      return {
        ...state,
        activeMode: 'coordinate',
        hasCoordinate: true,
        coordinate: {
          ...state.coordinate,
          measurements: upsertById(state.coordinate.measurements, measurement),
        },
      }
    }

    case 'coord_add_slider': {
      const id = str(args.id, str(args.name, `k${state.coordinate.sliders.length + 1}`)).trim()
      if (!id) {
        return state
      }
      const rawMin = num(args.min, -5)
      const rawMax = num(args.max, 5)
      const min = Math.min(rawMin, rawMax)
      const max = Math.max(rawMin, rawMax)
      const step = Math.max(0.001, num(args.step, (max - min) / 100))
      const initialValue = Math.max(min, Math.min(max, num(args.value ?? args.initialValue, (min + max) / 2)))
      const slider: CoordSlider = {
        id,
        label: str(args.label, id),
        min,
        max,
        step,
        initialValue,
        unit: typeof args.unit === 'string' ? args.unit : undefined,
        stepIndex,
      }
      return {
        ...state,
        activeMode: 'coordinate',
        hasCoordinate: true,
        coordinate: {
          ...state.coordinate,
          sliders: upsertById(state.coordinate.sliders, slider),
        },
      }
    }

    case 'coord_add_constraint': {
      const id = str(args.id, `con-${state.coordinate.constraints.length + 1}`)
      const kind = normalizeConstraintKind(str(args.kind, str(args.type, 'fixed_length')))
      const rawPairs = Array.isArray(args.pairs)
        ? args.pairs.filter(
            (pair): pair is [string, string] =>
              Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'string'
          )
        : undefined
      const pointIds = strArray(args.pointIds).length
        ? strArray(args.pointIds)
        : strArray(args.points)
      const targets = strArray(args.targets)
      const defaultLabel = (() => {
        if (kind === 'fixed_length') {
          return `定长 ${pointIds.join('') || str(args.segmentId, '')} = ${args.expr ?? args.value ?? ''}`
        }
        if (kind === 'equal_length') {
          return '等长约束'
        }
        if (kind === 'perpendicular') {
          return '垂直约束 ⊥'
        }
        if (kind === 'parallel') {
          return '平行约束 ∥'
        }
        if (kind === 'fixed_angle') {
          return `定角 ${args.angleDeg ?? args.value ?? 90}°`
        }
        if (kind === 'fixed_area') {
          return `定面积 S = ${args.expr ?? args.value ?? ''}`
        }
        if (kind === 'custom_equation') {
          return `方程 ${str(args.expr, '')}`
        }
        return `约束 ${kind}`
      })()

      const constraint: CoordConstraint = {
        id,
        kind,
        label: str(args.label, defaultLabel),
        targets: targets.length > 0 ? targets : undefined,
        pointIds: pointIds.length > 0 ? pointIds : undefined,
        pointId: strEndpointId(args.pointId),
        sourceId: strEndpointId(args.sourceId),
        pairs: rawPairs,
        segmentId: strEndpointId(args.segmentId),
        segmentIds: strArray(args.segmentIds).length ? strArray(args.segmentIds) : undefined,
        circleId: strEndpointId(args.circleId),
        functionId: strEndpointId(args.functionId),
        fromId: strEndpointId(args.fromId) ?? strEndpointId(args.from),
        toId: strEndpointId(args.toId) ?? strEndpointId(args.to),
        axis: args.axis === 'x' || args.axis === 'y' ? args.axis : undefined,
        centerId: strEndpointId(args.centerId),
        value: optNum(args.value ?? args.length ?? args.distance),
        expr: typeof args.expr === 'string' ? args.expr : undefined,
        ratio: optNum(args.ratio),
        angleDeg: optNum(args.angleDeg ?? args.angle),
        radius: optNum(args.radius ?? args.r),
        xMin: optNum(args.xMin),
        xMax: optNum(args.xMax),
        yMin: optNum(args.yMin),
        yMax: optNum(args.yMax),
        enabled: bool(args.enabled, true),
        stepIndex,
      }
      return {
        ...state,
        activeMode: 'coordinate',
        hasCoordinate: true,
        coordinate: {
          ...state.coordinate,
          constraints: upsertById(state.coordinate.constraints, constraint),
        },
      }
    }

    case 'coord_remove_constraint': {
      const removeSet = new Set<string>([
        ...strArray(args.ids),
        ...(typeof args.id === 'string' && args.id.trim() ? [args.id.trim()] : []),
      ])
      if (removeSet.size === 0) {
        return {
          ...state,
          activeMode: 'coordinate',
          coordinate: { ...state.coordinate, constraints: [] },
        }
      }
      return {
        ...state,
        activeMode: 'coordinate',
        coordinate: {
          ...state.coordinate,
          constraints: state.coordinate.constraints.filter((c) => !removeSet.has(c.id)),
        },
      }
    }

    case 'coord_set_script': {
      const code = str(args.code, str(args.script, ''))
      if (!code.trim()) {
        return state
      }
      const rawLoop = str(args.loopMode, 'bounce')
      const loopMode: CoordMotionScript['loopMode'] =
        rawLoop === 'loop' || rawLoop === 'once' ? rawLoop : 'bounce'
      const script: CoordMotionScript = {
        id: str(args.id, `script-${stepIndex}`),
        title: str(args.title, 'AI 动点控制程序'),
        description: typeof args.description === 'string' ? args.description : undefined,
        code,
        duration: Math.max(0.5, num(args.duration, 6)),
        loopMode,
        autoPlay: bool(args.autoPlay, false),
        enabled: bool(args.enabled, true),
        stepIndex,
      }
      return {
        ...state,
        activeMode: 'coordinate',
        hasCoordinate: true,
        coordinate: {
          ...state.coordinate,
          motionScript: script,
        },
      }
    }

    case 'coord_remove_script':
      return {
        ...state,
        activeMode: 'coordinate',
        coordinate: {
          ...state.coordinate,
          motionScript: null,
        },
      }

    case 'coord_toggle_trace': {
      const ids = new Set<string>([
        ...strArray(args.pointIds),
        ...strArray(args.ids),
        ...(typeof args.pointId === 'string' && args.pointId.trim() ? [args.pointId.trim()] : []),
        ...(typeof args.id === 'string' && args.id.trim() ? [args.id.trim()] : []),
      ])
      const enabled = bool(args.enabled, true)
      const traceColor = typeof args.color === 'string' ? args.color : undefined
      return {
        ...state,
        activeMode: 'coordinate',
        hasCoordinate: true,
        coordinate: {
          ...state.coordinate,
          points: state.coordinate.points.map((p) =>
            ids.size === 0 || ids.has(p.id)
              ? { ...p, trace: enabled, traceColor: traceColor ?? p.traceColor }
              : p
          ),
          movingPoints: state.coordinate.movingPoints.map((mp) =>
            ids.size === 0 || ids.has(mp.id)
              ? { ...mp, trace: enabled, traceColor: traceColor ?? mp.traceColor }
              : mp
          ),
          derivedPoints: state.coordinate.derivedPoints.map((dp) =>
            ids.size === 0 || ids.has(dp.id)
              ? { ...dp, trace: enabled, traceColor: traceColor ?? dp.traceColor }
              : dp
          ),
        },
      }
    }

    case 'coord_update': {
      const id = str(args.id).trim()
      if (!id) {
        return state
      }
      const c = state.coordinate
      const patchColor = typeof args.color === 'string' ? args.color : undefined
      const patchLabel = typeof args.label === 'string' ? args.label : undefined
      const patchVisible = typeof args.visible === 'boolean' ? args.visible : undefined
      const patchDashed = typeof args.dashed === 'boolean' ? args.dashed : undefined
      const patchTrace = typeof args.trace === 'boolean' ? args.trace : undefined
      const patchDraggable = typeof args.draggable === 'boolean' ? args.draggable : undefined
      const patchX = optNum(args.x)
      const patchY = optNum(args.y)

      return {
        ...state,
        activeMode: 'coordinate',
        hasCoordinate: true,
        coordinate: {
          ...c,
          points: c.points.map((p) =>
            p.id === id
              ? {
                  ...p,
                  x: patchX ?? p.x,
                  y: patchY ?? p.y,
                  color: patchColor ?? p.color,
                  label: patchLabel ?? p.label,
                  visible: patchVisible ?? p.visible,
                  trace: patchTrace ?? p.trace,
                  draggable: patchDraggable ?? p.draggable,
                  pinned: typeof args.pinned === 'boolean' ? args.pinned : p.pinned,
                }
              : p
          ),
          movingPoints: c.movingPoints.map((mp) =>
            mp.id === id
              ? {
                  ...mp,
                  color: patchColor ?? mp.color,
                  label: patchLabel ?? mp.label,
                  visible: patchVisible ?? mp.visible,
                  trace: patchTrace ?? mp.trace,
                  draggable: patchDraggable ?? mp.draggable,
                  tMin: optNum(args.tMin) ?? mp.tMin,
                  tMax: optNum(args.tMax) ?? mp.tMax,
                }
              : mp
          ),
          derivedPoints: c.derivedPoints.map((dp) =>
            dp.id === id
              ? {
                  ...dp,
                  color: patchColor ?? dp.color,
                  label: patchLabel ?? dp.label,
                  visible: patchVisible ?? dp.visible,
                  trace: patchTrace ?? dp.trace,
                }
              : dp
          ),
          segments: c.segments.map((s) =>
            s.id === id
              ? {
                  ...s,
                  color: patchColor ?? s.color,
                  label: patchLabel ?? s.label,
                  visible: patchVisible ?? s.visible,
                  dashed: patchDashed ?? s.dashed,
                  showLength: typeof args.showLength === 'boolean' ? args.showLength : s.showLength,
                  ticks: optNum(args.ticks) ?? s.ticks,
                }
              : s
          ),
          functions: c.functions.map((f) =>
            f.id === id
              ? {
                  ...f,
                  expr: typeof args.expr === 'string' ? args.expr : f.expr,
                  color: patchColor ?? f.color,
                  label: patchLabel ?? f.label,
                  visible: patchVisible ?? f.visible,
                  dashed: patchDashed ?? f.dashed,
                }
              : f
          ),
          polygons: c.polygons.map((poly) =>
            poly.id === id
              ? {
                  ...poly,
                  fill: typeof args.fill === 'string' ? args.fill : poly.fill,
                  stroke: typeof args.stroke === 'string' ? args.stroke : patchColor ?? poly.stroke,
                  label: patchLabel ?? poly.label,
                  visible: patchVisible ?? poly.visible,
                  showArea: typeof args.showArea === 'boolean' ? args.showArea : poly.showArea,
                }
              : poly
          ),
          circles: c.circles.map((circ) =>
            circ.id === id
              ? {
                  ...circ,
                  radius: optNum(args.radius) ?? circ.radius,
                  color: patchColor ?? circ.color,
                  label: patchLabel ?? circ.label,
                  visible: patchVisible ?? circ.visible,
                  dashed: patchDashed ?? circ.dashed,
                }
              : circ
          ),
          angles: c.angles.map((ang) =>
            ang.id === id
              ? {
                  ...ang,
                  color: patchColor ?? ang.color,
                  label: patchLabel ?? ang.label,
                  visible: patchVisible ?? ang.visible,
                }
              : ang
          ),
          auxiliaryLines: c.auxiliaryLines.map((aux) =>
            aux.id === id
              ? {
                  ...aux,
                  color: patchColor ?? aux.color,
                  label: patchLabel ?? aux.label,
                  visible: patchVisible ?? aux.visible,
                }
              : aux
          ),
          annotations: c.annotations.map((n) =>
            n.id === id
              ? {
                  ...n,
                  text: typeof args.text === 'string' ? args.text : n.text,
                  color: patchColor ?? n.color,
                  visible: patchVisible ?? n.visible,
                }
              : n
          ),
          constraints: c.constraints.map((con) =>
            con.id === id
              ? {
                  ...con,
                  label: patchLabel ?? con.label,
                  enabled: typeof args.enabled === 'boolean' ? args.enabled : con.enabled,
                  value: optNum(args.value) ?? con.value,
                  expr: typeof args.expr === 'string' ? args.expr : con.expr,
                }
              : con
          ),
        },
      }
    }

    case 'coord_set_t': {
      const pointId = str(args.pointId, str(args.id, 'P'))
      const xy = extractXY(args)
      const t = optNum(args.t)
      if (t === undefined && !xy) {
        return state
      }
      return {
        ...state,
        activeMode: 'coordinate',
        hasCoordinate: true,
        coordinate: {
          ...state.coordinate,
          targetT: t !== undefined ? { ...state.coordinate.targetT, [pointId]: t } : state.coordinate.targetT,
          targetPositions: xy
            ? { ...state.coordinate.targetPositions, [pointId]: xy }
            : state.coordinate.targetPositions,
          highlightedIds: [pointId],
        },
      }
    }

    case 'coord_set_param': {
      const id = str(args.id, str(args.name, '')).trim()
      const value = optNum(args.value ?? args.t)
      if (!id || value === undefined) {
        return state
      }
      return {
        ...state,
        activeMode: 'coordinate',
        hasCoordinate: true,
        coordinate: {
          ...state.coordinate,
          targetParams: { ...state.coordinate.targetParams, [id]: value },
        },
      }
    }

    case 'coord_highlight': {
      const ids = strArray(args.ids)
      return {
        ...state,
        activeMode: 'coordinate',
        coordinate: { ...state.coordinate, highlightedIds: ids },
      }
    }

    case 'coord_annotate': {
      const text = str(args.text, str(args.label))
      if (!text.trim()) {
        return state
      }
      const id = str(args.id, `note-${state.coordinate.annotations.length + 1}`)
      const anchorPointId =
        strEndpointId(args.anchorPointId) ??
        strEndpointId(args.anchor) ??
        strEndpointId(args.pointId)
      const xy = extractXY(args)
      if (!anchorPointId && !xy) {
        return state
      }
      return {
        ...state,
        activeMode: 'coordinate',
        hasCoordinate: true,
        coordinate: {
          ...state.coordinate,
          annotations: upsertById(state.coordinate.annotations, {
            id,
            text: text.trim(),
            x: xy?.x,
            y: xy?.y,
            anchorPointId,
            color: str(args.color, '#3964FE'),
            visible: bool(args.visible, true),
            stepIndex,
          }),
          highlightedIds: [id],
        },
      }
    }

    case 'board_switch': {
      const mode = args.mode === 'flowchart' ? 'flowchart' : 'coordinate'
      return {
        ...state,
        activeMode: mode,
      }
    }

    case 'coord_remove': {
      const removeSet = new Set<string>([
        ...strArray(args.ids),
        ...(typeof args.id === 'string' && args.id.trim() ? [args.id.trim()] : []),
      ])
      if (removeSet.size === 0) {
        return state
      }
      const nextTargetT = Object.fromEntries(
        Object.entries(state.coordinate.targetT).filter(([key]) => !removeSet.has(key))
      )
      const nextTargetPositions = Object.fromEntries(
        Object.entries(state.coordinate.targetPositions).filter(([key]) => !removeSet.has(key))
      )
      return {
        ...state,
        activeMode: 'coordinate',
        coordinate: {
          ...state.coordinate,
          points: state.coordinate.points.filter((p) => !removeSet.has(p.id)),
          movingPoints: state.coordinate.movingPoints.filter((p) => !removeSet.has(p.id)),
          derivedPoints: state.coordinate.derivedPoints.filter((p) => !removeSet.has(p.id)),
          segments: state.coordinate.segments.filter(
            (s) =>
              !removeSet.has(s.id) &&
              !(s.fromId && removeSet.has(s.fromId)) &&
              !(s.toId && removeSet.has(s.toId))
          ),
          functions: state.coordinate.functions.filter((f) => !removeSet.has(f.id)),
          polygons: state.coordinate.polygons.filter((p) => !removeSet.has(p.id)),
          circles: state.coordinate.circles.filter((c) => !removeSet.has(c.id)),
          angles: state.coordinate.angles.filter((a) => !removeSet.has(a.id)),
          auxiliaryLines: state.coordinate.auxiliaryLines.filter(
            (a) => !removeSet.has(a.id) && !(a.derivedPointId && removeSet.has(a.derivedPointId))
          ),
          measurements: state.coordinate.measurements.filter((m) => !removeSet.has(m.id)),
          annotations: state.coordinate.annotations.filter((n) => !removeSet.has(n.id)),
          sliders: state.coordinate.sliders.filter((s) => !removeSet.has(s.id)),
          constraints: state.coordinate.constraints.filter((c) => !removeSet.has(c.id)),
          highlightedIds: state.coordinate.highlightedIds.filter((id) => !removeSet.has(id)),
          targetT: nextTargetT,
          targetPositions: nextTargetPositions,
        },
      }
    }

    case 'flow_clear':
      return {
        ...state,
        activeMode: 'flowchart',
        flowchart: createEmptyFlowchartState(),
      }

    case 'flow_init': {
      const direction = args.direction === 'LR' ? 'LR' : 'TD'
      return {
        ...state,
        activeMode: 'flowchart',
        hasFlowchart: true,
        flowchart: {
          ...createEmptyFlowchartState(),
          title: str(args.title, '解题思维流程图'),
          direction,
        },
      }
    }

    case 'flow_add_node': {
      const id = str(args.id, `node-${state.flowchart.nodes.length + 1}`)
      const rawKind = str(args.kind, str(args.type, 'process'))
      const kind: FlowNodeKind =
        rawKind === 'start' ||
        rawKind === 'decision' ||
        rawKind === 'question' ||
        rawKind === 'result' ||
        rawKind === 'grammar'
          ? rawKind
          : 'process'
      const status =
        args.status === 'pending' || args.status === 'solved'
          ? args.status
          : kind === 'question'
            ? 'pending'
            : 'active'
      const label =
        str(args.label, '') ||
        str(args.title, '') ||
        str(args.text, '') ||
        str(args.name, '') ||
        id
      const sublabelRaw = args.sublabel ?? args.description ?? args.desc ?? args.detail
      const node: FlowNode = {
        id,
        label,
        sublabel: typeof sublabelRaw === 'string' && sublabelRaw.trim() ? sublabelRaw : undefined,
        kind,
        status,
        stepIndex,
      }
      return {
        ...state,
        activeMode: 'flowchart',
        hasFlowchart: true,
        flowchart: {
          ...state.flowchart,
          nodes: upsertById(state.flowchart.nodes, node),
          highlightedIds: [id],
        },
      }
    }

    case 'flow_update_node': {
      const id = str(args.id)
      if (!id) {
        return state
      }
      const existing = state.flowchart.nodes.find((n) => n.id === id)
      const rawKind = str(args.kind, str(args.type, existing?.kind ?? 'process'))
      const kind: FlowNodeKind =
        rawKind === 'start' ||
        rawKind === 'process' ||
        rawKind === 'decision' ||
        rawKind === 'question' ||
        rawKind === 'result' ||
        rawKind === 'grammar'
          ? rawKind
          : (existing?.kind ?? 'process')
      const nextLabel =
        str(args.label, '') || str(args.title, '') || str(args.text, '') || existing?.label || id
      const sublabelRaw = args.sublabel ?? args.description ?? args.desc ?? args.detail
      const updated: FlowNode = {
        id,
        label: nextLabel,
        sublabel:
          typeof sublabelRaw === 'string'
            ? sublabelRaw.trim() || undefined
            : existing?.sublabel,
        kind,
        status: args.status === 'pending' || args.status === 'active' ? args.status : 'solved',
        stepIndex: existing?.stepIndex ?? stepIndex,
      }
      return {
        ...state,
        activeMode: 'flowchart',
        hasFlowchart: true,
        flowchart: {
          ...state.flowchart,
          nodes: upsertById(state.flowchart.nodes, updated),
          highlightedIds: [id],
        },
      }
    }

    case 'flow_add_edge': {
      const from = strEndpointId(args.from) ?? strEndpointId(args.source) ?? strEndpointId(args.fromId)
      const to = strEndpointId(args.to) ?? strEndpointId(args.target) ?? strEndpointId(args.toId)
      if (!from || !to) {
        return state
      }
      const id = str(args.id, `edge-${from}-${to}`)
      const edge: FlowEdge = {
        id,
        from,
        to,
        label: typeof args.label === 'string' ? args.label : undefined,
        dashed: bool(args.dashed, false),
        stepIndex,
      }
      return {
        ...state,
        activeMode: 'flowchart',
        hasFlowchart: true,
        flowchart: {
          ...state.flowchart,
          edges: upsertById(state.flowchart.edges, edge),
          highlightedIds: [to],
        },
      }
    }

    case 'flow_highlight': {
      const ids = strArray(args.ids)
      return {
        ...state,
        activeMode: 'flowchart',
        flowchart: { ...state.flowchart, highlightedIds: ids },
      }
    }

    case 'flow_remove': {
      const nodeSet = new Set<string>([
        ...strArray(args.nodeIds),
        ...strArray(args.ids),
        ...(typeof args.id === 'string' && args.id.trim() ? [args.id.trim()] : []),
      ])
      const edgeSet = new Set<string>(strArray(args.edgeIds))
      return {
        ...state,
        activeMode: 'flowchart',
        flowchart: {
          ...state.flowchart,
          nodes: state.flowchart.nodes.filter((n) => !nodeSet.has(n.id)),
          edges: state.flowchart.edges.filter(
            (e) =>
              !edgeSet.has(e.id) && !nodeSet.has(e.id) && !nodeSet.has(e.from) && !nodeSet.has(e.to)
          ),
          highlightedIds: state.flowchart.highlightedIds.filter((id) => !nodeSet.has(id)),
        },
      }
    }
  }
}
