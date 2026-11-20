import type { CoordinateState } from './types.js'

/** GeoGebra JS API 最小类型定义（遵循 official geogebra/integration 规范） */
export type GeoGebraAppletApi = {
  reset: () => void
  evalCommand: (cmd: string) => boolean
  setCoordSystem: (xmin: number, xmax: number, ymin: number, ymax: number) => void
  setGridVisible: (visible: boolean) => void
  setAxesVisible: (xVisible: boolean, yVisible: boolean) => void
  setColor: (objName: string, r: number, g: number, b: number) => void
  setLineStyle: (objName: string, style: number) => void
  setLineThickness: (objName: string, thickness: number) => void
  setLabelVisible: (objName: string, visible: boolean) => void
  setCaption: (objName: string, caption: string) => void
  setLabelStyle: (objName: string, style: number) => void
  setValue: (objName: string, value: number) => void
  setAnimating: (objName: string, animate: boolean) => void
  startAnimation: () => void
  stopAnimation: () => void
  isAnimationRunning: () => boolean
  setSize: (width: number, height: number) => void
}

type GGBAppletConstructor = new (
  params: Record<string, unknown>,
  preferHtml5?: boolean
) => {
  inject: (elementId: string) => void
}

declare global {
  interface Window {
    GGBApplet?: GGBAppletConstructor
  }
}

const DEPLOY_GGB_URL = 'https://www.geogebra.org/apps/deployggb.js'
let loadPromise: Promise<GGBAppletConstructor> | null = null

/** 按需动态加载 GeoGebra 官方 deployggb.js 脚本 */
export const loadGeoGebraScript = (): Promise<GGBAppletConstructor> => {
  if (window.GGBApplet) {
    return Promise.resolve(window.GGBApplet)
  }
  if (loadPromise) {
    return loadPromise
  }
  loadPromise = new Promise<GGBAppletConstructor>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = DEPLOY_GGB_URL
    script.async = true
    script.onload = () => {
      if (window.GGBApplet) {
        resolve(window.GGBApplet)
      } else {
        loadPromise = null
        reject(new Error('GeoGebra 脚本已加载，但未暴露 GGBApplet 对象'))
      }
    }
    script.onerror = () => {
      loadPromise = null
      reject(new Error('无法连接 geogebra.org 加载 GeoGebra 引擎，请检查网络或切换至内置极速引擎'))
    }
    document.head.appendChild(script)
  })
  return loadPromise
}

/** 将颜色十六进制字符串转为 RGB 数组 */
const hexToRgb = (hex: string): [number, number, number] => {
  const clean = hex.replace('#', '').trim()
  if (clean.length === 6) {
    const r = Number.parseInt(clean.slice(0, 2), 16)
    const g = Number.parseInt(clean.slice(2, 4), 16)
    const b = Number.parseInt(clean.slice(4, 6), 16)
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      return [r, g, b]
    }
  }
  return [57, 100, 254]
}

/** 规范化 GeoGebra 合法标识符（只保留字母数字和下划线） */
const ggbId = (raw: string): string => {
  const sanitized = raw.replace(/[^a-zA-Z0-9_]/g, '_')
  return /^[a-zA-Z]/.test(sanitized) ? sanitized : `g_${sanitized}`
}

/**
 * 将当前 Agent 步骤的 CoordinateState 全量同步到 GeoGebra 实例，
 * 支持固定点、函数图像、可拖动动点滑块、动态线段/多边形、以及随动点实时联动的虚线辅助线！
 */
