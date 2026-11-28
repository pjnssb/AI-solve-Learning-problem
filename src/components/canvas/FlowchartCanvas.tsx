import clsx from 'clsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { sendQuickMessage, useChatStore } from '../../services/chat/store.js'
import { useSettings } from '../../services/settings.js'
import {
  setFlowDirectionOverride,
  setSelectedFlowNodeId,
  toggleFlowNodeStatusOverride,
  useCanvasStore,
} from '../../services/tutor/canvasStore.js'
import type { FlowchartState, FlowNode } from '../../services/tutor/types.js'
import { copyText } from '../../utils/clipboard.js'
import { showToast } from '../base/toastState.js'
import styles from './FlowchartCanvas.module.css'

type PositionedNode = {
  node: FlowNode
  layer: number
  x: number
  y: number
  width: number
  height: number
}

const NODE_WIDTH = 264
const GAP_X = 48
const GAP_Y = 64

const visualCharWidth = (ch: string): number => (ch.charCodeAt(0) > 255 ? 1.85 : 1)

const estimateTextPx = (text: string, fontSize = 11): number => {
  let units = 0
  for (const ch of text) {
    units += visualCharWidth(ch)
  }
  return Math.ceil(units * (fontSize * 0.62))
}

const wrapLines = (text: string, maxUnits: number, maxLines: number): string[] => {
  const lines: string[] = []
  let current = ''
  let widthCount = 0
  for (const ch of text) {
    if (ch === '\n') {
      lines.push(current)
      current = ''
      widthCount = 0
      if (lines.length >= maxLines) {
        return lines
      }
      continue
    }
    const chWidth = visualCharWidth(ch)
    if (widthCount + chWidth > maxUnits && current) {
      lines.push(current)
      if (lines.length >= maxLines) {
        const last = lines[lines.length - 1]
        lines[lines.length - 1] = `${last.slice(0, Math.max(1, last.length - 1))}…`
        return lines
      }
      current = ch
      widthCount = chWidth
    } else {
      current += ch
      widthCount += chWidth
    }
  }
  if (current) {
    lines.push(current)
  }
  return lines
}

const computeNodeHeight = (node: FlowNode): number => {
  const titleLines = wrapLines(node.label, 22, 4)
  const subLines = node.sublabel ? wrapLines(node.sublabel, 29, 4) : []
  if (subLines.length === 0) {
    return Math.max(58, 28 + titleLines.length * 18 + 12)
  }
  return Math.max(76, 26 + titleLines.length * 18 + 6 + subLines.length * 16 + 14)
}

