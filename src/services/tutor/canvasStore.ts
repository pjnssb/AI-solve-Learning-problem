import { create } from 'zustand'
import { getReplyText } from '../chat/reply.js'
import type { Message } from '../chat/types.js'
import type { Vec2 } from './geometryEngine.js'
import { applyToolCall } from './toolExecutor.js'
import { getToolBoardMode, getToolTargetId, parseTutorReply } from './toolParser.js'
import {
  createEmptyBoardState,
  type CanvasMode,
  type CanvasStepSnapshot,
  type TutorBoardState,
  type TutorToolCall,
  type UserCoordFunction,
  type UserCoordPoint,
  type UserCoordSegment,
} from './types.js'

const WIDTH_STORAGE_KEY = 'ai-tutor:canvas-width'

const loadWidth = (): number => {
  try {
    const saved = Number(localStorage.getItem(WIDTH_STORAGE_KEY))
    if (Number.isFinite(saved) && saved >= 340 && saved <= 960) {
      return saved
    }
  } catch {
    // 忽略存储读取异常
  }
  return 560
}

type CanvasPanelState = {
  open: boolean
  width: number
  /** 移动端上下分屏时画板占据的高度百分比（22~76） */
  mobileHeightPercent: number
  /** 移动端一键全屏查看画板开关 */
  mobileFullscreen: boolean
  activeTab: CanvasMode
  /** null 表示跟随最新步骤；数字表示查看某个历史步骤（1-based） */
  selectedStep: number | null
  steps: CanvasStepSnapshot[]
  /** 各动点的实时 t 值 */
  tValues: Record<string, number>
  /** 自由动点 / 可拖拽点 / 约束暖启动坐标 */
  freePositions: Record<string, Vec2>
  /** 独立参数滑块实时值 */
  paramValues: Record<string, number>
  /** AI 控制脚本的当前时间轴（秒） */
  scriptTime: number
  /** AI 控制脚本开关 */
  scriptEnabled: boolean
  /** 当前是否由脚本时间轴驱动（播放/拖动时间轴时为 true；手动拖动动点或滑块时为 false） */
  scriptTimelineActive: boolean
  /** 用户在画板内临时微调后的脚本源码（null 表示使用 AI 最新脚本） */
  scriptCodeOverride: string | null
  /** 已同步过的最新脚本 ID，用于新脚本到达时自动重置时间并响应 autoPlay */
  lastSyncedScriptKey: string
  /** 用户临时禁用的约束 ID 映射 */
  disabledConstraintIds: Record<string, boolean>
  /** 动点/派生点运动轨迹留痕点列 */
  traces: Record<string, Vec2[]>
  /** 当前正在被用户直接拖动的点 ID（供约束求解器与脚本感知） */
  draggedPointId: string | null
  playing: boolean
  speed: number
  loopMode: 'bounce' | 'loop'
  /** 当前同步的会话 ID */
  currentSessionId: string | null
  /** 已自动弹出过的消息 ID，避免同条消息流式多个工具时强行打断用户手动关闭 */
  lastAutoOpenedMessageId: string
  /** 当前总工具数，用于在同条消息切换画板模式时跟随切换 Tab */
  lastSyncedToolCount: number
  /** 用户点击高亮的坐标系元素 ID 或流程节点 ID */
  selectedCoordId: string | null
  selectedFlowNodeId: string | null
  /** 用户临时切换的流程图方向（null 跟随 AI 设定） */
  flowDirectionOverride: 'TD' | 'LR' | null
  /** 用户本地标记的节点状态覆盖 */
  flowStatusOverrides: Record<string, 'active' | 'pending' | 'solved'>
  /** 学生在坐标系上自主探索添加的点、线段与函数 */
  userPoints: UserCoordPoint[]
  userSegments: UserCoordSegment[]
  userFunctions: UserCoordFunction[]
}

export const useCanvasStore = create<CanvasPanelState>(() => ({
  open: false,
  width: loadWidth(),
  mobileHeightPercent: 42,
  mobileFullscreen: false,
  activeTab: 'coordinate',
  selectedStep: null,
  steps: [],
  tValues: {},
  freePositions: {},
  paramValues: {},
  scriptTime: 0,
  scriptEnabled: true,
  scriptTimelineActive: false,
  scriptCodeOverride: null,
  lastSyncedScriptKey: '',
  disabledConstraintIds: {},
  traces: {},
  draggedPointId: null,
  playing: false,
  speed: 1,
  loopMode: 'bounce',
  currentSessionId: null,
  lastAutoOpenedMessageId: '',
  lastSyncedToolCount: 0,
  selectedCoordId: null,
  selectedFlowNodeId: null,
  flowDirectionOverride: null,
  flowStatusOverrides: {},
  userPoints: [],
  userSegments: [],
  userFunctions: [],
}))

