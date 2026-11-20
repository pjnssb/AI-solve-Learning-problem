import type { ParsedTutorReply, TutorToolCall, TutorToolName } from './types.js'

const VALID_TOOLS = new Set<TutorToolName>([
  'coord_setup',
  'coord_plot_point',
  'coord_add_moving_point',
  'coord_draw_segment',
  'coord_draw_function',
  'coord_draw_polygon',
  'coord_draw_circle',
  'coord_draw_auxiliary_line',
  'coord_add_measurement',
  'coord_set_t',
  'coord_highlight',
  'coord_clear',
  'geogebra_eval',
  'geogebra_style',
  'geogebra_animate',
  'geogebra_clear',
  'flow_init',
  'flow_add_node',
  'flow_add_edge',
  'flow_update_node',
  'flow_highlight',
  'flow_clear',
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const defaultSummary = (tool: TutorToolName, args: Record<string, unknown>): string => {
  const label = typeof args.label === 'string' && args.label ? args.label : ''
  const title = typeof args.title === 'string' && args.title ? args.title : ''
  switch (tool) {
    case 'coord_setup':
      return title ? `初始化坐标系：${title}` : '初始化数学坐标系'
    case 'coord_plot_point':
      return `标出点 ${label || String(args.id ?? '')}`
    case 'coord_add_moving_point':
      return `添加动点 ${label || String(args.id ?? 'P')}`
    case 'coord_draw_segment':
      return `连接线段 ${label || `${String(args.fromId ?? '')}${String(args.toId ?? '')}`}`
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
    case 'coord_set_t':
      return `移动动点至目标位置`
    case 'coord_highlight':
      return `高亮当前步骤关键元素`
    case 'coord_clear':
      return `清空坐标系画板`
    case 'geogebra_eval':
      return `GeoGebra 执行作图指令`
    case 'geogebra_style':
      return `GeoGebra 设置对象样式`
    case 'geogebra_animate':
      return `GeoGebra 控制动点动画`
    case 'geogebra_clear':
      return `重置 GeoGebra 画板`
    case 'flow_init':
      return title ? `创建流程图：${title}` : '创建思维流程图'
    case 'flow_add_node':
      return `新增流程节点：${label || String(args.id ?? '')}`
    case 'flow_add_edge':
      return `连接流程步骤 ${String(args.from ?? '')} → ${String(args.to ?? '')}`
    case 'flow_update_node':
      return `补全节点答案：${label || String(args.id ?? '')}`
    case 'flow_highlight':
      return `高亮流程图当前步骤`
    case 'flow_clear':
      return `清空流程图画板`
  }
}

const parseToolJson = (rawJson: string, index: number): TutorToolCall[] => {
  try {
    const parsed: unknown = JSON.parse(rawJson.trim())
    const items = Array.isArray(parsed) ? parsed : [parsed]
    const calls: TutorToolCall[] = []
    items.forEach((item, subIndex) => {
      if (!isRecord(item)) {
        return
      }
      const toolName =
        typeof item.tool === 'string' ? item.tool : typeof item.name === 'string' ? item.name : ''
      if (!VALID_TOOLS.has(toolName as TutorToolName)) {
        return
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
      calls.push({
        id: `tool-${index}-${subIndex}-${tool}`,
        tool,
        summary,
        args,
      })
    })
    return calls
  } catch {
    return []
  }
}

const parseChoicesJson = (rawJson: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(rawJson.trim())
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim())
      .slice(0, 4)
  } catch {
    return []
  }
}

/**
 * 实时解析流式或已完成的 AI 导师文本：
 * - 抽出完整的 ```tutor-tool ... ```（以及兼容的 <tutor_tool>...</tutor_tool>）工具调用
 * - 抽出 ```tutor-choices ... ``` 启发式快捷回复选项
 * - 在流式尚未闭合工具块时自动隐藏原始 JSON，并给出 pendingToolLabel 供 UI 显示友好动画
 */
export const parseTutorReply = (rawText: string): ParsedTutorReply => {
  const toolCalls: TutorToolCall[] = []
  let choices: string[] = []
  let callCounter = 0

  // 1. 解析完整的代码块格式：```tutor-tool ... ``` 与 ```tutor-choices ... ```
  let stripped = rawText.replace(
    /```(tutor-tool|tutor-choices)\s*\n([\s\S]*?)```/g,
    (_match, kind: string, body: string) => {
      if (kind === 'tutor-tool') {
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

  // 2. 兼容 XML 标签格式：<tutor_tool>...</tutor_tool> 与 <tutor_choices>...</tutor_choices>
  stripped = stripped.replace(
    /<(tutor_tool|tutor_choices)>([\s\S]*?)<\/\1>/g,
    (_match, kind: string, body: string) => {
      if (kind === 'tutor_tool') {
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

  // 3. 流式阶段：若末尾存在尚未闭合的 tutor-tool / tutor-choices 块，平滑隐藏原始 JSON
  let pendingToolLabel: string | null = null
  const unclosedFence = stripped.match(/```(tutor-tool|tutor-choices)[\s\S]*$/)
  if (unclosedFence) {
    if (unclosedFence[1] === 'tutor-tool') {
      pendingToolLabel = 'Agent 正在调用画板工具...'
    }
    stripped = stripped.slice(0, unclosedFence.index)
  } else {
    const unclosedTag = stripped.match(/<(tutor_tool|tutor_choices)>[\s\S]*$/)
    if (unclosedTag) {
      if (unclosedTag[1] === 'tutor_tool') {
        pendingToolLabel = 'Agent 正在调用画板工具...'
      }
      stripped = stripped.slice(0, unclosedTag.index)
    } else {
      // 防止刚吐出 "```tutor" 几个字符时闪现
      const partialFence = stripped.match(
        /```(?:t(?:u(?:t(?:o(?:r(?:-?(?:t(?:o(?:o(?:l)?)?)?|c(?:h(?:o(?:i(?:c(?:e(?:s)?)?)?)?)?)?)?)?)?)?)?)?)?$/
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

export const isGeoGebraTool = (tool: TutorToolName): boolean => tool.startsWith('geogebra_')

export const isCoordinateTool = (tool: TutorToolName): boolean =>
  tool.startsWith('coord_') || tool.startsWith('geogebra_')

export const isFlowchartTool = (tool: TutorToolName): boolean => tool.startsWith('flow_')
