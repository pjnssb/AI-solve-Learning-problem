/**
 * 安全的无依赖数学表达式解析与求值器（递归下降解析，不使用 eval / Function）。
 * 支持四则运算、乘方 ^、隐式乘法（如 2x、-x^2、3(x+1)）、常用数学函数、常量 pi / e、
 * 滑块参数变量以及点坐标引用（如 P.x、A_prime.y）与几何函数（dist / angle / slope）。
 */

export type PointLookup = Record<string, { x: number; y: number }>

export type EvalContext = {
  vars: Record<string, number>
  points?: PointLookup
}

type Token =
  | { type: 'num'; value: number }
  | { type: 'id'; value: string; lower: string }
  | { type: 'op'; value: '+' | '-' | '*' | '/' | '^' }
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'comma' }

const MATH_CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
}

const MATH_FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sin: (a) => Math.sin(a),
  cos: (a) => Math.cos(a),
  tan: (a) => Math.tan(a),
  asin: (a) => Math.asin(a),
  acos: (a) => Math.acos(a),
  atan: (a) => Math.atan(a),
  atan2: (y, x) => Math.atan2(y, x),
  sqrt: (a) => Math.sqrt(a),
  cbrt: (a) => Math.cbrt(a),
  abs: (a) => Math.abs(a),
  sign: (a) => Math.sign(a),
  ln: (a) => Math.log(a),
  log: (a) => Math.log10(a),
  log2: (a) => Math.log2(a),
  exp: (a) => Math.exp(a),
  floor: (a) => Math.floor(a),
  ceil: (a) => Math.ceil(a),
  round: (a) => Math.round(a),
  pow: (a, b) => Math.pow(a, b),
  hypot: (...args) => Math.hypot(...args),
  min: (...args) => Math.min(...args),
  max: (...args) => Math.max(...args),
  deg: (rad) => (rad * 180) / Math.PI,
  rad: (deg) => (deg * Math.PI) / 180,
  clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
}

const GEOM_FUNCTIONS = new Set(['dist', 'distance', 'angle', 'slope', 'area'])

const tokenize = (raw: string): Token[] => {
  // 允许输入类似 "y = -x^2 + 4x"、"f(x) = ..." 或 "r(theta) = ..."，自动剥离左侧前缀
  const cleaned = raw
    .trim()
    .replace(/^[a-zA-Z]\s*\(\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\)\s*=/, '')
    .replace(/^[yr]\s*=/i, '')
    .replace(/\*\*/g, '^')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/π/g, 'pi')
    .replace(/√\s*\(/g, 'sqrt(')
    .replace(/θ/g, 'theta')

  const tokens: Token[] = []
  let i = 0
  while (i < cleaned.length) {
    const ch = cleaned[i]
    if (/\s/.test(ch)) {
      i += 1
      continue
    }
    if (/[0-9]/.test(ch) || (ch === '.' && i + 1 < cleaned.length && /[0-9]/.test(cleaned[i + 1]))) {
      let end = i
      let hasDot = false
      while (end < cleaned.length) {
        const c = cleaned[end]
        if (/[0-9]/.test(c)) {
          end += 1
        } else if (c === '.' && !hasDot) {
          hasDot = true
          end += 1
        } else {
          break
        }
      }
      const value = Number(cleaned.slice(i, end))
      if (!Number.isFinite(value)) {
        return []
      }
      tokens.push({ type: 'num', value })
      i = end
      continue
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let end = i
      while (end < cleaned.length && /[a-zA-Z0-9_.]/.test(cleaned[end])) {
        end += 1
      }
      const value = cleaned.slice(i, end)
      tokens.push({ type: 'id', value, lower: value.toLowerCase() })
      i = end
      continue
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '^') {
      tokens.push({ type: 'op', value: ch })
      i += 1
      continue
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen' })
      i += 1
      continue
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen' })
      i += 1
      continue
    }
    if (ch === ',') {
      tokens.push({ type: 'comma' })
      i += 1
      continue
    }
    return []
  }

  // 插入隐式乘法：如 2x -> 2 * x，2(x+1) -> 2 * (x+1)，(x+1)(x-1) -> (x+1) * (x-1)
  const expanded: Token[] = []
  for (let idx = 0; idx < tokens.length; idx += 1) {
    const curr = tokens[idx]
    const prev = expanded.at(-1)
    if (prev) {
      const prevIsFunc =
        prev.type === 'id' &&
        (Object.hasOwn(MATH_FUNCTIONS, prev.lower) || GEOM_FUNCTIONS.has(prev.lower))
      const prevIsValue =
        prev.type === 'num' || prev.type === 'rparen' || (prev.type === 'id' && !prevIsFunc)
      const currStartsValue = curr.type === 'id' || curr.type === 'lparen' || curr.type === 'num'
      if (prevIsValue && currStartsValue) {
        expanded.push({ type: 'op', value: '*' })
      }
    }
    expanded.push(curr)
  }
  return expanded
}