export const openCanvasPanel = (tab?: CanvasMode) =>
  useCanvasStore.setState((state) => ({
    open: true,
    activeTab: tab ?? state.activeTab,
  }))

export const closeCanvasPanel = () =>
  useCanvasStore.setState({ open: false, playing: false, mobileFullscreen: false })

export const toggleCanvasPanel = () =>
  useCanvasStore.setState((state) => ({
    open: !state.open,
    playing: state.open ? false : state.playing,
    mobileFullscreen: state.open ? false : state.mobileFullscreen,
  }))

export const setCanvasTab = (activeTab: CanvasMode) => useCanvasStore.setState({ activeTab })

export const setMobileHeightPercent = (percent: number) =>
  useCanvasStore.setState({
    mobileHeightPercent: Math.max(22, Math.min(76, Math.round(percent))),
    mobileFullscreen: false,
  })

export const toggleMobileFullscreen = () =>
  useCanvasStore.setState((state) => ({ mobileFullscreen: !state.mobileFullscreen }))

export const setCanvasWidth = (width: number) => {
  const clamped = Math.max(340, Math.min(960, Math.round(width)))
  try {
    localStorage.setItem(WIDTH_STORAGE_KEY, String(clamped))
  } catch {
    // 忽略存储写入异常
  }
  useCanvasStore.setState({ width: clamped })
}

export const selectCanvasStep = (stepNumber: number | null) =>
  useCanvasStore.setState((state) => {
    if (stepNumber === null) {
      const latest = state.steps.at(-1)
      return {
        selectedStep: null,
        activeTab: latest ? latest.mode : state.activeTab,
      }
    }
    const target = state.steps.find((s) => s.stepNumber === stepNumber)
    return {
      selectedStep: stepNumber,
      activeTab: target ? target.mode : state.activeTab,
    }
  })

export const jumpToMessageStep = (messageId: string, toolCall?: TutorToolCall) => {
  const state = useCanvasStore.getState()
  const target = state.steps.find((step) => step.messageId === messageId)
  if (!target) {
    openCanvasPanel(toolCall ? (getToolBoardMode(toolCall) ?? undefined) : undefined)
    return
  }
  const isLatest = target.stepNumber === state.steps.at(-1)?.stepNumber
  const preferredMode = toolCall ? getToolBoardMode(toolCall) : null
  const targetId = toolCall ? getToolTargetId(toolCall) : null
  const mode = preferredMode ?? target.mode
  useCanvasStore.setState({
    open: true,
    activeTab: mode,
    selectedStep: isLatest ? null : target.stepNumber,
    ...(mode === 'coordinate' ? { selectedCoordId: targetId } : { selectedFlowNodeId: targetId }),
  })
}

export const setMovingPointT = (pointId: string, t: number) =>
  useCanvasStore.setState((state) => ({
    tValues: { ...state.tValues, [pointId]: t },
    freePositions: Object.fromEntries(
      Object.entries(state.freePositions).filter(([k]) => k !== pointId)
    ),
    scriptTimelineActive: false,
  }))

export const setFreePointPosition = (pointId: string, x: number, y: number) =>
  useCanvasStore.setState((state) => ({
    freePositions: { ...state.freePositions, [pointId]: { x, y } },
    scriptTimelineActive: false,
  }))

export const batchUpdateMotionState = (patch: {
  tValues?: Record<string, number>
  freePositions?: Record<string, Vec2>
  scriptTime?: number
  scriptTimelineActive?: boolean
  draggedPointId?: string | null
}) =>
  useCanvasStore.setState((state) => ({
    ...(patch.tValues ? { tValues: { ...state.tValues, ...patch.tValues } } : {}),
    ...(patch.freePositions
      ? { freePositions: { ...state.freePositions, ...patch.freePositions } }
      : {}),
    ...(patch.scriptTime !== undefined ? { scriptTime: patch.scriptTime } : {}),
    ...(patch.scriptTimelineActive !== undefined
      ? { scriptTimelineActive: patch.scriptTimelineActive }
      : {}),
    ...(patch.draggedPointId !== undefined ? { draggedPointId: patch.draggedPointId } : {}),
  }))

