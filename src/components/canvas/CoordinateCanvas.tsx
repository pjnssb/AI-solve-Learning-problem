import clsx from 'clsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { sendQuickMessage, useChatStore } from '../../services/chat/store.js'
import { useSettings } from '../../services/settings.js'
import {
  addUserCoordFunction,
  addUserCoordPoint,
  addUserCoordSegment,
  appendTracePoints,
  batchUpdateMotionState,
  clearTraces,
  clearUserScratchpad,
  removeUserCoordElement,
  resetAllMotionState,
  setCanvasPlaying,
  setCanvasSpeed,
  setDraggedPointId,
  setFreePointPosition,
  setMovingPointT,
  setParamValue,
  setScriptCodeOverride,
  setScriptEnabled,
  setScriptTime,
  setScriptTimelineActive,
  setSelectedCoordId,
  toggleCanvasLoopMode,
  toggleConstraintDisabled,
  updateUserCoordPoint,
  useCanvasStore,
} from '../../services/tutor/canvasStore.js'
import {
  computeAngleDeg,
  computePolygonArea,
  computePolygonPerimeter,
  projectWorldToMovingPoint,
  resolveCircleParams,
  vecDist,
  type ResolveContext,
  type Vec2,
} from '../../services/tutor/geometryEngine.js'
import { compileMathExpr } from '../../services/tutor/mathEval.js'
import { solveCoordinateScene } from '../../services/tutor/sceneSolver.js'
import type {
  CoordMovingPoint,
  CoordinateState,
  CoordViewport,
} from '../../services/tutor/types.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import { InlineMarkdown } from '../markdown/Markdown.js'
import { SvgMathText } from './SvgMathText.js'
import styles from './CoordinateCanvas.module.css'

type ToolMode = 'pan' | 'point' | 'segment' | 'function'
type InspectorTab = 'none' | 'constraints' | 'script'

type HoverInfo =
  | { kind: 'point'; id: string; label: string; x: number; y: number; draggable: boolean }
  | { kind: 'curve'; id: string; expr: string; x: number; y: number; color: string }
  | { kind: 'segment'; id: string; label: string; length: number; draggable: boolean }

type DragSession =
  | {
      kind: 'pan'
      startX: number
      startY: number
      startViewport: CoordViewport
      moved: boolean
    }
  | {
      kind: 'point'
      pointId: string
      isUser: boolean
      mp?: CoordMovingPoint
      startX: number
      startY: number
      moved: boolean
    }
  | {
      kind: 'segment'
      segmentId: string
      movableIds: string[]
      startX: number
      startY: number
      startWorld: Vec2
      initialPositions: Record<string, Vec2>
      moved: boolean
    }

