/**
 * AI 教学 Agent 画板与工具调用核心类型定义。
 * 支持「动态数学坐标系」与「渐进式思维流程图」两大教学画板，
 * 包含动态几何构造、实时约束求解器、可编程动点脚本与参数滑块。
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
  /** 是否允许用户在画板上直接拖拽此点（或被约束求解器自动驱动） */
  draggable?: boolean
  /** 明确锁定为不可被约束求解器移动 */
  pinned?: boolean
  /** 是否开启运动轨迹留痕 */
  trace?: boolean
  traceColor?: string
  symbol?: 'dot' | 'hollow' | 'cross'
  visible?: boolean
  stepIndex: number
}

export type MovingPointPath =
  | {
      type: 'free'
      x: number
      y: number
      bounds?: { xMin?: number; xMax?: number; yMin?: number; yMax?: number }
    }
  | {
      type: 'segment'
      segmentId?: string
      fromId?: string
      toId?: string
      from?: [number, number]
      to?: [number, number]
    }
  | {
      type: 'line' | 'ray'
      segmentId?: string
      fromId?: string
      toId?: string
      from?: [number, number]
      to?: [number, number]
    }
  | {
      type: 'function'
      functionId?: string
      expr: string
    }
  | {
      type: 'parametric'
      xExpr: string
      yExpr: string
    }
  | {
      type: 'circle'
      circleId?: string
      centerId?: string
      center?: [number, number]
      radius?: number
      radiusPointId?: string
    }
  | {
      type: 'polyline'
      vertexIds?: string[]
      points?: [number, number][]
      closed?: boolean
    }

export type CoordMovingPoint = {
  id: string
  label: string
  path: MovingPointPath
  tMin: number
  tMax: number
  initialT: number
  color: string
  draggable?: boolean
  trace?: boolean
  traceColor?: string
  visible?: boolean
  stepIndex: number
}

export type DerivedPointKind =
  | 'midpoint'
  | 'ratio'
  | 'intersection'
  | 'perpendicular_foot'
  | 'symmetry'
  | 'rotate'
  | 'translate'
  | 'centroid'
  | 'circumcenter'
  | 'incenter'
  | 'orthocenter'
  | 'formula'

export type CoordDerivedPoint = {
  id: string
  label: string
  kind: DerivedPointKind
  /** 通用参考点 ID 列表（如 midpoint/ratio 的 [A, B]，triangle 中心的 [A, B, C]） */
  pointIds?: string[]
  fromId?: string
  toId?: string
  /** ratio 定比分点比例或表达式 */
  ratio?: number
  ratioExpr?: string
  /** 垂足 / 对称轴目标 */
  axis?: 'x' | 'y'
  targetLineFromId?: string
  targetLineToId?: string
  targetSegmentId?: string
  /** 旋转 / 中心对称中心 */
  centerId?: string
  angleDeg?: number
  angleExpr?: string
  /** 平移量 */
  dx?: number
  dy?: number
  vectorFromId?: string
  vectorToId?: string
  /** 交点目标（线段/直线/圆 ID 或点对） */
  target1Id?: string
  target2Id?: string
  line1FromId?: string
  line1ToId?: string
  line2FromId?: string
  line2ToId?: string
  circleId?: string
  circle2Id?: string
  /** 当存在 2 个交点时选择第 0 个或第 1 个 */
  index?: number
  /** formula 类型的坐标表达式（支持 P.x / P.y 与滑块参数） */
  xExpr?: string
  yExpr?: string
  color: string
  trace?: boolean
  traceColor?: string
  visible?: boolean
  stepIndex: number
}

export type CoordSegment = {
  id: string
  fromId?: string
  toId?: string
  from?: [number, number]
  to?: [number, number]
  kind: 'segment' | 'line' | 'ray' | 'vector'
  color: string
  label?: string
  showLength?: boolean
  showSlope?: boolean
  /** 等长记号（1/2/3 道短斜线） */
  ticks?: number
  dashed?: boolean
  width?: number
  visible?: boolean
  stepIndex: number
}

export type CoordAnnotation = {
  id: string
  text: string
  x?: number
  y?: number
  anchorPointId?: string
  color: string
  visible?: boolean
  stepIndex: number
}

export type CoordFunctionKind = 'explicit' | 'parametric' | 'polar' | 'inequality'