export const setDraggedPointId = (draggedPointId: string | null) =>
  useCanvasStore.setState({ draggedPointId })

export const setParamValue = (paramId: string, value: number) =>
  useCanvasStore.setState((state) => ({
    paramValues: { ...state.paramValues, [paramId]: value },
  }))

export const setScriptTime = (scriptTime: number) =>
  useCanvasStore.setState({ scriptTime, scriptEnabled: true, scriptTimelineActive: true })

export const setScriptEnabled = (scriptEnabled: boolean) =>
  useCanvasStore.setState({ scriptEnabled })

export const setScriptTimelineActive = (scriptTimelineActive: boolean) =>
  useCanvasStore.setState({ scriptTimelineActive })

export const setScriptCodeOverride = (scriptCodeOverride: string | null) =>
  useCanvasStore.setState({ scriptCodeOverride })

export const toggleConstraintDisabled = (constraintId: string) =>
  useCanvasStore.setState((state) => ({
    disabledConstraintIds: {
      ...state.disabledConstraintIds,
      [constraintId]: !state.disabledConstraintIds[constraintId],
    },
  }))

export const appendTracePoints = (samples: Record<string, Vec2>) =>
  useCanvasStore.setState((state) => {
    let changed = false
    const nextTraces: Record<string, Vec2[]> = { ...state.traces }
    for (const [id, pt] of Object.entries(samples)) {
      const arr = nextTraces[id] ?? []
      const last = arr.at(-1)
      if (!last || Math.hypot(pt.x - last.x, pt.y - last.y) > 0.04) {
        const updated = arr.length >= 600 ? [...arr.slice(-599), pt] : [...arr, pt]
        nextTraces[id] = updated
        changed = true
      }
    }
    return changed ? { traces: nextTraces } : state
  })

export const clearTraces = () => useCanvasStore.setState({ traces: {} })

export const resetAllMotionState = () =>
  useCanvasStore.setState((state) => {
    const board = getCurrentCanvasBoard(state)
    const tValues: Record<string, number> = {}
    for (const mp of board.coordinate.movingPoints) {
      tValues[mp.id] = mp.initialT
    }
    const paramValues: Record<string, number> = {}
    for (const sl of board.coordinate.sliders) {
      paramValues[sl.id] = sl.initialValue
    }
    return {
      playing: false,
      tValues,
      freePositions: {},
      paramValues,
      scriptTime: 0,
      scriptTimelineActive: false,
      traces: {},
    }
  })

export const setCanvasPlaying = (playing: boolean) =>
  useCanvasStore.setState((state) => ({
    playing,
    ...(playing ? { scriptEnabled: true, scriptTimelineActive: true } : {}),
    ...(playing ? {} : { scriptTimelineActive: state.scriptTimelineActive }),
  }))

export const setCanvasSpeed = (speed: number) => useCanvasStore.setState({ speed })

export const toggleCanvasLoopMode = () =>
  useCanvasStore.setState((state) => ({
    loopMode: state.loopMode === 'bounce' ? 'loop' : 'bounce',
  }))

export const setSelectedCoordId = (selectedCoordId: string | null) =>
  useCanvasStore.setState({ selectedCoordId })

export const setSelectedFlowNodeId = (selectedFlowNodeId: string | null) =>
  useCanvasStore.setState({ selectedFlowNodeId })

export const setFlowDirectionOverride = (flowDirectionOverride: 'TD' | 'LR' | null) =>
  useCanvasStore.setState({ flowDirectionOverride })

export const toggleFlowNodeStatusOverride = (
  nodeId: string,
  currentStatus: 'active' | 'pending' | 'solved'
) =>
  useCanvasStore.setState((state) => ({
    flowStatusOverrides: {
      ...state.flowStatusOverrides,
      [nodeId]: currentStatus === 'solved' ? 'pending' : 'solved',
    },
  }))

export const addUserCoordPoint = (x: number, y: number) =>
  useCanvasStore.setState((state) => {
    const idx = state.userPoints.length + 1
    const id = `U${idx}`
    return {
      userPoints: [...state.userPoints, { id, label: id, x, y }],
      selectedCoordId: id,
    }
  })

