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

  const exportSvg = () => {
    const svg = svgRef.current
    if (!svg) {
      return
    }
    const serialized = new XMLSerializer().serializeToString(svg)
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

      {/* 步骤时间轴回放条：直观回看 AI 每一步的作图增量 */}
      {steps.length > 0 ? (
        <div className={styles.stepBar}>
          <span className={styles.stepLabel}>分步</span>
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