export type CoordFunction = {
  id: string
  kind?: CoordFunctionKind
  expr: string
  /** parametric 曲线的 x(t), y(t) */
  xExpr?: string
  yExpr?: string
  /** polar 曲线的 r(theta) */
  rExpr?: string
  /** inequality 的比较方向：y < f(x), y <= f(x), y > f(x), y >= f(x) */
  inequality?: '<' | '<=' | '>' | '>='
  fill?: string
  label?: string
  color: string
  domain?: [number, number]
  tDomain?: [number, number]
  dashed?: boolean
  visible?: boolean
  stepIndex: number
}

export type CoordPolygon = {
  id: string
  vertexIds: string[]
  fill: string
  stroke: string
  label?: string
  showArea?: boolean
  showPerimeter?: boolean
  dashed?: boolean
  visible?: boolean
  stepIndex: number
}

export type CoordCircle = {
  id: string
  centerId: string
  radius?: number
  radiusExpr?: string
  radiusPointId?: string
  color: string
  fill?: string
  dashed?: boolean
  label?: string
  visible?: boolean
  stepIndex: number
}

export type CoordAngle = {
  id: string
  /** 角的顶点 ID */
  vertexId: string
  /** 第一条边经过的点 ID */
  fromId: string
  /** 第二条边经过的点 ID */
  toId: string
  label?: string
  showValue?: boolean
  rightAngle?: boolean
  radius?: number
  color: string
  visible?: boolean
  stepIndex: number
}

export type CoordAuxiliaryKind = 'connect' | 'perpendicular' | 'parallel' | 'symmetry' | 'bisector'

export type CoordAuxiliaryLine = {
  id: string
  kind: CoordAuxiliaryKind
  /** 起点或被作垂线/对称点的点 ID（支持动点，动点移动时辅助线同步移动） */
  fromId: string
  /** connect 时为终点 ID；bisector 时为角的另一条边点 */
  toId?: string
  /** bisector 时的角顶点 ID */
  vertexId?: string
  /** perpendicular / parallel / symmetry 时的目标直线端点 ID 或线段 ID */
  targetLineFromId?: string
  targetLineToId?: string
  targetSegmentId?: string
  /** 快捷指定坐标轴作为垂足/对称轴 */
  axis?: 'x' | 'y'
  /** perpendicular 垂足或 symmetry 对称点自动注册的新点 ID，可供后续线段/测量引用 */
  derivedPointId?: string
  derivedPointLabel?: string
  label?: string
  color: string
  showRightAngle?: boolean
  visible?: boolean
  stepIndex: number
}

export type CoordMeasurementKind =
  | 'distance'
  | 'sum_distance'
  | 'diff_distance'
  | 'ratio'
  | 'area'
  | 'perimeter'
  | 'angle'
  | 'slope'
  | 'coord'
  | 'expr'

export type CoordMeasurement = {
  id: string
  label: string
  kind: CoordMeasurementKind
  pointIds?: string[]
  pairs?: [string, string][]
  /** kind === 'expr' 时的自定义表达式，如 "dist(P,A)^2 + dist(P,B)^2" */
  expr?: string
  /** 用于动点最值问题：接近该目标值时高亮提示 */
  optimalValue?: number
  optimalHint?: string
  color: string
  stepIndex: number
}

export type CoordSlider = {
  id: string
  label: string
  min: number
  max: number
  step: number
  initialValue: number
  unit?: string
  stepIndex: number
}

export type CoordConstraintKind =
  | 'fixed_length'
  | 'equal_length'
  | 'length_ratio'
  | 'perpendicular'
  | 'parallel'
  | 'fixed_angle'
  | 'collinear'
  | 'on_segment'
  | 'on_line'
  | 'on_circle'
  | 'on_function'
  | 'on_polyline'
  | 'midpoint'
  | 'symmetric'
  | 'fixed_area'
  | 'bounds'
  | 'custom_equation'

