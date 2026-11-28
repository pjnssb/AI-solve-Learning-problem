import type {
  BlockContent,
  DefinitionContent,
  Node as MdAstNode,
  Nodes,
  Parent,
  PhrasingContent,
  Root,
  RootContent,
  Text,
} from 'mdast'
import { findAndReplace } from 'mdast-util-find-and-replace'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { mathFromMarkdown } from 'mdast-util-math'
import { gfm } from 'micromark-extension-gfm'
import { math } from 'micromark-extension-llm-math'
import type { Source } from '../chat/view.js'

/** 正文里的 [citation:N]，已换成对应来源 */
export interface CitationNode extends MdAstNode {
  type: 'citation'
  source: Source
}

export type HtmlTagAttrs = {
  title?: string
  open?: boolean
  style?: Record<string, string>
}

/** 安全的 HTML 标签节点（如 <sub> / <sup> / <u> / <mark> / <details> 等） */
export interface HtmlTagNode extends MdAstNode {
  type: 'htmlTag'
  tagName: string
  attrs?: HtmlTagAttrs
  isBlock?: boolean
  children: Nodes[]
}

declare module 'mdast' {
  interface RootContentMap {
    citation: CitationNode
    htmlTag: HtmlTagNode
  }

  interface BlockContentMap {
    htmlTag: HtmlTagNode
  }

  interface PhrasingContentMap {
    citation: CitationNode
    htmlTag: HtmlTagNode
  }
}

const text = (value: string): Text => ({ type: 'text', value })

const INLINE_HTML_TAGS = new Set([
  'sub',
  'sup',
  'u',
  'ins',
  's',
  'del',
  'b',
  'strong',
  'i',
  'em',
  'var',
  'mark',
  'small',
  'code',
  'kbd',
  'samp',
  'abbr',
  'cite',
  'q',
  'span',
  'font',
  'wbr',
])

const BLOCK_HTML_TAGS = new Set([
  'p',
  'div',
  'center',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'details',
  'summary',
])

const ALLOWED_HTML_TAGS = new Set([...INLINE_HTML_TAGS, ...BLOCK_HTML_TAGS])

const BARE_LATEX_ENVS = new Set([
  'equation',
  'equation*',
  'align',
  'align*',
  'aligned',
  'alignedat',
  'gather',
  'gather*',
  'gathered',
  'cases',
  'dcases',
  'rcases',
  'split',
  'multline',
  'multline*',
  'matrix',
  'pmatrix',
  'bmatrix',
  'Bmatrix',
  'vmatrix',
  'Vmatrix',
  'smallmatrix',
  'array',
  'CD',
])

const OPEN_TAG_RE = /^<([a-zA-Z][a-zA-Z0-9]*)(?:\s+([^<>]*?))?\s*(\/?)>$/
const CLOSE_TAG_RE = /^<\/([a-zA-Z][a-zA-Z0-9]*)\s*>$/
const COMMENT_RE = /^<!--[\s\S]*?-->$/

const SAFE_COLOR_RE =
  /^(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,24}|rgba?\(\s*\d{1,3}%?\s*[,\s]\s*\d{1,3}%?\s*[,\s]\s*\d{1,3}%?(?:\s*[,/]\s*(?:0|1|0?\.\d+|\d{1,3}%))?\s*\))$/

const SAFE_STYLE_PROPS: Record<string, string> = {
  color: 'color',
  'background-color': 'backgroundColor',
  'font-weight': 'fontWeight',
  'font-style': 'fontStyle',
  'text-decoration': 'textDecoration',
  'text-align': 'textAlign',
  'font-size': 'fontSize',
}

const isSafeStyleValue = (value: string): boolean => {
  const lower = value.toLowerCase()
  return (
    value.length > 0 &&
    value.length <= 64 &&
    !lower.includes('url(') &&
    !lower.includes('expression(') &&
    !lower.includes('javascript:') &&
    !value.includes('<') &&
    !value.includes('>')
  )
}

