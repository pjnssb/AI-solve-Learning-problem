import { evalMathExpr } from './mathEval.js'
import {
  createEmptyCoordinateState,
  createEmptyFlowchartState,
  type CoordAuxiliaryKind,
  type CoordAuxiliaryLine,
  type CoordCircle,
  type CoordFunction,
  type CoordMeasurement,
  type CoordMovingPoint,
  type CoordPoint,
  type CoordPolygon,
  type CoordSegment,
  type CoordinateState,
  type FlowEdge,
  type FlowNode,
  type FlowNodeKind,
  type MovingPointPath,
  type TutorBoardState,
  type TutorToolCall,
} from './types.js'

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))
      ? Number(value)
      : fallback

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

/**
 * 解析坐标系中任意点的实时坐标（支持固定点、动点、以及辅助线自动生成的动态垂足/对称点）。
 */
export const resolvePointCoords = (
  coord: CoordinateState,
  pointId: string,
  tValues: Record<string, number>,
  depth = 0
): { x: number; y: number } | null => {
  if (depth > 4) {
    return null
  }
  const fixed = coord.points.find((p) => p.id === pointId)
  if (fixed) {
    return { x: fixed.x, y: fixed.y }
  }
  const moving = coord.movingPoints.find((p) => p.id === pointId)
  if (moving) {
    const t = Object.hasOwn(tValues, moving.id) ? tValues[moving.id] : moving.initialT
    const clampedT = Math.max(moving.tMin, Math.min(moving.tMax, t))
    const { path } = moving
    if (path.type === 'segment') {
      const a = path.fromId
        ? resolvePointCoords(coord, path.fromId, tValues, depth + 1)
        : path.from
          ? { x: path.from[0], y: path.from[1] }
          : null
      const b = path.toId
        ? resolvePointCoords(coord, path.toId, tValues, depth + 1)
        : path.to
          ? { x: path.to[0], y: path.to[1] }
          : null
      if (!a || !b) {
        return null
      }
      const ratio =
        moving.tMax === moving.tMin ? 0 : (clampedT - moving.tMin) / (moving.tMax - moving.tMin)
      return {
        x: a.x + (b.x - a.x) * ratio,
        y: a.y + (b.y - a.y) * ratio,
      }
    }
    if (path.type === 'function') {
      const y = evalMathExpr(path.expr, { x: clampedT, t: clampedT })
      return Number.isFinite(y) ? { x: clampedT, y } : null
    }
    const x = evalMathExpr(path.xExpr, { t: clampedT, x: clampedT })
    const y = evalMathExpr(path.yExpr, { t: clampedT, x: clampedT })
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
  }

  // 检查是否由某条辅助线动态派生（如垂足 H 或对称点 A'）
  const aux = coord.auxiliaryLines.find((line) => line.derivedPointId === pointId)
  if (aux) {
    const geom = resolveAuxiliaryGeometry(coord, aux, tValues, depth + 1)
    return geom?.derivedPoint ?? null
  }
  return null
}

export type ResolvedAuxiliaryGeometry = {
  from: { x: number; y: number }
  to: { x: number; y: number }
  derivedPoint?: { x: number; y: number }
  /** 若需绘制直角符号，提供垂足和两条单位方向向量 */
  rightAngle?: {
    vertex: { x: number; y: number }
    u: { x: number; y: number }
    v: { x: number; y: number }
  }
}

const projectOntoLine = (
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
): { x: number; y: number } => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-9) {
    return a
  }
  const proj = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  return { x: a.x + proj * dx, y: a.y + proj * dy }
}

/** 计算辅助线端点（支持动点实时联动垂线、对称线、平行线、连线） */
export const resolveAuxiliaryGeometry = (
  coord: CoordinateState,
  aux: CoordAuxiliaryLine,
  tValues: Record<string, number>,
  depth = 0
): ResolvedAuxiliaryGeometry | null => {
  const from = resolvePointCoords(coord, aux.fromId, tValues, depth + 1)
  if (!from) {
    return null
  }

  if (aux.kind === 'connect') {
    if (!aux.toId) {
      return null
    }
    const to = resolvePointCoords(coord, aux.toId, tValues, depth + 1)
    return to ? { from, to } : null
  }

  const getTargetLine = (): [{ x: number; y: number }, { x: number; y: number }] | null => {
    if (aux.axis === 'x') {
      return [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ]
    }
    if (aux.axis === 'y') {
      return [
        { x: 0, y: 0 },
        { x: 0, y: 1 },
      ]
    }
    if (aux.targetLineFromId && aux.targetLineToId) {
      const a = resolvePointCoords(coord, aux.targetLineFromId, tValues, depth + 1)
      const b = resolvePointCoords(coord, aux.targetLineToId, tValues, depth + 1)
      if (a && b) {
        return [a, b]
      }
    }
    return null
  }

  const line = getTargetLine()
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

  // parallel：过 from 点作平行于 la-lb 的参考辅助线
  const dx = lb.x - la.x
  const dy = lb.y - la.y
  const len = Math.hypot(dx, dy) || 1
  const span = Math.max(coord.viewport.xMax - coord.viewport.xMin, 6) * 0.45
  return {
    from: { x: from.x - (dx / len) * span, y: from.y - (dy / len) * span },
    to: { x: from.x + (dx / len) * span, y: from.y + (dy / len) * span },
  }
}

