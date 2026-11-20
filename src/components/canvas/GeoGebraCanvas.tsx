import { useEffect, useId, useRef, useState } from 'react'
import {
  loadGeoGebraScript,
  syncCoordinateToGeoGebra,
  type GeoGebraAppletApi,
} from '../../services/tutor/geogebraAdapter.js'
import type { CoordinateState } from '../../services/tutor/types.js'
import styles from './GeoGebraCanvas.module.css'

/**
 * 官方 GeoGebra 绘图计算器嵌入组件：
 * - 通过 GeoGebra Apps JS API (deployggb.js) 加载完整 GeoGebra Graphing 引擎
 * - 自动将 AI Agent 每一步发出的点、函数、动点滑块与辅助线同步翻译为 GeoGebra 指令
 * - 底部提供 GeoGebra 原生命令行输入框与动点动画一键启停
 */
export const GeoGebraCanvas = ({
  coordinate,
  hasContent,
  onFallbackNative,
}: {
  coordinate: CoordinateState
  hasContent: boolean
  onFallbackNative: () => void
}) => {
  const reactId = useId().replace(/[^a-zA-Z0-9]/g, '')
  const elementId = `ggb-tutor-${reactId}`
  const hostRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<GeoGebraAppletApi | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [cmdInput, setCmdInput] = useState('')
  const [animating, setAnimating] = useState(false)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setErrorMessage('')

    void loadGeoGebraScript()
      .then((GGBApplet) => {
        if (cancelled || !hostRef.current) {
          return
        }
        const rect = hostRef.current.getBoundingClientRect()
        const width = Math.max(340, Math.floor(rect.width || 520))
        const height = Math.max(300, Math.floor(rect.height || 420))
        const applet = new GGBApplet(
          {
            id: `ggbApi_${reactId}`,
            appName: 'graphing',
            width,
            height,
            showToolBar: true,
            showAlgebraInput: false,
            showMenuBar: false,
            showResetIcon: true,
            enableShiftDragZoom: true,
            enableRightClick: true,
            borderColor: 'transparent',
            language: 'zh-CN',
            appletOnLoad: (api: GeoGebraAppletApi) => {
              if (cancelled) {
                return
              }
              apiRef.current = api
              setStatus('ready')
            },
          },
          true
        )
        applet.inject(elementId)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStatus('error')
          setErrorMessage(error instanceof Error ? error.message : 'GeoGebra 引擎加载失败')
        }
      })

    return () => {
      cancelled = true
      apiRef.current = null
    }
  }, [elementId, reactId])

  // 当容器宽高度变化时同步 GeoGebra 画布尺寸
  useEffect(() => {
    const el = hostRef.current
    if (!el) {
      return
    }
    const observer = new ResizeObserver(() => {
      const api = apiRef.current
      if (!api) {
        return
      }
      const rect = el.getBoundingClientRect()
      if (rect.width > 100 && rect.height > 100) {
        api.setSize(Math.floor(rect.width), Math.floor(rect.height))
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // 每当 AI Agent 执行新的坐标系工具步骤，自动增量同步到 GeoGebra
  useEffect(() => {
    const api = apiRef.current
    if (status !== 'ready' || !api || !hasContent) {
      return
    }
    syncCoordinateToGeoGebra(api, coordinate)
    setAnimating(false)
  }, [status, hasContent, coordinate])

  const runCommand = () => {
    const api = apiRef.current
    const cmd = cmdInput.trim()
    if (!api || !cmd) {
      return
    }
    api.evalCommand(cmd)
    setCmdInput('')
  }

  const toggleAnimation = () => {
    const api = apiRef.current
    if (!api) {
      return
    }
    if (animating) {
      api.stopAnimation()
      setAnimating(false)
    } else {
      for (const mp of coordinate.movingPoints) {
        const sliderName = `t_${mp.id.replace(/[^a-zA-Z0-9_]/g, '_')}`
        api.setAnimating(sliderName, true)
      }
      api.startAnimation()
      setAnimating(true)
    }
  }

  return (
    <div className={styles.container}>
      <div ref={hostRef} className={styles.appletHost}>
        <div id={elementId} />
      </div>

      {status === 'loading' ? (
        <div className={styles.statusOverlay}>
          <div>正在加载 GeoGebra 官方交互引擎...</div>
          <button type="button" className={styles.fallbackBtn} onClick={onFallbackNative}>
            先使用内置极速坐标引擎
          </button>
        </div>
      ) : null}

      {status === 'error' ? (
        <div className={styles.statusOverlay}>
          <div>{errorMessage}</div>
          <button type="button" className={styles.fallbackBtn} onClick={onFallbackNative}>
            切换回内置极速坐标引擎
          </button>
        </div>
      ) : null}

      {status === 'ready' ? (
        <div className={styles.commandBar}>
          {coordinate.movingPoints.length > 0 ? (
            <button type="button" className={styles.actionBtn} onClick={toggleAnimation}>
              {animating ? '⏸ 暂停动点' : '▶ 播放动点'}
            </button>
          ) : null}
          <input
            type="text"
            className={styles.commandInput}
            placeholder="输入 GeoGebra 指令，如 PerpendicularLine(P, xAxis)"
            value={cmdInput}
            onChange={(event) => setCmdInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                runCommand()
              }
            }}
          />
          <button type="button" className={styles.actionBtn} onClick={runCommand}>
            执行
          </button>
        </div>
      ) : null}
    </div>
  )
}
