import { create } from 'zustand'
import { getReplyText } from '../chat/reply.js'
import type { Message } from '../chat/types.js'
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
    if (Number.isFinite(saved) && saved >= 340 && saved <= 920) {
      return saved
    }
  } catch {
    // 忽略存储读取异常
  }
  return 540
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
  const clamped = Math.max(340, Math.min(920, Math.round(width)))
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
  }))

export const setCanvasPlaying = (playing: boolean) => useCanvasStore.setState({ playing })

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
  if (latestBoard) {
    for (const mp of latestBoard.coordinate.movingPoints) {
      if (!Object.hasOwn(nextTValues, mp.id)) {
        nextTValues[mp.id] = mp.initialT
      }
    }
    if (
      latestStep &&
      totalTools !== prev.lastSyncedToolCount &&
      latestStep.toolCalls.some((c) => c.tool === 'coord_set_t')
    ) {
      for (const [pointId, targetVal] of Object.entries(latestBoard.coordinate.targetT)) {
        nextTValues[pointId] = targetVal
      }
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
    lastSyncedToolCount: totalTools,
    ...(sessionChanged
      ? {
          selectedCoordId: null,
          selectedFlowNodeId: null,
          flowDirectionOverride: null,
          flowStatusOverrides: {},
          ...(startingFromWelcome
            ? {}
            : {
                userPoints: [],
                userSegments: [],
                userFunctions: [],
              }),
          playing: false,
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