export type CoordConstraint = {
  id: string
  kind: CoordConstraintKind
  label: string
  /** 允许求解器调整的点 ID；不填时自动选择约束中非固定、非当前拖拽的点 */
  targets?: string[]
  /** 关联点 ID（如 fixed_length: [A, B], fixed_angle: [A, B, C], collinear: [A, B, C]） */
  pointIds?: string[]
  /** 单个主点（如 on_circle / on_segment / bounds / midpoint） */
  pointId?: string
  /** 源点（如 symmetric） */
  sourceId?: string
  /** 成对端点（如 equal_length / length_ratio / perpendicular / parallel） */
  pairs?: [string, string][]
  /** 引用已有线段 ID */
  segmentId?: string
  segmentIds?: string[]
  /** 引用已有圆 / 函数 ID */
  circleId?: string
  functionId?: string
  /** 目标线段/直线端点或坐标轴 */
  fromId?: string
  toId?: string
  axis?: 'x' | 'y'
  centerId?: string
  /** 目标数值或动态数学表达式（可引用滑块变量） */
  value?: number
  expr?: string
  ratio?: number
  angleDeg?: number
  radius?: number
  /** bounds 范围限制 */
  xMin?: number
  xMax?: number
  yMin?: number
  yMax?: number
  /** 是否默认启用 */
  enabled: boolean
  stepIndex: number
}

export type CoordMotionScript = {
  id: string
  title: string
  description?: string
  /** JavaScript 代码体，接收受控沙箱参数 ctx */
  code: string
  /** 时间轴总时长（秒） */
  duration: number
  loopMode: 'bounce' | 'loop' | 'once'
  autoPlay: boolean
  enabled: boolean
  stepIndex: number
}

export type CoordinateState = {
  title: string
  viewport: CoordViewport
  /** 是否由 coord_setup 显式指定过视口；未指定时在标点/画图后自动扩展视口以防越界不可见 */
  hasExplicitViewport?: boolean
  /** 显式 coord_setup 递增版本号，用于只在 AI 明确重设视口时同步相机而不打断用户手动缩放 */
  setupVersion: number
  showGrid: boolean
  points: CoordPoint[]
  movingPoints: CoordMovingPoint[]
  derivedPoints: CoordDerivedPoint[]
  segments: CoordSegment[]
  functions: CoordFunction[]
  polygons: CoordPolygon[]
  circles: CoordCircle[]
  angles: CoordAngle[]
  auxiliaryLines: CoordAuxiliaryLine[]
  measurements: CoordMeasurement[]
  annotations: CoordAnnotation[]
  sliders: CoordSlider[]
  constraints: CoordConstraint[]
  motionScript: CoordMotionScript | null
  /** 工具建议将某个动点平滑移动到指定 t 值 */
  targetT: Record<string, number>
  /** 工具建议更新滑块或脚本时间 */
  targetParams: Record<string, number>
  /** 工具建议将自由点/动点移到指定坐标 */
  targetPositions: Record<string, { x: number; y: number }>
  highlightedIds: string[]
}

export type UserCoordPoint = {
  id: string
  label: string
  x: number
  y: number
}

export type UserCoordSegment = {
  id: string
  fromId: string
  toId: string
}

export type UserCoordFunction = {
  id: string
  expr: string
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
  | 'board_switch'
  | 'coord_setup'
  | 'coord_plot_point'
  | 'coord_add_moving_point'
  | 'coord_add_derived_point'
  | 'coord_draw_segment'
  | 'coord_draw_function'
  | 'coord_draw_polygon'
  | 'coord_draw_circle'
  | 'coord_draw_angle'
  | 'coord_draw_auxiliary_line'
  | 'coord_add_measurement'
  | 'coord_add_slider'
  | 'coord_add_constraint'
  | 'coord_remove_constraint'
  | 'coord_set_script'
  | 'coord_remove_script'
  | 'coord_toggle_trace'
  | 'coord_update'
  | 'coord_annotate'
  | 'coord_set_t'
  | 'coord_set_param'
  | 'coord_highlight'
  | 'coord_remove'
  | 'coord_clear'
  | 'flow_init'
  | 'flow_add_node'
  | 'flow_add_edge'
  | 'flow_update_node'
  | 'flow_highlight'
  | 'flow_remove'
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
  setupVersion: 0,
  showGrid: true,
  points: [],
  movingPoints: [],
  derivedPoints: [],
  segments: [],
  functions: [],
  polygons: [],
  circles: [],
  angles: [],
  auxiliaryLines: [],
  measurements: [],
  annotations: [],
  sliders: [],
  constraints: [],
  motionScript: null,
  targetT: {},
  targetParams: {},
  targetPositions: {},
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
