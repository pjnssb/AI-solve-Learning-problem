import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { copyText } from '../../utils/clipboard.js'
import { showToast } from '../base/toastState.js'
import type { FlowchartState, FlowNode } from '../../services/tutor/types.js'
import styles from './FlowchartCanvas.module.css'

type PositionedNode = {
  node: FlowNode
  x: number
  y: number
  width: number
  height: number
}

const NODE_WIDTH = 248
const NODE_HEIGHT_COMPACT = 60
const NODE_HEIGHT_SUB = 78
const GAP_X = 44
const GAP_Y = 58

const wrapLines = (text: string, maxChars: number, maxLines: number): string[] => {
  const lines: string[] = []
  let current = ''
  let widthCount = 0
  for (const ch of text) {
    const chWidth = ch.charCodeAt(0) > 255 ? 1.8 : 1
    if (widthCount + chWidth > maxChars && current) {
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

/** 轻量级分层拓扑布局：按节点边关系自动排布层级并居中对齐，适合渐进式增长的流程图 */
const computeFlowLayout = (flowchart: FlowchartState) => {
  const { nodes, edges, direction } = flowchart
  if (nodes.length === 0) {
    return { positioned: [] as PositionedNode[], bounds: { width: 400, height: 300 } }
  }

  const incoming = new Map<string, number>()
  const outgoing = new Map<string, string[]>()
  for (const node of nodes) {
    incoming.set(node.id, 0)
    outgoing.set(node.id, [])
  }
  for (const edge of edges) {
    if (incoming.has(edge.to) && outgoing.has(edge.from)) {
      incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1)
      outgoing.get(edge.from)?.push(edge.to)
    }
  }

  // BFS 计算每个节点所在层级
  const depth = new Map<string, number>()
  const queue: string[] = []
  for (const node of nodes) {
    if ((incoming.get(node.id) ?? 0) === 0) {
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
    for (const next of outgoing.get(curr) ?? []) {
      const existing = depth.get(next)
      if (existing === undefined || existing < currDepth + 1) {
        if (currDepth + 1 <= nodes.length) {
          depth.set(next, currDepth + 1)
          queue.push(next)
        }
      }
    }
  }

  // 尚未连通的孤立节点顺延到底部
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
  const positioned: PositionedNode[] = []

  if (direction === 'TD') {
    let cursorY = 56
    let maxRowWidth = NODE_WIDTH
    for (const layerKey of sortedLayerKeys) {
      const row = layers.get(layerKey) ?? []
      const rowWidth = row.length * NODE_WIDTH + Math.max(0, row.length - 1) * GAP_X
      maxRowWidth = Math.max(maxRowWidth, rowWidth)
    }
    const centerX = maxRowWidth / 2 + 48
    for (const layerKey of sortedLayerKeys) {
      const row = layers.get(layerKey) ?? []
      const rowWidth = row.length * NODE_WIDTH + Math.max(0, row.length - 1) * GAP_X
      const rowHeight = Math.max(
        ...row.map((n) => (n.sublabel ? NODE_HEIGHT_SUB : NODE_HEIGHT_COMPACT))
      )
      const startX = centerX - rowWidth / 2
      row.forEach((node, idx) => {
        const h = node.sublabel ? NODE_HEIGHT_SUB : NODE_HEIGHT_COMPACT
        positioned.push({
          node,
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
      bounds: { width: maxRowWidth + 96, height: Math.max(260, cursorY + 32) },
    }
  }

  // LR 横向布局
  let cursorX = 48
  let maxColHeight = NODE_HEIGHT_SUB
  for (const layerKey of sortedLayerKeys) {
    const col = layers.get(layerKey) ?? []
    const colHeight =
      col.reduce((acc, n) => acc + (n.sublabel ? NODE_HEIGHT_SUB : NODE_HEIGHT_COMPACT), 0) +
      Math.max(0, col.length - 1) * 32
    maxColHeight = Math.max(maxColHeight, colHeight)
  }
  const centerY = maxColHeight / 2 + 56
  for (const layerKey of sortedLayerKeys) {
    const col = layers.get(layerKey) ?? []
    const colHeight =
      col.reduce((acc, n) => acc + (n.sublabel ? NODE_HEIGHT_SUB : NODE_HEIGHT_COMPACT), 0) +
      Math.max(0, col.length - 1) * 32
    let y = centerY - colHeight / 2
    for (const node of col) {
      const h = node.sublabel ? NODE_HEIGHT_SUB : NODE_HEIGHT_COMPACT
      positioned.push({ node, x: cursorX, y, width: NODE_WIDTH, height: h })
      y += h + 32
    }
    cursorX += NODE_WIDTH + 68
  }
  return {
    positioned,
    bounds: { width: Math.max(360, cursorX + 40), height: maxColHeight + 112 },
  }
}

const toMermaidCode = (flowchart: FlowchartState): string => {
  const lines = [`flowchart ${flowchart.direction}`]
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
  const stageRef = useRef<HTMLDivElement>(null)
  const [stageSize, setStageSize] = useState({ width: 520, height: 420 })
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [dragging, setDragging] = useState(false)
  const dragOrigin = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(
    null
  )

  const layout = useMemo(() => computeFlowLayout(flowchart), [flowchart])
  const nodeMap = useMemo(
    () => new Map(layout.positioned.map((item) => [item.node.id, item])),
    [layout.positioned]
  )

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
  }, [])

  // 每次新增节点或方向变更时自动居中适配画布，体验丝滑
  const fitToView = () => {
    const scaleX = (stageSize.width - 36) / Math.max(1, layout.bounds.width)
    const scaleY = (stageSize.height - 64) / Math.max(1, layout.bounds.height)
    const nextZoom = Math.max(0.55, Math.min(1.08, Math.min(scaleX, scaleY)))
    setZoom(nextZoom)
    setPan({
      x: (stageSize.width - layout.bounds.width * nextZoom) / 2,
      y: Math.max(20, (stageSize.height - layout.bounds.height * nextZoom) / 2),
    })
  }

  useEffect(() => {
    fitToView()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowchart.nodes.length, flowchart.direction, stageSize.width, stageSize.height])

  if (!hasContent) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          <div className={styles.emptyTitle}>渐进式思维流程图画板</div>
          <div className={styles.emptyDesc}>
            遇到英语长难句拆解、逻辑分类讨论或解题思路梳理时，AI
            会随你的每一步回答逐个生长出流程节点，绝不一口气画完。
          </div>
        </div>
      </div>
    )
  }

  const highlighted = new Set(flowchart.highlightedIds)

  return (
    <div className={styles.container}>
      <div
        ref={stageRef}
        className={clsx(styles.stage, dragging && styles.stageDragging)}
        onWheel={(event) => {
          event.preventDefault()
          const factor = event.deltaY > 0 ? 0.92 : 1.09
          setZoom((prev) => Math.max(0.4, Math.min(2.2, prev * factor)))
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          setDragging(true)
          dragOrigin.current = {
            startX: event.clientX,
            startY: event.clientY,
            panX: pan.x,
            panY: pan.y,
          }
        }}
        onPointerMove={(event) => {
          const origin = dragOrigin.current
          if (!origin) {
            return
          }
          setPan({
            x: origin.panX + (event.clientX - origin.startX),
            y: origin.panY + (event.clientY - origin.startY),
          })
        }}
        onPointerUp={() => {
          dragOrigin.current = null
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
          </defs>

          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {/* 边连接线 */}
            {flowchart.edges.map((edge) => {
              const from = nodeMap.get(edge.from)
              const to = nodeMap.get(edge.to)
              if (!from || !to) {
                return null
              }
              const isTD = flowchart.direction === 'TD'
              const x1 = isTD ? from.x + from.width / 2 : from.x + from.width
              const y1 = isTD ? from.y + from.height : from.y + from.height / 2
              const x2 = isTD ? to.x + to.width / 2 : to.x
              const y2 = isTD ? to.y : to.y + to.height / 2
              const d = isTD
                ? `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2 - 3}`
                : `M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2 - 3} ${y2}`
              const mx = (x1 + x2) / 2
              const my = (y1 + y2) / 2
              const labelWidth = edge.label ? Math.min(180, edge.label.length * 10 + 18) : 0
              return (
                <g key={edge.id}>
                  <path
                    d={d}
                    className={clsx(styles.edgePath, edge.dashed && styles.edgeDashed)}
                    markerEnd={edge.dashed ? 'url(#flow-arrow-amber)' : 'url(#flow-arrow)'}
                  />
                  {edge.label ? (
                    <g transform={`translate(${mx}, ${my})`}>
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
            {layout.positioned.map(({ node, x, y, width, height }) => {
              const titleLines = wrapLines(node.label, 25, 2)
              const subLines = node.sublabel ? wrapLines(node.sublabel, 30, 2) : []
              const rx = node.kind === 'start' || node.kind === 'result' ? height / 2 : 14
              const isSolved = node.status === 'solved'
              const cardClass = clsx(
                styles.nodeCard,
                node.kind === 'start' && styles.nodeStart,
                node.kind === 'decision' && styles.nodeDecision,
                node.kind === 'question' && !isSolved && styles.nodeQuestion,
                node.kind === 'grammar' && styles.nodeGrammar,
                node.kind === 'result' && styles.nodeResult,
                isSolved && node.kind !== 'result' && styles.nodeSolved,
                highlighted.has(node.id) && styles.nodeHighlighted
              )
              return (
                <g key={node.id} transform={`translate(${x}, ${y})`} className={styles.nodeGroup}>
                  <rect width={width} height={height} rx={rx} className={cardClass} />
                  {/* 左上角步骤徽章 */}
                  <rect
                    x={12}
                    y={-9}
                    width={48}
                    height={18}
                    rx={9}
                    className={styles.stepBadgeBg}
                  />
                  <text x={36} y={3} textAnchor="middle" className={styles.stepBadgeText}>
                    步骤 {node.stepIndex}
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
                      y={
                        (subLines.length > 0 ? 26 : height / 2 - (titleLines.length - 1) * 7 + 4) +
                        idx * 17
                      }
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
                      y={26 + titleLines.length * 17 + 4 + idx * 15}
                      textAnchor="middle"
                      className={styles.nodeSubtitle}
                    >
                      {line}
                    </text>
                  ))}
                </g>
              )
            })}
          </g>
        </svg>

        <div className={styles.hudTopLeft}>
          {flowchart.title ? <div className={styles.boardTitle}>{flowchart.title}</div> : null}
        </div>

        <div className={styles.hudTopRight}>
          <button type="button" className={styles.toolBtn} onClick={fitToView}>
            适应画面
          </button>
          <button
            type="button"
            className={styles.toolBtn}
            onClick={async () => {
              const ok = await copyText(toMermaidCode(flowchart))
              showToast(ok ? { key: 'copied' } : { key: 'copyFailed', type: 'error' })
            }}
          >
            复制 Mermaid
          </button>
        </div>
      </div>

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
            核心步骤 / 语法结构
          </span>
        </div>
        <span>共 {flowchart.nodes.length} 个节点</span>
      </div>
    </div>
  )
}
