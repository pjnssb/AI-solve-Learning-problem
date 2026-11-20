/**
 * AI 教学 Agent 画板与工具调用核心类型定义。
 * 支持「动态数学坐标系」与「渐进式思维流程图」两大教学画板，
 * 所有绘制操作均以结构化工具调用（Agent Tool Call）逐步驱动。
 */

export type CanvasMode = 'coordinate' | 'flowchart'

export type CoordViewport = {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

export type CoordPoint = {
  id: string
  label: string
  x: number
  y: number
  color: string
  stepIndex: number
}

export type MovingPointPath =
  | {
      type: 'segment'
      fromId?: string
      toId?: string
      from?: [number, number]
      to?: [number, number]
    }
  | {
      type: 'function'
      expr: string
    }
  | {
      type: 'parametric'
      xExpr: string
      yExpr: string
    }

export type CoordMovingPoint = {
  id: string
  label: string
  path: MovingPointPath
  tMin: number
  tMax: number
  initialT: number
  color: string
  stepIndex: number
}

export type CoordSegment = {
  id: string
  fromId: string
  toId: string
  kind: 'segment' | 'line' | 'ray' | 'vector'
  color: string
  label?: string
  showLength?: boolean
  dashed?: boolean
  stepIndex: number
}

export type CoordFunction = {
  id: string
  expr: string
  label?: string
  color: string
  domain?: [number, number]
  dashed?: boolean
  stepIndex: number
}

export type CoordPolygon = {
  id: string
  vertexIds: string[]
  fill: string
  stroke: string
  label?: string
  showArea?: boolean
  stepIndex: number
}

export type CoordCircle = {
  id: string
  centerId: string
  radius?: number
  radiusPointId?: string
  color: string
  dashed?: boolean
  label?: string
  stepIndex: number
}

export type CoordAuxiliaryKind = 'connect' | 'perpendicular' | 'parallel' | 'symmetry'

export type CoordAuxiliaryLine = {
  id: string
  kind: CoordAuxiliaryKind
  /** 起点或被作垂线/对称点的点 ID（支持动点，动点移动时辅助线同步移动） */
  fromId: string
  /** connect 时为终点 ID；parallel 时为参考方向终点或配合 targetLineFromId/ToId */
  toId?: string
  /** perpendicular / parallel / symmetry 时的目标直线端点 ID */
  targetLineFromId?: string
  targetLineToId?: string
  /** 快捷指定坐标轴作为垂足/对称轴 */
  axis?: 'x' | 'y'
  /** perpendicular 垂足或 symmetry 对称点自动注册的新点 ID，可供后续线段/测量引用 */
  derivedPointId?: string
  derivedPointLabel?: string
  label?: string
  color: string
  showRightAngle?: boolean
  stepIndex: number
}

export type CoordMeasurement = {
  id: string
  label: string
  kind: 'distance' | 'sum_distance' | 'area' | 'coord'
  pointIds?: string[]
  pairs?: [string, string][]
  /** 用于动点最值问题：接近该目标值时高亮提示 */
  optimalValue?: number
  optimalHint?: string
  color: string
  stepIndex: number
}

export type GeoGebraStyleSpec = {
  target: string
  color?: string
  dashed?: boolean
  thickness?: number
  trace?: boolean
  visible?: boolean
  caption?: string
}

export type GeoGebraAnimateSpec = {
  target: string
  playing: boolean
  value?: number
}

export type GeoGebraCommandStep = {
  id: string
  commands: string[]
  styles?: GeoGebraStyleSpec[]
  animate?: GeoGebraAnimateSpec
  stepIndex: number
}

export type CoordinateState = {
  title: string
  viewport: CoordViewport
  showGrid: boolean
  preferredEngine?: 'native' | 'geogebra'
  points: CoordPoint[]
  movingPoints: CoordMovingPoint[]
  segments: CoordSegment[]
  functions: CoordFunction[]
  polygons: CoordPolygon[]
  circles: CoordCircle[]
  auxiliaryLines: CoordAuxiliaryLine[]
  measurements: CoordMeasurement[]
  /** 原生 GeoGebra 指令队列（供 AI Agent 直接调用 GeoGebra 全套几何/代数/轨迹/动画能力） */
  geogebraCommands: GeoGebraCommandStep[]
  /** 工具建议将某个动点平滑移动到指定 t 值 */
  targetT: Record<string, number>
  highlightedIds: string[]
}

export type FlowNodeKind = 'start' | 'process' | 'decision' | 'question' | 'result' | 'grammar'

export type FlowNode = {
  id: string
  label: string
  sublabel?: string
  kind: FlowNodeKind
  status: 'active' | 'pending' | 'solved'
  stepIndex: number
}

export type FlowEdge = {
  id: string
  from: string
  to: string
  label?: string
  dashed?: boolean
  stepIndex: number
}

export type FlowchartState = {
  title: string
  direction: 'TD' | 'LR'
  nodes: FlowNode[]
  edges: FlowEdge[]
  highlightedIds: string[]
}

export type TutorToolName =
  | 'coord_setup'
  | 'coord_plot_point'
  | 'coord_add_moving_point'
  | 'coord_draw_segment'
  | 'coord_draw_function'
  | 'coord_draw_polygon'
  | 'coord_draw_circle'
  | 'coord_draw_auxiliary_line'
  | 'coord_add_measurement'
  | 'coord_set_t'
  | 'coord_highlight'
  | 'coord_clear'
  | 'geogebra_eval'
  | 'geogebra_style'
  | 'geogebra_animate'
  | 'geogebra_clear'
  | 'flow_init'
  | 'flow_add_node'
  | 'flow_add_edge'
  | 'flow_update_node'
  | 'flow_highlight'
  | 'flow_clear'

export type TutorToolCall = {
  id: string
  tool: TutorToolName
  summary: string
  args: Record<string, unknown>
}

export type TutorBoardState = {
  activeMode: CanvasMode
  hasCoordinate: boolean
  hasFlowchart: boolean
  coordinate: CoordinateState
  flowchart: FlowchartState
}

export type CanvasStepSnapshot = {
  stepNumber: number
  messageId: string
  title: string
  mode: CanvasMode
  toolCalls: TutorToolCall[]
  board: TutorBoardState
}

export type ParsedTutorReply = {
  /** 去除工具调用块和快捷选项块之后的纯净教学正文 */
  cleanMarkdown: string
  /** 本条回复中解析出的所有 Agent 画板工具调用 */
  toolCalls: TutorToolCall[]
  /** 若正在流式输出一个尚未闭合的工具块，返回提示名 */
  pendingToolLabel: string | null
  /** 面向学生的启发式快捷回复建议 */
  choices: string[]
}

export const createEmptyCoordinateState = (): CoordinateState => ({
  title: '',
  viewport: { xMin: -2, xMax: 8, yMin: -4, yMax: 6 },
  showGrid: true,
  points: [],
  movingPoints: [],
  segments: [],
  functions: [],
  polygons: [],
  circles: [],
  auxiliaryLines: [],
  measurements: [],
  geogebraCommands: [],
  targetT: {},
  highlightedIds: [],
})

export const createEmptyFlowchartState = (): FlowchartState => ({
  title: '',
  direction: 'TD',
  nodes: [],
  edges: [],
  highlightedIds: [],
})

export const createEmptyBoardState = (): TutorBoardState => ({
  activeMode: 'coordinate',
  hasCoordinate: false,
  hasFlowchart: false,
  coordinate: createEmptyCoordinateState(),
  flowchart: createEmptyFlowchartState(),
})