type AstNode =
  | { kind: 'num'; value: number }
  | { kind: 'var'; name: string; lower: string }
  | { kind: 'unary'; op: '+' | '-'; operand: AstNode }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/' | '^'; left: AstNode; right: AstNode }
  | { kind: 'call'; name: string; args: AstNode[] }

class Parser {
  private pos = 0

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos]
  }

  private consume(): Token {
    const tok = this.tokens[this.pos]
    this.pos += 1
    return tok
  }

  parse(): AstNode | null {
    if (this.tokens.length === 0) {
      return null
    }
    const expr = this.parseAddSub()
    if (!expr || this.pos !== this.tokens.length) {
      return null
    }
    return expr
  }

  private parseAddSub(): AstNode | null {
    let left = this.parseMulDiv()
    if (!left) {
      return null
    }
    while (true) {
      const tok = this.peek()
      if (tok?.type === 'op' && (tok.value === '+' || tok.value === '-')) {
        this.consume()
        const right = this.parseMulDiv()
        if (!right) {
          return null
        }
        left = { kind: 'binary', op: tok.value, left, right }
      } else {
        break
      }
    }
    return left
  }

  private parseMulDiv(): AstNode | null {
    let left = this.parseUnary()
    if (!left) {
      return null
    }
    while (true) {
      const tok = this.peek()
      if (tok?.type === 'op' && (tok.value === '*' || tok.value === '/')) {
        this.consume()
        const right = this.parseUnary()
        if (!right) {
          return null
        }
        left = { kind: 'binary', op: tok.value, left, right }
      } else {
        break
      }
    }
    return left
  }

  private parseUnary(): AstNode | null {
    const tok = this.peek()
    if (tok?.type === 'op' && (tok.value === '+' || tok.value === '-')) {
      this.consume()
      const operand = this.parseUnary()
      if (!operand) {
        return null
      }
      return { kind: 'unary', op: tok.value, operand }
    }
    return this.parsePower()
  }

  private parsePower(): AstNode | null {
    const base = this.parsePrimary()
    if (!base) {
      return null
    }
    const tok = this.peek()
    if (tok?.type === 'op' && tok.value === '^') {
      this.consume()
      const exponent = this.parseUnary()
      if (!exponent) {
        return null
      }
      return { kind: 'binary', op: '^', left: base, right: exponent }
    }
    return base
  }

  private parsePrimary(): AstNode | null {
    const tok = this.peek()
    if (!tok) {
      return null
    }
    if (tok.type === 'num') {
      this.consume()
      return { kind: 'num', value: tok.value }
    }
    if (tok.type === 'id') {
      this.consume()
      if (
        this.peek()?.type === 'lparen' &&
        (Object.hasOwn(MATH_FUNCTIONS, tok.lower) || GEOM_FUNCTIONS.has(tok.lower))
      ) {
        this.consume()
        const args: AstNode[] = []
        if (this.peek()?.type !== 'rparen') {
          while (true) {
            const arg = this.parseAddSub()
            if (!arg) {
              return null
            }
            args.push(arg)
            if (this.peek()?.type === 'comma') {
              this.consume()
              continue
            }
            break
          }
        }
        if (this.peek()?.type !== 'rparen') {
          return null
        }
        this.consume()
        return { kind: 'call', name: tok.lower, args }
      }
      if (Object.hasOwn(MATH_CONSTANTS, tok.lower)) {
        return { kind: 'num', value: MATH_CONSTANTS[tok.lower] }
      }
      return { kind: 'var', name: tok.value, lower: tok.lower }
    }
    if (tok.type === 'lparen') {
      this.consume()
      const inner = this.parseAddSub()
      if (!inner || this.peek()?.type !== 'rparen') {
        return null
      }
      this.consume()
      return inner
    }
    return null
  }
}

const lookupPoint = (points: PointLookup | undefined, name: string): { x: number; y: number } | null => {
  if (!points) {
    return null
  }
  if (Object.hasOwn(points, name)) {
    return points[name]
  }
  const lower = name.toLowerCase()
  for (const [k, v] of Object.entries(points)) {
    if (k.toLowerCase() === lower) {
      return v
    }
  }
  return null
}