/** 分层拓扑布局 + 重心法减交叉：自动对齐分支并动态计算卡片高度 */
const computeFlowLayout = (flowchart: FlowchartState, direction: 'TD' | 'LR') => {
  const { nodes, edges } = flowchart
  if (nodes.length === 0) {
    return { positioned: [] as PositionedNode[], bounds: { width: 400, height: 300 } }
  }

  const nodeIds = new Set(nodes.map((n) => n.id))
  const incomingCount = new Map<string, number>()
  const parentsMap = new Map<string, string[]>()
  const outgoingMap = new Map<string, string[]>()
  for (const node of nodes) {
    incomingCount.set(node.id, 0)
    parentsMap.set(node.id, [])
    outgoingMap.set(node.id, [])
  }
  for (const edge of edges) {
    if (nodeIds.has(edge.from) && nodeIds.has(edge.to) && edge.from !== edge.to) {
      incomingCount.set(edge.to, (incomingCount.get(edge.to) ?? 0) + 1)
      outgoingMap.get(edge.from)?.push(edge.to)
      parentsMap.get(edge.to)?.push(edge.from)
    }
  }

  // BFS 计算节点层级（带防环保护）
  const depth = new Map<string, number>()
  const queue: string[] = []
  for (const node of nodes) {
    if ((incomingCount.get(node.id) ?? 0) === 0) {
      depth.set(node.id, 0)
      queue.push(node.id)
    }
  }
  if (queue.length === 0) {
    depth.set(nodes[0].id, 0)
    queue.push(nodes[0].id)
  }

  while (queue.length > 0) {
    const curr = queue.shift()
    if (!curr) {
      continue
    }
    const currDepth = depth.get(curr) ?? 0
    for (const next of outgoingMap.get(curr) ?? []) {
      const existing = depth.get(next)
      if (existing === undefined || existing < currDepth + 1) {
        if (currDepth + 1 < nodes.length) {
          depth.set(next, currDepth + 1)
          queue.push(next)
        }
      }
    }
  }

  let maxLayer = 0
  for (const d of depth.values()) {
    maxLayer = Math.max(maxLayer, d)
  }
  for (const node of nodes) {
    if (!depth.has(node.id)) {
      maxLayer += 1
      depth.set(node.id, maxLayer)
    }
  }

  const layers = new Map<number, FlowNode[]>()
  for (const node of nodes) {
    const layer = depth.get(node.id) ?? 0
    const list = layers.get(layer) ?? []
    list.push(node)
    layers.set(layer, list)
  }

  const sortedLayerKeys = Array.from(layers.keys()).sort((a, b) => a - b)

  // 重心法排序：按上一层父节点平均位置排序，减少交叉连线
  const orderIndex = new Map<string, number>()
  for (const layerKey of sortedLayerKeys) {
    const row = layers.get(layerKey) ?? []
    if (layerKey > 0 && row.length > 1) {
      row.sort((a, b) => {
        const pa = (parentsMap.get(a.id) ?? [])
          .map((pid) => orderIndex.get(pid))
          .filter((idx): idx is number => idx !== undefined)
        const pb = (parentsMap.get(b.id) ?? [])
          .map((pid) => orderIndex.get(pid))
          .filter((idx): idx is number => idx !== undefined)
        const avgA = pa.length > 0 ? pa.reduce((s, v) => s + v, 0) / pa.length : Number.MAX_SAFE_INTEGER
        const avgB = pb.length > 0 ? pb.reduce((s, v) => s + v, 0) / pb.length : Number.MAX_SAFE_INTEGER
        if (avgA !== avgB) {
          return avgA - avgB
        }
        return a.stepIndex - b.stepIndex
      })
    }
    row.forEach((n, idx) => orderIndex.set(n.id, idx))
  }

  const positioned: PositionedNode[] = []
  const heightById = new Map<string, number>(nodes.map((n) => [n.id, computeNodeHeight(n)]))

  if (direction === 'TD') {
    let cursorY = 56
    let maxRowWidth = NODE_WIDTH
    for (const layerKey of sortedLayerKeys) {
      const row = layers.get(layerKey) ?? []
      const rowWidth = row.length * NODE_WIDTH + Math.max(0, row.length - 1) * GAP_X
      maxRowWidth = Math.max(maxRowWidth, rowWidth)
    }
    const centerX = maxRowWidth / 2 + 56
    for (const layerKey of sortedLayerKeys) {
      const row = layers.get(layerKey) ?? []
      const rowWidth = row.length * NODE_WIDTH + Math.max(0, row.length - 1) * GAP_X
      const rowHeight = Math.max(...row.map((n) => heightById.get(n.id) ?? 64))
      const startX = centerX - rowWidth / 2
      row.forEach((node, idx) => {
        const h = heightById.get(node.id) ?? 64
        positioned.push({
          node,
          layer: layerKey,
          x: startX + idx * (NODE_WIDTH + GAP_X),
          y: cursorY + (rowHeight - h) / 2,
          width: NODE_WIDTH,
          height: h,
        })
      })
      cursorY += rowHeight + GAP_Y
    }
    return {
      positioned,
      bounds: { width: maxRowWidth + 112, height: Math.max(260, cursorY + 36) },
    }
  }

  // LR 横向布局
  let cursorX = 56
  let maxColHeight = 84
  for (const layerKey of sortedLayerKeys) {
    const col = layers.get(layerKey) ?? []
    const colHeight =
      col.reduce((acc, n) => acc + (heightById.get(n.id) ?? 64), 0) +
      Math.max(0, col.length - 1) * 32
    maxColHeight = Math.max(maxColHeight, colHeight)
  }
  const centerY = maxColHeight / 2 + 56
  for (const layerKey of sortedLayerKeys) {
    const col = layers.get(layerKey) ?? []
    const colHeight =
      col.reduce((acc, n) => acc + (heightById.get(n.id) ?? 64), 0) +
      Math.max(0, col.length - 1) * 32
    let y = centerY - colHeight / 2
    for (const node of col) {
      const h = heightById.get(node.id) ?? 64
      positioned.push({ node, layer: layerKey, x: cursorX, y, width: NODE_WIDTH, height: h })
      y += h + 32
    }
    cursorX += NODE_WIDTH + 72
  }
  return {
    positioned,
    bounds: { width: Math.max(360, cursorX + 48), height: maxColHeight + 112 },
  }
}

