import clsx from 'clsx'
import { useRef, useState } from 'react'
import {
  closeCanvasPanel,
  getCurrentCanvasBoard,
  selectCanvasStep,
  setCanvasTab,
  setCanvasWidth,
  setCoordEngine,
  useCanvasStore,
} from '../../services/tutor/canvasStore.js'
import { IconCloseOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { CoordinateCanvas } from './CoordinateCanvas.js'
import { FlowchartCanvas } from './FlowchartCanvas.js'
import { GeoGebraCanvas } from './GeoGebraCanvas.js'
import styles from './TutorCanvasPanel.module.css'

/** 右侧交互式教学画板：支持拖拽调宽、坐标系（内置极速 / GeoGebra 双引擎）/流程图一键切换、步骤时间轴回放与 SVG 导出 */
export const TutorCanvasPanel = () => {
  const open = useCanvasStore((state) => state.open)
  const width = useCanvasStore((state) => state.width)
  const activeTab = useCanvasStore((state) => state.activeTab)
  const coordEngine = useCanvasStore((state) => state.coordEngine)
  const selectedStep = useCanvasStore((state) => state.selectedStep)
  const steps = useCanvasStore((state) => state.steps)
  const board = useCanvasStore(getCurrentCanvasBoard)

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

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
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

  return (
    <aside className={styles.panel} style={{ width }}>
      <div
        className={clsx(styles.resizer, resizing && styles.resizerActive)}
        title="拖动调整画板宽度"
        onPointerDown={startResize}
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
            坐标系画板
            {board.hasCoordinate ? <span className={styles.tabDot} /> : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'flowchart'}
            className={clsx(styles.tab, activeTab === 'flowchart' && styles.tabActive)}
            onClick={() => setCanvasTab('flowchart')}
          >
            思维流程图
            {board.hasFlowchart ? <span className={styles.tabDot} /> : null}
          </button>
        </div>

        <div className={styles.headerActions}>
          {activeTab === 'coordinate' ? (
            <button
              type="button"
              className={clsx(styles.exportBtn, coordEngine === 'geogebra' && styles.engineActive)}
              title="在内置极速坐标引擎与官方 GeoGebra 引擎之间切换"
              onClick={() => setCoordEngine(coordEngine === 'native' ? 'geogebra' : 'native')}
            >
              {coordEngine === 'geogebra' ? 'GeoGebra ✓' : '切至 GeoGebra'}
            </button>
          ) : null}
          {(activeTab === 'coordinate' && coordEngine === 'native' && board.hasCoordinate) ||
          (activeTab === 'flowchart' && board.hasFlowchart) ? (
            <button type="button" className={styles.exportBtn} onClick={exportSvg}>
              导出 SVG
            </button>
          ) : null}
          <IconButton icon={<IconCloseOutline16 />} tooltip="收起画板" onClick={closeCanvasPanel} />
        </div>
      </div>

      {/* 步骤时间轴回放条：直观回看 AI 每一步的作图增量 */}
      {steps.length > 0 ? (
        <div className={styles.stepBar}>
          <span className={styles.stepLabel}>分步回放</span>
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
          coordEngine === 'geogebra' ? (
            <GeoGebraCanvas
              coordinate={board.coordinate}
              hasContent={board.hasCoordinate}
              onFallbackNative={() => setCoordEngine('native')}
            />
          ) : (
            <CoordinateCanvas
              coordinate={board.coordinate}
              hasContent={board.hasCoordinate}
              svgRef={svgRef}
            />
          )
        ) : (
          <FlowchartCanvas
            flowchart={board.flowchart}
            hasContent={board.hasFlowchart}
            svgRef={svgRef}
          />
        )}
      </div>
    </aside>
  )
}
