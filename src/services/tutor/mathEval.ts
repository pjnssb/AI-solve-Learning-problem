/**
 * 安全的无依赖数学表达式解析与求值器（递归下降解析，不使用 eval / Function）。
 * 支持四则运算、乘方 ^、隐式乘法（如 2x、-x^2、3(x+1)）、常用数学函数与常量 pi / e。
 */

type Token =
  | { type: 'num'; value: number }
  | { type: 'id'; value: string }
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
  sqrt: (a) => Math.sqrt(a),
  abs: (a) => Math.abs(a),
  ln: (a) => Math.log(a),
  log: (a) => Math.log10(a),
  exp: (a) => Math.exp(a),
  floor: (a) => Math.floor(a),
  ceil: (a) => Math.ceil(a),
  round: (a) => Math.round(a),
  pow: (a, b) => Math.pow(a, b),
  min: (...args) => Math.min(...args),
  max: (...args) => Math.max(...args),
}

const tokenize = (raw: string): Token[] => {
  // 允许输入类似 "y = -x^2 + 4x" 的表达式，自动剥离左侧 "y=" 或 "f(x)="
  const cleaned = raw
    .trim()
    .replace(/^[a-zA-Z]\s*\(\s*[a-zA-Z]\s*\)\s*=/, '')
    .replace(/^y\s*=/i, '')
    .replace(/\*\*/g, '^')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/π/g, 'pi')

  const tokens: Token[] = []
  let i = 0
  while (i < cleaned.length) {
    const ch = cleaned[i]
    if (/\s/.test(ch)) {
      i += 1
      continue
    }
    if (/[0-9.]/.test(ch)) {
      let end = i
      while (end < cleaned.length && /[0-9.]/.test(cleaned[end])) {
        end += 1
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
      while (end < cleaned.length && /[a-zA-Z0-9_]/.test(cleaned[end])) {
        end += 1
      }
      tokens.push({ type: 'id', value: cleaned.slice(i, end).toLowerCase() })
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
      const prevIsValue =
        prev.type === 'num' ||
        prev.type === 'rparen' ||
        (prev.type === 'id' && !Object.hasOwn(MATH_FUNCTIONS, prev.value))
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
  | { kind: 'var'; name: string }
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
      if (this.peek()?.type === 'lparen' && Object.hasOwn(MATH_FUNCTIONS, tok.value)) {
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
        return { kind: 'call', name: tok.value, args }
      }
      if (Object.hasOwn(MATH_CONSTANTS, tok.value)) {
        return { kind: 'num', value: MATH_CONSTANTS[tok.value] }
      }
      return { kind: 'var', name: tok.value }
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

const evaluateAst = (node: AstNode, vars: Record<string, number>): number => {
  switch (node.kind) {
    case 'num':
      return node.value
    case 'var':
      return Object.hasOwn(vars, node.name) ? vars[node.name] : Number.NaN
    case 'unary': {
      const value = evaluateAst(node.operand, vars)
      return node.op === '-' ? -value : value
    }
    case 'binary': {
      const left = evaluateAst(node.left, vars)
      const right = evaluateAst(node.right, vars)
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
      const fn = MATH_FUNCTIONS[node.name]
      if (!fn) {
        return Number.NaN
      }
      return fn(...node.args.map((arg) => evaluateAst(arg, vars)))
    }
  }
}

const compiledCache = new Map<string, AstNode | null>()

/** 编译数学表达式并返回一个求值函数；表达式非法时返回 null */
export const compileMathExpr = (
  expr: string
): ((vars: Record<string, number>) => number) | null => {
  let ast = compiledCache.get(expr)
  if (ast === undefined) {
    ast = new Parser(tokenize(expr)).parse()
    if (compiledCache.size > 200) {
      compiledCache.clear()
    }
    compiledCache.set(expr, ast)
  }
  if (!ast) {
    return null
  }
  const tree = ast
  return (vars) => evaluateAst(tree, vars)
}

export const evalMathExpr = (expr: string, vars: Record<string, number>): number => {
  const fn = compileMathExpr(expr)
  return fn ? fn(vars) : Number.NaN
}
