import {
  computeAngleDeg,
  computePolygonArea,
  intersectCircles,
  intersectLineCircle,
  intersectLines,
  projectOntoLine,
  reflectPointAcrossLine,
  rotatePointAround,
  vecDist,
  type Vec2,
} from './geometryEngine.js'

export type DynamicAnnotation = {
  id: string
  text: string
  x: number
  y: number
  color: string
}

export type ScriptExecutionResult = {
  pointOverrides: Record<string, Vec2>
  tOverrides: Record<string, number>
  paramUpdates: Record<string, number>
  annotations: DynamicAnnotation[]
  highlights: string[]
  statusText: string | null
  requestPause: boolean
  error: string | null
}

type CompiledScriptFn = (
  ctx: ScriptContext,
  MathObj: typeof Math,
  _w?: undefined,
  _d?: undefined,
  _g?: undefined,
  _s?: undefined,
  _f?: undefined,
  _x?: undefined,
  _ws?: undefined,
  _ls?: undefined,
  _ss?: undefined,
  _e?: undefined,
  _fn?: undefined,
  _al?: undefined,
  _pr?: undefined,
  _cf?: undefined,
  _st?: undefined,
  _si?: undefined
) => void

export type ScriptContext = {
  t: number
  duration: number
  progress: number
  dt: number
  playing: boolean
  isTimelineDriven: boolean
  draggedId: string | null
  state: Record<string, unknown>
  getPoint: (id: string) => Vec2 | null
  setPoint: (id: string, x: number, y: number) => void
  getT: (id: string) => number
  setT: (id: string, t: number) => void
  moveAlong: (
    id: string,
    path: (string | [number, number] | Vec2)[],
    distance: number,
    options?: { closed?: boolean; bounce?: boolean; loop?: boolean }
  ) => { x: number; y: number; segmentIndex: number; finished: boolean; totalLength: number } | null
  getParam: (name: string, fallback?: number) => number
  setParam: (name: string, value: number) => void
  setAnnotation: (id: string, text: string, x: number, y: number, color?: string) => void
  highlight: (ids: string[]) => void
  setStatus: (text: string | null) => void
  pause: () => void
  math: {
    PI: number
    E: number
    sin: (x: number) => number
    cos: (x: number) => number
    tan: (x: number) => number
    asin: (x: number) => number
    acos: (x: number) => number
    atan: (x: number) => number
    atan2: (y: number, x: number) => number
    sqrt: (x: number) => number
    abs: (x: number) => number
    pow: (a: number, b: number) => number
    min: (...args: number[]) => number
    max: (...args: number[]) => number
    floor: (x: number) => number
    ceil: (x: number) => number
    round: (x: number) => number
    hypot: (...args: number[]) => number
    sign: (x: number) => number
    clamp: (v: number, lo: number, hi: number) => number
    lerp: (a: number, b: number, t: number) => number
    dist: (a: Vec2, b: Vec2) => number
    angleDeg: (a: Vec2, vertex: Vec2, c: Vec2) => number
    rotate: (p: Vec2, center: Vec2, deg: number) => Vec2
    reflect: (p: Vec2, lineA: Vec2, lineB: Vec2) => Vec2
    project: (p: Vec2, lineA: Vec2, lineB: Vec2) => Vec2
    intersectLines: (a: Vec2, b: Vec2, c: Vec2, d: Vec2) => Vec2 | null
    intersectLineCircle: (a: Vec2, b: Vec2, center: Vec2, r: number) => Vec2[]
    intersectCircles: (c1: Vec2, r1: number, c2: Vec2, r2: number) => Vec2[]
    polygonArea: (pts: Vec2[]) => number
  }
}

const FORBIDDEN_IDENTIFIERS = [
  'window',
  'document',
  'globalThis',
  'self',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'cookie',
  'eval',
  'Function',
  'AsyncFunction',
  'GeneratorFunction',
  'import',
  'require',
  'process',
  'location',
  'navigator',
  'history',
  'alert',
  'prompt',
  'confirm',
  'constructor',
  '__proto__',
  'prototype',
  'Proxy',
  'Reflect',
  'Worker',
  'SharedWorker',
  'setTimeout',
  'setInterval',
]

/** 剥离字符串字面量和注释，便于做静态安全词法检查 */
const stripStringsAndComments = (code: string): string => {
  let out = ''
  let i = 0
  while (i < code.length) {
    const ch = code[i]
    const next = code[i + 1]
    if (ch === '/' && next === '/') {
      while (i < code.length && code[i] !== '\n') {
        i += 1
      }
      out += ' '
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) {
        i += 1
      }
      i += 2
      out += ' '
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      i += 1
      while (i < code.length) {
        if (code[i] === '\\') {
          i += 2
          continue
        }
        if (code[i] === quote) {
          i += 1
          break
        }
        i += 1
      }
      out += ' "" '
      continue
    }
    out += ch
    i += 1
  }
  return out
}