const chooseGridStep = (span: number): number => {
  const rough = span / 8
  const pow = 10 ** Math.floor(Math.log10(Math.max(rough, 1e-4)))
  const norm = rough / pow
  if (norm < 1.5) {
    return pow
  }
  if (norm < 3.5) {
    return 2 * pow
  }
  if (norm < 7.5) {
    return 5 * pow
  }
  return 10 * pow
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

const distToSegmentPx = (
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number => {
  const dx = x2 - x1
  const dy = y2 - y1
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-6) {
    return Math.hypot(px - x1, py - y1)
  }
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

export const CoordinateCanvas = ({
  coordinate,
  hasContent,
  svgRef,
}: {
  coordinate: CoordinateState
  hasContent: boolean
  svgRef?: React.RefObject<SVGSVGElement>
}) => {
  const tValues = useCanvasStore((state) => state.tValues)
  const freePositions = useCanvasStore((state) => state.freePositions)
  const paramValues = useCanvasStore((state) => state.paramValues)
  const scriptTime = useCanvasStore((state) => state.scriptTime)
  const scriptEnabled = useCanvasStore((state) => state.scriptEnabled)
  const scriptTimelineActive = useCanvasStore((state) => state.scriptTimelineActive)
  const scriptCodeOverride = useCanvasStore((state) => state.scriptCodeOverride)
  const disabledConstraintIds = useCanvasStore((state) => state.disabledConstraintIds)
  const traces = useCanvasStore((state) => state.traces)
  const draggedPointId = useCanvasStore((state) => state.draggedPointId)
  const playing = useCanvasStore((state) => state.playing)
  const speed = useCanvasStore((state) => state.speed)
  const loopMode = useCanvasStore((state) => state.loopMode)
  const selectedCoordId = useCanvasStore((state) => state.selectedCoordId)
  const userPoints = useCanvasStore((state) => state.userPoints)
  const userSegments = useCanvasStore((state) => state.userSegments)
  const userFunctions = useCanvasStore((state) => state.userFunctions)

  const activeSessionId = useChatStore((state) => state.activeId)
  const tutorMode = useSettings((state) => state.tutorMode)
  const streaming = useChatStore((state) =>
    state.activeId ? Object.hasOwn(state.streaming, state.activeId) : false
  )

  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 520, height: 420 })
  const [viewport, setViewport] = useState<CoordViewport>(coordinate.viewport)
  const [cursorWorld, setCursorWorld] = useState<Vec2 | null>(null)
  const [draggingKind, setDraggingKind] = useState<'none' | 'pan' | 'element'>('none')
  const [toolMode, setToolMode] = useState<ToolMode>('pan')
  const [snapPlotToGrid, setSnapPlotToGrid] = useState(true)
  const [globalTraceOn, setGlobalTraceOn] = useState(false)
  const [showGridLocal, setShowGridLocal] = useState<boolean | null>(null)
  const [segmentStartId, setSegmentStartId] = useState<string | null>(null)
  const [fnInput, setFnInput] = useState('')
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null)
  const [hoveredMeasureIds, setHoveredMeasureIds] = useState<string[]>([])
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('none')
  const [dockCollapsed, setDockCollapsed] = useState(false)
  const [scriptDraft, setScriptDraft] = useState('')
  const [snapTargetId, setSnapTargetId] = useState<string | null>(null)

  const scriptPersistentStateRef = useRef<Record<string, unknown>>({})
  const scriptDtRef = useRef(0)
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinchStartRef = useRef<{
    dist: number
    viewport: CoordViewport
    cx: number
    cy: number
  } | null>(null)
  const dragStateRef = useRef<DragSession | null>(null)

  const effectiveShowGrid = showGridLocal ?? coordinate.showGrid
  const hasUserItems = userPoints.length > 0 || userSegments.length > 0 || userFunctions.length > 0
  const effectiveHasContent = hasContent || hasUserItems || toolMode !== 'pan'

  // 当 AI 显式调用 coord_setup / coord_clear 或切换会话时同步视口，保留用户手动拖拽/缩放
  const setupSyncKey = `${activeSessionId ?? ''}:${coordinate.setupVersion}:${hasContent ? 1 : 0}`
  const prevSetupKeyRef = useRef(setupSyncKey)
  useEffect(() => {
    if (setupSyncKey !== prevSetupKeyRef.current) {
      prevSetupKeyRef.current = setupSyncKey
      setViewport(coordinate.viewport)
    }
  }, [setupSyncKey, coordinate.viewport])

  // 当脚本切换时刷新编辑器草稿和持久状态
  const activeScriptId = coordinate.motionScript?.id ?? ''
  const activeScriptCode = coordinate.motionScript?.code ?? ''
  useEffect(() => {
    setScriptDraft(scriptCodeOverride ?? activeScriptCode)
    scriptPersistentStateRef.current = {}
  }, [activeScriptId, activeScriptCode, scriptCodeOverride])

  // 键盘快捷键：Escape 退出绘制模式，Space 播放/暂停，Delete 删除选中自绘元素
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return
      }
      if (event.key === 'Escape') {
        setToolMode('pan')
        setSegmentStartId(null)
        setInspectorTab('none')
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedCoordId) {
        const isUser =
          userPoints.some((p) => p.id === selectedCoordId) ||
          userSegments.some((s) => s.id === selectedCoordId) ||
          userFunctions.some((f) => f.id === selectedCoordId)
        if (isUser) {
          removeUserCoordElement(selectedCoordId)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedCoordId, userPoints, userSegments, userFunctions])

  // 监听容器尺寸，自适应高清渲染
  useEffect(() => {
    const el = containerRef.current
    if (!el) {
      return
    }
    const update = () => {
      const rect = el.getBoundingClientRect()
      if (rect.width > 10 && rect.height > 10) {
        setSize({ width: rect.width, height: rect.height })
      }
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [effectiveHasContent])

  // 统一求解当前帧的完整场景（动点 + AI控制脚本 + 实时约束求解 + 派生点 + 度量）
  const solvedScene = useMemo(
    () =>
      solveCoordinateScene({
        coord: coordinate,
        tValues,
        freePositions,
        paramValues,
        userPoints,
        draggedId: draggedPointId,
        disabledConstraintIds,
        scriptEnabled,
        scriptTime,
        scriptDt: scriptDtRef.current,
        playing,
        isTimelineDriven: scriptTimelineActive,
        scriptCodeOverride,
        scriptPersistentState: scriptPersistentStateRef.current,
      }),
    [
      coordinate,
      tValues,
      freePositions,
      paramValues,
      userPoints,
      draggedPointId,
      disabledConstraintIds,
      scriptEnabled,
      scriptTime,
      playing,
      scriptTimelineActive,
      scriptCodeOverride,
    ]
  )

  const solvedSceneRef = useRef(solvedScene)
  solvedSceneRef.current = solvedScene

  // 若脚本主动调用 ctx.pause()，立即暂停播放
  useEffect(() => {
    if (solvedScene.scriptRequestPause && playing) {
      setCanvasPlaying(false)
    }
  }, [solvedScene.scriptRequestPause, playing])

  // 记录开启了 trace 的点或全局留痕模式下的轨迹点
  useEffect(() => {
    const traceTargets: Record<string, Vec2> = {}
    for (const p of coordinate.points) {
      if ((p.trace || (globalTraceOn && p.draggable)) && solvedScene.points[p.id]) {
        traceTargets[p.id] = solvedScene.points[p.id]
      }
    }
    for (const mp of coordinate.movingPoints) {
      if ((mp.trace || globalTraceOn) && solvedScene.points[mp.id]) {
        traceTargets[mp.id] = solvedScene.points[mp.id]
      }
    }
    for (const dp of coordinate.derivedPoints) {
      if ((dp.trace || globalTraceOn) && solvedScene.points[dp.id]) {
        traceTargets[dp.id] = solvedScene.points[dp.id]
      }
    }
    if (Object.keys(traceTargets).length > 0) {
      appendTracePoints(traceTargets)
    }
  }, [
    coordinate.points,
    coordinate.movingPoints,
    coordinate.derivedPoints,
    solvedScene.points,
    globalTraceOn,
  ])

  // 统一动画循环：支持 AI 控制脚本时间轴播放 + 普通动点自动播放（单次 batchUpdate，避免多点渲染抖动）
  const directionRef = useRef<Record<string, 1 | -1>>({})
  const scriptDirRef = useRef<1 | -1>(1)
  const hasAnimatable =
    Boolean(coordinate.motionScript && scriptEnabled) ||
    coordinate.movingPoints.some((mp) => mp.path.type !== 'free')

  useEffect(() => {
    if (!playing || !hasAnimatable) {
      return
    }
    let raf = 0
    let lastTime = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000)
      lastTime = now
      scriptDtRef.current = dt * speed
      const store = useCanvasStore.getState()

      if (coordinate.motionScript && store.scriptEnabled) {
        const dur = Math.max(0.5, coordinate.motionScript.duration)
        const mode = coordinate.motionScript.loopMode
        let nextTime = store.scriptTime + scriptDirRef.current * dt * speed
        if (nextTime >= dur) {
          if (mode === 'bounce') {
            nextTime = dur
            scriptDirRef.current = -1
          } else if (mode === 'loop') {
            nextTime = 0
          } else {
            nextTime = dur
            setCanvasPlaying(false)
          }
        } else if (nextTime <= 0) {
          if (mode === 'bounce') {
            nextTime = 0
            scriptDirRef.current = 1
          } else {
            nextTime = dur
          }
        }
        batchUpdateMotionState({ scriptTime: nextTime })
      } else {
        const nextT: Record<string, number> = {}
        const currentT = store.tValues
        // 如果存在约束，优先驱动第一个 1D 动点并让约束求解器驱动其余受约束点，避免互相拉扯
        const hasConstraints = coordinate.constraints.some(
          (c) => c.enabled && !store.disabledConstraintIds[c.id]
        )
        const driverIds = new Set<string>()
        const nonFreeMps = coordinate.movingPoints.filter((mp) => mp.path.type !== 'free')
        if (hasConstraints && nonFreeMps.length > 0) {
          driverIds.add(nonFreeMps[0].id)
        } else {
          for (const mp of nonFreeMps) {
            driverIds.add(mp.id)
          }
        }

        for (const mp of nonFreeMps) {
          if (!driverIds.has(mp.id)) {
            continue
          }
          const span = mp.tMax - mp.tMin
          if (span <= 0) {
            continue
          }
          const dir = directionRef.current[mp.id] ?? 1
          const prevVal = Object.hasOwn(currentT, mp.id) ? currentT[mp.id] : mp.initialT
          let nextVal = prevVal + dir * span * 0.22 * speed * dt
          if (nextVal >= mp.tMax) {
            if (loopMode === 'bounce') {
              nextVal = mp.tMax
              directionRef.current[mp.id] = -1
            } else {
              nextVal = mp.tMin
            }
          } else if (nextVal <= mp.tMin) {
            if (loopMode === 'bounce') {
              nextVal = mp.tMin
              directionRef.current[mp.id] = 1
            } else {
              nextVal = mp.tMax
            }
          }
          nextT[mp.id] = nextVal
        }
        if (Object.keys(nextT).length > 0) {
          const nextFree = Object.fromEntries(
            Object.entries(store.freePositions).filter(([id]) => !Object.hasOwn(nextT, id))
          )
          useCanvasStore.setState({
            tValues: { ...store.tValues, ...nextT },
            freePositions: nextFree,
          })
        }
      }

      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      scriptDtRef.current = 0
    }
  }, [
    playing,
    speed,
    loopMode,
    coordinate.movingPoints,
    coordinate.motionScript,
    coordinate.constraints,
    hasAnimatable,
  ])

  // 等比例坐标系映射（保证圆仍是正圆、直角仍是 90°）
  const transform = useMemo(() => {
    const worldW = Math.max(0.5, viewport.xMax - viewport.xMin)
    const worldH = Math.max(0.5, viewport.yMax - viewport.yMin)
    const scale = Math.min(size.width / worldW, size.height / worldH)
    const cx = (viewport.xMin + viewport.xMax) / 2
    const cy = (viewport.yMin + viewport.yMax) / 2
    const toSvgX = (x: number) => size.width / 2 + (x - cx) * scale
    const toSvgY = (y: number) => size.height / 2 - (y - cy) * scale
    const toWorldX = (sx: number) => cx + (sx - size.width / 2) / scale
    const toWorldY = (sy: number) => cy - (sy - size.height / 2) / scale
    const visibleXMin = toWorldX(0)
    const visibleXMax = toWorldX(size.width)
    const visibleYMin = toWorldY(size.height)
    const visibleYMax = toWorldY(0)
    return {
      scale,
      toSvgX,
      toSvgY,
      toWorldX,
      toWorldY,
      visibleXMin,
      visibleXMax,
      visibleYMin,
      visibleYMax,
    }
  }, [size.width, size.height, viewport])

  const zoomBy = useCallback(
    (factor: number, centerX = size.width / 2, centerY = size.height / 2) => {
      if (!Number.isFinite(factor) || factor <= 0) {
        return
      }
      setViewport((prev) => {
        const nextW = prev.xMax - prev.xMin
        if ((factor < 1 && nextW < 0.25) || (factor > 1 && nextW > 5000)) {
          return prev
        }
        const worldW = Math.max(0.5, prev.xMax - prev.xMin)
        const worldH = Math.max(0.5, prev.yMax - prev.yMin)
        const scale = Math.min(size.width / worldW, size.height / worldH)
        const cx = (prev.xMin + prev.xMax) / 2
        const cy = (prev.yMin + prev.yMax) / 2
        const anchorX = cx + (centerX - size.width / 2) / scale
        const anchorY = cy - (centerY - size.height / 2) / scale
        return {
          xMin: anchorX + (prev.xMin - anchorX) * factor,
          xMax: anchorX + (prev.xMax - anchorX) * factor,
          yMin: anchorY + (prev.yMin - anchorY) * factor,
          yMax: anchorY + (prev.yMax - anchorY) * factor,
        }
      })
    },
    [size.width, size.height]
  )

  const zoomByRef = useRef(zoomBy)
  zoomByRef.current = zoomBy

  // 非 passive 原生监听拦截滚轮与触控板双指捏合
  useEffect(() => {
    const el = containerRef.current
    if (!el) {
      return
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      event.stopPropagation()
      let dy = event.deltaY
      if (event.deltaMode === 1) {
        dy *= 16
      } else if (event.deltaMode === 2) {
        dy *= 100
      }
      if (!dy) {
        return
      }
      const clampedDy = Math.max(-180, Math.min(180, dy))
      const sensitivity = event.ctrlKey ? 0.008 : 0.0012
      const factor = Math.exp(clampedDy * sensitivity)
      const rect = el.getBoundingClientRect()
      zoomByRef.current(factor, event.clientX - rect.left, event.clientY - rect.top)
    }

    let lastScale = 1
    const onGestureStart = (event: Event) => {
      event.preventDefault()
      lastScale = 1
    }
    const onGestureChange = (event: Event) => {
      event.preventDefault()
      const gestureEvent = event as Event & { scale?: number; clientX?: number; clientY?: number }
      const scale =
        typeof gestureEvent.scale === 'number' && gestureEvent.scale > 0 ? gestureEvent.scale : 1
      const stepScale = scale / lastScale
      lastScale = scale
      if (!Number.isFinite(stepScale) || stepScale <= 0 || Math.abs(stepScale - 1) < 1e-4) {
        return
      }
      const rect = el.getBoundingClientRect()
      const cx =
        typeof gestureEvent.clientX === 'number' ? gestureEvent.clientX - rect.left : rect.width / 2
      const cy =
        typeof gestureEvent.clientY === 'number' ? gestureEvent.clientY - rect.top : rect.height / 2
      zoomByRef.current(1 / stepScale, cx, cy)
    }
    const onGestureEnd = (event: Event) => {
      event.preventDefault()
      lastScale = 1
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('gesturestart', onGestureStart, { passive: false })
    el.addEventListener('gesturechange', onGestureChange, { passive: false })
    el.addEventListener('gestureend', onGestureEnd, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('gesturestart', onGestureStart)
      el.removeEventListener('gesturechange', onGestureChange)
      el.removeEventListener('gestureend', onGestureEnd)
    }
  }, [effectiveHasContent])

  const movablePointIdSet = useMemo(() => {
    const set = new Set<string>()
    for (const mp of coordinate.movingPoints) {
      if (mp.draggable !== false && mp.visible !== false) {
        set.add(mp.id)
      }
    }
    for (const p of coordinate.points) {
      if (p.draggable && !p.pinned && p.visible !== false) {
        set.add(p.id)
      }
    }
    for (const up of userPoints) {
      set.add(up.id)
    }
    return set
  }, [coordinate.movingPoints, coordinate.points, userPoints])

  // 合并所有可交互点位（固定点 + 动点 + 派生点 + 辅助线派生点 + 学生自绘点）
  const allInteractivePoints = useMemo(() => {
    const pts: {
      id: string
      label: string
      x: number
      y: number
      color: string
      isUser?: boolean
      isMoving?: boolean
      draggable: boolean
      mp?: CoordMovingPoint
    }[] = []
    for (const p of coordinate.points) {
      if (p.visible === false) {
        continue
      }
      const pos = solvedScene.points[p.id] ?? { x: p.x, y: p.y }
      pts.push({
        id: p.id,
        label: p.label,
        x: pos.x,
        y: pos.y,
        color: p.color,
        draggable: Boolean(p.draggable && !p.pinned),
      })
    }
    for (const mp of coordinate.movingPoints) {
      if (mp.visible === false) {
        continue
      }
      const pos = solvedScene.points[mp.id]
      if (pos) {
        pts.push({
          id: mp.id,
          label: mp.label,
          x: pos.x,
          y: pos.y,
          color: mp.color,
          isMoving: true,
          draggable: mp.draggable !== false,
          mp,
        })
      }
    }
    for (const dp of coordinate.derivedPoints) {
      if (dp.visible === false) {
        continue
      }
      const pos = solvedScene.points[dp.id]
      if (pos) {
        pts.push({
          id: dp.id,
          label: dp.label,
          x: pos.x,
          y: pos.y,
          color: dp.color,
          draggable: false,
        })
      }
    }
    for (const aux of coordinate.auxiliaryLines) {
      if (aux.visible === false || !aux.derivedPointId) {
        continue
      }
      const pos = solvedScene.points[aux.derivedPointId]
      if (pos) {
        pts.push({
          id: aux.derivedPointId,
          label: aux.derivedPointLabel || aux.derivedPointId,
          x: pos.x,
          y: pos.y,
          color: aux.color,
          draggable: false,
        })
      }
    }
    for (const up of userPoints) {
      pts.push({
        id: up.id,
        label: up.label,
        x: up.x,
        y: up.y,
        color: '#8B5CF6',
        isUser: true,
        draggable: true,
      })
    }
    return pts
  }, [
    coordinate.points,
    coordinate.movingPoints,
    coordinate.derivedPoints,
    coordinate.auxiliaryLines,
    solvedScene.points,
    userPoints,
  ])

  const fitAllElements = useCallback(() => {
    const xs: number[] = []
    const ys: number[] = []
    for (const p of allInteractivePoints) {
      xs.push(p.x)
      ys.push(p.y)
    }
    for (const seg of coordinate.segments) {
      if (seg.from) {
        xs.push(seg.from[0])
        ys.push(seg.from[1])
      }
      if (seg.to) {
        xs.push(seg.to[0])
        ys.push(seg.to[1])
      }
    }
    const resolveCtx: ResolveContext = {
      coord: coordinate,
      tValues,
      params: solvedScene.params,
      overrides: solvedScene.points,
      userPoints,
    }
    for (const c of coordinate.circles) {
      const resolved = resolveCircleParams(resolveCtx, c)
      if (resolved) {
        xs.push(resolved.center.x - resolved.radius, resolved.center.x + resolved.radius)
        ys.push(resolved.center.y - resolved.radius, resolved.center.y + resolved.radius)
      }
    }
    if (xs.length === 0 || ys.length === 0) {
      setViewport(coordinate.viewport)
      return
    }
    const minX = Math.min(...xs, 0)
    const maxX = Math.max(...xs, 0)
    const minY = Math.min(...ys, 0)
    const maxY = Math.max(...ys, 0)
    const spanX = Math.max(2, maxX - minX)
    const spanY = Math.max(2, maxY - minY)
    const padX = spanX * 0.22
    const padY = spanY * 0.22
    setViewport({
      xMin: minX - padX,
      xMax: maxX + padX,
      yMin: minY - padY,
      yMax: maxY + padY,
    })
  }, [
    allInteractivePoints,
    coordinate,
    tValues,
    solvedScene.params,
    solvedScene.points,
    userPoints,
  ])

  const gridStep = chooseGridStep(transform.visibleXMax - transform.visibleXMin)
  const subStep = gridStep / 2
  const xTicks: number[] = []
  for (
    let x = Math.ceil(transform.visibleXMin / gridStep) * gridStep;
    x <= transform.visibleXMax;
    x += gridStep
  ) {
    xTicks.push(Number(x.toFixed(6)))
  }
  const yTicks: number[] = []
  for (
    let y = Math.ceil(transform.visibleYMin / gridStep) * gridStep;
    y <= transform.visibleYMax;
    y += gridStep
  ) {
    yTicks.push(Number(y.toFixed(6)))
  }
  const xSubTicks: number[] = []
  for (
    let x = Math.ceil(transform.visibleXMin / subStep) * subStep;
    x <= transform.visibleXMax;
    x += subStep
  ) {
    if (Math.abs(x % gridStep) > 1e-4) {
      xSubTicks.push(Number(x.toFixed(6)))
    }
  }
  const ySubTicks: number[] = []
  for (
    let y = Math.ceil(transform.visibleYMin / subStep) * subStep;
    y <= transform.visibleYMax;
    y += subStep
  ) {
    if (Math.abs(y % gridStep) > 1e-4) {
      ySubTicks.push(Number(y.toFixed(6)))
    }
  }

  const originSvgX = transform.toSvgX(0)
  const originSvgY = transform.toSvgY(0)
  const originInViewX = originSvgX >= 18 && originSvgX <= size.width - 18
  const originInViewY = originSvgY >= 18 && originSvgY <= size.height - 18
  const clampedAxisX = Math.max(26, Math.min(size.width - 26, originSvgX))
  const clampedAxisY = Math.max(26, Math.min(size.height - 26, originSvgY))

  // 合并 AI 函数曲线（显式/参数/极坐标/不等式阴影）与学生自绘函数曲线
  const allFunctions = useMemo(
    () => [
      ...coordinate.functions
        .filter((f) => f.visible !== false)
        .map((f) => ({ ...f, isUser: false })),
      ...userFunctions.map((uf) => ({
        id: uf.id,
        kind: 'explicit' as const,
        expr: uf.expr,
        label: `y = ${uf.expr}`,
        color: '#8B5CF6',
        domain: undefined as [number, number] | undefined,
        tDomain: undefined as [number, number] | undefined,
        xExpr: undefined as string | undefined,
        yExpr: undefined as string | undefined,
        rExpr: undefined as string | undefined,
        inequality: undefined as '<' | '<=' | '>' | '>=' | undefined,
        fill: undefined as string | undefined,
        dashed: true,
        stepIndex: 0,
        isUser: true,
      })),
    ],
    [coordinate.functions, userFunctions]
  )

  const functionPaths = useMemo(
    () =>
      allFunctions.map((fn) => {
        const kind = fn.kind ?? 'explicit'
        const params = solvedScene.params

        if (kind === 'parametric' && fn.xExpr && fn.yExpr) {
          const cx = compileMathExpr(fn.xExpr)
          const cy = compileMathExpr(fn.yExpr)
          if (!cx || !cy) {
            return { fn, compiled: null, d: '', fillD: '', labelPos: null as Vec2 | null }
          }
          const tStart = fn.tDomain ? fn.tDomain[0] : 0
          const tEnd = fn.tDomain ? fn.tDomain[1] : Math.PI * 2
          const steps = 260
          const parts: string[] = []
          let started = false
          let labelPos: Vec2 | null = null
          for (let i = 0; i <= steps; i += 1) {
            const t = tStart + ((tEnd - tStart) * i) / steps
            const vars = { ...params, t, x: t, theta: t }
            const wx = cx(vars, solvedScene.points)
            const wy = cy(vars, solvedScene.points)
            if (!Number.isFinite(wx) || !Number.isFinite(wy)) {
              started = false
              continue
            }
            const sx = transform.toSvgX(wx)
            const sy = transform.toSvgY(wy)
            parts.push(`${started ? 'L' : 'M'}${sx.toFixed(1)},${sy.toFixed(1)}`)
            started = true
            if (i === Math.floor(steps * 0.25)) {
              labelPos = { x: sx + 8, y: sy - 8 }
            }
          }
          return { fn, compiled: null, d: parts.join(' '), fillD: '', labelPos }
        }

        if (kind === 'polar' && (fn.rExpr || fn.expr)) {
          const cr = compileMathExpr(fn.rExpr || fn.expr)
          if (!cr) {
            return { fn, compiled: null, d: '', fillD: '', labelPos: null as Vec2 | null }
          }
          const tStart = fn.tDomain ? fn.tDomain[0] : 0
          const tEnd = fn.tDomain ? fn.tDomain[1] : Math.PI * 2
          const steps = 280
          const parts: string[] = []
          let started = false
          let labelPos: Vec2 | null = null
          for (let i = 0; i <= steps; i += 1) {
            const theta = tStart + ((tEnd - tStart) * i) / steps
            const r = cr({ ...params, theta, t: theta, x: theta }, solvedScene.points)
            if (!Number.isFinite(r) || Math.abs(r) > 1e4) {
              started = false
              continue
            }
            const sx = transform.toSvgX(r * Math.cos(theta))
            const sy = transform.toSvgY(r * Math.sin(theta))
            parts.push(`${started ? 'L' : 'M'}${sx.toFixed(1)},${sy.toFixed(1)}`)
            started = true
            if (i === Math.floor(steps * 0.15)) {
              labelPos = { x: sx + 8, y: sy - 8 }
            }
          }
          return { fn, compiled: null, d: parts.join(' '), fillD: '', labelPos }
        }

        const compiled = compileMathExpr(fn.expr)
        if (!compiled) {
          return { fn, compiled: null, d: '', fillD: '', labelPos: null as Vec2 | null }
        }
        const xStart = fn.domain
          ? Math.max(fn.domain[0], transform.visibleXMin)
          : transform.visibleXMin
        const xEnd = fn.domain
          ? Math.min(fn.domain[1], transform.visibleXMax)
          : transform.visibleXMax
        if (xEnd <= xStart) {
          return { fn, compiled, d: '', fillD: '', labelPos: null as Vec2 | null }
        }
        const steps = 260
        const parts: string[] = []
        const sampledPts: { sx: number; sy: number }[] = []
        let started = false
        let labelPos: Vec2 | null = null
        for (let i = 0; i <= steps; i += 1) {
          const x = xStart + ((xEnd - xStart) * i) / steps
          const y = compiled({ ...params, x, t: x }, solvedScene.points)
          if (!Number.isFinite(y) || Math.abs(y) > 1e4) {
            started = false
            continue
          }
          const sx = transform.toSvgX(x)
          const sy = transform.toSvgY(y)
          if (sy < -size.height * 2 || sy > size.height * 3) {
            started = false
            continue
          }
          parts.push(`${started ? 'L' : 'M'}${sx.toFixed(1)},${sy.toFixed(1)}`)
          sampledPts.push({ sx, sy })
          started = true
          if (i === Math.floor(steps * 0.72) && sy > 36 && sy < size.height - 36) {
            labelPos = { x: sx + 8, y: sy - 8 }
          }
        }

        let fillD = ''
        if ((kind === 'inequality' || fn.fill) && sampledPts.length >= 2) {
          const edgeY =
            fn.inequality === '>' || fn.inequality === '>='
              ? -10
              : fn.inequality === '<' || fn.inequality === '<='
                ? size.height + 10
                : transform.toSvgY(0)
          const first = sampledPts[0]
          const last = sampledPts[sampledPts.length - 1]
          fillD =
            `M${first.sx.toFixed(1)},${edgeY.toFixed(1)} ` +
            sampledPts.map((pt) => `L${pt.sx.toFixed(1)},${pt.sy.toFixed(1)}`).join(' ') +
            ` L${last.sx.toFixed(1)},${edgeY.toFixed(1)} Z`
        }

        return { fn, compiled, d: parts.join(' '), fillD, labelPos }
      }),
    [allFunctions, transform, size.height, solvedScene.params, solvedScene.points]
  )

  const getSegmentMovableIds = useCallback(
    (fromId: string | undefined, toId: string | undefined): string[] => {
      const ids: string[] = []
      if (fromId && movablePointIdSet.has(fromId)) {
        ids.push(fromId)
      }
      if (toId && movablePointIdSet.has(toId) && !ids.includes(toId)) {
        ids.push(toId)
      }
      return ids
    },
    [movablePointIdSet]
  )

  /** 命中检测：可拖动点 > 普通点 > 函数曲线 > 线段/辅助线 */
  const detectHover = useCallback(
    (sx: number, sy: number, wx: number) => {
      // 1. 优先命中可拖动点（22px 容错，手指/鼠标极易抓住！）
      let bestDragPt: HoverInfo | null = null
      let bestDragDist = 22
      for (const pt of allInteractivePoints) {
        if (!pt.draggable) {
          continue
        }
        const d = Math.hypot(transform.toSvgX(pt.x) - sx, transform.toSvgY(pt.y) - sy)
        if (d < bestDragDist) {
          bestDragDist = d
          bestDragPt = {
            kind: 'point',
            id: pt.id,
            label: pt.label,
            x: pt.x,
            y: pt.y,
            draggable: true,
          }
        }
      }
      if (bestDragPt) {
        setHoverInfo(bestDragPt)
        return
      }

      // 2. 普通固定点 / 派生点（15px）
      let bestPt: HoverInfo | null = null
      let bestPtDist = 15
      for (const pt of allInteractivePoints) {
        const d = Math.hypot(transform.toSvgX(pt.x) - sx, transform.toSvgY(pt.y) - sy)
        if (d < bestPtDist) {
          bestPtDist = d
          bestPt = {
            kind: 'point',
            id: pt.id,
            label: pt.label,
            x: pt.x,
            y: pt.y,
            draggable: pt.draggable,
          }
        }
      }
      if (bestPt) {
        setHoverInfo(bestPt)
        return
      }

      // 3. 命中线段 / 辅助线 / 学生线段（优先识别可联动拖动的动点线段！）
      for (const seg of coordinate.segments) {
        if (seg.visible === false) {
          continue
        }
        const a = seg.fromId
          ? solvedScene.points[seg.fromId]
          : seg.from
            ? { x: seg.from[0], y: seg.from[1] }
            : null
        const b = seg.toId
          ? solvedScene.points[seg.toId]
          : seg.to
            ? { x: seg.to[0], y: seg.to[1] }
            : null
        if (!a || !b) {
          continue
        }
        const d = distToSegmentPx(
          sx,
          sy,
          transform.toSvgX(a.x),
          transform.toSvgY(a.y),
          transform.toSvgX(b.x),
          transform.toSvgY(b.y)
        )
        if (d < 11) {
          const movable = getSegmentMovableIds(seg.fromId, seg.toId).length > 0
          setHoverInfo({
            kind: 'segment',
            id: seg.id,
            label: seg.label || `${seg.fromId ?? ''}${seg.toId ?? ''}` || '线段',
            length: vecDist(a, b),
            draggable: movable,
          })
          return
        }
      }

      for (const aux of coordinate.auxiliaryLines) {
        if (aux.visible === false) {
          continue
        }
        const geom = solvedScene.auxGeometries[aux.id]
        if (!geom) {
          continue
        }
        const d = distToSegmentPx(
          sx,
          sy,
          transform.toSvgX(geom.from.x),
          transform.toSvgY(geom.from.y),
          transform.toSvgX(geom.to.x),
          transform.toSvgY(geom.to.y)
        )
        if (d < 11) {
          const movable = getSegmentMovableIds(aux.fromId, aux.toId).length > 0
          setHoverInfo({
            kind: 'segment',
            id: aux.id,
            label: aux.label || '辅助线',
            length: vecDist(geom.from, geom.to),
            draggable: movable,
          })
          return
        }
      }

      // 4. 命中函数曲线（Desmos 式实时轨迹追踪）
      let bestCurve: HoverInfo | null = null
      let bestCurveDist = 13
      for (const item of functionPaths) {
        if (!item.compiled) {
          continue
        }
        if (item.fn.domain && (wx < item.fn.domain[0] || wx > item.fn.domain[1])) {
          continue
        }
        const fy = item.compiled({ ...solvedScene.params, x: wx, t: wx }, solvedScene.points)
        if (!Number.isFinite(fy)) {
          continue
        }
        const d = Math.abs(transform.toSvgY(fy) - sy)
        if (d < bestCurveDist) {
          bestCurveDist = d
          bestCurve = {
            kind: 'curve',
            id: item.fn.id,
            expr: item.fn.label || `y = ${item.fn.expr}`,
            x: wx,
            y: fy,
            color: item.fn.color,
          }
        }
      }
      if (bestCurve) {
        setHoverInfo(bestCurve)
        return
      }

      setHoverInfo(null)
    },
    [
      allInteractivePoints,
      coordinate.segments,
      coordinate.auxiliaryLines,
      solvedScene.points,
      solvedScene.auxGeometries,
      solvedScene.params,
      functionPaths,
      getSegmentMovableIds,
      transform,
    ]
  )

  /** 对单个被拖动点执行路径投影 + 磁吸关键点 + 约束暖启动 */
  const applyDragMoveForPoint = useCallback(
    (
      pointId: string,
      isUser: boolean,
      mp: CoordMovingPoint | undefined,
      wx: number,
      wy: number,
      shiftKey: boolean
    ) => {
      if (isUser) {
        const nextX = shiftKey ? Math.round(wx / (gridStep / 2)) * (gridStep / 2) : wx
        const nextY = shiftKey ? Math.round(wy / (gridStep / 2)) * (gridStep / 2) : wy
        updateUserCoordPoint(pointId, Number(nextX.toFixed(3)), Number(nextY.toFixed(3)))
        return
      }

      // 磁性吸附：若靠近非自身固定点（如最优解 P0 或顶点 B）10px 内，柔和吸附
      let targetX = wx
      let targetY = wy
      let snappedTo: string | null = null
      if (!shiftKey) {
        const sx = transform.toSvgX(wx)
        const sy = transform.toSvgY(wy)
        let bestD = 10
        for (const p of coordinate.points) {
          if (p.id === pointId || p.visible === false || p.draggable) {
            continue
          }
          const pos = solvedSceneRef.current.points[p.id] ?? { x: p.x, y: p.y }
          const d = Math.hypot(transform.toSvgX(pos.x) - sx, transform.toSvgY(pos.y) - sy)
          if (d < bestD) {
            bestD = d
            targetX = pos.x
            targetY = pos.y
            snappedTo = p.id
          }
        }
      }
      setSnapTargetId(snappedTo)

      const store = useCanvasStore.getState()
      const currentScene = solvedSceneRef.current

      if (mp && mp.path.type !== 'free') {
        const resolveCtx: ResolveContext = {
          coord: coordinate,
          tValues: store.tValues,
          params: currentScene.params,
          overrides: currentScene.points,
          userPoints: store.userPoints,
        }
        const proj = projectWorldToMovingPoint(resolveCtx, mp, targetX, targetY, {
          snapShift: shiftKey,
          gridStep,
        })
        if (proj.t !== undefined) {
          const nextTValues = { ...store.tValues, [pointId]: proj.t }
          const nextFree: Record<string, Vec2> = Object.fromEntries(
            Object.entries(store.freePositions).filter(([k]) => k !== pointId)
          )
          // 如果有约束，用当前场景立刻预求一步并暖启动其它受约束点，保证连续分支不跳变
          if (coordinate.constraints.length > 0) {
            const preview = solveCoordinateScene({
              coord: coordinate,
              tValues: nextTValues,
              freePositions: nextFree,
              paramValues: store.paramValues,
              userPoints: store.userPoints,
              draggedId: pointId,
              disabledConstraintIds: store.disabledConstraintIds,
              scriptEnabled: store.scriptEnabled,
              scriptTime: store.scriptTime,
              playing: false,
              isTimelineDriven: false,
              scriptCodeOverride: store.scriptCodeOverride,
              scriptPersistentState: scriptPersistentStateRef.current,
            })
            for (const [sid, spt] of Object.entries(preview.solvedOverrides)) {
              if (sid !== pointId) {
                nextFree[sid] = spt
              }
            }
            for (const [sid, st] of Object.entries(preview.solvedT)) {
              if (sid !== pointId) {
                nextTValues[sid] = st
              }
            }
          }
          useCanvasStore.setState({ tValues: nextTValues, freePositions: nextFree })
        }
        return
      }

      // free 动点或 draggable 点：自由 2D 坐标 + 约束暖启动
      const finalX = shiftKey ? Math.round(targetX / (gridStep / 2)) * (gridStep / 2) : targetX
      const finalY = shiftKey ? Math.round(targetY / (gridStep / 2)) * (gridStep / 2) : targetY
      let nextPos: Vec2 = { x: finalX, y: finalY }
      if (mp?.path.type === 'free' && mp.path.bounds) {
        const b = mp.path.bounds
        if (b.xMin !== undefined) {
          nextPos.x = Math.max(b.xMin, nextPos.x)
        }
        if (b.xMax !== undefined) {
          nextPos.x = Math.min(b.xMax, nextPos.x)
        }
        if (b.yMin !== undefined) {
          nextPos.y = Math.max(b.yMin, nextPos.y)
        }
        if (b.yMax !== undefined) {
          nextPos.y = Math.min(b.yMax, nextPos.y)
        }
      }
      const nextFree = { ...store.freePositions, [pointId]: nextPos }
      const nextTValues = { ...store.tValues }
      if (coordinate.constraints.length > 0) {
        const preview = solveCoordinateScene({
          coord: coordinate,
          tValues: nextTValues,
          freePositions: nextFree,
          paramValues: store.paramValues,
          userPoints: store.userPoints,
          draggedId: pointId,
          disabledConstraintIds: store.disabledConstraintIds,
          scriptEnabled: store.scriptEnabled,
          scriptTime: store.scriptTime,
          scriptCodeOverride: store.scriptCodeOverride,
          scriptPersistentState: scriptPersistentStateRef.current,
        })
        for (const [sid, spt] of Object.entries(preview.solvedOverrides)) {
          nextFree[sid] = spt
        }
        for (const [sid, st] of Object.entries(preview.solvedT)) {
          nextTValues[sid] = st
        }
      }
      useCanvasStore.setState({ freePositions: nextFree, tValues: nextTValues })
    },
    [coordinate, gridStep, transform]
  )

  if (!effectiveHasContent) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          <div className={styles.emptyTitle}>动态数学坐标系画板</div>
          <div className={styles.emptyDesc}>
            提问几何、函数、动点或约束轨迹问题后，AI
            可实时作图、设定线段/角度/方程约束条件，甚至编写动点控制程序；你也可以随时开启自由画板自行标点、连线或画函数。
          </div>
          <div className={styles.emptyActions}>
            <button
              type="button"
              className={styles.emptyActionBtn}
              onClick={() => setToolMode('point')}
            >
              开启自由画板（标点 / 连线）
            </button>
            <button
              type="button"
              className={styles.emptyActionBtn}
              onClick={() => setToolMode('function')}
            >
              绘制函数 y = f(x)
            </button>
          </div>
        </div>
      </div>
    )
  }

  const highlighted = new Set<string>([
    ...coordinate.highlightedIds,
    ...solvedScene.scriptHighlights,
    ...(selectedCoordId ? [selectedCoordId] : []),
    ...hoveredMeasureIds,
    ...(hoverInfo ? [hoverInfo.id] : []),
  ])

  const snapWorldVal = (v: number): number => {
    if (!snapPlotToGrid) {
      return Number(v.toFixed(2))
    }
    const step = gridStep / 2
    return Number((Math.round(v / step) * step).toFixed(4))
  }

  const handleCanvasActionClick = (sx: number, sy: number) => {
    const wx = transform.toWorldX(sx)
    const wy = transform.toWorldY(sy)
    if (toolMode === 'point') {
      addUserCoordPoint(snapWorldVal(wx), snapWorldVal(wy))
      return
    }
    if (toolMode === 'segment') {
      let nearestId: string | null = null
      let bestDist = 22
      for (const pt of allInteractivePoints) {
        const d = Math.hypot(transform.toSvgX(pt.x) - sx, transform.toSvgY(pt.y) - sy)
        if (d < bestDist) {
          bestDist = d
          nearestId = pt.id
        }
      }
      if (!nearestId) {
        return
      }
      if (!segmentStartId) {
        setSegmentStartId(nearestId)
        setSelectedCoordId(nearestId)
      } else {
        if (segmentStartId !== nearestId) {
          addUserCoordSegment(segmentStartId, nearestId)
        }
        setSegmentStartId(null)
      }
      return
    }
    if (hoverInfo) {
      setSelectedCoordId(selectedCoordId === hoverInfo.id ? null : hoverInfo.id)
    } else {
      setSelectedCoordId(null)
    }
  }

  const totalConstraints = solvedScene.constraintStatuses.length
  const satisfiedConstraints = solvedScene.constraintStatuses.filter((s) => s.satisfied).length
  const hasUnsatisfiedConstraint = solvedScene.constraintStatuses.some(
    (s) => s.enabled && !s.satisfied
  )
  const hasTraces = Object.values(traces).some((pts) => pts.length >= 2)
  const hasDockControls =
    coordinate.movingPoints.length > 0 ||
    coordinate.sliders.length > 0 ||
    Boolean(coordinate.motionScript)

  const stageCursorClass =
    draggingKind === 'element' || draggingKind === 'pan'
      ? styles.stageDragging
      : toolMode === 'point' || toolMode === 'segment'
        ? styles.stageCrosshair
        : hoverInfo &&
            ((hoverInfo.kind === 'point' && hoverInfo.draggable) ||
              (hoverInfo.kind === 'segment' && hoverInfo.draggable))
          ? styles.stageGrabbable
          : undefined

  return (
    <div className={styles.container}>
      {/* 顶部互动工具条：模式切换 + 轨迹 + 约束 + 控制程序 + 网格 + 问 AI */}
      <div className={styles.toolbar}>
        <div className={styles.toolModeGroup} role="group" aria-label="坐标系交互模式">
          <button
            type="button"
            className={clsx(styles.modeBtn, toolMode === 'pan' && styles.modeBtnActive)}
            title="拖动视图、动点、动点线段或自绘点（默认连续丝滑拖动，按住 Shift 步进吸附）"
            onClick={() => {
              setToolMode('pan')
              setSegmentStartId(null)
            }}
          >
            ✋ 拖动
          </button>
          <button
            type="button"
            className={clsx(styles.modeBtn, toolMode === 'point' && styles.modeBtnActive)}
            title="在坐标系点击添加可拖动的自主探索点"
            onClick={() => {
              setToolMode('point')
              setSegmentStartId(null)
            }}
          >
            ● 标点
          </button>
          <button
            type="button"
            className={clsx(styles.modeBtn, toolMode === 'segment' && styles.modeBtnActive)}
            title="依次点击两个点连接探索线段"
            onClick={() => {
              setToolMode('segment')
              setSegmentStartId(null)
            }}
          >
            ╱ 连线
          </button>
          <button
            type="button"
            className={clsx(styles.modeBtn, toolMode === 'function' && styles.modeBtnActive)}
            title="输入表达式绘制自定义对比函数"
            onClick={() => {
              setToolMode((prev) => (prev === 'function' ? 'pan' : 'function'))
              setSegmentStartId(null)
            }}
          >
            𝑓(x)
          </button>
        </div>

        <div className={styles.toolActionGroup}>
          {totalConstraints > 0 ? (
            <button
              type="button"
              className={clsx(
                styles.miniBtn,
                inspectorTab === 'constraints' && styles.miniBtnActive,
                hasUnsatisfiedConstraint ? styles.miniBtnWarn : styles.miniBtnOk
              )}
              title="查看与开关当前画板的几何/代数约束条件"
              onClick={() =>
                setInspectorTab((prev) => (prev === 'constraints' ? 'none' : 'constraints'))
              }
            >
              约束 {satisfiedConstraints}/{totalConstraints}
            </button>
          ) : null}

          {coordinate.motionScript ? (
            <button
              type="button"
              className={clsx(
                styles.miniBtn,
                inspectorTab === 'script' && styles.miniBtnActive,
                solvedScene.scriptError
                  ? styles.miniBtnWarn
                  : scriptEnabled
                    ? styles.miniBtnScript
                    : undefined
              )}
              title="查看、调试或开关 AI 编写的动点控制程序"
              onClick={() => setInspectorTab((prev) => (prev === 'script' ? 'none' : 'script'))}
            >
              {solvedScene.scriptError ? '⚠ 程序报错' : scriptEnabled ? '⚡ 程序' : '程序(停)'}
            </button>
          ) : null}

          <button
            type="button"
            className={clsx(styles.miniBtn, (globalTraceOn || hasTraces) && styles.miniBtnActive)}
            title={
              globalTraceOn ? '关闭轨迹留痕（再次点击清除留痕）' : '开启所有动点/派生点运动轨迹留痕'
            }
            onClick={() => {
              if (globalTraceOn) {
                setGlobalTraceOn(false)
              } else {
                setGlobalTraceOn(true)
              }
            }}
          >
            轨迹
          </button>
          {hasTraces ? (
            <button
              type="button"
              className={styles.miniBtn}
              title="清除已记录的轨迹曲线"
              onClick={clearTraces}
            >
              清轨迹
            </button>
          ) : null}

          {toolMode === 'point' ? (
            <button
              type="button"
              className={clsx(styles.miniBtn, snapPlotToGrid && styles.miniBtnActive)}
              title="标点时是否吸附到网格刻度"
              onClick={() => setSnapPlotToGrid((prev) => !prev)}
            >
              吸附
            </button>
          ) : null}

          <button
            type="button"
            className={clsx(styles.miniBtn, effectiveShowGrid && styles.miniBtnActive)}
            title="显示/隐藏网格"
            onClick={() => setShowGridLocal((prev) => !(prev ?? coordinate.showGrid))}
          >
            网格
          </button>

          {hasUserItems ? (
            <button
              type="button"
              className={styles.miniBtn}
              title="清除自己标的点、线段与函数"
              onClick={() => {
                clearUserScratchpad()
                setSegmentStartId(null)
              }}
            >
              清自绘
            </button>
          ) : null}

          {hasContent || hasUserItems ? (
            <button
              type="button"
              className={styles.askAiBtn}
              disabled={streaming}
              title="把当前画板上的动点坐标、约束状态与你的自绘图形同步给 AI 分析"
              onClick={() => {
                if (!ensureApiKey()) {
                  return
                }
                const prompt = tutorMode
                  ? '请结合我现在坐标系画板上的动点位置、约束条件与图形，看看我的探索对不对，下一步该怎么思考？'
                  : '请结合我现在坐标系画板上的图形、约束与动点状态，帮我分析一下当前画面。'
                sendQuickMessage(activeSessionId, prompt)
              }}
            >
              问 AI
            </button>
          ) : null}
        </div>
      </div>

      {/* 约束条件检查器抽屉 */}
      {inspectorTab === 'constraints' && totalConstraints > 0 ? (
        <div className={styles.inspectorDrawer}>
          <div className={styles.inspectorHeader}>
            <span className={styles.inspectorTitle}>
              实时约束求解器（拖动动点时自动维持以下条件）
            </span>
            <button
              type="button"
              className={styles.inspectorClose}
              onClick={() => setInspectorTab('none')}
            >
              收起
            </button>
          </div>
          <div className={styles.constraintList}>
            {solvedScene.constraintStatuses.map((st) => (
              <label key={st.id} className={styles.constraintItem}>
                <input
                  type="checkbox"
                  checked={st.enabled}
                  onChange={() => toggleConstraintDisabled(st.id)}
                />
                <span className={styles.constraintLabel}>{st.label}</span>
                <span
                  className={clsx(
                    styles.constraintBadge,
                    !st.enabled
                      ? styles.constraintMuted
                      : st.satisfied
                        ? styles.constraintOk
                        : styles.constraintWarn
                  )}
                >
                  {!st.enabled ? '已停用' : st.satisfied ? '满足 ✓' : `误差 ${st.error.toFixed(2)}`}
                </span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {/* AI 动点控制程序抽屉（支持实时查看、启停、微调代码并热更新） */}
      {inspectorTab === 'script' && coordinate.motionScript ? (
        <div className={styles.inspectorDrawer}>
          <div className={styles.inspectorHeader}>
            <div className={styles.scriptHeaderInfo}>
              <span className={styles.inspectorTitle}>⚡ {coordinate.motionScript.title}</span>
              {coordinate.motionScript.description ? (
                <span className={styles.scriptDesc}>{coordinate.motionScript.description}</span>
              ) : null}
            </div>
            <div className={styles.scriptHeaderActions}>
              <button
                type="button"
                className={clsx(styles.miniBtn, scriptEnabled && styles.miniBtnActive)}
                onClick={() => setScriptEnabled(!scriptEnabled)}
              >
                {scriptEnabled ? '已启用' : '已停用'}
              </button>
              <button
                type="button"
                className={styles.inspectorClose}
                onClick={() => setInspectorTab('none')}
              >
                收起
              </button>
            </div>
          </div>
          <textarea
            className={styles.scriptEditor}
            value={scriptDraft}
            onChange={(event) => setScriptDraft(event.target.value)}
            spellCheck={false}
            rows={5}
          />
          {solvedScene.scriptError ? (
            <div className={styles.scriptErrorBox}>{solvedScene.scriptError}</div>
          ) : null}
          <div className={styles.scriptFooter}>
            <span className={styles.scriptHint}>
              可用 ctx.t / ctx.moveAlong / ctx.getPoint / ctx.setPoint / ctx.math / ctx.setStatus
            </span>
            <div className={styles.scriptFooterBtns}>
              {scriptCodeOverride !== null ? (
                <button
                  type="button"
                  className={styles.miniBtn}
                  onClick={() => {
                    setScriptCodeOverride(null)
                    setScriptDraft(coordinate.motionScript?.code ?? '')
                  }}
                >
                  恢复原程序
                </button>
              ) : null}
              <button
                type="button"
                className={styles.askAiBtn}
                onClick={() => {
                  scriptPersistentStateRef.current = {}
                  setScriptCodeOverride(scriptDraft)
                  setScriptEnabled(true)
                }}
              >
                运行修改
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 学生自绘函数输入条 */}
      {toolMode === 'function' ? (
        <form
          className={styles.fnBar}
          onSubmit={(event) => {
            event.preventDefault()
            if (fnInput.trim()) {
              addUserCoordFunction(fnInput)
              setFnInput('')
              setToolMode('pan')
            }
          }}
        >
          <span className={styles.fnPrefix}>y =</span>
          <input
            type="text"
            className={styles.fnInput}
            placeholder="例如：-x^2 + 4*x 或 sin(x) 或 1.5*x - 3.5"
            value={fnInput}
            onChange={(event) => setFnInput(event.target.value)}
            autoFocus
          />
          <button type="submit" className={styles.fnSubmit}>
            绘制
          </button>
        </form>
      ) : null}

      {/* 连线提示条 */}
      {toolMode === 'segment' ? (
        <div className={styles.modeBanner}>
          {segmentStartId
            ? `已选起点 ${segmentStartId}，请点击第二个点完成连线（Esc 取消）`
            : '请依次点击坐标系上的两个点（含动点或自绘点）连接探索线段'}
        </div>
      ) : null}

      <div
        ref={containerRef}
        className={clsx(styles.stage, stageCursorClass)}
        onDoubleClick={() => fitAllElements()}
        onPointerDown={(event) => {
          if (event.button !== 0 && event.pointerType === 'mouse') {
            return
          }
          // 防止文本选中或默认拖拽行为干扰丝滑拖拽
          event.preventDefault()

          activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
          if (activePointersRef.current.size === 2) {
            const pts = Array.from(activePointersRef.current.values())
            const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
            const rect = event.currentTarget.getBoundingClientRect()
            pinchStartRef.current = {
              dist: Math.max(10, dist),
              viewport,
              cx: (pts[0].x + pts[1].x) / 2 - rect.left,
              cy: (pts[0].y + pts[1].y) / 2 - rect.top,
            }
            dragStateRef.current = null
            setDraggedPointId(null)
            setDraggingKind('none')
            return
          }

          const rect = event.currentTarget.getBoundingClientRect()
          const sx = event.clientX - rect.left
          const sy = event.clientY - rect.top
          const wx = transform.toWorldX(sx)
          const wy = transform.toWorldY(sy)

          try {
            event.currentTarget.setPointerCapture(event.pointerId)
          } catch {
            // 忽略不支持 pointer capture 的环境
          }

          // 浏览/拖动模式下，统一高精度命中检测：动点/可拖点 -> 动点线段/辅助线 -> 平移背景
          if (toolMode === 'pan') {
            // 1. 优先命中可拖动点（24px 宽松半径，彻底解决点难抓、拖不动的问题）
            let bestPt: (typeof allInteractivePoints)[number] | null = null
            let bestPtDist = 24
            for (const pt of allInteractivePoints) {
              if (!pt.draggable) {
                continue
              }
              const d = Math.hypot(transform.toSvgX(pt.x) - sx, transform.toSvgY(pt.y) - sy)
              if (d < bestPtDist) {
                bestPtDist = d
                bestPt = pt
              }
            }
            if (bestPt) {
              setCanvasPlaying(false)
              setScriptTimelineActive(false)
              if (scriptEnabled && coordinate.motionScript) {
                // 若脚本在不处于时间轴驱动时仍强制覆盖当前抓的点，则临时停用脚本以免拖动被弹回
                const probe = solveCoordinateScene({
                  coord: coordinate,
                  tValues,
                  freePositions,
                  paramValues,
                  userPoints,
                  draggedId: bestPt.id,
                  disabledConstraintIds,
                  scriptEnabled: true,
                  scriptTime,
                  playing: false,
                  isTimelineDriven: false,
                  scriptCodeOverride,
                  scriptPersistentState: scriptPersistentStateRef.current,
                })
                if (probe.scriptControlledIds.includes(bestPt.id)) {
                  setScriptEnabled(false)
                }
              }
              setSelectedCoordId(bestPt.id)
              setDraggedPointId(bestPt.id)
              setDraggingKind('element')
              dragStateRef.current = {
                kind: 'point',
                pointId: bestPt.id,
                isUser: Boolean(bestPt.isUser),
                mp: bestPt.mp,
                startX: event.clientX,
                startY: event.clientY,
                moved: false,
              }
              return
            }

            // 2. 命中连接了动点/可拖点的线段或辅助线（12px 半径）——拖动线段即可带动动点一起移动！
            let hitSegment: { id: string; movableIds: string[]; dist: number } | null = null
            for (const seg of coordinate.segments) {
              if (seg.visible === false) {
                continue
              }
              const movableIds = getSegmentMovableIds(seg.fromId, seg.toId)
              if (movableIds.length === 0) {
                continue
              }
              const a = seg.fromId
                ? solvedScene.points[seg.fromId]
                : seg.from
                  ? { x: seg.from[0], y: seg.from[1] }
                  : null
              const b = seg.toId
                ? solvedScene.points[seg.toId]
                : seg.to
                  ? { x: seg.to[0], y: seg.to[1] }
                  : null
              if (!a || !b) {
                continue
              }
              const d = distToSegmentPx(
                sx,
                sy,
                transform.toSvgX(a.x),
                transform.toSvgY(a.y),
                transform.toSvgX(b.x),
                transform.toSvgY(b.y)
              )
              if (d < 12 && (!hitSegment || d < hitSegment.dist)) {
                hitSegment = { id: seg.id, movableIds, dist: d }
              }
            }
            for (const aux of coordinate.auxiliaryLines) {
              if (aux.visible === false) {
                continue
              }
              const movableIds = getSegmentMovableIds(aux.fromId, aux.toId)
              if (movableIds.length === 0) {
                continue
              }
              const geom = solvedScene.auxGeometries[aux.id]
              if (!geom) {
                continue
              }
              const d = distToSegmentPx(
                sx,
                sy,
                transform.toSvgX(geom.from.x),
                transform.toSvgY(geom.from.y),
                transform.toSvgX(geom.to.x),
                transform.toSvgY(geom.to.y)
              )
              if (d < 12 && (!hitSegment || d < hitSegment.dist)) {
                hitSegment = { id: aux.id, movableIds, dist: d }
              }
            }
            for (const seg of userSegments) {
              const movableIds = getSegmentMovableIds(seg.fromId, seg.toId)
              if (movableIds.length === 0) {
                continue
              }
              const a = solvedScene.points[seg.fromId]
              const b = solvedScene.points[seg.toId]
              if (!a || !b) {
                continue
              }
              const d = distToSegmentPx(
                sx,
                sy,
                transform.toSvgX(a.x),
                transform.toSvgY(a.y),
                transform.toSvgX(b.x),
                transform.toSvgY(b.y)
              )
              if (d < 12 && (!hitSegment || d < hitSegment.dist)) {
                hitSegment = { id: seg.id, movableIds, dist: d }
              }
            }

            if (hitSegment) {
              const initialPositions: Record<string, Vec2> = {}
              for (const id of hitSegment.movableIds) {
                const pos = solvedScene.points[id]
                if (pos) {
                  initialPositions[id] = { x: pos.x, y: pos.y }
                }
              }
              setCanvasPlaying(false)
              setScriptTimelineActive(false)
              if (scriptEnabled && coordinate.motionScript) {
                const probe = solveCoordinateScene({
                  coord: coordinate,
                  tValues,
                  freePositions,
                  paramValues,
                  userPoints,
                  draggedId: hitSegment.movableIds[0] ?? null,
                  disabledConstraintIds,
                  scriptEnabled: true,
                  scriptTime,
                  playing: false,
                  isTimelineDriven: false,
                  scriptCodeOverride,
                  scriptPersistentState: scriptPersistentStateRef.current,
                })
                if (hitSegment.movableIds.some((id) => probe.scriptControlledIds.includes(id))) {
                  setScriptEnabled(false)
                }
              }
              setSelectedCoordId(hitSegment.id)
              setDraggedPointId(hitSegment.movableIds[0] ?? null)
              setDraggingKind('element')
              dragStateRef.current = {
                kind: 'segment',
                segmentId: hitSegment.id,
                movableIds: hitSegment.movableIds,
                startX: event.clientX,
                startY: event.clientY,
                startWorld: { x: wx, y: wy },
                initialPositions,
                moved: false,
              }
              return
            }
          }

          // 3. 背景平移（在 point/segment 模式下若拖动距离 < 4px 则在 pointerUp 触发点击标点/连线）
          setDraggingKind('pan')
          dragStateRef.current = {
            kind: 'pan',
            startX: event.clientX,
            startY: event.clientY,
            startViewport: viewport,
            moved: false,
          }
        }}
        onPointerMove={(event) => {
          if (activePointersRef.current.has(event.pointerId)) {
            activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
          }
          if (activePointersRef.current.size === 2 && pinchStartRef.current) {
            const pts = Array.from(activePointersRef.current.values())
            const dist = Math.max(10, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y))
            const factor = pinchStartRef.current.dist / dist
            const vp = pinchStartRef.current.viewport
            const scale = Math.min(
              size.width / (vp.xMax - vp.xMin),
              size.height / (vp.yMax - vp.yMin)
            )
            const anchorX =
              (vp.xMin + vp.xMax) / 2 + (pinchStartRef.current.cx - size.width / 2) / scale
            const anchorY =
              (vp.yMin + vp.yMax) / 2 - (pinchStartRef.current.cy - size.height / 2) / scale
            setViewport({
              xMin: anchorX + (vp.xMin - anchorX) * factor,
              xMax: anchorX + (vp.xMax - anchorX) * factor,
              yMin: anchorY + (vp.yMin - anchorY) * factor,
              yMax: anchorY + (vp.yMax - anchorY) * factor,
            })
            return
          }

          const rect = event.currentTarget.getBoundingClientRect()
          const sx = event.clientX - rect.left
          const sy = event.clientY - rect.top
          const wx = transform.toWorldX(sx)
          const wy = transform.toWorldY(sy)
          setCursorWorld({ x: wx, y: wy })

          const drag = dragStateRef.current
          if (!drag) {
            detectHover(sx, sy, wx)
            return
          }

          if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 2.5) {
            drag.moved = true
          }

          if (drag.kind === 'pan') {
            if (!drag.moved) {
              return
            }
            const dxWorld = (event.clientX - drag.startX) / transform.scale
            const dyWorld = (event.clientY - drag.startY) / transform.scale
            setViewport({
              xMin: drag.startViewport.xMin - dxWorld,
              xMax: drag.startViewport.xMax - dxWorld,
              yMin: drag.startViewport.yMin + dyWorld,
              yMax: drag.startViewport.yMax + dyWorld,
            })
            return
          }

          if (drag.kind === 'point') {
            applyDragMoveForPoint(drag.pointId, drag.isUser, drag.mp, wx, wy, event.shiftKey)
            return
          }

          // 拖动线段：按鼠标位移平移所有关联动点/可拖点
          if (drag.kind === 'segment') {
            const dx = wx - drag.startWorld.x
            const dy = wy - drag.startWorld.y
            for (const id of drag.movableIds) {
              const initPos = drag.initialPositions[id]
              if (!initPos) {
                continue
              }
              const isUser = userPoints.some((p) => p.id === id)
              const mp = coordinate.movingPoints.find((m) => m.id === id)
              applyDragMoveForPoint(id, isUser, mp, initPos.x + dx, initPos.y + dy, event.shiftKey)
            }
          }
        }}
        onPointerUp={(event) => {
          activePointersRef.current.delete(event.pointerId)
          if (activePointersRef.current.size < 2) {
            pinchStartRef.current = null
          }
          const drag = dragStateRef.current
          dragStateRef.current = null
          setDraggingKind('none')
          setDraggedPointId(null)
          setSnapTargetId(null)

          if (drag?.kind === 'pan' && !drag.moved) {
            const rect = event.currentTarget.getBoundingClientRect()
            handleCanvasActionClick(event.clientX - rect.left, event.clientY - rect.top)
          }
        }}
        onPointerCancel={(event) => {
          activePointersRef.current.delete(event.pointerId)
          pinchStartRef.current = null
          dragStateRef.current = null
          setDraggingKind('none')
          setDraggedPointId(null)
          setSnapTargetId(null)
        }}
        onPointerLeave={() => {
          if (!dragStateRef.current) {
            setCursorWorld(null)
            setHoverInfo(null)
          }
        }}
      >
        <svg ref={svgRef} className={styles.svg} width={size.width} height={size.height}>
          {/* 背景主/次网格 */}
          {effectiveShowGrid ? (
            <g>
              {xSubTicks.map((x) => {
                const sx = transform.toSvgX(x)
                return (
                  <line
                    key={`sgx-${x}`}
                    x1={sx}
                    y1={0}
                    x2={sx}
                    y2={size.height}
                    className={styles.subGridLine}
                  />
                )
              })}
              {ySubTicks.map((y) => {
                const sy = transform.toSvgY(y)
                return (
                  <line
                    key={`sgy-${y}`}
                    x1={0}
                    y1={sy}
                    x2={size.width}
                    y2={sy}
                    className={styles.subGridLine}
                  />
                )
              })}
              {xTicks.map((x) => {
                const sx = transform.toSvgX(x)
                return (
                  <line
                    key={`gx-${x}`}
                    x1={sx}
                    y1={0}
                    x2={sx}
                    y2={size.height}
                    className={styles.gridLine}
                  />
                )
              })}
              {yTicks.map((y) => {
                const sy = transform.toSvgY(y)
                return (
                  <line
                    key={`gy-${y}`}
                    x1={0}
                    y1={sy}
                    x2={size.width}
                    y2={sy}
                    className={styles.gridLine}
                  />
                )
              })}
            </g>
          ) : null}

          {/* 坐标轴、刻度线与箭头 */}
          <g>
            <line
              x1={0}
              y1={clampedAxisY}
              x2={size.width - 8}
              y2={clampedAxisY}
              className={styles.axisLine}
            />
            <polygon
              points={`${size.width - 2},${clampedAxisY} ${size.width - 11},${clampedAxisY - 4} ${size.width - 11},${clampedAxisY + 4}`}
              className={styles.axisArrow}
            />
            <text x={size.width - 16} y={clampedAxisY - 10} className={styles.axisLabel}>
              x
            </text>

            <line
              x1={clampedAxisX}
              y1={size.height}
              x2={clampedAxisX}
              y2={8}
              className={styles.axisLine}
            />
            <polygon
              points={`${clampedAxisX},2 ${clampedAxisX - 4},11 ${clampedAxisX + 4},11`}
              className={styles.axisArrow}
            />
            <text x={clampedAxisX + 10} y={16} className={styles.axisLabel}>
              y
            </text>

            {xTicks.map((x) => {
              if (Math.abs(x) < 1e-6) {
                return null
              }
              const sx = transform.toSvgX(x)
              if (sx < 18 || sx > size.width - 24) {
                return null
              }
              return (
                <g key={`tx-${x}`}>
                  <line
                    x1={sx}
                    y1={clampedAxisY - 3}
                    x2={sx}
                    y2={clampedAxisY + 3}
                    className={styles.axisTick}
                  />
                  <text
                    x={sx}
                    y={clampedAxisY + 15}
                    textAnchor="middle"
                    className={styles.tickText}
                  >
                    {formatNum(x)}
                  </text>
                </g>
              )
            })}
            {yTicks.map((y) => {
              if (Math.abs(y) < 1e-6) {
                return null
              }
              const sy = transform.toSvgY(y)
              if (sy < 18 || sy > size.height - 16) {
                return null
              }
              return (
                <g key={`ty-${y}`}>
                  <line
                    x1={clampedAxisX - 3}
                    y1={sy}
                    x2={clampedAxisX + 3}
                    y2={sy}
                    className={styles.axisTick}
                  />
                  <text
                    x={clampedAxisX - 8}
                    y={sy + 4}
                    textAnchor="end"
                    className={styles.tickText}
                  >
                    {formatNum(y)}
                  </text>
                </g>
              )
            })}
            {originInViewX && originInViewY ? (
              <text
                x={originSvgX - 8}
                y={originSvgY + 15}
                textAnchor="end"
                className={styles.tickText}
              >
                O
              </text>
            ) : null}
          </g>

          {/* 轨迹留痕层 */}
          {Object.entries(traces).map(([pointId, pts]) => {
            if (pts.length < 2) {
              return null
            }
            const color =
              coordinate.movingPoints.find((m) => m.id === pointId)?.traceColor ??
              coordinate.movingPoints.find((m) => m.id === pointId)?.color ??
              coordinate.derivedPoints.find((d) => d.id === pointId)?.traceColor ??
              coordinate.derivedPoints.find((d) => d.id === pointId)?.color ??
              coordinate.points.find((p) => p.id === pointId)?.traceColor ??
              '#10B981'
            const polyStr = pts
              .map((p) => `${transform.toSvgX(p.x).toFixed(1)},${transform.toSvgY(p.y).toFixed(1)}`)
              .join(' ')
            return (
              <polyline
                key={`trace-${pointId}`}
                points={polyStr}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeOpacity={0.55}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )
          })}

          {/* 多边形填充层 */}
          {coordinate.polygons.map((poly) => {
            if (poly.visible === false) {
              return null
            }
            const pts = poly.vertexIds
              .map((id) => solvedScene.points[id])
              .filter((p): p is Vec2 => Boolean(p))
            if (pts.length < 3) {
              return null
            }
            const pointsAttr = pts
              .map((p) => `${transform.toSvgX(p.x).toFixed(1)},${transform.toSvgY(p.y).toFixed(1)}`)
              .join(' ')
            const cx = pts.reduce((acc, p) => acc + p.x, 0) / pts.length
            const cy = pts.reduce((acc, p) => acc + p.y, 0) / pts.length
            const area = computePolygonArea(pts)
            const perim = poly.showPerimeter ? computePolygonPerimeter(pts) : 0
            return (
              <g key={poly.id}>
                <polygon
                  points={pointsAttr}
                  fill={poly.fill}
                  stroke={poly.stroke}
                  strokeWidth={highlighted.has(poly.id) ? 2.6 : 1.6}
                  strokeDasharray={poly.dashed ? '6 4' : undefined}
                  strokeLinejoin="round"
                />
                {poly.showArea || poly.showPerimeter || poly.label ? (
                  <text
                    x={transform.toSvgX(cx)}
                    y={transform.toSvgY(cy)}
                    textAnchor="middle"
                    className={styles.pointLabel}
                    fill={poly.stroke}
                  >
                    {poly.label ? `${poly.label} ` : ''}
                    {poly.showArea ? `S = ${area.toFixed(2)}` : ''}
                    {poly.showPerimeter ? ` C = ${perim.toFixed(2)}` : ''}
                  </text>
                ) : null}
              </g>
            )
          })}

          {/* 角度弧线与度数标注 */}
          {coordinate.angles.map((ang) => {
            if (ang.visible === false) {
              return null
            }
            const a = solvedScene.points[ang.fromId]
            const v = solvedScene.points[ang.vertexId]
            const c = solvedScene.points[ang.toId]
            if (!a || !v || !c) {
              return null
            }
            const deg = computeAngleDeg(a, v, c)
            if (!Number.isFinite(deg)) {
              return null
            }
            const vx = transform.toSvgX(v.x)
            const vy = transform.toSvgY(v.y)
            const a1 = Math.atan2(transform.toSvgY(a.y) - vy, transform.toSvgX(a.x) - vx)
            const a2 = Math.atan2(transform.toSvgY(c.y) - vy, transform.toSvgX(c.x) - vx)
            let diff = a2 - a1
            while (diff <= -Math.PI) {
              diff += Math.PI * 2
            }
            while (diff > Math.PI) {
              diff -= Math.PI * 2
            }
            const rPx = ang.radius ? Math.max(12, Math.min(48, ang.radius)) : 22
            const isRight = ang.rightAngle || Math.abs(deg - 90) < 0.6
            const midAngle = a1 + diff / 2
            const labelDist = isRight ? 26 : rPx + 15
            const lx = vx + Math.cos(midAngle) * labelDist
            const ly = vy + Math.sin(midAngle) * labelDist

            let shapeEl: React.ReactNode
            if (isRight) {
              const s = 12
              const u1x = Math.cos(a1) * s
              const u1y = Math.sin(a1) * s
              const u2x = Math.cos(a2) * s
              const u2y = Math.sin(a2) * s
              const pts = `${vx + u1x},${vy + u1y} ${vx + u1x + u2x},${vy + u1y + u2y} ${vx + u2x},${vy + u2y}`
              shapeEl = (
                <polyline
                  points={pts}
                  fill={ang.color}
                  fillOpacity={0.12}
                  stroke={ang.color}
                  strokeWidth={1.8}
                />
              )
            } else {
              const sx1 = vx + Math.cos(a1) * rPx
              const sy1 = vy + Math.sin(a1) * rPx
              const sx2 = vx + Math.cos(a2) * rPx
              const sy2 = vy + Math.sin(a2) * rPx
              const sweep = diff >= 0 ? 1 : 0
              const arcD = `M ${vx} ${vy} L ${sx1} ${sy1} A ${rPx} ${rPx} 0 0 ${sweep} ${sx2} ${sy2} Z`
              const strokeD = `M ${sx1} ${sy1} A ${rPx} ${rPx} 0 0 ${sweep} ${sx2} ${sy2}`
              shapeEl = (
                <>
                  <path d={arcD} fill={ang.color} fillOpacity={0.14} stroke="none" />
                  <path d={strokeD} fill="none" stroke={ang.color} strokeWidth={1.8} />
                </>
              )
            }

            return (
              <g key={ang.id}>
                {shapeEl}
                {ang.label || ang.showValue !== false ? (
                  <text
                    x={lx}
                    y={ly + 4}
                    textAnchor="middle"
                    className={styles.auxLabel}
                    fill={ang.color}
                  >
                    {ang.label ? `${ang.label} ` : ''}
                    {ang.showValue !== false ? `${deg.toFixed(1)}°` : ''}
                  </text>
                ) : null}
              </g>
            )
          })}

          {/* 圆 */}
          {coordinate.circles.map((circle) => {
            if (circle.visible === false) {
              return null
            }
            const resolved = resolveCircleParams(
              {
                coord: coordinate,
                tValues,
                params: solvedScene.params,
                overrides: solvedScene.points,
                userPoints,
              },
              circle
            )
            if (!resolved) {
              return null
            }
            const cx = transform.toSvgX(resolved.center.x)
            const cy = transform.toSvgY(resolved.center.y)
            const rPx = resolved.radius * transform.scale
            return (
              <g key={circle.id}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={rPx}
                  fill={circle.fill ?? 'none'}
                  stroke={circle.color}
                  strokeWidth={highlighted.has(circle.id) ? 2.6 : 1.8}
                  strokeDasharray={circle.dashed ? '6 4' : undefined}
                />
                {circle.label ? (
                  <text
                    x={cx + rPx * 0.72}
                    y={cy - rPx * 0.72 - 6}
                    className={styles.pointLabel}
                    fill={circle.color}
                  >
                    {circle.label}
                  </text>
                ) : null}
              </g>
            )
          })}

          {/* 函数图像（显式/参数/极坐标/不等式阴影） */}
          {functionPaths.map(({ fn, d, fillD, labelPos }) =>
            d ? (
              <g key={fn.id}>
                {fillD ? (
                  <path d={fillD} fill={fn.fill ?? 'rgba(57, 100, 254, 0.14)'} stroke="none" />
                ) : null}
                <path
                  d={d}
                  fill="none"
                  stroke={fn.color}
                  strokeWidth={highlighted.has(fn.id) ? 3.2 : 2.2}
                  strokeLinecap="round"
                  strokeDasharray={fn.dashed ? '6 4' : undefined}
                />
                {fn.label && labelPos ? (
                  <text x={labelPos.x} y={labelPos.y} className={styles.pointLabel} fill={fn.color}>
                    {fn.label}
                  </text>
                ) : null}
              </g>
            ) : null
          )}

          {/* 线段 / 直线 / 射线 / 向量（支持等长记号 ticks 与斜率显示） */}
          {coordinate.segments.map((seg) => {
            if (seg.visible === false) {
              return null
            }
            const a = seg.fromId
              ? solvedScene.points[seg.fromId]
              : seg.from
                ? { x: seg.from[0], y: seg.from[1] }
                : null
            const b = seg.toId
              ? solvedScene.points[seg.toId]
              : seg.to
                ? { x: seg.to[0], y: seg.to[1] }
                : null
            if (!a || !b) {
              return null
            }
            const dx = b.x - a.x
            const dy = b.y - a.y
            const len = Math.hypot(dx, dy)
            let p1 = a
            let p2 = b
            if ((seg.kind === 'line' || seg.kind === 'ray') && len > 1e-6) {
              const span =
                Math.hypot(
                  transform.visibleXMax - transform.visibleXMin,
                  transform.visibleYMax - transform.visibleYMin
                ) * 1.5
              const ux = dx / len
              const uy = dy / len
              if (seg.kind === 'line') {
                p1 = { x: a.x - ux * span, y: a.y - uy * span }
              }
              p2 = { x: a.x + ux * span, y: a.y + uy * span }
            }
            const x1 = transform.toSvgX(p1.x)
            const y1 = transform.toSvgY(p1.y)
            const x2 = transform.toSvgX(p2.x)
            const y2 = transform.toSvgY(p2.y)
            const mx = (transform.toSvgX(a.x) + transform.toSvgX(b.x)) / 2
            const my = (transform.toSvgY(a.y) + transform.toSvgY(b.y)) / 2

            let arrowPoly: string | null = null
            if (seg.kind === 'vector' && len > 1e-6) {
              const angle = Math.atan2(y2 - y1, x2 - x1)
              const sizePx = 9
              const ax1 = x2 - sizePx * Math.cos(angle - Math.PI / 6)
              const ay1 = y2 - sizePx * Math.sin(angle - Math.PI / 6)
              const ax2 = x2 - sizePx * Math.cos(angle + Math.PI / 6)
              const ay2 = y2 - sizePx * Math.sin(angle + Math.PI / 6)
              arrowPoly = `${x2},${y2} ${ax1},${ay1} ${ax2},${ay2}`
            }

            // 等长记号短横线
            const tickLines: { x1: number; y1: number; x2: number; y2: number }[] = []
            if (seg.ticks && seg.ticks > 0 && len > 1e-6) {
              const count = Math.min(3, Math.round(seg.ticks))
              const segPx = Math.hypot(x2 - x1, y2 - y1) || 1
              const tx = (x2 - x1) / segPx
              const ty = (y2 - y1) / segPx
              const nx = -ty
              const ny = tx
              for (let k = 0; k < count; k += 1) {
                const off = (k - (count - 1) / 2) * 5
                const cx = mx + tx * off
                const cy = my + ty * off
                tickLines.push({
                  x1: cx - nx * 5.5,
                  y1: cy - ny * 5.5,
                  x2: cx + nx * 5.5,
                  y2: cy + ny * 5.5,
                })
              }
            }

            const baseW = seg.width ?? 2
            const isHighlighted = highlighted.has(seg.id)
            const slopeText =
              seg.showSlope && len > 1e-6
                ? Math.abs(dx) < 1e-6
                  ? 'k=∞'
                  : `k=${(dy / dx).toFixed(2)}`
                : ''

            return (
              <g key={seg.id}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={seg.color}
                  strokeWidth={isHighlighted ? baseW + 1.2 : baseW}
                  strokeLinecap="round"
                  strokeDasharray={seg.dashed ? '6 4' : undefined}
                />
                {tickLines.map((tl, idx) => (
                  <line
                    key={idx}
                    x1={tl.x1}
                    y1={tl.y1}
                    x2={tl.x2}
                    y2={tl.y2}
                    stroke={seg.color}
                    strokeWidth={1.6}
                    strokeLinecap="round"
                  />
                ))}
                {arrowPoly ? <polygon points={arrowPoly} fill={seg.color} /> : null}
                {seg.showLength || seg.showSlope || seg.label ? (
                  <text x={mx + 6} y={my - 6} className={styles.lengthTag}>
                    {seg.label ? `${seg.label} ` : ''}
                    {seg.showLength ? len.toFixed(2) : ''}
                    {slopeText ? ` ${slopeText}` : ''}
                  </text>
                ) : null}
              </g>
            )
          })}

          {/* 学生自主探索线段 */}
          {userSegments.map((seg) => {
            const a = solvedScene.points[seg.fromId]
            const b = solvedScene.points[seg.toId]
            if (!a || !b) {
              return null
            }
            const x1 = transform.toSvgX(a.x)
            const y1 = transform.toSvgY(a.y)
            const x2 = transform.toSvgX(b.x)
            const y2 = transform.toSvgY(b.y)
            const len = vecDist(a, b)
            return (
              <g key={seg.id}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="#8B5CF6"
                  strokeWidth={highlighted.has(seg.id) ? 2.8 : 2}
                  strokeDasharray="5 4"
                  strokeLinecap="round"
                />
                <text x={(x1 + x2) / 2 + 6} y={(y1 + y2) / 2 - 6} className={styles.lengthTag}>
                  {len.toFixed(2)}
                </text>
              </g>
            )
          })}

          {/* 辅助线（动点实时联动 + 自动直角符号 ∟ + 自动派生对称点/垂足点） */}
          {coordinate.auxiliaryLines.map((aux) => {
            if (aux.visible === false) {
              return null
            }
            const geom = solvedScene.auxGeometries[aux.id]
            if (!geom) {
              return null
            }
            const x1 = transform.toSvgX(geom.from.x)
            const y1 = transform.toSvgY(geom.from.y)
            const x2 = transform.toSvgX(geom.to.x)
            const y2 = transform.toSvgY(geom.to.y)
            const mx = (x1 + x2) / 2
            const my = (y1 + y2) / 2

            let rightAnglePoints: string | null = null
            if (geom.rightAngle) {
              const { vertex, u, v } = geom.rightAngle
              const stepWorld = 9 / transform.scale
              const p1 = { x: vertex.x + u.x * stepWorld, y: vertex.y + u.y * stepWorld }
              const p2 = {
                x: vertex.x + (u.x + v.x) * stepWorld,
                y: vertex.y + (u.y + v.y) * stepWorld,
              }
              const p3 = { x: vertex.x + v.x * stepWorld, y: vertex.y + v.y * stepWorld }
              rightAnglePoints = `${transform.toSvgX(p1.x)},${transform.toSvgY(p1.y)} ${transform.toSvgX(p2.x)},${transform.toSvgY(p2.y)} ${transform.toSvgX(p3.x)},${transform.toSvgY(p3.y)}`
            }

            const derivedHighlighted = aux.derivedPointId
              ? highlighted.has(aux.derivedPointId)
              : false

            return (
              <g key={aux.id}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={aux.color}
                  strokeWidth={highlighted.has(aux.id) ? 2.8 : 2}
                  strokeLinecap="round"
                  className={styles.auxLine}
                />
                {rightAnglePoints ? (
                  <polyline
                    points={rightAnglePoints}
                    fill="none"
                    stroke={aux.color}
                    strokeWidth={1.5}
                  />
                ) : null}
                {aux.label ? (
                  <text x={mx + 8} y={my - 6} className={styles.auxLabel} fill={aux.color}>
                    <SvgMathText text={aux.label} />
                  </text>
                ) : null}
                {geom.derivedPoint && aux.derivedPointId ? (
                  <g>
                    {derivedHighlighted ? (
                      <circle
                        cx={transform.toSvgX(geom.derivedPoint.x)}
                        cy={transform.toSvgY(geom.derivedPoint.y)}
                        r={10}
                        fill="none"
                        stroke={aux.color}
                        strokeWidth={2}
                        className={styles.pulseHalo}
                      />
                    ) : null}
                    <circle
                      cx={transform.toSvgX(geom.derivedPoint.x)}
                      cy={transform.toSvgY(geom.derivedPoint.y)}
                      r={5}
                      fill={aux.color}
                      stroke="var(--dsw-alias-bg-base)"
                      strokeWidth={2}
                    />
                    <text
                      x={transform.toSvgX(geom.derivedPoint.x) + 8}
                      y={transform.toSvgY(geom.derivedPoint.y) + 15}
                      className={styles.pointLabel}
                      fill={aux.color}
                    >
                      <SvgMathText text={aux.derivedPointLabel || aux.derivedPointId} />
                    </text>
                  </g>
                ) : null}
              </g>
            )
          })}

          {/* 自由文字/公式标注 + 脚本动态标注 */}
          {coordinate.annotations.map((note) => {
            if (note.visible === false) {
              return null
            }
            const pos = note.anchorPointId
              ? solvedScene.points[note.anchorPointId]
              : note.x !== undefined && note.y !== undefined
                ? { x: note.x, y: note.y }
                : null
            if (!pos) {
              return null
            }
            return (
              <text
                key={note.id}
                x={transform.toSvgX(pos.x) + (note.anchorPointId ? 10 : 0)}
                y={transform.toSvgY(pos.y) + (note.anchorPointId ? 18 : 0)}
                className={styles.pointLabel}
                fill={note.color}
              >
                <SvgMathText text={note.text} />
              </text>
            )
          })}
          {solvedScene.scriptAnnotations.map((note) => (
            <text
              key={`dyn-${note.id}`}
              x={transform.toSvgX(note.x)}
              y={transform.toSvgY(note.y)}
              className={styles.pointLabel}
              fill={note.color}
            >
              <SvgMathText text={note.text} />
            </text>
          ))}

          {/* 动态派生几何点（中点、交点、旋转点、垂足、内心/外心/重心等） */}
          {coordinate.derivedPoints.map((dp) => {
            if (dp.visible === false) {
              return null
            }
            const pos = solvedScene.points[dp.id]
            if (!pos) {
              return null
            }
            const sx = transform.toSvgX(pos.x)
            const sy = transform.toSvgY(pos.y)
            const isHighlighted = highlighted.has(dp.id) || segmentStartId === dp.id
            return (
              <g key={dp.id}>
                {isHighlighted ? (
                  <circle
                    cx={sx}
                    cy={sy}
                    r={11}
                    fill="none"
                    stroke={dp.color}
                    strokeWidth={2}
                    className={styles.pulseHalo}
                  />
                ) : null}
                <polygon
                  points={`${sx},${sy - 6} ${sx + 6},${sy} ${sx},${sy + 6} ${sx - 6},${sy}`}
                  fill={dp.color}
                  stroke="var(--dsw-alias-bg-base)"
                  strokeWidth={2}
                />
                <text x={sx + 9} y={sy - 9} className={styles.pointLabel} fill={dp.color}>
                  {dp.label}({formatNum(pos.x)}, {formatNum(pos.y)})
                </text>
              </g>
            )
          })}

          {/* 固定点 / 可拖拽点 */}
          {coordinate.points.map((pt) => {
            if (pt.visible === false) {
              return null
            }
            const pos = solvedScene.points[pt.id] ?? { x: pt.x, y: pt.y }
            const sx = transform.toSvgX(pos.x)
            const sy = transform.toSvgY(pos.y)
            const isHighlighted =
              highlighted.has(pt.id) || segmentStartId === pt.id || snapTargetId === pt.id
            return (
              <g key={pt.id}>
                {isHighlighted ? (
                  <circle
                    cx={sx}
                    cy={sy}
                    r={snapTargetId === pt.id ? 13 : 11}
                    fill="none"
                    stroke={pt.color}
                    strokeWidth={2}
                    className={styles.pulseHalo}
                  />
                ) : null}
                {pt.draggable ? (
                  <circle cx={sx} cy={sy} r={11} fill={pt.color} fillOpacity={0.14} />
                ) : null}
                {pt.symbol === 'cross' ? (
                  <g stroke={pt.color} strokeWidth={2.2} strokeLinecap="round">
                    <line x1={sx - 5} y1={sy - 5} x2={sx + 5} y2={sy + 5} />
                    <line x1={sx + 5} y1={sy - 5} x2={sx - 5} y2={sy + 5} />
                  </g>
                ) : (
                  <circle
                    cx={sx}
                    cy={sy}
                    r={pt.draggable ? 6.5 : 5.5}
                    fill={pt.symbol === 'hollow' ? 'var(--dsw-alias-bg-base)' : pt.color}
                    stroke={pt.symbol === 'hollow' ? pt.color : 'var(--dsw-alias-bg-base)'}
                    strokeWidth={2.2}
                  />
                )}
                {pt.label ? (
                  <text x={sx + 9} y={sy - 9} className={styles.pointLabel} fill={pt.color}>
                    {pt.draggable ? `${pt.id}(${formatNum(pos.x)}, ${formatNum(pos.y)})` : pt.label}
                  </text>
                ) : null}
              </g>
            )
          })}

          {/* 学生自主探索点（现在也支持直接拖动！） */}
          {userPoints.map((pt) => {
            const sx = transform.toSvgX(pt.x)
            const sy = transform.toSvgY(pt.y)
            const isHighlighted = highlighted.has(pt.id) || segmentStartId === pt.id
            return (
              <g key={pt.id}>
                {isHighlighted ? (
                  <circle
                    cx={sx}
                    cy={sy}
                    r={12}
                    fill="none"
                    stroke="#8B5CF6"
                    strokeWidth={2}
                    className={styles.pulseHalo}
                  />
                ) : null}
                <circle cx={sx} cy={sy} r={10} fill="#8B5CF6" fillOpacity={0.12} />
                <circle
                  cx={sx}
                  cy={sy}
                  r={6}
                  fill="#8B5CF6"
                  stroke="var(--dsw-alias-bg-base)"
                  strokeWidth={2.2}
                />
                <text x={sx + 9} y={sy - 9} className={styles.pointLabel} fill="#8B5CF6">
                  {pt.label}({formatNum(pt.x)}, {formatNum(pt.y)})
                </text>
              </g>
            )
          })}

          {/* Desmos 式函数曲线悬停捕捉点 */}
          {hoverInfo?.kind === 'curve' ? (
            <g pointerEvents="none">
              <circle
                cx={transform.toSvgX(hoverInfo.x)}
                cy={transform.toSvgY(hoverInfo.y)}
                r={5}
                fill="var(--dsw-alias-bg-base)"
                stroke={hoverInfo.color}
                strokeWidth={2.5}
              />
            </g>
          ) : null}

          {/* 动点（由 stage 统一处理丝滑拖拽，绝不丢失事件或被吸附卡死） */}
          {coordinate.movingPoints.map((mp) => {
            if (mp.visible === false) {
              return null
            }
            const pos = solvedScene.points[mp.id]
            if (!pos) {
              return null
            }
            const sx = transform.toSvgX(pos.x)
            const sy = transform.toSvgY(pos.y)
            const isActive = draggedPointId === mp.id || highlighted.has(mp.id)
            return (
              <g key={mp.id} pointerEvents="none">
                <circle
                  cx={sx}
                  cy={sy}
                  r={isActive ? 17 : 14}
                  fill={mp.color}
                  fillOpacity={isActive ? 0.24 : 0.14}
                  className={styles.pulseHalo}
                />
                <circle
                  cx={sx}
                  cy={sy}
                  r={isActive ? 8.2 : 7.2}
                  fill={mp.color}
                  stroke="var(--dsw-alias-bg-base)"
                  strokeWidth={2.6}
                />
                <text x={sx + 11} y={sy - 11} className={styles.pointLabel} fill={mp.color}>
                  {mp.label}({formatNum(pos.x)}, {formatNum(pos.y)})
                </text>
              </g>
            )
          })}
        </svg>

        {/* 左上角标题 + 实时动态测量 HUD + 脚本状态提示 */}
        <div className={styles.hudTopLeft}>
          {coordinate.title ? <div className={styles.boardTitle}>{coordinate.title}</div> : null}
          {solvedScene.scriptStatus ? (
            <div className={styles.scriptStatusPill}>⚡ {solvedScene.scriptStatus}</div>
          ) : null}
          {solvedScene.measurements.length > 0 ? (
            <div className={styles.measureList}>
              {solvedScene.measurements.map(({ measurement, display, isOptimal, relatedIds }) => (
                <div
                  key={measurement.id}
                  className={clsx(styles.measurePill, isOptimal && styles.measureOptimal)}
                  onMouseEnter={() => setHoveredMeasureIds(relatedIds)}
                  onMouseLeave={() => setHoveredMeasureIds([])}
                >
                  <span
                    className={styles.measureDot}
                    style={{ backgroundColor: measurement.color }}
                  />
                  <span>
                    <InlineMarkdown text={measurement.label} />
                  </span>
                  <span className={styles.measureValue}>{display}</span>
                  {isOptimal && measurement.optimalHint ? (
                    <span className={styles.optimalBadge}>{measurement.optimalHint}</span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* 右上角缩放 / 适应图形按钮 */}
        <div className={styles.hudTopRight}>
          <button
            type="button"
            className={styles.zoomBtn}
            title="放大"
            onClick={() => zoomBy(1 / 1.25)}
          >
            +
          </button>
          <button
            type="button"
            className={styles.zoomBtn}
            title="缩小"
            onClick={() => zoomBy(1.25)}
          >
            −
          </button>
          <button
            type="button"
            className={styles.zoomBtn}
            title="自适应居中显示全部图形（也可双击空白处）"
            onClick={fitAllElements}
          >
            ⛶
          </button>
          <button
            type="button"
            className={styles.zoomBtn}
            title="复位初始视角"
            onClick={() => setViewport(coordinate.viewport)}
          >
            ⌖
          </button>
        </div>

        {/* 左下角：悬停元素详情（标明可拖动提示）或鼠标实时坐标 */}
        {hoverInfo ? (
          <div className={styles.hoverReadout}>
            {hoverInfo.kind === 'point'
              ? `${hoverInfo.label}: (${formatNum(hoverInfo.x)}, ${formatNum(hoverInfo.y)})${hoverInfo.draggable ? ' · 按住可拖动' : ''}`
              : hoverInfo.kind === 'curve'
                ? `${hoverInfo.expr}  |  (${formatNum(hoverInfo.x)}, ${formatNum(hoverInfo.y)})`
                : `${hoverInfo.label}: 长度 ${hoverInfo.length.toFixed(2)}${hoverInfo.draggable ? ' · 可拖动联动' : ''}`}
          </div>
        ) : cursorWorld ? (
          <div className={styles.cursorReadout}>
            (
            {formatNum(
              snapPlotToGrid && toolMode === 'point' ? snapWorldVal(cursorWorld.x) : cursorWorld.x
            )}
            ,{' '}
            {formatNum(
              snapPlotToGrid && toolMode === 'point' ? snapWorldVal(cursorWorld.y) : cursorWorld.y
            )}
            )
          </div>
        ) : null}

        {/* 若选中了自绘点/线/函数，提供快捷删除按钮 */}
        {selectedCoordId &&
        (userPoints.some((p) => p.id === selectedCoordId) ||
          userSegments.some((s) => s.id === selectedCoordId) ||
          userFunctions.some((f) => f.id === selectedCoordId)) ? (
          <button
            type="button"
            className={styles.deleteSelectedBtn}
            onClick={() => removeUserCoordElement(selectedCoordId)}
          >
            删除选中自绘 ({selectedCoordId})
          </button>
        ) : null}
      </div>

      {/* 底部统一动点 / 参数滑块 / 脚本时间轴控制坞 */}
      {hasDockControls ? (
        <div className={styles.motionDock}>
          <div className={styles.dockTopRow}>
            <div className={styles.dockPlaybackLeft}>
              {hasAnimatable ? (
                <button
                  type="button"
                  className={styles.playBtn}
                  title={playing ? '暂停动画' : '播放动画'}
                  onClick={() => setCanvasPlaying(!playing)}
                >
                  {playing ? '⏸' : '▶'}
                </button>
              ) : null}
              <span className={styles.dockTitle}>
                {coordinate.motionScript && scriptEnabled
                  ? `⚡ ${coordinate.motionScript.title}`
                  : coordinate.movingPoints.length > 0
                    ? `动点控制（可直接拖动红点或线段）`
                    : '参数滑块'}
              </span>
            </div>

            <div className={styles.playbackActions}>
              {hasAnimatable ? (
                <>
                  <button
                    type="button"
                    className={styles.speedBtn}
                    title="切换播放速度"
                    onClick={() => setCanvasSpeed(speed === 0.5 ? 1 : speed === 1 ? 2 : 0.5)}
                  >
                    {speed}x
                  </button>
                  {!coordinate.motionScript ? (
                    <button
                      type="button"
                      className={styles.speedBtn}
                      title={
                        loopMode === 'bounce'
                          ? '当前：往返运动（点击切换单向循环）'
                          : '当前：单向循环（点击切换往返）'
                      }
                      onClick={toggleCanvasLoopMode}
                    >
                      {loopMode === 'bounce' ? '⇄' : '↻'}
                    </button>
                  ) : null}
                </>
              ) : null}
              <button
                type="button"
                className={styles.speedBtn}
                title="重置全部动点、参数与时间轴到初始状态"
                onClick={() => {
                  scriptPersistentStateRef.current = {}
                  resetAllMotionState()
                }}
              >
                ↺
              </button>
              <button
                type="button"
                className={styles.speedBtn}
                title={dockCollapsed ? '展开控制滑块' : '折叠控制滑块以扩大画布视野'}
                onClick={() => setDockCollapsed((prev) => !prev)}
              >
                {dockCollapsed ? '▴' : '▾'}
              </button>
            </div>
          </div>

          {!dockCollapsed ? (
            <div className={styles.dockSliders}>
              {/* AI 控制脚本时间轴 */}
              {coordinate.motionScript && scriptEnabled ? (
                <div className={styles.sliderWrap}>
                  <div className={styles.sliderHeader}>
                    <span>时间轴 t</span>
                    <span className={styles.sliderCoords}>
                      {scriptTime.toFixed(2)}s / {coordinate.motionScript.duration.toFixed(1)}s
                    </span>
                  </div>
                  <div className={styles.sliderControlLine}>
                    <button
                      type="button"
                      className={styles.stepAdjustBtn}
                      title="时间后退"
                      onClick={() => {
                        setCanvasPlaying(false)
                        setScriptTime(Math.max(0, scriptTime - 0.1))
                      }}
                    >
                      −
                    </button>
                    <input
                      type="range"
                      className={styles.slider}
                      min={0}
                      max={coordinate.motionScript.duration}
                      step={coordinate.motionScript.duration / 300}
                      value={scriptTime}
                      onChange={(event) => {
                        setCanvasPlaying(false)
                        setScriptTime(Number(event.target.value))
                      }}
                    />
                    <button
                      type="button"
                      className={styles.stepAdjustBtn}
                      title="时间前进"
                      onClick={() => {
                        setCanvasPlaying(false)
                        setScriptTime(
                          Math.min(coordinate.motionScript?.duration ?? 6, scriptTime + 0.1)
                        )
                      }}
                    >
                      +
                    </button>
                  </div>
                </div>
              ) : null}

              {/* 动点滑块 / 自由点坐标芯片 */}
              {coordinate.movingPoints.map((mp) => {
                const pos = solvedScene.points[mp.id]
                if (mp.path.type === 'free') {
                  return (
                    <div key={mp.id} className={styles.freePointRow}>
                      <span>自由动点 {mp.label}（在画板上任意拖动）</span>
                      <div className={styles.freePointRight}>
                        <span className={styles.sliderCoords}>
                          {pos ? `(${formatNum(pos.x)}, ${formatNum(pos.y)})` : '--'}
                        </span>
                        <button
                          type="button"
                          className={styles.stepAdjustBtn}
                          title="复位位置"
                          onClick={() => {
                            if (mp.path.type === 'free') {
                              setFreePointPosition(mp.id, mp.path.x, mp.path.y)
                            }
                          }}
                        >
                          ↺
                        </button>
                      </div>
                    </div>
                  )
                }

                const currentT = Object.hasOwn(solvedScene.solvedT, mp.id)
                  ? solvedScene.solvedT[mp.id]
                  : Object.hasOwn(tValues, mp.id)
                    ? tValues[mp.id]
                    : mp.initialT
                const microStep = Math.max(0.02, Number(((mp.tMax - mp.tMin) / 50).toFixed(3)))
                return (
                  <div key={mp.id} className={styles.sliderWrap}>
                    <div className={styles.sliderHeader}>
                      <span>动点 {mp.label}</span>
                      <span className={styles.sliderCoords}>
                        {pos ? `(${formatNum(pos.x)}, ${formatNum(pos.y)})` : formatNum(currentT)}
                      </span>
                    </div>
                    <div className={styles.sliderControlLine}>
                      <button
                        type="button"
                        className={styles.stepAdjustBtn}
                        title="微调减小"
                        onClick={() => {
                          setCanvasPlaying(false)
                          setMovingPointT(mp.id, Math.max(mp.tMin, currentT - microStep))
                        }}
                      >
                        −
                      </button>
                      <input
                        type="range"
                        className={styles.slider}
                        min={mp.tMin}
                        max={mp.tMax}
                        step={(mp.tMax - mp.tMin) / 300}
                        value={Math.max(mp.tMin, Math.min(mp.tMax, currentT))}
                        onChange={(event) => {
                          setCanvasPlaying(false)
                          setMovingPointT(mp.id, Number(event.target.value))
                        }}
                      />
                      <button
                        type="button"
                        className={styles.stepAdjustBtn}
                        title="微调增大"
                        onClick={() => {
                          setCanvasPlaying(false)
                          setMovingPointT(mp.id, Math.min(mp.tMax, currentT + microStep))
                        }}
                      >
                        +
                      </button>
                    </div>
                  </div>
                )
              })}

              {/* 参数滑块（如 a, b, k, theta） */}
              {coordinate.sliders.map((sl) => {
                const val = solvedScene.params[sl.id] ?? sl.initialValue
                return (
                  <div key={sl.id} className={styles.sliderWrap}>
                    <div className={styles.sliderHeader}>
                      <span>参数 {sl.label}</span>
                      <span className={styles.sliderCoords}>
                        {formatNum(val)}
                        {sl.unit ?? ''}
                      </span>
                    </div>
                    <div className={styles.sliderControlLine}>
                      <button
                        type="button"
                        className={styles.stepAdjustBtn}
                        title="减小参数"
                        onClick={() => setParamValue(sl.id, Math.max(sl.min, val - sl.step))}
                      >
                        −
                      </button>
                      <input
                        type="range"
                        className={styles.slider}
                        min={sl.min}
                        max={sl.max}
                        step={sl.step}
                        value={Math.max(sl.min, Math.min(sl.max, val))}
                        onChange={(event) => setParamValue(sl.id, Number(event.target.value))}
                      />
                      <button
                        type="button"
                        className={styles.stepAdjustBtn}
                        title="增大参数"
                        onClick={() => setParamValue(sl.id, Math.min(sl.max, val + sl.step))}
                      >
                        +
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