export const syncCoordinateToGeoGebra = (api: GeoGebraAppletApi, coord: CoordinateState) => {
  api.reset()
  api.setAxesVisible(true, true)
  api.setGridVisible(coord.showGrid)
  api.setCoordSystem(
    coord.viewport.xMin,
    coord.viewport.xMax,
    coord.viewport.yMin,
    coord.viewport.yMax
  )

  const idMap = new Map<string, string>()
  const register = (rawId: string): string => {
    const existing = idMap.get(rawId)
    if (existing) {
      return existing
    }
    const mapped = ggbId(rawId)
    idMap.set(rawId, mapped)
    return mapped
  }

  // 1. 固定点
  for (const pt of coord.points) {
    const name = register(pt.id)
    api.evalCommand(`${name} = (${pt.x}, ${pt.y})`)
    const [r, g, b] = hexToRgb(pt.color)
    api.setColor(name, r, g, b)
    if (pt.label) {
      api.setCaption(name, pt.label)
      api.setLabelStyle(name, 3)
    }
  }

  // 2. 函数图像
  for (const fn of coord.functions) {
    const name = register(fn.id)
    const expr = fn.expr
      .replace(/^y\s*=/i, '')
      .replace(/²/g, '^2')
      .replace(/³/g, '^3')
      .trim()
    if (fn.domain) {
      api.evalCommand(`${name}(x) = Function(${expr}, ${fn.domain[0]}, ${fn.domain[1]})`)
    } else {
      api.evalCommand(`${name}(x) = ${expr}`)
    }
    const [r, g, b] = hexToRgb(fn.color)
    api.setColor(name, r, g, b)
    if (fn.dashed) {
      api.setLineStyle(name, 1)
    }
  }

  // 3. 动点（自动创建 GeoGebra Slider 滑块 + 绑定动点，支持手动拖动或一键播放动画）
  for (const mp of coord.movingPoints) {
    const name = register(mp.id)
    const sliderName = `t_${name}`
    const initialVal = Object.hasOwn(coord.targetT, mp.id) ? coord.targetT[mp.id] : mp.initialT
    const step = Math.max(0.02, Number(((mp.tMax - mp.tMin) / 120).toFixed(3)))
    api.evalCommand(`${sliderName} = Slider(${mp.tMin}, ${mp.tMax}, ${step})`)
    api.setValue(sliderName, initialVal)

    if (mp.path.type === 'segment') {
      const a = mp.path.fromId ? register(mp.path.fromId) : null
      const b = mp.path.toId ? register(mp.path.toId) : null
      if (a && b) {
        api.evalCommand(
          `${name} = ${a} + ((${sliderName} - ${mp.tMin}) / ${Math.max(1e-6, mp.tMax - mp.tMin)}) * (${b} - ${a})`
        )
      } else {
        const from = mp.path.from ?? [0, 0]
        const to = mp.path.to ?? [6, 0]
        const span = Math.max(1e-6, mp.tMax - mp.tMin)
        api.evalCommand(
          `${name} = (${from[0]} + (${to[0]} - ${from[0]}) * (${sliderName} - ${mp.tMin}) / ${span}, ${from[1]} + (${to[1]} - ${from[1]}) * (${sliderName} - ${mp.tMin}) / ${span})`
        )
      }
    } else if (mp.path.type === 'function') {
      const expr = mp.path.expr.replace(/\bx\b/g, `(${sliderName})`).replace(/²/g, '^2')
      api.evalCommand(`${name} = (${sliderName}, ${expr})`)
    } else {
      const xExpr = mp.path.xExpr.replace(/\bt\b/g, `(${sliderName})`)
      const yExpr = mp.path.yExpr.replace(/\bt\b/g, `(${sliderName})`)
      api.evalCommand(`${name} = (${xExpr}, ${yExpr})`)
    }
    const [r, g, b] = hexToRgb(mp.color)
    api.setColor(name, r, g, b)
  }

  // 4. 辅助线（GeoGebra 原生动态几何约束：垂线、对称点、平行线与虚线连线，随动点自动联动！）
  for (const aux of coord.auxiliaryLines) {
    const auxName = register(aux.id)
    const fromName = register(aux.fromId)
    const [r, g, b] = hexToRgb(aux.color)

    if (aux.kind === 'connect' && aux.toId) {
      const toName = register(aux.toId)
      api.evalCommand(`${auxName} = Segment(${fromName}, ${toName})`)
      api.setColor(auxName, r, g, b)
      api.setLineStyle(auxName, 1)
    } else if (aux.kind === 'symmetry') {
      const targetLine =
        aux.axis === 'x'
          ? 'xAxis'
          : aux.axis === 'y'
            ? 'yAxis'
            : aux.targetLineFromId && aux.targetLineToId
              ? `Line(${register(aux.targetLineFromId)}, ${register(aux.targetLineToId)})`
              : 'xAxis'
      const mirrorName = register(aux.derivedPointId || `${aux.id}_mirror`)
      api.evalCommand(`${mirrorName} = Reflect(${fromName}, ${targetLine})`)
      api.setColor(mirrorName, r, g, b)
      if (aux.derivedPointLabel) {
        api.setCaption(mirrorName, aux.derivedPointLabel)
        api.setLabelStyle(mirrorName, 3)
      }
      api.evalCommand(`${auxName} = Segment(${fromName}, ${mirrorName})`)
      api.setColor(auxName, r, g, b)
      api.setLineStyle(auxName, 1)
    } else if (aux.kind === 'perpendicular') {
      const targetLine =
        aux.axis === 'x'
          ? 'xAxis'
          : aux.axis === 'y'
            ? 'yAxis'
            : aux.targetLineFromId && aux.targetLineToId
              ? `Line(${register(aux.targetLineFromId)}, ${register(aux.targetLineToId)})`
              : 'xAxis'
      const helperLine = `${auxName}_line`
      const footName = register(aux.derivedPointId || `${aux.id}_foot`)
      api.evalCommand(`${helperLine} = PerpendicularLine(${fromName}, ${targetLine})`)
      api.evalCommand(`SetVisibleInView(${helperLine}, 1, false)`)
      api.evalCommand(`${footName} = Intersect(${helperLine}, ${targetLine})`)
      api.setColor(footName, r, g, b)
      if (aux.derivedPointLabel) {
        api.setCaption(footName, aux.derivedPointLabel)
        api.setLabelStyle(footName, 3)
      }
      api.evalCommand(`${auxName} = Segment(${fromName}, ${footName})`)
      api.setColor(auxName, r, g, b)
      api.setLineStyle(auxName, 1)
    } else if (aux.kind === 'parallel') {
      const targetLine =
        aux.axis === 'x'
          ? 'xAxis'
          : aux.axis === 'y'
            ? 'yAxis'
            : aux.targetLineFromId && aux.targetLineToId
              ? `Line(${register(aux.targetLineFromId)}, ${register(aux.targetLineToId)})`
              : 'xAxis'
      api.evalCommand(`${auxName} = Line(${fromName}, ${targetLine})`)
      api.setColor(auxName, r, g, b)
      api.setLineStyle(auxName, 1)
    }
  }

  // 5. 线段与多边形
  for (const seg of coord.segments) {
    const name = register(seg.id)
    const ptA = register(seg.fromId)
    const ptB = register(seg.toId)
    const cmd =
      seg.kind === 'line'
        ? `Line(${ptA}, ${ptB})`
        : seg.kind === 'ray'
          ? `Ray(${ptA}, ${ptB})`
          : seg.kind === 'vector'
            ? `Vector(${ptA}, ${ptB})`
            : `Segment(${ptA}, ${ptB})`
    api.evalCommand(`${name} = ${cmd}`)
    const [cr, cg, cb] = hexToRgb(seg.color)
    api.setColor(name, cr, cg, cb)
    if (seg.dashed) {
      api.setLineStyle(name, 1)
    }
  }

  for (const poly of coord.polygons) {
    const name = register(poly.id)
    const verts = poly.vertexIds.map(register).join(', ')
    api.evalCommand(`${name} = Polygon(${verts})`)
    const [r, g, b] = hexToRgb(poly.stroke)
    api.setColor(name, r, g, b)
  }

  for (const circle of coord.circles) {
    const name = register(circle.id)
    const center = register(circle.centerId)
    if (circle.radiusPointId) {
      api.evalCommand(`${name} = Circle(${center}, ${register(circle.radiusPointId)})`)
    } else if (circle.radius !== undefined) {
      api.evalCommand(`${name} = Circle(${center}, ${circle.radius})`)
    }
    const [r, g, b] = hexToRgb(circle.color)
    api.setColor(name, r, g, b)
    if (circle.dashed) {
      api.setLineStyle(name, 1)
    }
  }
}