const parseTagAttrs = (tagName: string, rawAttrs: string): HtmlTagAttrs | undefined => {
  if (!rawAttrs.trim()) {
    return undefined
  }
  const attrs: HtmlTagAttrs = {}
  const style: Record<string, string> = {}

  const titleMatch = rawAttrs.match(/\btitle\s*=\s*(?:"([^"]*)"|'([^']*)')/i)
  if (titleMatch) {
    attrs.title = titleMatch[1] ?? titleMatch[2] ?? ''
  }

  if (tagName === 'details' && /(?:^|\s)open(?:\s|=|$)/i.test(rawAttrs)) {
    attrs.open = true
  }

  if (tagName === 'font') {
    const colorMatch = rawAttrs.match(/\bcolor\s*=\s*(?:"([^"]*)"|'([^']*)')/i)
    const colorVal = (colorMatch?.[1] ?? colorMatch?.[2] ?? '').trim()
    if (colorVal && SAFE_COLOR_RE.test(colorVal)) {
      style.color = colorVal
    }
  }

  const styleMatch = rawAttrs.match(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i)
  const styleRaw = styleMatch?.[1] ?? styleMatch?.[2]
  if (styleRaw) {
    for (const decl of styleRaw.split(';')) {
      const colonIdx = decl.indexOf(':')
      if (colonIdx === -1) {
        continue
      }
      const prop = decl.slice(0, colonIdx).trim().toLowerCase()
      const val = decl.slice(colonIdx + 1).trim()
      const mapped = SAFE_STYLE_PROPS[prop]
      if (mapped && isSafeStyleValue(val)) {
        style[mapped] = val
      }
    }
  }

  if (Object.keys(style).length > 0) {
    attrs.style = style
  }
  return Object.keys(attrs).length > 0 ? attrs : undefined
}

/**
 * 将未包裹定界符的独立 LaTeX 环境（如 \begin{cases}...\end{cases}、\begin{aligned}...\end{aligned}）
 * 自动包裹为 $$...$$ 块，同时跳过代码块、行内代码与已有数学定界符。
 */
