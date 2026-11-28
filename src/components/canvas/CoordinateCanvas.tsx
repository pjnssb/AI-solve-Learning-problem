import clsx from 'clsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChatStore, sendQuickMessage } from '../../services/chat/store.js'
import { useSettings } from '../../services/settings.js'
import { compileMathExpr } from '../../services/tutor/mathEval.js'
import {
  addUserCoordFunction,
  addUserCoordPoint,
  addUserCoordSegment,
  clearUserScratchpad,
  removeUserCoordElement,
  setCanvasPlaying,
  setCanvasSpeed,
  setMovingPointT,
  setSelectedCoordId,
  toggleCanvasLoopMode,
  useCanvasStore,
} from '../../services/tutor/canvasStore.js'
import {
  computePolygonArea,
  resolveAuxiliaryGeometry,
  resolvePointCoords,
} from '../../services/tutor/toolExecutor.js'
import type {
  CoordMovingPoint,
  CoordinateState,
  CoordViewport,
} from '../../services/tutor/types.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import styles from './CoordinateCanvas.module.css'

type ToolMode = 'pan' | 'point' | 'segment' | 'function'

type HoverInfo =
  | { kind: 'point'; id: string; label: string; x: number; y: number }
  | { kind: 'curve'; id: string; expr: string; x: number; y: number; color: string }
  | { kind: 'segment'; id: string; label: string; length: number }

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

