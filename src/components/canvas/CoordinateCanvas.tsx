import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { compileMathExpr } from '../../services/tutor/mathEval.js'
import {
  setCanvasPlaying,
  setCanvasSpeed,
  setMovingPointT,
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
import styles from './CoordinateCanvas.module.css'

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
  if (Math.abs(value) < 1e-6) {
    return '0'
  }
  if (Math.abs(value - Math.round(value)) < 1e-3) {
    return String(Math.round(value))
  }
  return value.toFixed(2).replace(/\.?0+$/, '')
}

/** 根据鼠标所在世界坐标，反推最接近该位置的动点参数 t */
const projectToMovingPointT = (
  coord: CoordinateState,
  mp: CoordMovingPoint,
  worldX: number,
  worldY: number,
  tValues: Record<string, number>
): number => {
  const { path, tMin, tMax } = mp
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
    return tMin + ratio * (tMax - tMin)
  }
  if (path.type === 'function') {
    return Math.max(tMin, Math.min(tMax, worldX))
  }
  // parametric: 采样寻找最近点
  const samples = 100
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
  return bestT
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

  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 520, height: 420 })
  const [viewport, setViewport] = useState<CoordViewport>(coordinate.viewport)
  const [cursorWorld, setCursorWorld] = useState<{ x: number; y: number } | null>(null)
  const [draggingBg, setDraggingBg] = useState(false)
  const dragStateRef = useRef<
    | { kind: 'pan'; startX: number; startY: number; startViewport: CoordViewport }
    | { kind: 'point'; point: CoordMovingPoint }
    | null
  >(null)

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
  }, [])

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

  const zoomBy = (factor: number, centerX = size.width / 2, centerY = size.height / 2) => {
    const anchorX = transform.toWorldX(centerX)
    const anchorY = transform.toWorldY(centerY)
    setViewport((prev) => ({
      xMin: anchorX + (prev.xMin - anchorX) * factor,
      xMax: anchorX + (prev.xMax - anchorX) * factor,
      yMin: anchorY + (prev.yMin - anchorY) * factor,
      yMax: anchorY + (prev.yMax - anchorY) * factor,
    }))
  }

  const gridStep = chooseGridStep(transform.visibleXMax - transform.visibleXMin)
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

  const originSvgX = transform.toSvgX(0)
  const originSvgY = transform.toSvgY(0)
  const clampedAxisX = Math.max(24, Math.min(size.width - 24, originSvgX))
  const clampedAxisY = Math.max(24, Math.min(size.height - 24, originSvgY))

  // 预采样函数曲线
  const functionPaths = useMemo(
    () =>
      coordinate.functions.map((fn) => {
        const compiled = compileMathExpr(fn.expr)
        if (!compiled) {
          return { fn, d: '', labelPos: null as { x: number; y: number } | null }
        }
        const xStart = fn.domain
          ? Math.max(fn.domain[0], transform.visibleXMin)
          : transform.visibleXMin
        const xEnd = fn.domain
          ? Math.min(fn.domain[1], transform.visibleXMax)
          : transform.visibleXMax
        const steps = 220
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
          if (i === Math.floor(steps * 0.72) && sy > 30 && sy < size.height - 30) {
            labelPos = { x: sx + 8, y: sy - 8 }
          }
        }
        return { fn, d: parts.join(' '), labelPos }
      }),
    [coordinate.functions, transform, size.height]
  )

  if (!hasContent) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          <div className={styles.emptyTitle}>动态数学坐标系画板</div>
          <div className={styles.emptyDesc}>
            提问几何、函数或动点题后，AI 导师会每讲一步调用 Agent
            工具在这里实时作图、添加辅助线并让动点移动起来。
          </div>
        </div>
      </div>
    )
  }

  // 计算实时测量指标 HUD
  const computedMeasurements = coordinate.measurements.map((m) => {
    let numericValue = Number.NaN
    let display = '--'
    if (m.kind === 'coord' && m.pointIds?.[0]) {
      const p = resolvePointCoords(coordinate, m.pointIds[0], tValues)
      if (p) {
        display = `(${formatNum(p.x)}, ${formatNum(p.y)})`
      }
    } else if (m.kind === 'distance' && m.pointIds && m.pointIds.length >= 2) {
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
    return { measurement: m, display, isOptimal }
  })

  const highlighted = new Set(coordinate.highlightedIds)

  return (
    <div className={styles.container}>
      <div
        ref={containerRef}
        className={clsx(styles.stage, draggingBg && styles.stageDragging)}
        onWheel={(event) => {
          event.preventDefault()
          const rect = event.currentTarget.getBoundingClientRect()
          const factor = event.deltaY > 0 ? 1.12 : 1 / 1.12
          zoomBy(factor, event.clientX - rect.left, event.clientY - rect.top)
        }}
        onPointerDown={(event) => {
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
          const rect = event.currentTarget.getBoundingClientRect()
          const sx = event.clientX - rect.left
          const sy = event.clientY - rect.top
          const wx = transform.toWorldX(sx)
          const wy = transform.toWorldY(sy)
          setCursorWorld({ x: wx, y: wy })

          const drag = dragStateRef.current
          if (!drag) {
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
            const nextT = projectToMovingPointT(coordinate, drag.point, wx, wy, tValues)
            setMovingPointT(drag.point.id, nextT)
          }
        }}
        onPointerUp={() => {
          dragStateRef.current = null
          setDraggingBg(false)
        }}
        onPointerLeave={() => {
          if (!dragStateRef.current) {
            setCursorWorld(null)
          }
        }}
      >
        <svg ref={svgRef} className={styles.svg} width={size.width} height={size.height}>
          {/* 背景网格 */}
          {coordinate.showGrid ? (
            <g>
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

          {/* 坐标轴与箭头 */}
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
                <text
                  key={`tx-${x}`}
                  x={sx}
                  y={clampedAxisY + 15}
                  textAnchor="middle"
                  className={styles.tickText}
                >
                  {formatNum(x)}
                </text>
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
                <text
                  key={`ty-${y}`}
                  x={clampedAxisX - 8}
                  y={sy + 4}
                  textAnchor="end"
                  className={styles.tickText}
                >
                  {formatNum(y)}
                </text>
              )
            })}
            <text
              x={clampedAxisX - 8}
              y={clampedAxisY + 15}
              textAnchor="end"
              className={styles.tickText}
            >
              O
            </text>
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
                  strokeWidth={highlighted.has(poly.id) ? 2.4 : 1.6}
                  strokeLinejoin="round"
                />
                {poly.showArea ? (
                  <text
                    x={transform.toSvgX(cx)}
                    y={transform.toSvgY(cy)}
                    textAnchor="middle"
                    className={styles.pointLabel}
                    fill={poly.stroke}
                  >
                    S = {area.toFixed(2)}
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
            return (
              <circle
                key={circle.id}
                cx={transform.toSvgX(center.x)}
                cy={transform.toSvgY(center.y)}
                r={radius * transform.scale}
                fill="none"
                stroke={circle.color}
                strokeWidth={highlighted.has(circle.id) ? 2.5 : 1.8}
                strokeDasharray={circle.dashed ? '6 4' : undefined}
              />
            )
          })}

          {/* 函数图像 */}
          {functionPaths.map(({ fn, d, labelPos }) =>
            d ? (
              <g key={fn.id}>
                <path
                  d={d}
                  fill="none"
                  stroke={fn.color}
                  strokeWidth={highlighted.has(fn.id) ? 3 : 2.2}
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

          {/* 线段 / 直线 */}
          {coordinate.segments.map((seg) => {
            const a = resolvePointCoords(coordinate, seg.fromId, tValues)
            const b = resolvePointCoords(coordinate, seg.toId, tValues)
            if (!a || !b) {
              return null
            }
            const x1 = transform.toSvgX(a.x)
            const y1 = transform.toSvgY(a.y)
            const x2 = transform.toSvgX(b.x)
            const y2 = transform.toSvgY(b.y)
            const len = Math.hypot(b.x - a.x, b.y - a.y)
            const mx = (x1 + x2) / 2
            const my = (y1 + y2) / 2
            return (
              <g key={seg.id}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={seg.color}
                  strokeWidth={highlighted.has(seg.id) ? 2.8 : 2}
                  strokeLinecap="round"
                  strokeDasharray={seg.dashed ? '6 4' : undefined}
                />
                {seg.showLength || seg.label ? (
                  <text x={mx + 6} y={my - 6} className={styles.lengthTag}>
                    {seg.label ? `${seg.label} ` : ''}
                    {seg.showLength ? len.toFixed(2) : ''}
                  </text>
                ) : null}
              </g>
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

            // 计算直角标记折线（SVG 像素大小固定 9px）
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

            return (
              <g key={aux.id}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={aux.color}
                  strokeWidth={highlighted.has(aux.id) ? 2.6 : 2}
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
            const isHighlighted = highlighted.has(pt.id)
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
                <text x={sx + 9} y={sy - 9} className={styles.pointLabel} fill={pt.color}>
                  {pt.label}
                </text>
              </g>
            )
          })}

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
                {/* 扩大命中区，方便手指/鼠标顺手拖拽 */}
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

        {/* 左上角标题 + 实时动态测量 HUD */}
        <div className={styles.hudTopLeft}>
          {coordinate.title ? <div className={styles.boardTitle}>{coordinate.title}</div> : null}
          {computedMeasurements.length > 0 ? (
            <div className={styles.measureList}>
              {computedMeasurements.map(({ measurement, display, isOptimal }) => (
                <div
                  key={measurement.id}
                  className={clsx(styles.measurePill, isOptimal && styles.measureOptimal)}
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

        {/* 右上角缩放按钮 */}
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
            title="复位视图"
            onClick={() => setViewport(coordinate.viewport)}
          >
            ⌖
          </button>
        </div>

        {/* 左下角鼠标实时坐标 */}
        {cursorWorld ? (
          <div className={styles.cursorReadout}>
            ({formatNum(cursorWorld.x)}, {formatNum(cursorWorld.y)})
          </div>
        ) : null}
      </div>

      {/* 底部动点交互控制条 */}
      {coordinate.movingPoints.length > 0 ? (
        <div className={styles.motionDock}>
          {coordinate.movingPoints.map((mp, idx) => {
            const currentT = Object.hasOwn(tValues, mp.id) ? tValues[mp.id] : mp.initialT
            const pos = resolvePointCoords(coordinate, mp.id, tValues)
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
                </div>
                {idx === 0 ? (
                  <button
                    type="button"
                    className={styles.speedBtn}
                    title="切换播放速度"
                    onClick={() => setCanvasSpeed(speed === 0.5 ? 1 : speed === 1 ? 2 : 0.5)}
                  >
                    {speed}x
                  </button>
                ) : null}
              </div>
            )
          })}
          <div className={styles.dragTip}>
            提示：可直接拖动坐标系上的红色动点，所有关联线段与辅助线都会实时同步移动
          </div>
        </div>
      ) : null}
    </div>
  )
}
