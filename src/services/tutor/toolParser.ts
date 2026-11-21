import type { CanvasMode, ParsedTutorReply, TutorToolCall, TutorToolName } from './types.js'

const VALID_TOOLS = new Set<TutorToolName>([
  'board_switch',
  'coord_setup',
  'coord_plot_point',
  'coord_add_moving_point',
  'coord_draw_segment',
  'coord_draw_function',
  'coord_draw_polygon',
  'coord_draw_circle',
  'coord_draw_auxiliary_line',
  'coord_add_measurement',
  'coord_annotate',
  'coord_set_t',
  'coord_highlight',
  'coord_remove',
  'coord_clear',
  'flow_init',
  'flow_add_node',
  'flow_add_edge',
  'flow_update_node',
  'flow_highlight',
  'flow_remove',
  'flow_clear',
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const defaultSummary = (tool: TutorToolName, args: Record<string, unknown>): string => {
  const label =
    typeof args.label === 'string' && args.label
      ? args.label
      : typeof args.title === 'string' && args.title
        ? args.title
        : ''
  const title = typeof args.title === 'string' && args.title ? args.title : ''
  switch (tool) {
    case 'board_switch':
      return args.mode === 'flowchart' ? '切换到思维流程图画板' : '切换到数学坐标系画板'
    case 'coord_setup':
      return title ? `初始化坐标系：${title}` : '初始化数学坐标系'
    case 'coord_plot_point':
      return `标出点 ${label || String(args.id ?? '')}`
    case 'coord_add_moving_point':
      return `添加动点 ${label || String(args.id ?? 'P')}`
    case 'coord_draw_segment':
      return `绘制线段 ${label || `${String(args.fromId ?? args.from ?? '')}${String(args.toId ?? args.to ?? '')}`}`
    case 'coord_draw_function':
      return `绘制函数图像 ${label || String(args.expr ?? '')}`
    case 'coord_draw_polygon':
      return `绘制多边形 ${label}`
    case 'coord_draw_circle':
      return `绘制圆 ${label}`
    case 'coord_draw_auxiliary_line':
      return `作辅助线 ${label || String(args.kind ?? '')}`
    case 'coord_add_measurement':
      return `添加实时度量 ${label}`
    case 'coord_annotate':
      return `添加标注：${String(args.text ?? label)}`
    case 'coord_set_t':
      return `移动动点至目标位置`
    case 'coord_highlight':
      return `高亮当前步骤关键元素`
    case 'coord_remove':
      return `删除坐标系元素`
    case 'coord_clear':
      return `清空坐标系画板`
    case 'flow_init':
      return title ? `创建流程图：${title}` : '创建思维流程图'
    case 'flow_add_node':
      return `新增流程节点：${label || String(args.id ?? '')}`
    case 'flow_add_edge':
      return `连接流程步骤 ${String(args.from ?? args.source ?? '')} → ${String(args.to ?? args.target ?? '')}`
    case 'flow_update_node':
      return `更新节点：${label || String(args.id ?? '')}`
    case 'flow_highlight':
      return `高亮流程图当前步骤`
    case 'flow_remove':
      return `删除流程图节点或连线`
    case 'flow_clear':
      return `清空流程图画板`
  }
}

/**
 * 容错修复大模型常见 JSON 格式瑕疵：
 * - 去除 JSON 外的注释与尾随逗号
 * - 修复字符串内未转义的反斜杠（如 LaTeX 公式 "\perp"、"\sqrt"、"\triangle"）
 */
const sanitizeJsonText = (raw: string): string => {
  let out = ''
  let inString = false
  let i = 0
  while (i < raw.length) {
    const ch = raw[i]
    if (!inString) {
      if (ch === '/' && raw[i + 1] === '/') {
        while (i < raw.length && raw[i] !== '\n') {
          i += 1
        }
        continue
      }
      if (ch === '/' && raw[i + 1] === '*') {
        i += 2
        while (i < raw.length && !(raw[i] === '*' && raw[i + 1] === '/')) {
          i += 1
        }
        i += 2
        continue
      }
      if (ch === '"') {
        inString = true
      }
      out += ch
      i += 1
      continue
    }

    // inString
    if (ch === '\n' || ch === '\r') {
      out += ch === '\n' ? '\\n' : ''
      i += 1
      continue
    }
    if (ch === '\\') {
      const next = raw[i + 1]
      if (!next) {
        out += '\\\\'
        i += 1
        continue
      }
      if (next === 'u') {
        const hex = raw.slice(i + 2, i + 6)
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += raw.slice(i, i + 6)
          i += 6
          continue
        }
        out += '\\\\'
        i += 1
        continue
      }
      if ('"\\/bfnrt'.includes(next)) {
        out += '\\' + next
        i += 2
        continue
      }
      // 非法的 JSON 转义字符（如 \p, \s, \a, \d 等），转义为双反斜杠
      out += '\\\\'
      i += 1
      continue
    }
    if (ch === '"') {
      inString = false
    }
    out += ch
    i += 1
  }

  return out.replace(/,\s*([}\]])/g, '$1').trim()
}