export const updateUserCoordPoint = (id: string, x: number, y: number) =>
  useCanvasStore.setState((state) => ({
    userPoints: state.userPoints.map((p) => (p.id === id ? { ...p, x, y } : p)),
  }))

export const addUserCoordSegment = (fromId: string, toId: string) =>
  useCanvasStore.setState((state) => {
    if (fromId === toId) {
      return state
    }
    const id = `useg-${state.userSegments.length + 1}`
    return {
      userSegments: [...state.userSegments, { id, fromId, toId }],
      selectedCoordId: id,
    }
  })

export const addUserCoordFunction = (expr: string) =>
  useCanvasStore.setState((state) => {
    const trimmed = expr.trim()
    if (!trimmed) {
      return state
    }
    const id = `ufn-${state.userFunctions.length + 1}`
    return {
      userFunctions: [...state.userFunctions, { id, expr: trimmed }],
      selectedCoordId: id,
    }
  })

export const removeUserCoordElement = (id: string) =>
  useCanvasStore.setState((state) => ({
    userPoints: state.userPoints.filter((p) => p.id !== id),
    userSegments: state.userSegments.filter((s) => s.id !== id && s.fromId !== id && s.toId !== id),
    userFunctions: state.userFunctions.filter((f) => f.id !== id),
    selectedCoordId: state.selectedCoordId === id ? null : state.selectedCoordId,
  }))

export const clearUserScratchpad = () =>
  useCanvasStore.setState({
    userPoints: [],
    userSegments: [],
    userFunctions: [],
    selectedCoordId: null,
  })

/**
 * 从当前可见消息分支确定性重放所有 Agent 画板工具调用，生成每一步的画板快照。
 * 坐标系画板与流程图画板独立保留状态，AI 可以在两者之间随时来回切换，不会丢失另一块画板的内容。
 */