const toMermaidCode = (flowchart: FlowchartState, direction: 'TD' | 'LR'): string => {
  const lines = [`flowchart ${direction}`]
  const esc = (s: string) => s.replace(/"/g, "'")
  for (const node of flowchart.nodes) {
    const text = node.sublabel ? `${node.label}<br/>${node.sublabel}` : node.label
    if (node.kind === 'decision') {
      lines.push(`  ${node.id}{"${esc(text)}"}`)
    } else if (node.kind === 'start' || node.kind === 'result') {
      lines.push(`  ${node.id}(["${esc(text)}"])`)
    } else {
      lines.push(`  ${node.id}["${esc(text)}"]`)
    }
  }
  for (const edge of flowchart.edges) {
    const arrow = edge.dashed ? '-.->' : '-->'
    lines.push(
      edge.label
        ? `  ${edge.from} ${arrow}|"${esc(edge.label)}"| ${edge.to}`
        : `  ${edge.from} ${arrow} ${edge.to}`
    )
  }
  return lines.join('\n')
}

export const FlowchartCanvas = ({
  flowchart,
  hasContent,
  svgRef,
}: {
  flowchart: FlowchartState
  hasContent: boolean
  svgRef?: React.RefObject<SVGSVGElement>
}) => {
  const selectedFlowNodeId = useCanvasStore((state) => state.selectedFlowNodeId)
  const flowDirectionOverride = useCanvasStore((state) => state.flowDirectionOverride)
  const flowStatusOverrides = useCanvasStore((state) => state.flowStatusOverrides)
  const activeSessionId = useChatStore((state) => state.activeId)
  const tutorMode = useSettings((state) => state.tutorMode)
  const streaming = useChatStore((state) =>
    state.activeId ? Object.hasOwn(state.streaming, state.activeId) : false
  )

  const stageRef = useRef<HTMLDivElement>(null)
  const [stageSize, setStageSize] = useState({ width: 520, height: 420 })
  const [view, setView] = useState({ zoom: 1, pan: { x: 0, y: 0 } })
  const { zoom, pan } = view
  const [dragging, setDragging] = useState(false)
  const [nodeOffsets, setNodeOffsets] = useState<Record<string, { dx: number; dy: number }>>({})

  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinchRef = useRef<{ dist: number; zoom: number; pan: { x: number; y: number }; cx: number; cy: number } | null>(null)
  const dragRef = useRef<
    | { kind: 'pan'; startX: number; startY: number; panX: number; panY: number }
    | { kind: 'node'; nodeId: string; startX: number; startY: number; baseDx: number; baseDy: number; moved: boolean }
    | null
  >(null)

  const effectiveDirection = flowDirectionOverride ?? flowchart.direction
  const layout = useMemo(
    () => computeFlowLayout(flowchart, effectiveDirection),
    [flowchart, effectiveDirection]
  )

  const nodeMap = useMemo(() => {
    const map = new Map<string, PositionedNode>()
    for (const item of layout.positioned) {
      const off = nodeOffsets[item.node.id]
      map.set(
        item.node.id,
        off ? { ...item, x: item.x + off.dx, y: item.y + off.dy } : item
      )
    }
    return map
  }, [layout.positioned, nodeOffsets])

  useEffect(() => {
    const el = stageRef.current
    if (!el) {
      return
    }
    const update = () => {
      const rect = el.getBoundingClientRect()
      if (rect.width > 10 && rect.height > 10) {
        setStageSize({ width: rect.width, height: rect.height })
      }
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasContent])

  const fitToView = useCallback(() => {
    const scaleX = (stageSize.width - 44) / Math.max(1, layout.bounds.width)
    const scaleY = (stageSize.height - 80) / Math.max(1, layout.bounds.height)
    const nextZoom = Math.max(0.45, Math.min(1.08, Math.min(scaleX, scaleY)))
    setView({
      zoom: nextZoom,
      pan: {
        x: (stageSize.width - layout.bounds.width * nextZoom) / 2,
        y: Math.max(24, (stageSize.height - layout.bounds.height * nextZoom) / 2),
      },
    })
  }, [stageSize.width, stageSize.height, layout.bounds.width, layout.bounds.height])

  // 当节点/连线数量、排版方向或首次容器尺寸测量完成时自动适配视图，保留用户手动缩放/拖拽状态
  const prevFitKeyRef = useRef('')
  const prevMeasuredRef = useRef(false)
  useEffect(() => {
    const key = `${flowchart.nodes.length}:${flowchart.edges.length}:${effectiveDirection}`
    const sizeChangedOnInit = !prevMeasuredRef.current && stageSize.width !== 520
    if (sizeChangedOnInit) {
      prevMeasuredRef.current = true
    }
    if (key !== prevFitKeyRef.current || sizeChangedOnInit) {
      prevFitKeyRef.current = key
      fitToView()
    }
  }, [flowchart.nodes.length, flowchart.edges.length, effectiveDirection, stageSize.width, fitToView])

  const zoomAt = useCallback(
    (factor: number, cx = stageSize.width / 2, cy = stageSize.height / 2) => {
      if (!Number.isFinite(factor) || factor <= 0) {
        return
      }
      setView((prev) => {
        const nextZoom = Math.max(0.35, Math.min(2.4, prev.zoom * factor))
        const ratio = nextZoom / prev.zoom
        return {
          zoom: nextZoom,
          pan: {
            x: cx - (cx - prev.pan.x) * ratio,
            y: cy - (cy - prev.pan.y) * ratio,
          },
        }
      })
    },
    [stageSize.width, stageSize.height]
  )

  const zoomAtRef = useRef(zoomAt)
  zoomAtRef.current = zoomAt

  // 使用非 passive 原生监听拦截触控板双指捏合（ctrlKey + wheel 及 Safari gesture*），避免浏览器缩放整页
  useEffect(() => {
    const el = stageRef.current
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
      const factor = Math.exp(-clampedDy * sensitivity)
      const rect = el.getBoundingClientRect()
      zoomAtRef.current(factor, event.clientX - rect.left, event.clientY - rect.top)
    }

    let lastScale = 1
    const onGestureStart = (event: Event) => {
      event.preventDefault()
      lastScale = 1
    }
    const onGestureChange = (event: Event) => {
      event.preventDefault()
      const gestureEvent = event as Event & { scale?: number; clientX?: number; clientY?: number }
      const scale = typeof gestureEvent.scale === 'number' && gestureEvent.scale > 0 ? gestureEvent.scale : 1
      const stepScale = scale / lastScale
      lastScale = scale
      if (!Number.isFinite(stepScale) || stepScale <= 0 || Math.abs(stepScale - 1) < 1e-4) {
        return
      }
      const rect = el.getBoundingClientRect()
      const cx = typeof gestureEvent.clientX === 'number' ? gestureEvent.clientX - rect.left : rect.width / 2
      const cy = typeof gestureEvent.clientY === 'number' ? gestureEvent.clientY - rect.top : rect.height / 2
      zoomAtRef.current(stepScale, cx, cy)
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
  }, [hasContent])

  // 计算选中节点及其邻接关系，用于聚焦高亮
  const connectedIds = useMemo(() => {
    if (!selectedFlowNodeId) {
      return null
    }
    const set = new Set<string>([selectedFlowNodeId])
    for (const edge of flowchart.edges) {
      if (edge.from === selectedFlowNodeId) {
        set.add(edge.to)
      }
      if (edge.to === selectedFlowNodeId) {
        set.add(edge.from)
      }
    }
    return set
  }, [selectedFlowNodeId, flowchart.edges])

  if (!hasContent) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          <div className={styles.emptyTitle}>思维流程图画板</div>
          <div className={styles.emptyDesc}>
            无论是英语长难句拆解、逻辑分类讨论、算法流程还是知识梳理，无论是否开启苏格拉底引导，AI
            都可以随时在这里为你绘制和更新清晰的可视化流程图。
          </div>
        </div>
      </div>
    )
  }

  const highlighted = new Set(flowchart.highlightedIds)
  const selectedNode = selectedFlowNodeId
    ? flowchart.nodes.find((n) => n.id === selectedFlowNodeId) ?? null
    : null
  const selectedStatus = selectedNode
    ? (flowStatusOverrides[selectedNode.id] ?? selectedNode.status)
    : null
  const hasCustomOffsets = Object.keys(nodeOffsets).length > 0

  // 统计同一父节点发出的边数，错开标签位置防止重叠
  const outgoingEdgesCount = new Map<string, number>()
  const outgoingEdgeIndex = new Map<string, number>()
  for (const edge of flowchart.edges) {
    const count = outgoingEdgesCount.get(edge.from) ?? 0
    outgoingEdgeIndex.set(edge.id, count)
    outgoingEdgesCount.set(edge.from, count + 1)
  }

  return (
    <div className={styles.container}>
      <div
        ref={stageRef}
        className={clsx(styles.stage, dragging && styles.stageDragging)}
        onDoubleClick={fitToView}
        onPointerDown={(event) => {
          activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
          if (activePointersRef.current.size === 2) {
            const pts = Array.from(activePointersRef.current.values())
            const rect = event.currentTarget.getBoundingClientRect()
            pinchRef.current = {
              dist: Math.max(10, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)),
              zoom,
              pan,
              cx: (pts[0].x + pts[1].x) / 2 - rect.left,
              cy: (pts[0].y + pts[1].y) / 2 - rect.top,
            }
            dragRef.current = null
            setDragging(false)
            return
          }
          if (dragRef.current?.kind === 'node') {
            return
          }
          event.currentTarget.setPointerCapture(event.pointerId)
          setDragging(true)
          dragRef.current = {
            kind: 'pan',
            startX: event.clientX,
            startY: event.clientY,
            panX: pan.x,
            panY: pan.y,
          }
        }}
        onPointerMove={(event) => {
          if (activePointersRef.current.has(event.pointerId)) {
            activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
          }
          if (activePointersRef.current.size === 2 && pinchRef.current) {
            const pts = Array.from(activePointersRef.current.values())
            const dist = Math.max(10, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y))
            const nextZoom = Math.max(
              0.35,
              Math.min(2.4, pinchRef.current.zoom * (dist / pinchRef.current.dist))
            )
            const ratio = nextZoom / pinchRef.current.zoom
            setView({
              zoom: nextZoom,
              pan: {
                x: pinchRef.current.cx - (pinchRef.current.cx - pinchRef.current.pan.x) * ratio,
                y: pinchRef.current.cy - (pinchRef.current.cy - pinchRef.current.pan.y) * ratio,
              },
            })
            return
          }

          const drag = dragRef.current
          if (!drag) {
            return
          }
          if (drag.kind === 'pan') {
            setView((prev) => ({
              ...prev,
              pan: {
                x: drag.panX + (event.clientX - drag.startX),
                y: drag.panY + (event.clientY - drag.startY),
              },
            }))
          } else {
            const dxScreen = event.clientX - drag.startX
            const dyScreen = event.clientY - drag.startY
            if (Math.hypot(dxScreen, dyScreen) > 4) {
              drag.moved = true
            }
            if (drag.moved) {
              setNodeOffsets((prev) => ({
                ...prev,
                [drag.nodeId]: {
                  dx: drag.baseDx + dxScreen / zoom,
                  dy: drag.baseDy + dyScreen / zoom,
                },
              }))
            }
          }
        }}
        onPointerUp={(event) => {
          activePointersRef.current.delete(event.pointerId)
          if (activePointersRef.current.size < 2) {
            pinchRef.current = null
          }
          const drag = dragRef.current
          dragRef.current = null
          setDragging(false)
          if (drag?.kind === 'node') {
            if (!drag.moved) {
              setSelectedFlowNodeId(selectedFlowNodeId === drag.nodeId ? null : drag.nodeId)
            }
          } else if (
            drag?.kind === 'pan' &&
            Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4
          ) {
            setSelectedFlowNodeId(null)
          }
        }}
        onPointerCancel={(event) => {
          activePointersRef.current.delete(event.pointerId)
          pinchRef.current = null
          dragRef.current = null
          setDragging(false)
        }}
      >
        <svg ref={svgRef} className={styles.svg} width={stageSize.width} height={stageSize.height}>
          <defs>
            <marker
              id="flow-arrow"
              viewBox="0 0 10 10"
              refX="8.5"
              refY="5"
              markerWidth="6.5"
              markerHeight="6.5"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.2 L 9 5 L 0 8.8 z" fill="var(--dsw-alias-label-tertiary)" />
            </marker>
            <marker
              id="flow-arrow-amber"
              viewBox="0 0 10 10"
              refX="8.5"
              refY="5"
              markerWidth="6.5"
              markerHeight="6.5"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.2 L 9 5 L 0 8.8 z" fill="var(--dsw-static-amber-500)" />
            </marker>
            <marker
              id="flow-arrow-brand"
              viewBox="0 0 10 10"
              refX="8.5"
              refY="5"
              markerWidth="6.5"
              markerHeight="6.5"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.2 L 9 5 L 0 8.8 z" fill="var(--dsw-alias-brand-primary)" />
            </marker>
          </defs>

          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {/* 边连接线（支持跨层绕行、回边绕行、聚焦高亮与错峰标签） */}
            {flowchart.edges.map((edge) => {
              const from = nodeMap.get(edge.from)
              const to = nodeMap.get(edge.to)
              if (!from || !to) {
                return null
              }
              const isTD = effectiveDirection === 'TD'
              const isBackEdge = to.layer <= from.layer
              const isSkipLayer = to.layer - from.layer > 1

              let d: string
              let lx: number
              let ly: number

              if (isTD) {
                const x1 = from.x + from.width / 2
                const y1 = from.y + from.height
                const x2 = to.x + to.width / 2
                const y2 = to.y
                if (isBackEdge) {
                  const sideX = Math.max(from.x + from.width, to.x + to.width) + 52
                  const sy1 = from.y + from.height / 2
                  const sy2 = to.y + to.height / 2
                  d = `M ${from.x + from.width} ${sy1} C ${sideX} ${sy1}, ${sideX} ${sy2}, ${to.x + to.width + 4} ${sy2}`
                  lx = sideX - 8
                  ly = (sy1 + sy2) / 2
                } else if (isSkipLayer) {
                  const curveX = Math.max(x1, x2) + 84
                  d = `M ${x1} ${y1} C ${curveX} ${y1 + 40}, ${curveX} ${y2 - 40}, ${x2} ${y2 - 3}`
                  lx = (x1 + x2) / 2 + 52
                  ly = (y1 + y2) / 2
                } else {
                  d = `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2 - 3}`
                  const totalOut = outgoingEdgesCount.get(edge.from) ?? 1
                  const idxOut = outgoingEdgeIndex.get(edge.id) ?? 0
                  const t = totalOut > 1 ? 0.56 + (idxOut % 2 === 0 ? -0.08 : 0.08) : 0.5
                  lx = x1 + (x2 - x1) * t
                  ly = y1 + (y2 - y1) * t
                }
              } else {
                const x1 = from.x + from.width
                const y1 = from.y + from.height / 2
                const x2 = to.x
                const y2 = to.y + to.height / 2
                if (isBackEdge) {
                  const sideY = Math.max(from.y + from.height, to.y + to.height) + 46
                  const sx1 = from.x + from.width / 2
                  const sx2 = to.x + to.width / 2
                  d = `M ${sx1} ${from.y + from.height} C ${sx1} ${sideY}, ${sx2} ${sideY}, ${sx2} ${to.y + to.height + 4}`
                  lx = (sx1 + sx2) / 2
                  ly = sideY - 8
                } else if (isSkipLayer) {
                  const curveY = Math.min(y1, y2) - 68
                  d = `M ${x1} ${y1} C ${x1 + 40} ${curveY}, ${x2 - 40} ${curveY}, ${x2 - 3} ${y2}`
                  lx = (x1 + x2) / 2
                  ly = (y1 + y2) / 2 - 42
                } else {
                  d = `M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2 - 3} ${y2}`
                  const totalOut = outgoingEdgesCount.get(edge.from) ?? 1
                  const idxOut = outgoingEdgeIndex.get(edge.id) ?? 0
                  const t = totalOut > 1 ? 0.56 + (idxOut % 2 === 0 ? -0.08 : 0.08) : 0.5
                  lx = x1 + (x2 - x1) * t
                  ly = y1 + (y2 - y1) * t
                }
              }

              const isEdgeFocused =
                selectedFlowNodeId !== null &&
                (edge.from === selectedFlowNodeId || edge.to === selectedFlowNodeId)
              const isEdgeDimmed = selectedFlowNodeId !== null && !isEdgeFocused
              const labelWidth = edge.label ? Math.max(44, estimateTextPx(edge.label, 11) + 18) : 0

              return (
                <g key={edge.id} className={clsx(isEdgeDimmed && styles.dimmed)}>
                  <path
                    d={d}
                    className={clsx(
                      styles.edgePath,
                      edge.dashed && styles.edgeDashed,
                      isEdgeFocused && styles.edgeFocused
                    )}
                    markerEnd={
                      isEdgeFocused
                        ? 'url(#flow-arrow-brand)'
                        : edge.dashed
                          ? 'url(#flow-arrow-amber)'
                          : 'url(#flow-arrow)'
                    }
                  />
                  {edge.label ? (
                    <g transform={`translate(${lx}, ${ly})`}>
                      <rect
                        x={-labelWidth / 2}
                        y={-11}
                        width={labelWidth}
                        height={22}
                        rx={11}
                        className={styles.edgeLabelBg}
                      />
                      <text x={0} y={4} textAnchor="middle" className={styles.edgeLabelText}>
                        {edge.label}
                      </text>
                    </g>
                  ) : null}
                </g>
              )
            })}

            {/* 节点卡片 */}
            {layout.positioned.map(({ node }) => {
              const pos = nodeMap.get(node.id)
              if (!pos) {
                return null
              }
              const { x, y, width, height } = pos
              const effectiveStatus = flowStatusOverrides[node.id] ?? node.status
              const titleLines = wrapLines(node.label, 22, 4)
              const subLines = node.sublabel ? wrapLines(node.sublabel, 29, 4) : []
              const rx = node.kind === 'start' || node.kind === 'result' ? Math.min(28, height / 2) : 14
              const isSolved = effectiveStatus === 'solved'
              const isSelected = selectedFlowNodeId === node.id
              const isDimmed = connectedIds !== null && !connectedIds.has(node.id)
              const stepText = `步骤 ${node.stepIndex}`
              const badgeWidth = Math.max(48, estimateTextPx(stepText, 10) + 16)

              const cardClass = clsx(
                styles.nodeCard,
                node.kind === 'start' && styles.nodeStart,
                node.kind === 'decision' && styles.nodeDecision,
                node.kind === 'question' && !isSolved && styles.nodeQuestion,
                node.kind === 'grammar' && styles.nodeGrammar,
                node.kind === 'result' && styles.nodeResult,
                isSolved && node.kind !== 'result' && styles.nodeSolved,
                (highlighted.has(node.id) || isSelected) && styles.nodeHighlighted,
                isSelected && styles.nodeSelected
              )

              const titleStartY =
                subLines.length > 0
                  ? 26
                  : height / 2 - ((titleLines.length - 1) * 18) / 2 + 4

              return (
                <g
                  key={node.id}
                  transform={`translate(${x}, ${y})`}
                  className={clsx(styles.nodeGroup, isDimmed && styles.dimmed)}
                  onPointerDown={(event) => {
                    if (event.button !== 0) {
                      return
                    }
                    event.stopPropagation()
                    containerRefOrStageCapture(stageRef.current, event.pointerId)
                    const currentOff = nodeOffsets[node.id] ?? { dx: 0, dy: 0 }
                    dragRef.current = {
                      kind: 'node',
                      nodeId: node.id,
                      startX: event.clientX,
                      startY: event.clientY,
                      baseDx: currentOff.dx,
                      baseDy: currentOff.dy,
                      moved: false,
                    }
                  }}
                >
                  <g className={styles.nodeInner}>
                    <rect width={width} height={height} rx={rx} className={cardClass} />
                    {/* 决策节点左侧菱形标识 */}
                    {node.kind === 'decision' ? (
                      <text
                        x={12}
                        y={20}
                        fill="var(--dsw-static-amber-500)"
                        fontSize={12}
                        fontWeight={700}
                      >
                        ◇
                      </text>
                    ) : null}
                    {/* 左上角步骤徽章 */}
                    <rect
                      x={14}
                      y={-9}
                      width={badgeWidth}
                      height={18}
                      rx={9}
                      className={styles.stepBadgeBg}
                    />
                    <text
                      x={14 + badgeWidth / 2}
                      y={3}
                      textAnchor="middle"
                      className={styles.stepBadgeText}
                    >
                      {stepText}
                    </text>
                    {isSolved ? (
                      <text
                        x={width - 14}
                        y={18}
                        textAnchor="end"
                        fill="var(--dsw-static-green-500)"
                        fontSize={12}
                        fontWeight={700}
                      >
                        ✓
                      </text>
                    ) : node.kind === 'question' ? (
                      <text
                        x={width - 14}
                        y={18}
                        textAnchor="end"
                        fill="var(--dsw-static-amber-500)"
                        fontSize={12}
                        fontWeight={700}
                      >
                        ?
                      </text>
                    ) : null}
                    {titleLines.map((line, idx) => (
                      <text
                        key={idx}
                        x={width / 2}
                        y={titleStartY + idx * 18}
                        textAnchor="middle"
                        className={styles.nodeTitle}
                      >
                        {line}
                      </text>
                    ))}
                    {subLines.map((line, idx) => (
                      <text
                        key={idx}
                        x={width / 2}
                        y={titleStartY + titleLines.length * 18 + 3 + idx * 16}
                        textAnchor="middle"
                        className={styles.nodeSubtitle}
                      >
                        {line}
                      </text>
                    ))}
                  </g>
                </g>
              )
            })}
          </g>
        </svg>

        <div className={styles.hudTopLeft}>
          {flowchart.title ? <div className={styles.boardTitle}>{flowchart.title}</div> : null}
        </div>

        <div className={styles.hudTopRight}>
          <button
            type="button"
            className={styles.toolBtn}
            title="切换竖排 / 横排布局"
            onClick={() =>
              setFlowDirectionOverride(effectiveDirection === 'TD' ? 'LR' : 'TD')
            }
          >
            {effectiveDirection === 'TD' ? '⇅ 竖排' : '⇄ 横排'}
          </button>
          <button type="button" className={styles.zoomIconBtn} title="放大" onClick={() => zoomAt(1.18)}>
            +
          </button>
          <button
            type="button"
            className={styles.zoomIconBtn}
            title="缩小"
            onClick={() => zoomAt(1 / 1.18)}
          >
            −
          </button>
          <button
            type="button"
            className={styles.toolBtn}
            title="自适应居中显示全部节点"
            onClick={() => {
              if (hasCustomOffsets) {
                setNodeOffsets({})
              }
              fitToView()
            }}
          >
            {hasCustomOffsets ? '重排并适应' : '适应画面'}
          </button>
          <button
            type="button"
            className={styles.toolBtn}
            onClick={async () => {
              const ok = await copyText(toMermaidCode(flowchart, effectiveDirection))
              showToast(ok ? { key: 'copied' } : { key: 'copyFailed', type: 'error' })
            }}
          >
            复制 Mermaid
          </button>
        </div>
      </div>

      {/* 点击节点后展示完整内容与向 AI 追问 / 标记状态操作栏 */}
      {selectedNode ? (
        <div className={styles.inspector}>
          <div className={styles.inspectorBody}>
            <div className={styles.inspectorHeader}>
              <span className={styles.inspectorBadge}>步骤 {selectedNode.stepIndex}</span>
              <span className={styles.inspectorTitle}>{selectedNode.label}</span>
            </div>
            {selectedNode.sublabel ? (
              <div className={styles.inspectorSub}>{selectedNode.sublabel}</div>
            ) : null}
          </div>
          <div className={styles.inspectorActions}>
            {activeSessionId ? (
              <button
                type="button"
                className={styles.inspectorAskBtn}
                disabled={streaming}
                onClick={() => {
                  const prompt =
                    tutorMode && selectedNode.kind === 'question' && selectedStatus !== 'solved'
                      ? `针对流程图里的待推导节点「${selectedNode.label}」，请再给我一点引导提示或一起推进这一步。`
                      : `请详细展开讲讲流程图中的「${selectedNode.label}」这一步。`
                  sendQuickMessage(activeSessionId, prompt)
                }}
              >
                {tutorMode && selectedNode.kind === 'question' && selectedStatus !== 'solved'
                  ? '请 AI 引导此步'
                  : '追问此节点'}
              </button>
            ) : null}
            <button
              type="button"
              className={styles.inspectorBtn}
              onClick={() =>
                toggleFlowNodeStatusOverride(
                  selectedNode.id,
                  selectedStatus ?? selectedNode.status
                )
              }
            >
              {selectedStatus === 'solved' ? '标为待思考' : '标记已掌握 ✓'}
            </button>
            <button
              type="button"
              className={styles.inspectorBtn}
              onClick={async () => {
                const text = selectedNode.sublabel
                  ? `${selectedNode.label}\n${selectedNode.sublabel}`
                  : selectedNode.label
                const ok = await copyText(text)
                showToast(ok ? { key: 'copied' } : { key: 'copyFailed', type: 'error' })
              }}
            >
              复制
            </button>
            <button
              type="button"
              className={styles.inspectorCloseBtn}
              title="关闭节点详情"
              onClick={() => setSelectedFlowNodeId(null)}
            >
              ✕
            </button>
          </div>
        </div>
      ) : null}

      <div className={styles.legendBar}>
        <div className={styles.legendItems}>
          <span className={styles.legendItem}>
            <span
              className={styles.legendDot}
              style={{ backgroundColor: 'var(--dsw-static-amber-500)' }}
            />
            待推导（？）
          </span>
          <span className={styles.legendItem}>
            <span
              className={styles.legendDot}
              style={{ backgroundColor: 'var(--dsw-static-green-500)' }}
            />
            已解锁结论（✓）
          </span>
          <span className={styles.legendItem}>
            <span
              className={styles.legendDot}
              style={{ backgroundColor: 'var(--dsw-alias-brand-primary)' }}
            />
            点击节点可看全文/追问 · 支持拖拽调位
          </span>
        </div>
        <span>共 {flowchart.nodes.length} 个节点</span>
      </div>
    </div>
  )
}

function containerRefOrStageCapture(el: HTMLDivElement | null, pointerId: number) {
  try {
    el?.setPointerCapture(pointerId)
  } catch {
    // 忽略不支持 pointer capture 的合成事件
  }
}