/** 从混合的多条 NDJSON / 逗号分隔对象文本中逐个提取顶层 {...} JSON 对象 */
const extractBalancedObjects = (text: string): string[] => {
  const objects: string[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') {
      if (depth === 0) {
        start = i
      }
      depth += 1
    } else if (ch === '}' && depth > 0) {
      depth -= 1
      if (depth === 0 && start !== -1) {
        objects.push(text.slice(start, i + 1))
        start = -1
      }
    }
  }
  return objects
}

const toToolCall = (item: unknown, index: number, subIndex: number): TutorToolCall | null => {
  if (!isRecord(item)) {
    return null
  }
  const toolName =
    typeof item.tool === 'string'
      ? item.tool.trim()
      : typeof item.name === 'string'
        ? item.name.trim()
        : ''
  if (!VALID_TOOLS.has(toolName as TutorToolName)) {
    return null
  }
  const tool = toolName as TutorToolName
  const args = isRecord(item.args)
    ? item.args
    : isRecord(item.arguments)
      ? item.arguments
      : isRecord(item.input)
        ? item.input
        : Object.fromEntries(
            Object.entries(item).filter(
              ([key]) => key !== 'tool' && key !== 'name' && key !== 'summary'
            )
          )
  const summary =
    typeof item.summary === 'string' && item.summary.trim()
      ? item.summary.trim()
      : defaultSummary(tool, args)
  return {
    id: `tool-${index}-${subIndex}-${tool}`,
    tool,
    summary,
    args,
  }
}

const parseJsonLoose = (raw: string): unknown => {
  const trimmed = raw.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const sanitized = sanitizeJsonText(trimmed)
    return JSON.parse(sanitized)
  }
}

const parseToolJson = (rawJson: string, index: number): TutorToolCall[] => {
  try {
    const parsed = parseJsonLoose(rawJson)
    const items = Array.isArray(parsed) ? parsed : [parsed]
    const calls: TutorToolCall[] = []
    items.forEach((item, subIndex) => {
      const call = toToolCall(item, index, subIndex)
      if (call) {
        calls.push(call)
      }
    })
    return calls
  } catch {
    // 兜底：尝试拆解同一个代码块内多条并列的 {...} 对象（NDJSON 或逗号分隔）
    const sanitized = sanitizeJsonText(rawJson)
    const chunks = extractBalancedObjects(sanitized)
    const calls: TutorToolCall[] = []
    chunks.forEach((chunk, subIndex) => {
      try {
        const call = toToolCall(JSON.parse(chunk), index, subIndex)
        if (call) {
          calls.push(call)
        }
      } catch {
        // 忽略仍无法解析的单段对象
      }
    })
    return calls
  }
}

const parseChoicesJson = (rawJson: string): string[] => {
  const normalizeList = (items: unknown[]): string[] =>
    items
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim())
      .slice(0, 4)

  try {
    const parsed = parseJsonLoose(rawJson)
    if (Array.isArray(parsed)) {
      return normalizeList(parsed)
    }
    if (isRecord(parsed)) {
      if (Array.isArray(parsed.choices)) {
        return normalizeList(parsed.choices)
      }
      if (Array.isArray(parsed.options)) {
        return normalizeList(parsed.options)
      }
    }
    return []
  } catch {
    // 兼容模型输出多行列表形式
    const lines = rawJson
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
      .filter((line) => line.length > 0 && !line.startsWith('[') && !line.startsWith(']'))
      .map((line) => line.replace(/^["']|["'],?$/g, '').trim())
      .filter(Boolean)
    return lines.slice(0, 4)
  }
}

const describePendingTool = (partialBody: string): string => {
  const summaryMatch = partialBody.match(/"summary"\s*:\s*"([^"\\]{2,40})/)
  if (summaryMatch?.[1]) {
    return `正在绘制：${summaryMatch[1]}...`
  }
  const toolMatch = partialBody.match(/"tool"\s*:\s*"([a-z_]+)"/)
  if (toolMatch?.[1]) {
    const t = toolMatch[1]
    if (t.startsWith('flow_')) {
      return '正在构建流程图节点...'
    }
    if (t.startsWith('coord_')) {
      return '正在绘制坐标系元素...'
    }
  }
  return 'Agent 正在调用画板工具...'
}

/**
 * 实时解析流式或已完成的 AI 导师文本：
 * - 抽出完整的 ```tutor-tool ... ``` / ```tutor_tool ... ``` / <tutor_tool>...</tutor_tool> 工具调用
 * - 兼容模型误用 ```json 包裹的画板工具块（仅当内容包含合法 tool 字段时提取）
 * - 抽出 ```tutor-choices ... ``` 启发式快捷回复选项
 * - 在流式尚未闭合工具块时自动隐藏原始 JSON，并给出细粒度 pendingToolLabel
 */