export const computePolygonArea = (points: { x: number; y: number }[]): number => {
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
        coordinate: createEmptyCoordinateState(),
      }

    case 'coord_setup': {
      const nextViewport = {
        xMin: num(args.xMin, state.coordinate.viewport.xMin),
        xMax: num(args.xMax, state.coordinate.viewport.xMax),
        yMin: num(args.yMin, state.coordinate.viewport.yMin),
        yMax: num(args.yMax, state.coordinate.viewport.yMax),
      }
      return {
        ...state,
        activeMode: 'coordinate',
        hasCoordinate: true,
        coordinate: {
          ...state.coordinate,
          title: str(args.title, state.coordinate.title),
          viewport: nextViewport,
          showGrid: bool(args.showGrid, state.coordinate.showGrid),
        },
      }
    }

    case 'coord_plot_point': {
      const id = str(args.id, `P${state.coordinate.points.length + 1}`)
      const x = num(args.x, 0)
      const y = num(args.y, 0)
      const point: CoordPoint = {
        id,
        label: str(args.label, `${id}(${x}, ${y})`),
        x,
        y,
        color: str(args.color, '#3964FE'),
        stepIndex,
      }
      return {
        ...state,
        activeMode: 'coordinate',
        hasCoordinate: true,
        coordinate: {
          ...state.coordinate,
          points: upsertById(state.coordinate.points, point),
          highlightedIds: [id],
        },
      }
    }

    case 'coord_add_moving_point': {
      const id = str(args.id, 'P')
      const pathType = str(args.pathType, 'segment')
      let path: MovingPointPath
      if (pathType === 'function') {
        path = { type: 'function', expr: str(args.expr, 'x') }
      } else if (pathType === 'parametric') {
        path = {
          type: 'parametric',
          xExpr: str(args.xExpr, 'cos(t)'),
          yExpr: str(args.yExpr, 'sin(t)'),
        }
      } else {
        path = {
          type: 'segment',
          fromId: typeof args.fromId === 'string' ? args.fromId : undefined,
          toId: typeof args.toId === 'string' ? args.toId : undefined,
          from: numPair(args.from) ?? [0, 0],
          to: numPair(args.to) ?? [6, 0],
        }
      }
      const tMin = num(args.tMin, 0)
      const tMax = num(args.tMax, pathType === 'segment' ? 1 : 4)
      const initialT = num(args.initialT, (tMin + tMax) / 2)
      const mp: CoordMovingPoint = {
        id,
        label: str(args.label, id),
        path,
        tMin,
        tMax,
        initialT,
        color: str(args.color, '#EF4444'),
        stepIndex,
      }
      return {
        ...state,
        activeMode: 'coordinate',
        hasCoordinate: true,
        coordinate: {
          ...state.coordinate,
          movingPoints: upsertById(state.coordinate.movingPoints, mp),
          highlightedIds: [id],
        },
      }
    }

    case 'coord_draw_segment': {
      const fromId =
        typeof args.fromId === 'string' && args.fromId.trim() ? args.fromId.trim() : undefined
      const toId = typeof args.toId === 'string' && args.toId.trim() ? args.toId.trim() : undefined
      const from = numPair(args.from)
      const to = numPair(args.to)
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
        dashed: bool(args.dashed, false),
        stepIndex,
      }
      return {
        ...state,
        activeMode: 'coordinate',
        hasCoordinate: true,
        coordinate: {
          ...state.coordinate,
          segments: upsertById(state.coordinate.segments, segment),
          highlightedIds: [id],
        },
      }
    }

    case 'coord_draw_function': {
      const expr = str(args.expr)
      if (!expr) {
        return state
      }
      const id = str(args.id, `fn-${state.coordinate.functions.length + 1}`)
      const fn: CoordFunction = {
        id,
        expr,
        label: typeof args.label === 'string' ? args.label : `y = ${expr}`,
        color: str(args.color, '#3964FE'),
        domain: numPair(args.domain),
        dashed: bool(args.dashed, false),
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
      const vertexIds = strArray(args.vertexIds)
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
        stepIndex,
      }
      return {
        ...state,
        activeMode: 'coordinate',
        hasCoordinate: true,
        coordinate: {
          ...state.coordinate,
          polygons: upsertById(state.coordinate.polygons, poly),
          highlightedIds: [id],
        },
      }
    }

    case 'coord_draw_circle': {
      const centerId = str(args.centerId)
      if (!centerId) {
        return state
      }
      const id = str(args.id, `circle-${centerId}`)
      const circle: CoordCircle = {
        id,
        centerId,
        radius: args.radius !== undefined ? num(args.radius, 1) : undefined,
        radiusPointId: typeof args.radiusPointId === 'string' ? args.radiusPointId : undefined,
        color: str(args.color, '#0EA5E9'),
        dashed: bool(args.dashed, false),
        label: typeof args.label === 'string' ? args.label : undefined,
        stepIndex,
      }
      return {
        ...state,
        activeMode: 'coordinate',
        hasCoordinate: true,
        coordinate: {
          ...state.coordinate,
          circles: upsertById(state.coordinate.circles, circle),
          highlightedIds: [id],
        },
      }
    }

    case 'coord_draw_auxiliary_line': {
      const fromId = str(args.fromId)
      if (!fromId) {
        return state
      }
      const rawKind = str(args.kind, 'connect')
      const kind: CoordAuxiliaryKind =
        rawKind === 'perpendicular' || rawKind === 'parallel' || rawKind === 'symmetry'
          ? rawKind
          : 'connect'
      const id = str(args.id, `aux-${state.coordinate.auxiliaryLines.length + 1}`)
      const axis = args.axis === 'x' || args.axis === 'y' ? args.axis : undefined
      const aux: CoordAuxiliaryLine = {
        id,
        kind,
        fromId,
        toId: typeof args.toId === 'string' ? args.toId : undefined,
        targetLineFromId:
          typeof args.targetLineFromId === 'string' ? args.targetLineFromId : undefined,
        targetLineToId: typeof args.targetLineToId === 'string' ? args.targetLineToId : undefined,
        axis,
        derivedPointId: typeof args.derivedPointId === 'string' ? args.derivedPointId : undefined,
        derivedPointLabel:
          typeof args.derivedPointLabel === 'string' ? args.derivedPointLabel : undefined,
        label: typeof args.label === 'string' ? args.label : undefined,
        color: str(args.color, '#F59E0B'),
        showRightAngle: bool(args.showRightAngle, kind === 'perpendicular' || kind === 'symmetry'),
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
      const rawKind = str(args.kind, 'distance')
      const kind: CoordMeasurement['kind'] =
        rawKind === 'sum_distance' || rawKind === 'area' || rawKind === 'coord'
          ? rawKind
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
        pointIds: strArray(args.pointIds),
        pairs: rawPairs,
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

    case 'coord_set_t': {
      const pointId = str(args.pointId, 'P')
      const t = num(args.t, Number.NaN)
      if (!Number.isFinite(t)) {
        return state
      }
      return {
        ...state,
        activeMode: 'coordinate',
        hasCoordinate: true,
        coordinate: {
          ...state.coordinate,
          targetT: { ...state.coordinate.targetT, [pointId]: t },
          highlightedIds: [pointId],
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
        typeof args.anchorPointId === 'string' && args.anchorPointId.trim()
          ? args.anchorPointId.trim()
          : undefined
      const x = args.x !== undefined ? num(args.x, 0) : undefined
      const y = args.y !== undefined ? num(args.y, 0) : undefined
      if (!anchorPointId && (x === undefined || y === undefined)) {
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
            x,
            y,
            anchorPointId,
            color: str(args.color, '#3964FE'),
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
      return {
        ...state,
        activeMode: 'coordinate',
        coordinate: {
          ...state.coordinate,
          points: state.coordinate.points.filter((p) => !removeSet.has(p.id)),
          movingPoints: state.coordinate.movingPoints.filter((p) => !removeSet.has(p.id)),
          segments: state.coordinate.segments.filter(
            (s) =>
              !removeSet.has(s.id) &&
              !(s.fromId && removeSet.has(s.fromId)) &&
              !(s.toId && removeSet.has(s.toId))
          ),
          functions: state.coordinate.functions.filter((f) => !removeSet.has(f.id)),
          polygons: state.coordinate.polygons.filter((p) => !removeSet.has(p.id)),
          circles: state.coordinate.circles.filter((c) => !removeSet.has(c.id)),
          auxiliaryLines: state.coordinate.auxiliaryLines.filter(
            (a) => !removeSet.has(a.id) && !(a.derivedPointId && removeSet.has(a.derivedPointId))
          ),
          measurements: state.coordinate.measurements.filter((m) => !removeSet.has(m.id)),
          annotations: state.coordinate.annotations.filter((n) => !removeSet.has(n.id)),
          highlightedIds: state.coordinate.highlightedIds.filter((id) => !removeSet.has(id)),
          targetT: nextTargetT,
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
      const rawKind = str(args.kind, 'process')
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
      const node: FlowNode = {
        id,
        label: str(args.label, id),
        sublabel: typeof args.sublabel === 'string' ? args.sublabel : undefined,
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
      if (!existing) {
        return state
      }
      const rawKind = str(args.kind, existing.kind)
      const kind: FlowNodeKind =
        rawKind === 'start' ||
        rawKind === 'process' ||
        rawKind === 'decision' ||
        rawKind === 'question' ||
        rawKind === 'result' ||
        rawKind === 'grammar'
          ? rawKind
          : existing.kind
      const updated: FlowNode = {
        ...existing,
        label: str(args.label, existing.label),
        sublabel: typeof args.sublabel === 'string' ? args.sublabel : existing.sublabel,
        kind,
        status: args.status === 'pending' || args.status === 'active' ? args.status : 'solved',
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
      const from = str(args.from)
      const to = str(args.to)
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