/** 根据鼠标所在世界坐标，反推最接近该位置的动点参数 t */
const projectToMovingPointT = (
  coord: CoordinateState,
  mp: CoordMovingPoint,
  worldX: number,
  worldY: number,
  tValues: Record<string, number>,
  snapStep: number | null
): number => {
  const { path, tMin, tMax } = mp
  let rawT = tMin
  if (path.type === 'segment') {
    const a = path.fromId
      ? resolvePointCoords(coord, path.fromId, tValues)
      : path.from
        ? { x: path.from[0], y: path.from[1] }
        : null
    const b = path.toId
      ? resolvePointCoords(coord, path.toId, tValues)
      : path.to
        ? { x: path.to[0], y: path.to[1] }
        : null
    if (!a || !b) {
      return tMin
    }
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lenSq = dx * dx + dy * dy
    if (lenSq < 1e-9) {
      return tMin
    }
    const ratio = Math.max(0, Math.min(1, ((worldX - a.x) * dx + (worldY - a.y) * dy) / lenSq))
    rawT = tMin + ratio * (tMax - tMin)
  } else if (path.type === 'function') {
    rawT = Math.max(tMin, Math.min(tMax, worldX))
  } else {
    const samples = 120
    let bestT = tMin
    let bestDist = Infinity
    for (let i = 0; i <= samples; i += 1) {
      const t = tMin + ((tMax - tMin) * i) / samples
      const pos = resolvePointCoords(coord, mp.id, { ...tValues, [mp.id]: t })
      if (!pos) {
        continue
      }
      const d = Math.hypot(pos.x - worldX, pos.y - worldY)
      if (d < bestDist) {
        bestDist = d
        bestT = t
      }
    }
    rawT = bestT
  }
  if (snapStep && snapStep > 0) {
    const snapped = Math.round(rawT / snapStep) * snapStep
    return Math.max(tMin, Math.min(tMax, snapped))
  }
  return rawT
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
  const [cursorWorld, setCursorWorld] = useState<{ x: number; y: number } | null>(null)
  const [draggingBg, setDraggingBg] = useState(false)
  const [toolMode, setToolMode] = useState<ToolMode>('pan')
  const [snapToGrid, setSnapToGrid] = useState(true)
  const [showGridLocal, setShowGridLocal] = useState<boolean | null>(null)
  const [segmentStartId, setSegmentStartId] = useState<string | null>(null)
  const [fnInput, setFnInput] = useState('')
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null)
  const [hoveredMeasureIds, setHoveredMeasureIds] = useState<string[]>([])

  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinchStartRef = useRef<{ dist: number; viewport: CoordViewport; cx: number; cy: number } | null>(
    null
  )
  const dragStateRef = useRef<
    | { kind: 'pan'; startX: number; startY: number; startViewport: CoordViewport }
    | { kind: 'point'; point: CoordMovingPoint }
    | null
  >(null)

  const effectiveShowGrid = showGridLocal ?? coordinate.showGrid
  const hasUserItems = userPoints.length > 0 || userSegments.length > 0 || userFunctions.length > 0
  const effectiveHasContent = hasContent || hasUserItems || toolMode !== 'pan'

  // 当题目切换或 coord_setup 变更视口时，同步视口范围
  const baseViewportKey = `${coordinate.viewport.xMin},${coordinate.viewport.xMax},${coordinate.viewport.yMin},${coordinate.viewport.yMax}`
  useEffect(() => {
    setViewport(coordinate.viewport)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseViewportKey])

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

  // 动点自动播放动画循环（支持往返 bounce 与单向循环 loop）
  const directionRef = useRef<Record<string, 1 | -1>>({})
  useEffect(() => {
    if (!playing || coordinate.movingPoints.length === 0) {
      return
    }
    let raf = 0
    let lastTime = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000)
      lastTime = now
      const currentT = useCanvasStore.getState().tValues
      for (const mp of coordinate.movingPoints) {
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
        setMovingPointT(mp.id, nextVal)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, loopMode, coordinate.movingPoints])

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
      const anchorX = transform.toWorldX(centerX)
      const anchorY = transform.toWorldY(centerY)
      setViewport((prev) => {
        const nextW = prev.xMax - prev.xMin
        if ((factor < 1 && nextW < 0.25) || (factor > 1 && nextW > 5000)) {
          return prev
        }
        return {
          xMin: anchorX + (prev.xMin - anchorX) * factor,
          xMax: anchorX + (prev.xMax - anchorX) * factor,
          yMin: anchorY + (prev.yMin - anchorY) * factor,
          yMax: anchorY + (prev.yMax - anchorY) * factor,
        }
      })
    },
    [size.width, size.height, transform]
  )

  // 合并所有可用点位（AI 固定点 + 动点 + 派生点 + 学生自绘点），供连线与悬浮检测使用
  const allInteractivePoints = useMemo(() => {
    const pts: {
      id: string
      label: string
      x: number
      y: number
      color: string
      isUser?: boolean
      isMoving?: boolean
    }[] = []
    for (const p of coordinate.points) {
      pts.push({ id: p.id, label: p.label, x: p.x, y: p.y, color: p.color })
    }
    for (const mp of coordinate.movingPoints) {
      const pos = resolvePointCoords(coordinate, mp.id, tValues)
      if (pos) {
        pts.push({
          id: mp.id,
          label: mp.label,
          x: pos.x,
          y: pos.y,
          color: mp.color,
          isMoving: true,
        })
      }
    }
    for (const aux of coordinate.auxiliaryLines) {
      if (aux.derivedPointId) {
        const geom = resolveAuxiliaryGeometry(coordinate, aux, tValues)
        if (geom?.derivedPoint) {
          pts.push({
            id: aux.derivedPointId,
            label: aux.derivedPointLabel || aux.derivedPointId,
            x: geom.derivedPoint.x,
            y: geom.derivedPoint.y,
            color: aux.color,
          })
        }
      }
    }
    for (const up of userPoints) {
      pts.push({ id: up.id, label: up.label, x: up.x, y: up.y, color: '#8B5CF6', isUser: true })
    }
    return pts
  }, [coordinate, tValues, userPoints])

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
    for (const c of coordinate.circles) {
      const center = resolvePointCoords(coordinate, c.centerId, tValues)
      const r =
        c.radiusPointId !== undefined
          ? (() => {
              const rp = resolvePointCoords(coordinate, c.radiusPointId, tValues)
              return center && rp ? Math.hypot(rp.x - center.x, rp.y - center.y) : (c.radius ?? 0)
            })()
          : (c.radius ?? 0)
      if (center && r > 0) {
        xs.push(center.x - r, center.x + r)
        ys.push(center.y - r, center.y + r)
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
  }, [allInteractivePoints, coordinate, tValues])

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

  // 合并 AI 函数曲线与学生自绘函数曲线并预采样
  const allFunctions = useMemo(
    () => [
      ...coordinate.functions.map((f) => ({ ...f, isUser: false })),
      ...userFunctions.map((uf) => ({
        id: uf.id,
        expr: uf.expr,
        label: `y = ${uf.expr}`,
        color: '#8B5CF6',
        domain: undefined as [number, number] | undefined,
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
        const compiled = compileMathExpr(fn.expr)
        if (!compiled) {
          return { fn, compiled: null, d: '', labelPos: null as { x: number; y: number } | null }
        }
        const xStart = fn.domain
          ? Math.max(fn.domain[0], transform.visibleXMin)
          : transform.visibleXMin
        const xEnd = fn.domain
          ? Math.min(fn.domain[1], transform.visibleXMax)
          : transform.visibleXMax
        const steps = 240
        const parts: string[] = []
        let started = false
        let labelPos: { x: number; y: number } | null = null
        for (let i = 0; i <= steps; i += 1) {
          const x = xStart + ((xEnd - xStart) * i) / steps
          const y = compiled({ x, t: x })
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
          started = true
          if (i === Math.floor(steps * 0.72) && sy > 36 && sy < size.height - 36) {
            labelPos = { x: sx + 8, y: sy - 8 }
          }
        }
        return { fn, compiled, d: parts.join(' '), labelPos }
      }),
    [allFunctions, transform, size.height]
  )

  const resolveByAnyPointId = useCallback(
    (pointId: string): { x: number; y: number } | null => {
      const fromCoord = resolvePointCoords(coordinate, pointId, tValues)
      if (fromCoord) {
        return fromCoord
      }
      const userPt = userPoints.find((p) => p.id === pointId)
      return userPt ? { x: userPt.x, y: userPt.y } : null
    },
    [coordinate, tValues, userPoints]
  )

  const detectHover = useCallback(
    (sx: number, sy: number, wx: number) => {
      // 1. 优先命中点（14px 内）
      let bestPt: HoverInfo | null = null
      let bestPtDist = 15
      for (const pt of allInteractivePoints) {
        const d = Math.hypot(transform.toSvgX(pt.x) - sx, transform.toSvgY(pt.y) - sy)
        if (d < bestPtDist) {
          bestPtDist = d
          bestPt = { kind: 'point', id: pt.id, label: pt.label, x: pt.x, y: pt.y }
        }
      }
      if (bestPt) {
        setHoverInfo(bestPt)
        return
      }

      // 2. 命中函数曲线（Desmos 式实时轨迹追踪）
      let bestCurve: HoverInfo | null = null
      let bestCurveDist = 13
      for (const item of functionPaths) {
        if (!item.compiled) {
          continue
        }
        if (item.fn.domain && (wx < item.fn.domain[0] || wx > item.fn.domain[1])) {
          continue
        }
        const fy = item.compiled({ x: wx, t: wx })
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

      // 3. 命中线段或学生线段
      for (const seg of coordinate.segments) {
        const a = seg.fromId
          ? resolveByAnyPointId(seg.fromId)
          : seg.from
            ? { x: seg.from[0], y: seg.from[1] }
            : null
        const b = seg.toId
          ? resolveByAnyPointId(seg.toId)
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
        if (d < 9) {
          setHoverInfo({
            kind: 'segment',
            id: seg.id,
            label: seg.label || `${seg.fromId ?? ''}${seg.toId ?? ''}` || '线段',
            length: Math.hypot(b.x - a.x, b.y - a.y),
          })
          return
        }
      }

      setHoverInfo(null)
    },
    [allInteractivePoints, functionPaths, coordinate.segments, resolveByAnyPointId, transform]
  )

  if (!effectiveHasContent) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          <div className={styles.emptyTitle}>动态数学坐标系画板</div>
          <div className={styles.emptyDesc}>
            提问几何、函数或动点问题后，AI 可随时调用画板工具在这里实时作图、添加辅助线与动点；无论是否开启苏格拉底引导，你都可以随时打开画板自行标点、连线或画函数。
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

  // 计算实时测量指标 HUD
  const computedMeasurements = coordinate.measurements.map((m) => {
    let numericValue = Number.NaN
    let display = '--'
    const relatedIds: string[] = []
    if (m.kind === 'coord' && m.pointIds?.[0]) {
      relatedIds.push(m.pointIds[0])
      const p = resolvePointCoords(coordinate, m.pointIds[0], tValues)
      if (p) {
        display = `(${formatNum(p.x)}, ${formatNum(p.y)})`
      }
    } else if (m.kind === 'distance' && m.pointIds && m.pointIds.length >= 2) {
      relatedIds.push(m.pointIds[0], m.pointIds[1])
      const a = resolvePointCoords(coordinate, m.pointIds[0], tValues)
      const b = resolvePointCoords(coordinate, m.pointIds[1], tValues)
      if (a && b) {
        numericValue = Math.hypot(b.x - a.x, b.y - a.y)
        display = numericValue.toFixed(2)
      }
    } else if (m.kind === 'sum_distance' && m.pairs) {
      let total = 0
      let valid = true
      for (const [id1, id2] of m.pairs) {
        relatedIds.push(id1, id2)
        const a = resolvePointCoords(coordinate, id1, tValues)
        const b = resolvePointCoords(coordinate, id2, tValues)
        if (!a || !b) {
          valid = false
          break
        }
        total += Math.hypot(b.x - a.x, b.y - a.y)
      }
      if (valid) {
        numericValue = total
        display = total.toFixed(2)
      }
    } else if (m.kind === 'area' && m.pointIds && m.pointIds.length >= 3) {
      relatedIds.push(...m.pointIds)
      const pts = m.pointIds
        .map((id) => resolvePointCoords(coordinate, id, tValues))
        .filter((p): p is { x: number; y: number } => p !== null)
      if (pts.length >= 3) {
        numericValue = computePolygonArea(pts)
        display = numericValue.toFixed(2)
      }
    }
    const isOptimal =
      m.optimalValue !== undefined &&
      Number.isFinite(m.optimalValue) &&
      Number.isFinite(numericValue) &&
      Math.abs(numericValue - m.optimalValue) < Math.max(0.08, Math.abs(m.optimalValue) * 0.012)
    return { measurement: m, display, isOptimal, relatedIds }
  })

  const highlighted = new Set<string>([
    ...coordinate.highlightedIds,
    ...(selectedCoordId ? [selectedCoordId] : []),
    ...hoveredMeasureIds,
    ...(hoverInfo ? [hoverInfo.id] : []),
  ])

  const snapWorldVal = (v: number): number => {
    if (!snapToGrid) {
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
      let bestDist = 18
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

  return (
    <div className={styles.container}>
      {/* 顶部互动工具条：模式切换 + 吸附 + 网格 + 适应 + 联动问 AI */}
      <div className={styles.toolbar}>
        <div className={styles.toolModeGroup} role="group" aria-label="坐标系交互模式">
          <button
            type="button"
            className={clsx(styles.modeBtn, toolMode === 'pan' && styles.modeBtnActive)}
            title="拖动视图或动点，悬停曲线查看精确坐标"
            onClick={() => {
              setToolMode('pan')
              setSegmentStartId(null)
            }}
          >
            ✋ 浏览
          </button>
          <button
            type="button"
            className={clsx(styles.modeBtn, toolMode === 'point' && styles.modeBtnActive)}
            title="在坐标系点击添加自主探索点"
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
            title="依次点击两个点连接探索辅助线"
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
          <button
            type="button"
            className={clsx(styles.miniBtn, snapToGrid && styles.miniBtnActive)}
            title={snapToGrid ? '已开启网格刻度吸附（点击关闭）' : '开启网格刻度吸附'}
            onClick={() => setSnapToGrid((prev) => !prev)}
          >
            吸附
          </button>
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
              title="把当前画板上的动点坐标与你添加的点/辅助线/函数同步给 AI 分析"
              onClick={() => {
                if (!ensureApiKey()) {
                  return
                }
                const prompt = tutorMode
                  ? '请结合我现在坐标系画板上的动点位置与图形，看看我的探索对不对，下一步该怎么思考？'
                  : '请结合我现在坐标系画板上的图形、函数与标点位置，帮我分析一下当前画面。'
                sendQuickMessage(activeSessionId, prompt)
              }}
            >
              问 AI 当前画面
            </button>
          ) : null}
        </div>
      </div>

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
            placeholder="例如：-x^2 + 4*x 或 1.5*x - 3.5"
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
            ? `已选起点 ${segmentStartId}，请点击第二个点完成连线`
            : '请依次点击坐标系上的两个点（含动点或自绘点）连接探索线段'}
        </div>
      ) : null}

      <div
        ref={containerRef}
        className={clsx(
          styles.stage,
          draggingBg && styles.stageDragging,
          (toolMode === 'point' || toolMode === 'segment') && styles.stageCrosshair
        )}
        onDoubleClick={() => fitAllElements()}
        onWheel={(event) => {
          event.preventDefault()
          const rect = event.currentTarget.getBoundingClientRect()
          const factor = event.deltaY > 0 ? 1.12 : 1 / 1.12
          zoomBy(factor, event.clientX - rect.left, event.clientY - rect.top)
        }}
        onPointerDown={(event) => {
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
            setDraggingBg(false)
            return
          }
          if (dragStateRef.current?.kind === 'point') {
            return
          }
          event.currentTarget.setPointerCapture(event.pointerId)
          setDraggingBg(true)
          dragStateRef.current = {
            kind: 'pan',
            startX: event.clientX,
            startY: event.clientY,
            startViewport: viewport,
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
            const anchorX =
              (vp.xMin + vp.xMax) / 2 +
              (pinchStartRef.current.cx - size.width / 2) /
                Math.min(size.width / (vp.xMax - vp.xMin), size.height / (vp.yMax - vp.yMin))
            const anchorY =
              (vp.yMin + vp.yMax) / 2 -
              (pinchStartRef.current.cy - size.height / 2) /
                Math.min(size.width / (vp.xMax - vp.xMin), size.height / (vp.yMax - vp.yMin))
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
          if (drag.kind === 'pan') {
            const dxWorld = (event.clientX - drag.startX) / transform.scale
            const dyWorld = (event.clientY - drag.startY) / transform.scale
            setViewport({
              xMin: drag.startViewport.xMin - dxWorld,
              xMax: drag.startViewport.xMax - dxWorld,
              yMin: drag.startViewport.yMin + dyWorld,
              yMax: drag.startViewport.yMax + dyWorld,
            })
          } else {
            const snapVal = snapToGrid || event.shiftKey ? gridStep / 4 : null
            const nextT = projectToMovingPointT(coordinate, drag.point, wx, wy, tValues, snapVal)
            setMovingPointT(drag.point.id, nextT)
          }
        }}
        onPointerUp={(event) => {
          activePointersRef.current.delete(event.pointerId)
          if (activePointersRef.current.size < 2) {
            pinchStartRef.current = null
          }
          const drag = dragStateRef.current
          dragStateRef.current = null
          setDraggingBg(false)
          if (
            drag?.kind === 'pan' &&
            Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4
          ) {
            const rect = event.currentTarget.getBoundingClientRect()
            handleCanvasActionClick(event.clientX - rect.left, event.clientY - rect.top)
          }
        }}
        onPointerCancel={(event) => {
          activePointersRef.current.delete(event.pointerId)
          pinchStartRef.current = null
          dragStateRef.current = null
          setDraggingBg(false)
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

          {/* 多边形填充层 */}
          {coordinate.polygons.map((poly) => {
            const pts = poly.vertexIds
              .map((id) => resolvePointCoords(coordinate, id, tValues))
              .filter((p): p is { x: number; y: number } => p !== null)
            if (pts.length < 3) {
              return null
            }
            const pointsAttr = pts
              .map((p) => `${transform.toSvgX(p.x).toFixed(1)},${transform.toSvgY(p.y).toFixed(1)}`)
              .join(' ')
            const cx = pts.reduce((acc, p) => acc + p.x, 0) / pts.length
            const cy = pts.reduce((acc, p) => acc + p.y, 0) / pts.length
            const area = computePolygonArea(pts)
            return (
              <g key={poly.id}>
                <polygon
                  points={pointsAttr}
                  fill={poly.fill}
                  stroke={poly.stroke}
                  strokeWidth={highlighted.has(poly.id) ? 2.6 : 1.6}
                  strokeLinejoin="round"
                />
                {poly.showArea || poly.label ? (
                  <text
                    x={transform.toSvgX(cx)}
                    y={transform.toSvgY(cy)}
                    textAnchor="middle"
                    className={styles.pointLabel}
                    fill={poly.stroke}
                  >
                    {poly.label ? `${poly.label} ` : ''}
                    {poly.showArea ? `S = ${area.toFixed(2)}` : ''}
                  </text>
                ) : null}
              </g>
            )
          })}

          {/* 圆 */}
          {coordinate.circles.map((circle) => {
            const center = resolvePointCoords(coordinate, circle.centerId, tValues)
            if (!center) {
              return null
            }
            let radius = circle.radius ?? 0
            if (circle.radiusPointId) {
              const rp = resolvePointCoords(coordinate, circle.radiusPointId, tValues)
              if (rp) {
                radius = Math.hypot(rp.x - center.x, rp.y - center.y)
              }
            }
            if (radius <= 0) {
              return null
            }
            const cx = transform.toSvgX(center.x)
            const cy = transform.toSvgY(center.y)
            const rPx = radius * transform.scale
            return (
              <g key={circle.id}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={rPx}
                  fill="none"
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

          {/* 函数图像（含学生自绘对比函数） */}
          {functionPaths.map(({ fn, d, labelPos }) =>
            d ? (
              <g key={fn.id}>
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

          {/* 线段 / 直线 / 射线 / 向量 */}
          {coordinate.segments.map((seg) => {
            const a = seg.fromId
              ? resolvePointCoords(coordinate, seg.fromId, tValues)
              : seg.from
                ? { x: seg.from[0], y: seg.from[1] }
                : null
            const b = seg.toId
              ? resolvePointCoords(coordinate, seg.toId, tValues)
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
            return (
              <g key={seg.id}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={seg.color}
                  strokeWidth={highlighted.has(seg.id) ? 3 : 2}
                  strokeLinecap="round"
                  strokeDasharray={seg.dashed ? '6 4' : undefined}
                />
                {arrowPoly ? <polygon points={arrowPoly} fill={seg.color} /> : null}
                {seg.showLength || seg.label ? (
                  <text x={mx + 6} y={my - 6} className={styles.lengthTag}>
                    {seg.label ? `${seg.label} ` : ''}
                    {seg.showLength ? len.toFixed(2) : ''}
                  </text>
                ) : null}
              </g>
            )
          })}

          {/* 学生自主探索线段 */}
          {userSegments.map((seg) => {
            const a = resolveByAnyPointId(seg.fromId)
            const b = resolveByAnyPointId(seg.toId)
            if (!a || !b) {
              return null
            }
            const x1 = transform.toSvgX(a.x)
            const y1 = transform.toSvgY(a.y)
            const x2 = transform.toSvgX(b.x)
            const y2 = transform.toSvgY(b.y)
            const len = Math.hypot(b.x - a.x, b.y - a.y)
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

          {/* 自由文字/公式标注 */}
          {coordinate.annotations.map((note) => {
            const pos = note.anchorPointId
              ? resolvePointCoords(coordinate, note.anchorPointId, tValues)
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
                {note.text}
              </text>
            )
          })}

          {/* 辅助线（支持动点实时联动 + 自动直角符号 ∟ + 自动派生对称点/垂足点） */}
          {coordinate.auxiliaryLines.map((aux) => {
            const geom = resolveAuxiliaryGeometry(coordinate, aux, tValues)
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
                    {aux.label}
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
                      {aux.derivedPointLabel || aux.derivedPointId}
                    </text>
                  </g>
                ) : null}
              </g>
            )
          })}

          {/* 固定点 */}
          {coordinate.points.map((pt) => {
            const sx = transform.toSvgX(pt.x)
            const sy = transform.toSvgY(pt.y)
            const isHighlighted = highlighted.has(pt.id) || segmentStartId === pt.id
            return (
              <g key={pt.id}>
                {isHighlighted ? (
                  <circle
                    cx={sx}
                    cy={sy}
                    r={11}
                    fill="none"
                    stroke={pt.color}
                    strokeWidth={2}
                    className={styles.pulseHalo}
                  />
                ) : null}
                <circle
                  cx={sx}
                  cy={sy}
                  r={5.5}
                  fill={pt.color}
                  stroke="var(--dsw-alias-bg-base)"
                  strokeWidth={2.2}
                />
                {pt.label ? (
                  <text x={sx + 9} y={sy - 9} className={styles.pointLabel} fill={pt.color}>
                    {pt.label}
                  </text>
                ) : null}
              </g>
            )
          })}

          {/* 学生自主探索点 */}
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
                    r={11}
                    fill="none"
                    stroke="#8B5CF6"
                    strokeWidth={2}
                    className={styles.pulseHalo}
                  />
                ) : null}
                <circle
                  cx={sx}
                  cy={sy}
                  r={5.5}
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

          {/* 动点（支持直接鼠标/触摸拖动 + 动态光环） */}
          {coordinate.movingPoints.map((mp) => {
            const pos = resolvePointCoords(coordinate, mp.id, tValues)
            if (!pos) {
              return null
            }
            const sx = transform.toSvgX(pos.x)
            const sy = transform.toSvgY(pos.y)
            return (
              <g
                key={mp.id}
                className={styles.movingPointHandle}
                onPointerDown={(event) => {
                  if (toolMode === 'segment') {
                    return
                  }
                  event.stopPropagation()
                  setCanvasPlaying(false)
                  containerRef.current?.setPointerCapture(event.pointerId)
                  dragStateRef.current = { kind: 'point', point: mp }
                }}
              >
                <circle
                  cx={sx}
                  cy={sy}
                  r={14}
                  fill={mp.color}
                  fillOpacity={0.14}
                  className={styles.pulseHalo}
                />
                <circle cx={sx} cy={sy} r={16} fill="transparent" />
                <circle
                  cx={sx}
                  cy={sy}
                  r={7}
                  fill={mp.color}
                  stroke="var(--dsw-alias-bg-base)"
                  strokeWidth={2.5}
                />
                <text x={sx + 10} y={sy - 11} className={styles.pointLabel} fill={mp.color}>
                  {mp.label}({formatNum(pos.x)}, {formatNum(pos.y)})
                </text>
              </g>
            )
          })}
        </svg>

        {/* 左上角标题 + 实时动态测量 HUD（悬停测量芯片联动高亮对应几何元素） */}
        <div className={styles.hudTopLeft}>
          {coordinate.title ? <div className={styles.boardTitle}>{coordinate.title}</div> : null}
          {computedMeasurements.length > 0 ? (
            <div className={styles.measureList}>
              {computedMeasurements.map(({ measurement, display, isOptimal, relatedIds }) => (
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
                  <span>{measurement.label}</span>
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

        {/* 左下角：悬停元素详情或鼠标实时坐标 */}
        {hoverInfo ? (
          <div className={styles.hoverReadout}>
            {hoverInfo.kind === 'point'
              ? `${hoverInfo.label}: (${formatNum(hoverInfo.x)}, ${formatNum(hoverInfo.y)})`
              : hoverInfo.kind === 'curve'
                ? `${hoverInfo.expr}  |  (${formatNum(hoverInfo.x)}, ${formatNum(hoverInfo.y)})`
                : `${hoverInfo.label}: 长度 ${hoverInfo.length.toFixed(2)}`}
          </div>
        ) : cursorWorld ? (
          <div className={styles.cursorReadout}>
            ({formatNum(snapToGrid && toolMode === 'point' ? snapWorldVal(cursorWorld.x) : cursorWorld.x)},{' '}
            {formatNum(snapToGrid && toolMode === 'point' ? snapWorldVal(cursorWorld.y) : cursorWorld.y)})
          </div>
        ) : null}

        {/* 若选中了自绘点/函数，提供快捷删除按钮 */}
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

      {/* 底部动点交互控制条 */}
      {coordinate.movingPoints.length > 0 ? (
        <div className={styles.motionDock}>
          {coordinate.movingPoints.map((mp, idx) => {
            const currentT = Object.hasOwn(tValues, mp.id) ? tValues[mp.id] : mp.initialT
            const pos = resolvePointCoords(coordinate, mp.id, tValues)
            const microStep = Math.max(0.05, Number(((mp.tMax - mp.tMin) / 40).toFixed(2)))
            return (
              <div key={mp.id} className={styles.motionRow}>
                {idx === 0 ? (
                  <button
                    type="button"
                    className={styles.playBtn}
                    title={playing ? '暂停动点' : '播放动点动画'}
                    onClick={() => setCanvasPlaying(!playing)}
                  >
                    {playing ? '⏸' : '▶'}
                  </button>
                ) : null}
                <div className={styles.sliderWrap}>
                  <div className={styles.sliderHeader}>
                    <span>动点 {mp.label} 滑块</span>
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
                      step={(mp.tMax - mp.tMin) / 240}
                      value={currentT}
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
                    <button
                      type="button"
                      className={styles.stepAdjustBtn}
                      title="回到起始位置"
                      onClick={() => {
                        setCanvasPlaying(false)
                        setMovingPointT(mp.id, mp.initialT)
                      }}
                    >
                      ↺
                    </button>
                  </div>
                </div>
                {idx === 0 ? (
                  <div className={styles.playbackActions}>
                    <button
                      type="button"
                      className={styles.speedBtn}
                      title="切换播放速度"
                      onClick={() => setCanvasSpeed(speed === 0.5 ? 1 : speed === 1 ? 2 : 0.5)}
                    >
                      {speed}x
                    </button>
                    <button
                      type="button"
                      className={styles.speedBtn}
                      title={loopMode === 'bounce' ? '当前：往返运动（点击切换单向循环）' : '当前：单向循环（点击切换往返）'}
                      onClick={toggleCanvasLoopMode}
                    >
                      {loopMode === 'bounce' ? '⇄' : '↻'}
                    </button>
                  </div>
                ) : null}
              </div>
            )
          })}
          <div className={styles.dragTip}>
            提示：可直接拖动红点 P 或悬停函数曲线查看精确坐标；按住 Shift 拖动可按刻度步进吸附
          </div>
        </div>
      ) : null}
    </div>
  )
}