export const parseTutorReply = (rawText: string, streaming = true): ParsedTutorReply => {
  const toolCalls: TutorToolCall[] = []
  let choices: string[] = []
  let callCounter = 0

  // 1. 解析标准及常见变体代码块：```tutor-tool / tutor_tool / tutor-choices / tutor_choices
  let stripped = rawText.replace(
    /```(tutor[-_]tool|tutor[-_]choices)[ \t]*\r?\n?([\s\S]*?)```/gi,
    (_match, kind: string, body: string) => {
      const normalized = kind.toLowerCase().replace('_', '-')
      if (normalized === 'tutor-tool') {
        const parsed = parseToolJson(body, callCounter++)
        toolCalls.push(...parsed)
      } else {
        const parsed = parseChoicesJson(body)
        if (parsed.length > 0) {
          choices = parsed
        }
      }
      return ''
    }
  )

  // 2. 兼容模型误用 ```json 包裹的合法画板工具调用
  stripped = stripped.replace(/```json[ \t]*\r?\n([\s\S]*?)```/gi, (match, body: string) => {
    if (!/"tool"\s*:/.test(body)) {
      return match
    }
    const parsed = parseToolJson(body, callCounter++)
    if (parsed.length > 0) {
      toolCalls.push(...parsed)
      return ''
    }
    return match
  })

  // 3. 兼容 XML 标签格式：<tutor_tool> / <tutor-tool> / <tutor_choices> / <tutor-choices>
  stripped = stripped.replace(
    /<(tutor[-_]tool|tutor[-_]choices)>([\s\S]*?)<\/\1>/gi,
    (_match, kind: string, body: string) => {
      const normalized = kind.toLowerCase().replace('_', '-')
      if (normalized === 'tutor-tool') {
        const parsed = parseToolJson(body, callCounter++)
        toolCalls.push(...parsed)
      } else {
        const parsed = parseChoicesJson(body)
        if (parsed.length > 0) {
          choices = parsed
        }
      }
      return ''
    }
  )

  // 4. 处理末尾未闭合的块
  let pendingToolLabel: string | null = null
  const unclosedFence = stripped.match(/```(tutor[-_]tool|tutor[-_]choices)([\s\S]*)$/i)
  if (unclosedFence) {
    const normalized = unclosedFence[1].toLowerCase().replace('_', '-')
    const body = unclosedFence[2] ?? ''
    if (!streaming) {
      // 回复已结束但模型忘记闭合 ```，尝试抢救已完整输出的工具或选项
      if (normalized === 'tutor-tool') {
        const parsed = parseToolJson(body, callCounter++)
        toolCalls.push(...parsed)
      } else {
        const parsed = parseChoicesJson(body)
        if (parsed.length > 0) {
          choices = parsed
        }
      }
    } else if (normalized === 'tutor-tool') {
      pendingToolLabel = describePendingTool(body)
    }
    stripped = stripped.slice(0, unclosedFence.index)
  } else {
    const unclosedTag = stripped.match(/<(tutor[-_]tool|tutor[-_]choices)>([\s\S]*)$/i)
    if (unclosedTag) {
      const normalized = unclosedTag[1].toLowerCase().replace('_', '-')
      const body = unclosedTag[2] ?? ''
      if (!streaming) {
        if (normalized === 'tutor-tool') {
          const parsed = parseToolJson(body, callCounter++)
          toolCalls.push(...parsed)
        } else {
          const parsed = parseChoicesJson(body)
          if (parsed.length > 0) {
            choices = parsed
          }
        }
      } else if (normalized === 'tutor-tool') {
        pendingToolLabel = describePendingTool(body)
      }
      stripped = stripped.slice(0, unclosedTag.index)
    } else if (streaming) {
      // 防止刚吐出 "```tutor" 几个字符时闪现
      const partialFence = stripped.match(
        /```(?:t(?:u(?:t(?:o(?:r(?:[-_]?(?:t(?:o(?:o(?:l)?)?)?|c(?:h(?:o(?:i(?:c(?:e(?:s)?)?)?)?)?)?)?)?)?)?)?)?)?$/i
      )
      if (partialFence) {
        stripped = stripped.slice(0, partialFence.index)
      }
    }
  }

  return {
    cleanMarkdown: stripped.replace(/\n{3,}/g, '\n\n').trim(),
    toolCalls,
    pendingToolLabel,
    choices,
  }
}

export const isCoordinateTool = (tool: TutorToolName): boolean => tool.startsWith('coord_')

export const isFlowchartTool = (tool: TutorToolName): boolean => tool.startsWith('flow_')

export const getToolBoardMode = (call: TutorToolCall): CanvasMode | null => {
  if (call.tool === 'board_switch') {
    return call.args.mode === 'flowchart' ? 'flowchart' : 'coordinate'
  }
  if (isCoordinateTool(call.tool)) {
    return 'coordinate'
  }
  if (isFlowchartTool(call.tool)) {
    return 'flowchart'
  }
  return null
}

/** 提取某次工具调用对应的主元素 ID，用于在点击回复中的工具卡片时聚焦高亮 */
export const getToolTargetId = (call: TutorToolCall): string | null => {
  const { args } = call
  if (typeof args.id === 'string' && args.id.trim()) {
    return args.id.trim()
  }
  if (typeof args.pointId === 'string' && args.pointId.trim()) {
    return args.pointId.trim()
  }
  if (Array.isArray(args.ids) && typeof args.ids[0] === 'string') {
    return args.ids[0]
  }
  return null
}