/** 静态安全检查，阻止访问浏览器宿主对象与原型链逃逸 */
export const validateMotionScript = (code: string): string | null => {
  if (!code.trim()) {
    return '脚本内容为空'
  }
  if (code.length > 16000) {
    return '脚本长度超过 16,000 字符限制'
  }
  const stripped = stripStringsAndComments(code)
  for (const word of FORBIDDEN_IDENTIFIERS) {
    const re = new RegExp(`\\b${word}\\b`)
    if (re.test(stripped)) {
      return `脚本包含受限标识符 "${word}"，为保证安全已禁止执行`
    }
  }
  if (/\[\s*['"`](?:constructor|__proto__|prototype)['"`]\s*\]/.test(code)) {
    return '脚本包含受限属性访问，已禁止执行'
  }
  return null
}

/** 注入简单循环步数守卫，防止 AI 误写死循环卡死画板 */
const injectLoopGuard = (code: string): string => {
  const guard = 'if (++__steps > 40000) { throw new Error("脚本循环次数超限，已安全中止"); } '
  return `let __steps = 0;\n${code
    .replace(/\b(for\s*\([^)]*\)\s*\{)/g, `$1 ${guard}`)
    .replace(/\b(while\s*\([^)]*\)\s*\{)/g, `$1 ${guard}`)
    .replace(/\b(do\s*\{)/g, `$1 ${guard}`)}`
}

const scriptCache = new Map<string, { fn: CompiledScriptFn | null; error: string | null }>()

export const compileMotionScript = (
  code: string
): { fn: CompiledScriptFn | null; error: string | null } => {
  const cached = scriptCache.get(code)
  if (cached) {
    return cached
  }
  const validationError = validateMotionScript(code)
  if (validationError) {
    const res = { fn: null, error: validationError }
    scriptCache.set(code, res)
    return res
  }
  try {
    const instrumented = `"use strict";\n${injectLoopGuard(code)}`
    // 使用受限参数列表屏蔽常见浏览器全局标识符（eval/Function 已由静态检查提前拦截）
    const fn = new Function(
      'ctx',
      'Math',
      'window',
      'document',
      'globalThis',
      'self',
      'fetch',
      'XMLHttpRequest',
      'WebSocket',
      'localStorage',
      'sessionStorage',
      'Function',
      'alert',
      'prompt',
      'confirm',
      'setTimeout',
      'setInterval',
      instrumented
    ) as CompiledScriptFn
    if (scriptCache.size > 64) {
      scriptCache.clear()
    }
    const res = { fn, error: null }
    scriptCache.set(code, res)
    return res
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const res = { fn: null, error: `脚本语法错误：${message}` }
    scriptCache.set(code, res)
    return res
  }
}

const MATH_HELPER: ScriptContext['math'] = Object.freeze({
  PI: Math.PI,
  E: Math.E,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  sqrt: Math.sqrt,
  abs: Math.abs,
  pow: Math.pow,
  min: Math.min,
  max: Math.max,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  hypot: Math.hypot,
  sign: Math.sign,
  clamp: (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v)),
  lerp: (a: number, b: number, t: number) => a + (b - a) * t,
  dist: vecDist,
  angleDeg: computeAngleDeg,
  rotate: rotatePointAround,
  reflect: reflectPointAcrossLine,
  project: projectOntoLine,
  intersectLines,
  intersectLineCircle,
  intersectCircles,
  polygonArea: computePolygonArea,
})

/** 在隔离沙箱中执行一帧 AI 动点控制脚本 */
export const runMotionScriptFrame = (options: {
  code: string
  t: number
  duration: number
  dt: number
  playing?: boolean
  isTimelineDriven?: boolean
  draggedId: string | null
  basePoints: Record<string, Vec2>
  tValues: Record<string, number>
  params: Record<string, number>
  persistentState: Record<string, unknown>
}): ScriptExecutionResult => {
  const {
    code,
    t,
    duration,
    dt,
    playing = false,
    isTimelineDriven = true,
    draggedId,
    basePoints,
    tValues,
    params,
    persistentState,
  } = options
  const compiled = compileMotionScript(code)
  if (compiled.error || !compiled.fn) {
    return {
      pointOverrides: {},
      tOverrides: {},
      paramUpdates: {},
      annotations: [],
      highlights: [],
      statusText: null,
      requestPause: false,
      error: compiled.error ?? '脚本编译失败',
    }
  }

  const pointOverrides: Record<string, Vec2> = {}
  const tOverrides: Record<string, number> = {}
  const paramUpdates: Record<string, number> = {}
  const annotationMap = new Map<string, DynamicAnnotation>()
  let highlights: string[] = []
  let statusText: string | null = null
  let requestPause = false

  const getPoint = (id: string): Vec2 | null => {
    if (Object.hasOwn(pointOverrides, id)) {
      return { ...pointOverrides[id] }
    }
    if (Object.hasOwn(basePoints, id)) {
      return { ...basePoints[id] }
    }
    return null
  }

  const setPoint = (id: string, x: number, y: number) => {
    if (typeof id === 'string' && id && Number.isFinite(x) && Number.isFinite(y)) {
      pointOverrides[id] = { x, y }
    }
  }

  const getT = (id: string): number => {
    if (Object.hasOwn(tOverrides, id)) {
      return tOverrides[id]
    }
    return Object.hasOwn(tValues, id) ? tValues[id] : 0
  }

  const setT = (id: string, value: number) => {
    if (typeof id === 'string' && id && Number.isFinite(value)) {
      tOverrides[id] = value
    }
  }

  const moveAlong: ScriptContext['moveAlong'] = (id, path, rawDistance, opts) => {
    const verts: Vec2[] = []
    for (const item of path) {
      if (typeof item === 'string') {
        const pt = getPoint(item)
        if (pt) {
          verts.push(pt)
        }
      } else if (Array.isArray(item) && item.length >= 2) {
        const x = Number(item[0])
        const y = Number(item[1])
        if (Number.isFinite(x) && Number.isFinite(y)) {
          verts.push({ x, y })
        }
      } else if (
        !Array.isArray(item) &&
        typeof item === 'object' &&
        item !== null &&
        Number.isFinite(item.x) &&
        Number.isFinite(item.y)
      ) {
        verts.push({ x: item.x, y: item.y })
      }
    }
    if (verts.length === 0) {
      return null
    }
    if (opts?.closed && verts.length >= 2) {
      verts.push(verts[0])
    }
    if (verts.length === 1) {
      setPoint(id, verts[0].x, verts[0].y)
      return { x: verts[0].x, y: verts[0].y, segmentIndex: 0, finished: true, totalLength: 0 }
    }
    const lens: number[] = []
    let totalLength = 0
    for (let i = 0; i < verts.length - 1; i += 1) {
      const l = vecDist(verts[i], verts[i + 1])
      lens.push(l)
      totalLength += l
    }
    if (totalLength < 1e-9) {
      setPoint(id, verts[0].x, verts[0].y)
      return { x: verts[0].x, y: verts[0].y, segmentIndex: 0, finished: true, totalLength: 0 }
    }

    let d = Number.isFinite(rawDistance) ? rawDistance : 0
    let finished = false
    if (opts?.bounce) {
      const period = totalLength * 2
      const mod = ((d % period) + period) % period
      d = mod <= totalLength ? mod : period - mod
    } else if (opts?.loop) {
      d = ((d % totalLength) + totalLength) % totalLength
    } else {
      if (d <= 0) {
        d = 0
      } else if (d >= totalLength) {
        d = totalLength
        finished = true
      }
    }

    let remain = d
    for (let i = 0; i < lens.length; i += 1) {
      const segLen = lens[i]
      if (remain <= segLen || i === lens.length - 1) {
        const localRatio = segLen < 1e-9 ? 0 : Math.max(0, Math.min(1, remain / segLen))
        const x = verts[i].x + (verts[i + 1].x - verts[i].x) * localRatio
        const y = verts[i].y + (verts[i + 1].y - verts[i].y) * localRatio
        setPoint(id, x, y)
        return { x, y, segmentIndex: i, finished, totalLength }
      }
      remain -= segLen
    }
    const last = verts[verts.length - 1]
    setPoint(id, last.x, last.y)
    return { x: last.x, y: last.y, segmentIndex: lens.length - 1, finished: true, totalLength }
  }

  const ctx: ScriptContext = {
    t,
    duration: Math.max(0.001, duration),
    progress: duration > 0 ? Math.max(0, Math.min(1, t / duration)) : 0,
    dt,
    playing,
    isTimelineDriven,
    draggedId,
    state: persistentState,
    getPoint,
    setPoint,
    getT,
    setT,
    moveAlong,
    getParam: (name, fallback = 0) => {
      if (Object.hasOwn(paramUpdates, name)) {
        return paramUpdates[name]
      }
      return Object.hasOwn(params, name) ? params[name] : fallback
    },
    setParam: (name, value) => {
      if (typeof name === 'string' && name && Number.isFinite(value)) {
        paramUpdates[name] = value
      }
    },
    setAnnotation: (id, text, x, y, color = '#3964FE') => {
      if (typeof id === 'string' && id && typeof text === 'string' && Number.isFinite(x) && Number.isFinite(y)) {
        annotationMap.set(id, { id, text, x, y, color })
      }
    },
    highlight: (ids) => {
      if (Array.isArray(ids)) {
        highlights = ids.filter((item): item is string => typeof item === 'string')
      }
    },
    setStatus: (text) => {
      statusText = typeof text === 'string' && text.trim() ? text.trim() : null
    },
    pause: () => {
      requestPause = true
    },
    math: MATH_HELPER,
  }

  try {
    compiled.fn(ctx, Math)
    return {
      pointOverrides,
      tOverrides,
      paramUpdates,
      annotations: Array.from(annotationMap.values()),
      highlights,
      statusText,
      requestPause,
      error: null,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      pointOverrides,
      tOverrides,
      paramUpdates,
      annotations: Array.from(annotationMap.values()),
      highlights,
      statusText,
      requestPause: false,
      error: `脚本运行错误：${message}`,
    }
  }
}
