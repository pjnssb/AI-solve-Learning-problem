import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import {
  closeCanvasPanel,
  getCurrentCanvasBoard,
  selectCanvasStep,
  setCanvasTab,
  setCanvasWidth,
  setMobileHeightPercent,
  toggleMobileFullscreen,
  useCanvasStore,
} from '../../services/tutor/canvasStore.js'
import { IconCloseOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { CoordinateCanvas } from './CoordinateCanvas.js'
import { FlowchartCanvas } from './FlowchartCanvas.js'
import styles from './TutorCanvasPanel.module.css'

const useIsNarrowSplit = () => {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 900 : false
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 899px)')
    const update = () => setNarrow(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return narrow
}

/** 将当前主题的 CSS 变量与画板类样式内联进导出的 SVG，确保离线打开依然清晰美观 */
const serializeStyledSvg = (svg: SVGSVGElement): string => {
  const clone = svg.cloneNode(true) as SVGSVGElement
  const computed = getComputedStyle(document.body)
  const bgBase = computed.getPropertyValue('--dsw-alias-bg-base').trim() || '#ffffff'
  const textPrimary = computed.getPropertyValue('--dsw-alias-label-primary').trim() || '#0f172a'
  const textSecondary = computed.getPropertyValue('--dsw-alias-label-secondary').trim() || '#475569'
  const textTertiary = computed.getPropertyValue('--dsw-alias-label-tertiary').trim() || '#94a3b8'
  const borderL2 = computed.getPropertyValue('--dsw-alias-border-l2').trim() || '#e2e8f0'
  const brandPrimary = computed.getPropertyValue('--dsw-alias-brand-primary').trim() || '#3964fe'
  const amber = computed.getPropertyValue('--dsw-static-amber-500').trim() || '#f59e0b'
  const green = computed.getPropertyValue('--dsw-static-green-500').trim() || '#22c55e'
  const layer2 = computed.getPropertyValue('--dsw-alias-bg-layer-2').trim() || '#ffffff'

  const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  styleEl.textContent = `
    svg {
      background: ${bgBase};
      --dsw-alias-bg-base: ${bgBase};
      --dsw-alias-bg-layer-2: ${layer2};
      --dsw-alias-label-primary: ${textPrimary};
      --dsw-alias-label-secondary: ${textSecondary};
      --dsw-alias-label-tertiary: ${textTertiary};
      --dsw-alias-border-l2: ${borderL2};
      --dsw-alias-border-l3: ${borderL2};
      --dsw-alias-brand-primary: ${brandPrimary};
      --dsw-static-amber-500: ${amber};
      --dsw-static-amber-400: ${amber};
      --dsw-static-green-500: ${green};
      --dsw-font-family: system-ui, -apple-system, sans-serif;
    }
  `
  clone.insertBefore(styleEl, clone.firstChild)

  // 将 CSS Module 类名涉及的关键 computed style 内联固化，避免脱离页面样式表后失效
  const srcNodes = svg.querySelectorAll('*')
  const dstNodes = clone.querySelectorAll('*')
  srcNodes.forEach((src, i) => {
    const dst = dstNodes[i]
    if (!dst) {
      return
    }
    const cs = getComputedStyle(src)
    const tag = src.tagName.toLowerCase()
    if (tag === 'line' || tag === 'path' || tag === 'circle' || tag === 'polygon' || tag === 'polyline' || tag === 'rect') {
      if (cs.fill && cs.fill !== 'none') {
        dst.setAttribute('fill', cs.fill)
      }
      if (cs.stroke && cs.stroke !== 'none') {
        dst.setAttribute('stroke', cs.stroke)
      }
      if (cs.strokeWidth) {
        dst.setAttribute('stroke-width', cs.strokeWidth)
      }
      if (cs.strokeDasharray && cs.strokeDasharray !== 'none') {
        dst.setAttribute('stroke-dasharray', cs.strokeDasharray)
      }
      if (cs.opacity && cs.opacity !== '1') {
        dst.setAttribute('opacity', cs.opacity)
      }
    } else if (tag === 'text') {
      if (cs.fill) {
        dst.setAttribute('fill', cs.fill)
      }
      if (cs.fontSize) {
        dst.setAttribute('font-size', cs.fontSize)
      }
      if (cs.fontWeight) {
        dst.setAttribute('font-weight', cs.fontWeight)
      }
      if (cs.fontFamily) {
        dst.setAttribute('font-family', cs.fontFamily)
      }
      if (cs.stroke && cs.stroke !== 'none') {
        dst.setAttribute('stroke', cs.stroke)
        dst.setAttribute('stroke-width', cs.strokeWidth)
        dst.setAttribute('paint-order', cs.paintOrder || 'stroke')
      }
    }
  })

  return new XMLSerializer().serializeToString(clone)
}

/**
 * 交互式教学画板：
 * - 桌面端：右侧分屏，支持左右拖拽调宽；
 * - 手机端：上方实时分屏，下方保留完整对话与输入框，支持拖动底部横条自由调节上下比例，也支持一键全屏。
 */
export const TutorCanvasPanel = () => {
  const open = useCanvasStore((state) => state.open)
  const width = useCanvasStore((state) => state.width)
  const mobileHeightPercent = useCanvasStore((state) => state.mobileHeightPercent)
  const mobileFullscreen = useCanvasStore((state) => state.mobileFullscreen)
  const activeTab = useCanvasStore((state) => state.activeTab)
  const selectedStep = useCanvasStore((state) => state.selectedStep)
  const steps = useCanvasStore((state) => state.steps)
  const board = useCanvasStore(getCurrentCanvasBoard)

  const isNarrow = useIsNarrowSplit()
  const [resizing, setResizing] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)

  if (!open) {
    return null
  }

  const latestStepNumber = steps.at(-1)?.stepNumber ?? null
  const activeStepNumber = selectedStep ?? latestStepNumber
  const activeStepIndex = steps.findIndex((s) => s.stepNumber === activeStepNumber)

  const exportSvg = () => {
    const svg = svgRef.current
    if (!svg) {
      return
    }
    const serialized = serializeStyledSvg(svg)
    const blob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = activeTab === 'coordinate' ? 'coordinate-board.svg' : 'flowchart-board.svg'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  const startDesktopResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    setResizing(true)
    const startX = event.clientX
    const startWidth = width
    const onMove = (moveEvent: PointerEvent) => {
      const maxWidth = Math.min(920, Math.floor(window.innerWidth * 0.65))
      const next = Math.max(340, Math.min(maxWidth, startWidth + (startX - moveEvent.clientX)))
      setCanvasWidth(next)
    }
    const onUp = () => {
      setResizing(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const startMobileResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    setResizing(true)
    const startY = event.clientY
    const startPercent = mobileHeightPercent
    const vh = Math.max(320, window.innerHeight)
    const onMove = (moveEvent: PointerEvent) => {
      const deltaPercent = ((moveEvent.clientY - startY) / vh) * 100
      setMobileHeightPercent(startPercent + deltaPercent)
    }
    const onUp = () => {
      setResizing(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const panelStyle = isNarrow
    ? mobileFullscreen
      ? undefined
      : { height: `${mobileHeightPercent}%` }
    : { width }

  return (
    <aside
      className={clsx(styles.panel, isNarrow && mobileFullscreen && styles.panelMobileFullscreen)}
      style={panelStyle}
    >
      <div
        className={clsx(styles.resizer, resizing && styles.resizerActive)}
        title="拖动调整画板宽度"
        onPointerDown={startDesktopResize}
      />
      <div className={styles.header}>
        <div className={styles.tabs} role="tablist" aria-label="教学画板切换">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'coordinate'}
            className={clsx(styles.tab, activeTab === 'coordinate' && styles.tabActive)}
            onClick={() => setCanvasTab('coordinate')}
          >
            {isNarrow ? '坐标系' : '坐标系画板'}
            {board.hasCoordinate ? <span className={styles.tabDot} /> : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'flowchart'}
            className={clsx(styles.tab, activeTab === 'flowchart' && styles.tabActive)}
            onClick={() => setCanvasTab('flowchart')}
          >
            {isNarrow ? '流程图' : '思维流程图'}
            {board.hasFlowchart ? <span className={styles.tabDot} /> : null}
          </button>
        </div>

        <div className={styles.headerActions}>
          {(activeTab === 'coordinate' && board.hasCoordinate) ||
          (activeTab === 'flowchart' && board.hasFlowchart) ? (
            <button
              type="button"
              className={clsx(styles.exportBtn, styles.exportSvgDesktop)}
              onClick={exportSvg}
            >
              导出 SVG
            </button>
          ) : null}
          <button
            type="button"
            className={clsx(styles.exportBtn, styles.mobileFullscreenBtn)}
            onClick={toggleMobileFullscreen}
          >
            {mobileFullscreen ? '分屏' : '全屏'}
          </button>
          <IconButton icon={<IconCloseOutline16 />} tooltip="收起画板" onClick={closeCanvasPanel} />
        </div>
      </div>

      {/* 步骤时间轴回放条：支持上一步 / 下一步与任意历史步点击回放 */}
      {steps.length > 0 ? (
        <div className={styles.stepBar}>
          <span className={styles.stepLabel}>分步</span>
          {steps.length > 1 ? (
            <div className={styles.stepNavGroup}>
              <button
                type="button"
                className={styles.stepNavBtn}
                title="上一步"
                disabled={activeStepIndex <= 0}
                onClick={() => {
                  const prevStep = steps[activeStepIndex - 1]
                  if (prevStep) {
                    selectCanvasStep(prevStep.stepNumber)
                  }
                }}
              >
                ‹
              </button>
              <button
                type="button"
                className={styles.stepNavBtn}
                title="下一步"
                disabled={activeStepIndex === -1 || activeStepIndex >= steps.length - 1}
                onClick={() => {
                  const nextStep = steps[activeStepIndex + 1]
                  if (nextStep) {
                    selectCanvasStep(
                      nextStep.stepNumber === latestStepNumber ? null : nextStep.stepNumber
                    )
                  }
                }}
              >
                ›
              </button>
            </div>
          ) : null}
          {steps.map((step) => {
            const isCurrent = activeStepNumber === step.stepNumber
            const isLatest = step.stepNumber === latestStepNumber
            return (
              <button
                key={step.stepNumber}
                type="button"
                title={step.title}
                className={clsx(styles.stepPill, isCurrent && styles.stepPillActive)}
                onClick={() => selectCanvasStep(isLatest ? null : step.stepNumber)}
              >
                <span
                  className={clsx(
                    styles.stepModeDot,
                    step.mode === 'flowchart' ? styles.stepModeFlow : styles.stepModeCoord
                  )}
                />
                第 {step.stepNumber} 步{isLatest ? ' · 当前' : ''}
              </button>
            )
          })}
        </div>
      ) : null}

      <div className={styles.body}>
        {activeTab === 'coordinate' ? (
          <CoordinateCanvas
            coordinate={board.coordinate}
            hasContent={board.hasCoordinate}
            svgRef={svgRef}
          />
        ) : (
          <FlowchartCanvas
            flowchart={board.flowchart}
            hasContent={board.hasFlowchart}
            svgRef={svgRef}
          />
        )}
      </div>

      {/* 移动端底部可拖拽分割条：上下拖动即可自由调整画板与对话区域的高度比例 */}
      {!mobileFullscreen ? (
        <div
          className={clsx(styles.mobileHandle, resizing && styles.mobileHandleActive)}
          title="上下拖动调节画板高度"
          onPointerDown={startMobileResize}
        >
          <span className={styles.mobileHandleBar} />
        </div>
      ) : null}
    </aside>
  )
}