const evaluateGeomCall = (name: string, args: AstNode[], ctx: EvalContext): number => {
  const { points } = ctx
  const getPtArg = (node: AstNode | undefined): { x: number; y: number } | null =>
    node?.kind === 'var' ? lookupPoint(points, node.name) : null

  if (name === 'dist' || name === 'distance') {
    if (args.length === 2) {
      const a = getPtArg(args[0])
      const b = getPtArg(args[1])
      if (a && b) {
        return Math.hypot(b.x - a.x, b.y - a.y)
      }
    }
    if (args.length === 4) {
      const x1 = evaluateAst(args[0], ctx)
      const y1 = evaluateAst(args[1], ctx)
      const x2 = evaluateAst(args[2], ctx)
      const y2 = evaluateAst(args[3], ctx)
      return Math.hypot(x2 - x1, y2 - y1)
    }
    return Number.NaN
  }

  if (name === 'angle' && args.length === 3) {
    const a = getPtArg(args[0])
    const b = getPtArg(args[1])
    const c = getPtArg(args[2])
    if (!a || !b || !c) {
      return Number.NaN
    }
    const v1x = a.x - b.x
    const v1y = a.y - b.y
    const v2x = c.x - b.x
    const v2y = c.y - b.y
    const l1 = Math.hypot(v1x, v1y)
    const l2 = Math.hypot(v2x, v2y)
    if (l1 < 1e-9 || l2 < 1e-9) {
      return Number.NaN
    }
    const cosVal = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)))
    return (Math.acos(cosVal) * 180) / Math.PI
  }

  if (name === 'slope' && args.length === 2) {
    const a = getPtArg(args[0])
    const b = getPtArg(args[1])
    if (!a || !b || Math.abs(b.x - a.x) < 1e-9) {
      return Number.NaN
    }
    return (b.y - a.y) / (b.x - a.x)
  }

  if (name === 'area' && args.length >= 3) {
    const pts: { x: number; y: number }[] = []
    for (const arg of args) {
      const p = getPtArg(arg)
      if (!p) {
        return Number.NaN
      }
      pts.push(p)
    }
    let sum = 0
    for (let i = 0; i < pts.length; i += 1) {
      const next = pts[(i + 1) % pts.length]
      sum += pts[i].x * next.y - next.x * pts[i].y
    }
    return Math.abs(sum) * 0.5
  }

  return Number.NaN
}

const evaluateAst = (node: AstNode, ctx: EvalContext): number => {
  switch (node.kind) {
    case 'num':
      return node.value
    case 'var': {
      const { vars, points } = ctx
      if (Object.hasOwn(vars, node.name)) {
        return vars[node.name]
      }
      if (Object.hasOwn(vars, node.lower)) {
        return vars[node.lower]
      }
      // 支持 P.x / P.y 点坐标引用
      const dotIdx = node.name.lastIndexOf('.')
      if (dotIdx > 0) {
        const ptId = node.name.slice(0, dotIdx)
        const prop = node.name.slice(dotIdx + 1).toLowerCase()
        const pt = lookupPoint(points, ptId)
        if (pt) {
          if (prop === 'x') {
            return pt.x
          }
          if (prop === 'y') {
            return pt.y
          }
        }
      }
      return Number.NaN
    }
    case 'unary': {
      const value = evaluateAst(node.operand, ctx)
      return node.op === '-' ? -value : value
    }
    case 'binary': {
      const left = evaluateAst(node.left, ctx)
      const right = evaluateAst(node.right, ctx)
      switch (node.op) {
        case '+':
          return left + right
        case '-':
          return left - right
        case '*':
          return left * right
        case '/':
          return right === 0 ? Number.NaN : left / right
        case '^':
          return Math.pow(left, right)
        default:
          return Number.NaN
      }
    }
    case 'call': {
      if (GEOM_FUNCTIONS.has(node.name)) {
        return evaluateGeomCall(node.name, node.args, ctx)
      }
      const fn = MATH_FUNCTIONS[node.name]
      if (!fn) {
        return Number.NaN
      }
      return fn(...node.args.map((arg) => evaluateAst(arg, ctx)))
    }
  }
}

const compiledCache = new Map<string, AstNode | null>()

const getOrCompileAst = (expr: string): AstNode | null => {
  let ast = compiledCache.get(expr)
  if (ast === undefined) {
    ast = new Parser(tokenize(expr)).parse()
    if (compiledCache.size > 300) {
      compiledCache.clear()
    }
    compiledCache.set(expr, ast)
  }
  return ast
}

/** 编译数学表达式并返回一个求值函数；表达式非法时返回 null */
export const compileMathExpr = (
  expr: string
): ((vars: Record<string, number>, points?: PointLookup) => number) | null => {
  const ast = getOrCompileAst(expr)
  if (!ast) {
    return null
  }
  const tree = ast
  return (vars, points) => evaluateAst(tree, { vars, points })
}

export const evalMathExpr = (
  expr: string,
  vars: Record<string, number>,
  points?: PointLookup
): number => {
  const fn = compileMathExpr(expr)
  return fn ? fn(vars, points) : Number.NaN
}

/**
 * 解析等式残差：支持 "lhs = rhs"（返回 lhs - rhs）或纯表达式 "expr"（默认 expr = 0）。
 */
export const evalEquationResidual = (
  rawExpr: string,
  vars: Record<string, number>,
  points?: PointLookup
): number => {
  const eqIdx = rawExpr.indexOf('=')
  if (eqIdx > 0 && rawExpr[eqIdx - 1] !== '<' && rawExpr[eqIdx - 1] !== '>' && rawExpr[eqIdx + 1] !== '=') {
    const lhs = rawExpr.slice(0, eqIdx).trim()
    const rhs = rawExpr.slice(eqIdx + 1).trim()
    if (lhs && rhs) {
      const lv = evalMathExpr(lhs, vars, points)
      const rv = evalMathExpr(rhs, vars, points)
      return lv - rv
    }
  }
  return evalMathExpr(rawExpr, vars, points)
}