const wrapBareLatexEnvs = (input: string): string => {
  if (!input.includes('\\begin{')) {
    return input
  }
  let out = ''
  let i = 0
  let inFence: string | null = null
  let inlineCodeTicks = 0
  let inDollar: number | null = null
  let inParenMath = false
  let inBracketMath = false

  while (i < input.length) {
    const atLineStart = i === 0 || input[i - 1] === '\n'
    if (atLineStart && !inlineCodeTicks && !inDollar && !inParenMath && !inBracketMath) {
      const fenceMatch = input.slice(i).match(/^[ \t]{0,3}(`{3,}|~{3,})/)
      if (fenceMatch) {
        const marker = fenceMatch[1]
        if (!inFence) {
          inFence = marker[0]
        } else if (marker[0] === inFence && marker.length >= 3) {
          inFence = null
        }
        const lineEnd = input.indexOf('\n', i)
        if (lineEnd === -1) {
          out += input.slice(i)
          break
        }
        out += input.slice(i, lineEnd + 1)
        i = lineEnd + 1
        continue
      }
    }

    if (inFence) {
      const lineEnd = input.indexOf('\n', i)
      if (lineEnd === -1) {
        out += input.slice(i)
        break
      }
      out += input.slice(i, lineEnd + 1)
      i = lineEnd + 1
      continue
    }

    const ch = input[i]
    if (ch === '\\') {
      const next = input[i + 1]
      if (!inlineCodeTicks && !inDollar) {
        if (!inParenMath && !inBracketMath && next === '(') {
          inParenMath = true
          out += '\\('
          i += 2
          continue
        }
        if (inParenMath && next === ')') {
          inParenMath = false
          out += '\\)'
          i += 2
          continue
        }
        if (!inParenMath && !inBracketMath && next === '[') {
          inBracketMath = true
          out += '\\['
          i += 2
          continue
        }
        if (inBracketMath && next === ']') {
          inBracketMath = false
          out += '\\]'
          i += 2
          continue
        }
        if (!inParenMath && !inBracketMath && input.startsWith('\\begin{', i)) {
          const envMatch = input.slice(i).match(/^\\begin\{([a-zA-Z*]+)\}/)
          if (envMatch && BARE_LATEX_ENVS.has(envMatch[1])) {
            const envName = envMatch[1]
            const openToken = `\\begin{${envName}}`
            const closeToken = `\\end{${envName}}`
            let depth = 1
            let scan = i + openToken.length
            let endPos = -1
            while (scan < input.length) {
              const nextOpen = input.indexOf(openToken, scan)
              const nextClose = input.indexOf(closeToken, scan)
              if (nextClose === -1) {
                break
              }
              if (nextOpen !== -1 && nextOpen < nextClose) {
                depth += 1
                scan = nextOpen + openToken.length
              } else {
                depth -= 1
                scan = nextClose + closeToken.length
                if (depth === 0) {
                  endPos = scan
                  break
                }
              }
            }
            if (endPos !== -1) {
              const block = input.slice(i, endPos)
              const needLeadingNl = out.length > 0 && !out.endsWith('\n')
              const needTrailingNl = endPos < input.length && input[endPos] !== '\n'
              out += `${needLeadingNl ? '\n' : ''}$$\n${block}\n$$${needTrailingNl ? '\n' : ''}`
              i = endPos
              continue
            }
          }
        }
      }
      out += input.slice(i, i + 2)
      i += 2
      continue
    }

    if (ch === '`' && !inDollar && !inParenMath && !inBracketMath) {
      let ticks = 0
      while (input[i + ticks] === '`') {
        ticks += 1
      }
      if (inlineCodeTicks === 0) {
        inlineCodeTicks = ticks
      } else if (inlineCodeTicks === ticks) {
        inlineCodeTicks = 0
      }
      out += input.slice(i, i + ticks)
      i += ticks
      continue
    }

    if (ch === '$' && !inlineCodeTicks && !inParenMath && !inBracketMath) {
      let count = 0
      while (input[i + count] === '$') {
        count += 1
      }
      if (count <= 2) {
        if (inDollar === null) {
          inDollar = count
        } else if (inDollar === count) {
          inDollar = null
        }
      }
      out += input.slice(i, i + count)
      i += count
      continue
    }

    out += ch
    i += 1
  }

  return out
}

const pairInlineHtmlNodes = (nodes: PhrasingContent[]): PhrasingContent[] => {
  type Frame = { tagName: string; attrs?: HtmlTagAttrs; children: PhrasingContent[] }
  const stack: Frame[] = []
  const root: PhrasingContent[] = []
  const target = () => stack.at(-1)?.children ?? root

  for (const node of nodes) {
    if (node.type !== 'html') {
      target().push(node)
      continue
    }
    const val = node.value.trim()
    if (COMMENT_RE.test(val)) {
      continue
    }
    if (/^<br\s*\/?>$/i.test(val)) {
      target().push({ type: 'break' })
      continue
    }
    if (/^<hr\s*\/?>$/i.test(val)) {
      continue
    }
    const openMatch = val.match(OPEN_TAG_RE)
    if (openMatch) {
      const tag = openMatch[1].toLowerCase()
      if (ALLOWED_HTML_TAGS.has(tag)) {
        const attrs = parseTagAttrs(tag, openMatch[2] ?? '')
        const selfClosing = openMatch[3] === '/' || tag === 'wbr'
        if (selfClosing) {
          target().push({ type: 'htmlTag', tagName: tag, attrs, children: [] })
        } else {
          stack.push({ tagName: tag, attrs, children: [] })
        }
        continue
      }
    }
    const closeMatch = val.match(CLOSE_TAG_RE)
    if (closeMatch) {
      const tag = closeMatch[1].toLowerCase()
      if (ALLOWED_HTML_TAGS.has(tag)) {
        let matchIdx = -1
        for (let i = stack.length - 1; i >= 0; i -= 1) {
          if (stack[i].tagName === tag) {
            matchIdx = i
            break
          }
        }
        if (matchIdx !== -1) {
          while (stack.length > matchIdx) {
            const frame = stack.pop()
            if (frame) {
              target().push({
                type: 'htmlTag',
                tagName: frame.tagName,
                attrs: frame.attrs,
                children: frame.children,
              })
            }
          }
        }
        continue
      }
    }
    target().push(node)
  }

  while (stack.length > 0) {
    const frame = stack.pop()
    if (frame) {
      target().push({
        type: 'htmlTag',
        tagName: frame.tagName,
        attrs: frame.attrs,
        children: frame.children,
      })
    }
  }

  return root
}

const parseRawMarkdown = (
  input: string,
  { sources, disableLink }: { sources: Source[] | undefined; disableLink: boolean }
): Root => {
  const sourceInput = wrapBareLatexEnvs(input)
  const ast = fromMarkdown(sourceInput, {
    extensions: [
      // codeIndented 语法导致有前导空格的列表无法正常渲染
      { ...gfm(), disable: { null: ['codeIndented'] } },
      math({ singleDollarTextMath: true }),
    ],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
  })
  if (sources) {
    const sourcesByIndex = new Map(sources.map((source) => [source.index, source]))
    findAndReplace(
      ast,
      [
        /\[citation:(\d+)\]/g,
        (_: string, index: string): CitationNode | '' => {
          const source = sourcesByIndex.get(Number(index))
          return source ? { type: 'citation', source } : ''
        },
      ],
      { ignore: ['linkReference'] }
    )
  }
  const raw = (node: Nodes) =>
    sourceInput.slice(node.position?.start.offset, node.position?.end.offset)

  const parseHtmlBlock = (htmlStr: string): Nodes[] => {
    const trimmed = htmlStr.trim()
    if (!trimmed || COMMENT_RE.test(trimmed)) {
      return []
    }
    if (/^<hr\s*\/?>$/i.test(trimmed)) {
      return [{ type: 'thematicBreak' }]
    }
    if (/^<br\s*\/?>$/i.test(trimmed)) {
      return [{ type: 'paragraph', children: [{ type: 'break' }] }]
    }

    const tokenRe = /<!--[\s\S]*?-->|<\/?[a-zA-Z][a-zA-Z0-9]*(?:\s+[^<>]*)?\s*\/?>/g
    type BlockFrame = { tagName: string; attrs?: HtmlTagAttrs; children: Nodes[] }
    const stack: BlockFrame[] = []
    const rootNodes: Nodes[] = []
    const pushNode = (item: Nodes) => {
      const top = stack.at(-1)
      if (top) {
        top.children.push(item)
      } else {
        rootNodes.push(item)
      }
    }

    let lastIndex = 0
    let matchedAnyAllowedTag = false

    const normalizeInlineRuns = (nodes: Nodes[]): Nodes[] => {
      const normalized: Nodes[] = []
      let pendingInline: PhrasingContent[] = []
      const flushInline = () => {
        if (pendingInline.length === 0) {
          return
        }
        normalized.push({ type: 'paragraph', children: pendingInline })
        pendingInline = []
      }
      for (const node of nodes) {
        if (
          node.type === 'paragraph' ||
          node.type === 'heading' ||
          node.type === 'blockquote' ||
          node.type === 'thematicBreak' ||
          node.type === 'math' ||
          node.type === 'code' ||
          node.type === 'list' ||
          node.type === 'table' ||
          (node.type === 'htmlTag' && node.isBlock)
        ) {
          flushInline()
          normalized.push(node)
        } else {
          pendingInline.push(node as PhrasingContent)
        }
      }
      flushInline()
      return normalized
    }

    const emitTextChunk = (chunk: string) => {
      if (!chunk) {
        return
      }
      if (!chunk.trim()) {
        if (stack.length > 0 && !BLOCK_HTML_TAGS.has(stack[stack.length - 1].tagName)) {
          pushNode(text(chunk))
        }
        return
      }
      const leading = chunk.match(/^[ \t]+/)?.[0] ?? ''
      const trailing = chunk.match(/[ \t]+$/)?.[0] ?? ''
      const body = chunk.trim()
      const subAst = toMdAst(body, { sources, disableLink })
      if (subAst.children.length === 1 && subAst.children[0].type === 'paragraph') {
        if (leading) {
          pushNode(text(leading))
        }
        for (const phr of subAst.children[0].children) {
          pushNode(phr)
        }
        if (trailing) {
          pushNode(text(trailing))
        }
        return
      }
      const insideInline = stack.length > 0 && !BLOCK_HTML_TAGS.has(stack[stack.length - 1].tagName)
      for (const child of subAst.children) {
        if (insideInline && child.type === 'paragraph') {
          for (const phr of child.children) {
            pushNode(phr)
          }
        } else {
          pushNode(child)
        }
      }
    }

    let match: RegExpExecArray | null
    while ((match = tokenRe.exec(trimmed)) !== null) {
      const tok = match[0]
      if (COMMENT_RE.test(tok)) {
        emitTextChunk(trimmed.slice(lastIndex, match.index))
        lastIndex = match.index + tok.length
        continue
      }
      if (/^<br\s*\/?>$/i.test(tok)) {
        matchedAnyAllowedTag = true
        emitTextChunk(trimmed.slice(lastIndex, match.index))
        pushNode({ type: 'break' })
        lastIndex = match.index + tok.length
        continue
      }
      if (/^<hr\s*\/?>$/i.test(tok)) {
        matchedAnyAllowedTag = true
        emitTextChunk(trimmed.slice(lastIndex, match.index))
        pushNode({ type: 'thematicBreak' })
        lastIndex = match.index + tok.length
        continue
      }
      const openM = tok.match(OPEN_TAG_RE)
      if (openM) {
        const tag = openM[1].toLowerCase()
        if (ALLOWED_HTML_TAGS.has(tag)) {
          matchedAnyAllowedTag = true
          emitTextChunk(trimmed.slice(lastIndex, match.index))
          const attrs = parseTagAttrs(tag, openM[2] ?? '')
          const selfClosing = openM[3] === '/' || tag === 'wbr'
          if (selfClosing) {
            pushNode({
              type: 'htmlTag',
              tagName: tag,
              attrs,
              isBlock: BLOCK_HTML_TAGS.has(tag),
              children: [],
            })
          } else {
            stack.push({ tagName: tag, attrs, children: [] })
          }
          lastIndex = match.index + tok.length
          continue
        }
      }
      const closeM = tok.match(CLOSE_TAG_RE)
      if (closeM) {
        const tag = closeM[1].toLowerCase()
        if (ALLOWED_HTML_TAGS.has(tag)) {
          matchedAnyAllowedTag = true
          emitTextChunk(trimmed.slice(lastIndex, match.index))
          let matchIdx = -1
          for (let k = stack.length - 1; k >= 0; k -= 1) {
            if (stack[k].tagName === tag) {
              matchIdx = k
              break
            }
          }
          if (matchIdx !== -1) {
            while (stack.length > matchIdx) {
              const frame = stack.pop()
              if (frame) {
                finalizeFrame(frame, pushNode)
              }
            }
          }
          lastIndex = match.index + tok.length
          continue
        }
      }
    }

    if (!matchedAnyAllowedTag) {
      return [{ type: 'html', value: htmlStr }]
    }

    emitTextChunk(trimmed.slice(lastIndex))
    while (stack.length > 0) {
      const frame = stack.pop()
      if (frame) {
        finalizeFrame(frame, pushNode)
      }
    }

    return normalizeInlineRuns(rootNodes)
  }

  const finalizeFrame = (
    frame: { tagName: string; attrs?: HtmlTagAttrs; children: Nodes[] },
    pushNode: (n: Nodes) => void
  ) => {
    const isBlock = BLOCK_HTML_TAGS.has(frame.tagName)
    if (frame.tagName === 'p') {
      const phrasing = frame.children.flatMap((c) =>
        c.type === 'paragraph' ? c.children : [c as PhrasingContent]
      )
      pushNode({ type: 'paragraph', children: phrasing })
      return
    }
    if (/^h([1-6])$/.test(frame.tagName)) {
      const depth = Number(frame.tagName[1]) as 1 | 2 | 3 | 4 | 5 | 6
      const phrasing = frame.children.flatMap((c) =>
        c.type === 'paragraph' ? c.children : [c as PhrasingContent]
      )
      pushNode({ type: 'heading', depth, children: phrasing })
      return
    }
    if (!isBlock) {
      const phrasing = frame.children.flatMap((c) =>
        c.type === 'paragraph' ? c.children : [c as PhrasingContent]
      )
      pushNode({
        type: 'htmlTag',
        tagName: frame.tagName,
        attrs: frame.attrs,
        isBlock: false,
        children: phrasing,
      })
      return
    }
    // 将块容器内的行内节点组合成连续段落
    const blockChildren: Nodes[] = []
    let pending: PhrasingContent[] = []
    const flush = () => {
      if (pending.length === 0) {
        return
      }
      blockChildren.push({ type: 'paragraph', children: pending })
      pending = []
    }
    for (const child of frame.children) {
      if (
        child.type === 'paragraph' ||
        child.type === 'heading' ||
        child.type === 'blockquote' ||
        child.type === 'thematicBreak' ||
        child.type === 'math' ||
        child.type === 'code' ||
        child.type === 'list' ||
        child.type === 'table' ||
        (child.type === 'htmlTag' && child.isBlock)
      ) {
        flush()
        blockChildren.push(child)
      } else {
        pending.push(child as PhrasingContent)
      }
    }
    flush()

    if (frame.tagName === 'blockquote') {
      pushNode({
        type: 'blockquote',
        children: blockChildren as Array<BlockContent | DefinitionContent>,
      })
      return
    }
    pushNode({
      type: 'htmlTag',
      tagName: frame.tagName,
      attrs: frame.attrs,
      isBlock: true,
      children: blockChildren,
    })
  }

  /** 将跨块拆开的 <details>...</details> / <center>...</center> / <div>...</div> 重新配对 */
  const pairSplitBlockContainers = (nodes: RootContent[]): RootContent[] => {
    type BlockStackFrame = { tagName: string; attrs?: HtmlTagAttrs; children: RootContent[] }
    const stack: BlockStackFrame[] = []
    const out: RootContent[] = []
    const target = () => stack.at(-1)?.children ?? out

    for (const node of nodes) {
      if (node.type === 'html') {
        const val = node.value.trim()
        const openM = val.match(/^<(details|center|div)(?:\s+([^<>]*?))?\s*>$/i)
        if (openM) {
          const tag = openM[1].toLowerCase()
          stack.push({ tagName: tag, attrs: parseTagAttrs(tag, openM[2] ?? ''), children: [] })
          continue
        }
        const closeM = val.match(/^<\/(details|center|div)\s*>$/i)
        if (closeM) {
          const tag = closeM[1].toLowerCase()
          let idx = -1
          for (let k = stack.length - 1; k >= 0; k -= 1) {
            if (stack[k].tagName === tag) {
              idx = k
              break
            }
          }
          if (idx !== -1) {
            while (stack.length > idx) {
              const frame = stack.pop()
              if (frame) {
                target().push({
                  type: 'htmlTag',
                  tagName: frame.tagName,
                  attrs: frame.attrs,
                  isBlock: true,
                  children: frame.children,
                })
              }
            }
            continue
          }
        }
      }
      target().push(node)
    }

    while (stack.length > 0) {
      const frame = stack.pop()
      if (frame) {
        target().push({
          type: 'htmlTag',
          tagName: frame.tagName,
          attrs: frame.attrs,
          isBlock: true,
          children: frame.children,
        })
      }
    }
    return out
  }

  // 先处理子节点，再按需把当前节点换成若干节点
  const simplify = (node: Nodes, parentType?: Nodes['type']): Nodes[] => {
    if ('children' in node) {
      let children = node.children.flatMap((child) => simplify(child, node.type))
      if (
        node.type === 'paragraph' ||
        node.type === 'heading' ||
        node.type === 'tableCell' ||
        node.type === 'emphasis' ||
        node.type === 'strong' ||
        node.type === 'link' ||
        node.type === 'delete'
      ) {
        children = pairInlineHtmlNodes(children as PhrasingContent[])
      } else if (node.type === 'root' || node.type === 'blockquote' || node.type === 'listItem') {
        children = pairSplitBlockContainers(children as RootContent[])
      }
      ;(node as Parent).children = children as RootContent[]
    }
    switch (node.type) {
      case 'html': {
        const isBlockParent =
          parentType === 'root' || parentType === 'blockquote' || parentType === 'listItem'
        if (!isBlockParent) {
          return [node]
        }
        // 保留跨块开闭标签给 pairSplitBlockContainers 处理（如 <details>\n<summary>...</summary>）
        const trimmed = node.value.trim()
        if (
          /^<(details|center|div)(?:\s+[^<>]*)?>$/i.test(trimmed) ||
          /^<\/(details|center|div)\s*>$/i.test(trimmed)
        ) {
          return [node]
        }
        // 处理像 "<details>\n<summary>标题</summary>" 这样含内嵌子标签的跨块开标签
        const splitDetailsMatch = trimmed.match(/^<(details)(?:\s+([^<>]*?))?>\s*\n([\s\S]+)$/i)
        if (splitDetailsMatch && !/<\/details>/i.test(trimmed)) {
          const inner = parseHtmlBlock(splitDetailsMatch[3])
          return [
            {
              type: 'html',
              value: `<details${splitDetailsMatch[2] ? ' ' + splitDetailsMatch[2] : ''}>`,
            },
            ...inner,
          ]
        }
        return parseHtmlBlock(node.value)
      }
      case 'link':
        return disableLink ? node.children : [node]
      case 'delete': {
        // 解析器保证首尾定界符等长
        const delimiter = raw(node).match(/^~+/)?.[0] ?? ''
        return [text(delimiter), ...node.children, text(delimiter)]
      }
      case 'footnoteReference':
      case 'imageReference':
      case 'linkReference':
        return [text(raw(node))]
      case 'footnoteDefinition':
      case 'definition':
        return [{ type: 'paragraph', children: [text(raw(node))] }]
      default:
        return [node]
    }
  }
  simplify(ast)
  return ast
}

/**
 * 解析正文，并把渲染器不单独处理的节点提前换掉，渲染时无需再读原文：
 * - 传入 sources 时，[citation:N] 换成角标节点，找不到来源的直接去掉
 * - disableLink 时链接只保留文字
 * - 删除线保留原样的 ~ 定界符，脚注、引用式链接与定义显示原文
 * - 配对安全的 HTML 数学/排版标签（<sub>、<sup>、<u>、<mark>、<details> 等）
 * - 自动包裹独立的 LaTeX 环境（\begin{cases}...\end{cases} 等）
 */
export function toMdAst(
  input: string,
  { sources, disableLink }: { sources: Source[] | undefined; disableLink: boolean }
): Root {
  return parseRawMarkdown(input, { sources, disableLink })
}