export const syncCanvasFromMessages = (sessionId: string | null, visibleMessages: Message[]) => {
  if (!sessionId) {
    useCanvasStore.setState({
      currentSessionId: null,
      steps: [],
      selectedStep: null,
      tValues: {},
      freePositions: {},
      paramValues: {},
      scriptTime: 0,
      scriptEnabled: true,
      scriptCodeOverride: null,
      lastSyncedScriptKey: '',
      disabledConstraintIds: {},
      traces: {},
      draggedPointId: null,
      playing: false,
      lastAutoOpenedMessageId: '',
      lastSyncedToolCount: 0,
      selectedCoordId: null,
      selectedFlowNodeId: null,
      flowDirectionOverride: null,
      flowStatusOverrides: {},
      userPoints: [],
      userSegments: [],
      userFunctions: [],
    })
    return
  }

  let board: TutorBoardState = createEmptyBoardState()
  const steps: CanvasStepSnapshot[] = []
  let totalTools = 0

  for (const message of visibleMessages) {
    if (message.role !== 'assistant') {
      continue
    }
    const text = getReplyText(message)
    if (!text) {
      continue
    }
    const isStreamingMsg = message.status === 'pending' || message.status === 'streaming'
    const { toolCalls } = parseTutorReply(text, isStreamingMsg)
    if (toolCalls.length === 0) {
      continue
    }
    const stepNumber = steps.length + 1
    for (const call of toolCalls) {
      board = applyToolCall(board, call, stepNumber)
      totalTools += 1
    }
    const lastSummary = toolCalls.at(-1)?.summary ?? `步骤 ${stepNumber}`
    steps.push({
      stepNumber,
      messageId: message.id,
      title: lastSummary,
      mode: board.activeMode,
      toolCalls,
      board,
    })
  }

  const prev = useCanvasStore.getState()
  const sessionChanged = prev.currentSessionId !== sessionId
  const startingFromWelcome =
    prev.currentSessionId === null &&
    steps.length === 0 &&
    visibleMessages.length <= 2 &&
    visibleMessages.some(
      (m) => m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming')
    )
  const latestStep = steps.at(-1)
  const latestBoard = latestStep?.board

  const nextTValues: Record<string, number> = sessionChanged ? {} : { ...prev.tValues }
  let nextFreePositions: Record<string, Vec2> = sessionChanged ? {} : { ...prev.freePositions }
  const nextParamValues: Record<string, number> = sessionChanged ? {} : { ...prev.paramValues }
  let nextScriptTime = sessionChanged ? 0 : prev.scriptTime
  let nextScriptEnabled = sessionChanged ? true : prev.scriptEnabled
  let nextScriptCodeOverride = sessionChanged ? null : prev.scriptCodeOverride
  let nextScriptKey = sessionChanged ? '' : prev.lastSyncedScriptKey
  let nextPlaying = sessionChanged ? false : prev.playing

  if (latestBoard) {
    const coord = latestBoard.coordinate
    for (const mp of coord.movingPoints) {
      if (!Object.hasOwn(nextTValues, mp.id)) {
        nextTValues[mp.id] = mp.initialT
      }
    }
    for (const sl of coord.sliders) {
      if (!Object.hasOwn(nextParamValues, sl.id)) {
        nextParamValues[sl.id] = sl.initialValue
      }
    }
    if (latestStep && totalTools !== prev.lastSyncedToolCount) {
      if (latestStep.toolCalls.some((c) => c.tool === 'coord_set_t')) {
        const targetTIds = new Set(Object.keys(coord.targetT))
        for (const [pointId, targetVal] of Object.entries(coord.targetT)) {
          nextTValues[pointId] = targetVal
        }
        nextFreePositions = Object.fromEntries(
          Object.entries(nextFreePositions).filter(([k]) => !targetTIds.has(k))
        )
        for (const [pointId, targetPos] of Object.entries(coord.targetPositions)) {
          nextFreePositions[pointId] = targetPos
        }
      }
      if (latestStep.toolCalls.some((c) => c.tool === 'coord_set_param')) {
        for (const [key, val] of Object.entries(coord.targetParams)) {
          if (key === 't' || key === 'scriptTime') {
            nextScriptTime = val
          } else {
            nextParamValues[key] = val
          }
        }
      }
    }
    if (coord.motionScript) {
      const scriptKey = `${sessionId}:${coord.motionScript.id}:${coord.motionScript.code.length}`
      if (scriptKey !== nextScriptKey) {
        nextScriptKey = scriptKey
        nextScriptCodeOverride = null
        nextScriptEnabled = coord.motionScript.enabled
        nextScriptTime = 0
        if (coord.motionScript.autoPlay) {
          nextPlaying = true
        }
      }
    } else if (nextScriptKey) {
      nextScriptKey = ''
      nextScriptCodeOverride = null
    }
  }

  const latestMsgKey = latestStep ? `${sessionId}:${latestStep.messageId}` : ''
  const isNewMessageWithTools = Boolean(
    latestMsgKey && latestMsgKey !== prev.lastAutoOpenedMessageId
  )
  const toolCountAdvanced = totalTools > prev.lastSyncedToolCount
  const latestMode = latestStep?.mode ?? prev.activeTab

  useCanvasStore.setState({
    currentSessionId: sessionId,
    steps,
    tValues: nextTValues,
    freePositions: nextFreePositions,
    paramValues: nextParamValues,
    scriptTime: nextScriptTime,
    scriptEnabled: nextScriptEnabled,
    scriptCodeOverride: nextScriptCodeOverride,
    lastSyncedScriptKey: nextScriptKey,
    playing: nextPlaying,
    lastSyncedToolCount: totalTools,
    ...(sessionChanged
      ? {
          selectedCoordId: null,
          selectedFlowNodeId: null,
          flowDirectionOverride: null,
          flowStatusOverrides: {},
          disabledConstraintIds: {},
          traces: {},
          draggedPointId: null,
          ...(startingFromWelcome
            ? {}
            : {
                userPoints: [],
                userSegments: [],
                userFunctions: [],
              }),
        }
      : {}),
    ...(isNewMessageWithTools
      ? {
          open: true,
          activeTab: latestMode,
          selectedStep: null,
          lastAutoOpenedMessageId: latestMsgKey,
        }
      : toolCountAdvanced && prev.open
        ? {
            activeTab: latestMode,
            selectedStep: null,
          }
        : totalTools === 0
          ? { selectedStep: null, lastAutoOpenedMessageId: '' }
          : {}),
  })
}

export const getCurrentCanvasBoard = (state: CanvasPanelState): TutorBoardState => {
  if (state.steps.length === 0) {
    return createEmptyBoardState()
  }
  if (state.selectedStep !== null) {
    const matched = state.steps.find((s) => s.stepNumber === state.selectedStep)
    if (matched) {
      return matched.board
    }
  }
  return state.steps[state.steps.length - 1].board
}
