import { create } from 'zustand'
import { getReplyText } from '../chat/reply.js'
import type { Message } from '../chat/types.js'
import { applyToolCall } from './toolExecutor.js'
import { isFlowchartTool, isGeoGebraTool, parseTutorReply } from './toolParser.js'
import {
  createEmptyBoardState,
  type CanvasMode,
  type CanvasStepSnapshot,
  type TutorBoardState,
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
  activeTab: CanvasMode
  coordEngine: 'native' | 'geogebra'
  /** null 表示跟随最新步骤；数字表示查看某个历史步骤（1-based） */
  selectedStep: number | null
  steps: CanvasStepSnapshot[]
  /** 各动点的实时 t 值 */
  tValues: Record<string, number>
  playing: boolean
  speed: number
  loopMode: 'bounce' | 'loop'
  /** 已自动弹出过的会话 + 工具总数标记，避免用户手动关闭后重复强行弹开 */
  lastAutoOpenedKey: string
}

export const useCanvasStore = create<CanvasPanelState>(() => ({
  open: false,
  width: loadWidth(),
  activeTab: 'coordinate',
  coordEngine: 'native',
  selectedStep: null,
  steps: [],
  tValues: {},
  playing: false,
  speed: 1,
  loopMode: 'bounce',
  lastAutoOpenedKey: '',
}))

export const openCanvasPanel = (tab?: CanvasMode) =>
  useCanvasStore.setState((state) => ({
    open: true,
    activeTab: tab ?? state.activeTab,
  }))

export const closeCanvasPanel = () => useCanvasStore.setState({ open: false, playing: false })

export const toggleCanvasPanel = () =>
  useCanvasStore.setState((state) => ({
    open: !state.open,
    playing: state.open ? false : state.playing,
  }))

export const setCanvasTab = (activeTab: CanvasMode) => useCanvasStore.setState({ activeTab })

export const setCoordEngine = (coordEngine: 'native' | 'geogebra') =>
  useCanvasStore.setState({ coordEngine })

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
      return { selectedStep: null }
    }
    const target = state.steps.find((s) => s.stepNumber === stepNumber)
    return {
      selectedStep: stepNumber,
      activeTab: target ? target.mode : state.activeTab,
      ...(target?.board.coordinate.preferredEngine
        ? { coordEngine: target.board.coordinate.preferredEngine }
        : {}),
    }
  })

export const jumpToMessageStep = (messageId: string) => {
  const state = useCanvasStore.getState()
  const target = state.steps.find((step) => step.messageId === messageId)
  if (!target) {
    openCanvasPanel()
    return
  }
  const isLatest = target.stepNumber === state.steps.at(-1)?.stepNumber
  const usesGeoGebra = target.toolCalls.some((c) => isGeoGebraTool(c.tool))
  useCanvasStore.setState({
    open: true,
    activeTab: target.mode,
    ...(usesGeoGebra ? { coordEngine: 'geogebra' as const } : {}),
    selectedStep: isLatest ? null : target.stepNumber,
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

/**
 * 从当前可见消息分支确定性重放所有 Agent 画板工具调用，生成每一步的画板快照。
 * 这样无论是流式实时绘制、切换会话、切换分支、还是页面刷新，画板状态都 100% 一致。
 */
export const syncCanvasFromMessages = (sessionId: string | null, visibleMessages: Message[]) => {
  if (!sessionId) {
    useCanvasStore.setState({
      steps: [],
      selectedStep: null,
      tValues: {},
      playing: false,
      coordEngine: 'native',
      lastAutoOpenedKey: '',
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
    const { toolCalls } = parseTutorReply(text)
    if (toolCalls.length === 0) {
      continue
    }
    const stepNumber = steps.length + 1
    let stepMode: CanvasMode = board.activeMode
    for (const call of toolCalls) {
      board = applyToolCall(board, call, stepNumber)
      stepMode = isFlowchartTool(call.tool) ? 'flowchart' : 'coordinate'
      totalTools += 1
    }
    const lastSummary = toolCalls.at(-1)?.summary ?? `步骤 ${stepNumber}`
    steps.push({
      stepNumber,
      messageId: message.id,
      title: lastSummary,
      mode: stepMode,
      toolCalls,
      board,
    })
  }

  const prev = useCanvasStore.getState()
  const autoKey = `${sessionId}:${totalTools}`
  const latestBoard = steps.at(-1)?.board

  // 合并动点初始 t 值与工具下发的目标 t 值
  const nextTValues: Record<string, number> = { ...prev.tValues }
  if (latestBoard) {
    for (const mp of latestBoard.coordinate.movingPoints) {
      if (!Object.hasOwn(nextTValues, mp.id)) {
        nextTValues[mp.id] = mp.initialT
      }
    }
    // 若最新的步骤刚刚触发 coord_set_t，则自动移动到该目标值
    const latestStep = steps.at(-1)
    if (
      latestStep &&
      autoKey !== prev.lastAutoOpenedKey &&
      latestStep.toolCalls.some((c) => c.tool === 'coord_set_t')
    ) {
      for (const [pointId, targetVal] of Object.entries(latestBoard.coordinate.targetT)) {
        nextTValues[pointId] = targetVal
      }
    }
  }

  const shouldAutoOpen = totalTools > 0 && autoKey !== prev.lastAutoOpenedKey
  const latestMode = steps.at(-1)?.mode ?? prev.activeTab
  const latestStepUsesGeoGebra =
    steps.at(-1)?.toolCalls.some((c) => isGeoGebraTool(c.tool)) ?? false

  useCanvasStore.setState({
    steps,
    tValues: nextTValues,
    // 新工具调用发生时自动打开画板并切到对应模式/引擎、跟随最新步骤
    ...(shouldAutoOpen
      ? {
          open: true,
          activeTab: latestMode,
          ...(latestStepUsesGeoGebra ? { coordEngine: 'geogebra' as const } : {}),
          selectedStep: null,
          lastAutoOpenedKey: autoKey,
        }
      : totalTools === 0
        ? { selectedStep: null, lastAutoOpenedKey: autoKey }
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
