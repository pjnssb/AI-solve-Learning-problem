import { ApiError, streamMessage } from '../api/client.js'
import { readServerSentEvents } from '../api/sse.js'
import type { MessageStreamEvent, MessageUsage, StopReason } from '../api/types.js'
import { appendCanvasContext, getContextRounds, getReplyText } from '../chat/reply.js'
import type { AssistantMessage, Message, UserMessage } from '../chat/types.js'
import type { ProviderConfig } from './providers.js'

type SimpleRoleMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

type CacheControlBlock = {
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral' }
}

const CONTINUE_PROMPT =
  '请紧接你上一条未完成的输出继续生成，不要重复任何已输出的内容，也不要加开场白。'

const normalizeApiKey = (raw: string): string =>
  raw
    .trim()
    .replace(/^Bearer\s+/i, '')
    .trim()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const toNonNegativeInt = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0

/**
 * 构建前缀完全稳定的多轮消息列表：
 * - systemPrompt 保持纯静态，不混入动态画板状态；
 * - 画板实时状态快照仅在首次出现或发生变化时附加到对应轮次的用户消息末尾，并随回复版本固化，
 *   避免历史轮次发生任何字节偏移，从而最大化各模型服务商的 Prompt KV 缓存命中率；
 * - 当前轮与历史轮采用完全一致的文本规范化；
 * - 续写时保留已输出的 assistant 前缀并附加续写指令，既不重复输出也能命中已有缓存前缀。
 */
const buildSimpleMessages = (
  systemPrompt: string,
  history: Message[],
  question: UserMessage,
  canvasContext?: string,
  prefix?: AssistantMessage
): SimpleRoleMessage[] => {
  const result: SimpleRoleMessage[] = [{ role: 'system', content: systemPrompt }]
  let previousCanvasContext: string | undefined
  const resolveCanvasSnapshot = (snapshot: string | undefined): string | undefined => {
    if (snapshot && snapshot !== previousCanvasContext) {
      previousCanvasContext = snapshot
      return snapshot
    }
    return undefined
  }
  for (const [user, reply] of getContextRounds(history)) {
    const userBase = user.content.trim()
    const replyText = getReplyText(reply)
    if (userBase && replyText.trim()) {
      const userContent = appendCanvasContext(userBase, resolveCanvasSnapshot(reply.canvasContext))
      result.push({ role: 'user', content: userContent })
      result.push({ role: 'assistant', content: replyText })
    }
  }
  const currentContent = appendCanvasContext(
    question.content.trim(),
    resolveCanvasSnapshot(canvasContext)
  )
  result.push({ role: 'user', content: currentContent })

  if (prefix?.prefix) {
    const partialText = getReplyText(prefix)
    if (partialText.trim()) {
      result.push({ role: 'assistant', content: partialText })
      result.push({ role: 'user', content: CONTINUE_PROMPT })
    }
  }
  return result
}

const readHttpError = async (response: Response): Promise<ApiError> => {
  const text = await response.text().catch(() => '')
  let message = text || response.statusText || `HTTP ${response.status}`
  try {
    const json = JSON.parse(text) as { error?: { message?: string }; message?: string }
    if (json.error?.message) {
      message = json.error.message
    } else if (json.message) {
      message = json.message
    }
  } catch {
    // 保留原始响应文案
  }
  return new ApiError('http', message, response.status)
}

/**
 * 解析网关地址候选列表：
 * - 剥离误粘贴的 /models、/chat/completions、/completions、/messages 后缀
 * - 纯域名自动补全 /v1；带子路径且无版本段时保留原路径并附带 /v1 兜底候选
 */
const resolveEndpointCandidates = (rawBase: string, endpointSuffix: string): string[] => {
  const trimmed = rawBase.trim().replace(/\/+$/, '')
  if (trimmed.endsWith(endpointSuffix)) {
    return [trimmed]
  }
  const base = trimmed.replace(/\/(chat\/completions|completions|messages|models)$/i, '')
  try {
    const parsed = new URL(base)
    if (parsed.pathname === '' || parsed.pathname === '/') {
      return [`${base}/v1${endpointSuffix}`]
    }
  } catch {
    // 忽略非标准相对路径
  }
  const candidates = [`${base}${endpointSuffix}`]
  if (!/\/v\d+(?:alpha|beta)?$/i.test(base)) {
    candidates.push(`${base}/v1${endpointSuffix}`)
  }
  return candidates
}

/**
 * 流式 <think>...</think> / <thought>...</thought> 标签拆分器：
 * 兼容 Ollama / vLLM / SiliconFlow / OpenRouter / 各类自建中转站把思维链内嵌在 content 里的情况。
 */
const createThinkTagSplitter = () => {
  const OPEN_TAGS = ['<think>', '<thought>']
  const CLOSE_TAGS = ['</think>', '</thought>']
  let inThink = false
  let buffer = ''

  const findPartialSuffixLen = (str: string, tags: string[]): number => {
    const lower = str.toLowerCase()
    const maxCheck = Math.min(str.length, 10)
    for (let len = maxCheck; len >= 1; len -= 1) {
      const suffix = lower.slice(-len)
      if (tags.some((tag) => tag.startsWith(suffix))) {
        return len
      }
    }
    return 0
  }

  const push = (chunk: string): { kind: 'thinking' | 'text'; text: string }[] => {
    buffer += chunk
    const out: { kind: 'thinking' | 'text'; text: string }[] = []

    while (buffer.length > 0) {
      const lower = buffer.toLowerCase()
      if (!inThink) {
        let foundIdx = -1
        let foundLen = 0
        for (const tag of OPEN_TAGS) {
          const idx = lower.indexOf(tag)
          if (idx !== -1 && (foundIdx === -1 || idx < foundIdx)) {
            foundIdx = idx
            foundLen = tag.length
          }
        }
        if (foundIdx !== -1) {
          if (foundIdx > 0) {
            out.push({ kind: 'text', text: buffer.slice(0, foundIdx) })
          }
          buffer = buffer.slice(foundIdx + foundLen)
          inThink = true
          continue
        }
        const hold = findPartialSuffixLen(buffer, OPEN_TAGS)
        const emitLen = buffer.length - hold
        if (emitLen > 0) {
          out.push({ kind: 'text', text: buffer.slice(0, emitLen) })
          buffer = buffer.slice(emitLen)
        }
        break
      } else {
        let foundIdx = -1
        let foundLen = 0
        for (const tag of CLOSE_TAGS) {
          const idx = lower.indexOf(tag)
          if (idx !== -1 && (foundIdx === -1 || idx < foundIdx)) {
            foundIdx = idx
            foundLen = tag.length
          }
        }
        if (foundIdx !== -1) {
          if (foundIdx > 0) {
            out.push({ kind: 'thinking', text: buffer.slice(0, foundIdx) })
          }
          buffer = buffer.slice(foundIdx + foundLen)
          inThink = false
          continue
        }
        const hold = findPartialSuffixLen(buffer, CLOSE_TAGS)
        const emitLen = buffer.length - hold
        if (emitLen > 0) {
          out.push({ kind: 'thinking', text: buffer.slice(0, emitLen) })
          buffer = buffer.slice(emitLen)
        }
        break
      }
    }

    return out
  }

  const flush = (): { kind: 'thinking' | 'text'; text: string }[] => {
    if (!buffer) {
      return []
    }
    const item = { kind: inThink ? ('thinking' as const) : ('text' as const), text: buffer }
    buffer = ''
    return [item]
  }

  return { push, flush }
}

const extractOpenAiReasoning = (delta: Record<string, unknown> | undefined): string => {
  if (!delta) {
    return ''
  }
  if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
    return delta.reasoning_content
  }
  if (typeof delta.reasoning === 'string' && delta.reasoning.length > 0) {
    return delta.reasoning
  }
  if (typeof delta.thinking === 'string' && delta.thinking.length > 0) {
    return delta.thinking
  }
  if (Array.isArray(delta.reasoning_details)) {
    const parts = delta.reasoning_details
      .map((item) => {
        if (isRecord(item)) {
          if (typeof item.text === 'string') {
            return item.text
          }
          if (typeof item.summary === 'string') {
            return item.summary
          }
        }
        return ''
      })
      .filter(Boolean)
    if (parts.length > 0) {
      return parts.join('')
    }
  }
  return ''
}

const extractOpenAiContentParts = (
  content: unknown
): { kind: 'thinking' | 'text'; text: string }[] => {
  if (typeof content === 'string') {
    return content.length > 0 ? [{ kind: 'text', text: content }] : []
  }
  if (!Array.isArray(content)) {
    return []
  }
  const pieces: { kind: 'thinking' | 'text'; text: string }[] = []
  for (const part of content) {
    if (!isRecord(part)) {
      continue
    }
    const type = typeof part.type === 'string' ? part.type : ''
    if (type === 'thinking' || type === 'reasoning') {
      const value =
        typeof part.thinking === 'string'
          ? part.thinking
          : typeof part.text === 'string'
            ? part.text
            : ''
      if (value) {
        pieces.push({ kind: 'thinking', text: value })
      }
    } else if (typeof part.text === 'string' && part.text.length > 0) {
      pieces.push({ kind: 'text', text: part.text })
    }
  }
  return pieces
}

const parseOpenAiUsage = (raw: unknown): MessageUsage | undefined => {
  if (!isRecord(raw)) {
    return undefined
  }
  const promptTokens = toNonNegativeInt(raw.prompt_tokens)
  const outputTokens = toNonNegativeInt(raw.completion_tokens)
  const details = isRecord(raw.prompt_tokens_details) ? raw.prompt_tokens_details : undefined
  const cacheRead =
    toNonNegativeInt(raw.prompt_cache_hit_tokens) ||
    toNonNegativeInt(raw.cache_read_input_tokens) ||
    toNonNegativeInt(details?.cached_tokens)
  const cacheCreation = toNonNegativeInt(raw.cache_creation_input_tokens)
  if (promptTokens === 0 && outputTokens === 0 && cacheRead === 0 && cacheCreation === 0) {
    return undefined
  }
  const uncachedInput =
    typeof raw.prompt_cache_miss_tokens === 'number' &&
    Number.isFinite(raw.prompt_cache_miss_tokens)
      ? toNonNegativeInt(raw.prompt_cache_miss_tokens)
      : Math.max(0, promptTokens - cacheRead - cacheCreation)
  return {
    input_tokens: uncachedInput,
    cache_creation_input_tokens: cacheCreation,
    cache_read_input_tokens: cacheRead,
    output_tokens: outputTokens,
  }
}

const mapOpenAiFinishReason = (reason: string | null | undefined): StopReason => {
  if (reason === 'length') {
    return 'max_tokens'
  }
  if (reason === 'content_filter') {
    return 'refusal'
  }
  return 'end_turn'
}

const isOpenAiReasoningOnlyModel = (modelId: string): boolean =>
  /(?:^|\/)(?:o1|o3|o4)(?:[-.]|$)/i.test(modelId.trim())

const supportsOpenRouterCacheControl = (provider: ProviderConfig, modelId: string): boolean => {
  if (provider.id !== 'openrouter') {
    return false
  }
  const lower = modelId.toLowerCase()
  return lower.includes('claude') || lower.includes('anthropic') || lower.includes('gemini')
}

const attachOpenRouterCacheControl = (
  messages: SimpleRoleMessage[]
): Array<{ role: SimpleRoleMessage['role']; content: string | CacheControlBlock[] }> => {
  const historyBreakpointIndex = messages.length >= 3 ? messages.length - 2 : -1
  return messages.map((message, index) => {
    if (index === 0 || index === historyBreakpointIndex) {
      return {
        role: message.role,
        content: [
          {
            type: 'text',
            text: message.content,
            cache_control: { type: 'ephemeral' },
          },
        ],
      }
    }
    return message
  })
}

const buildOpenAiThinkingExtras = (
  provider: ProviderConfig,
  modelId: string,
  thinking: boolean
): Record<string, unknown> | null => {
  if (!thinking) {
    return null
  }
  if (provider.id === 'deepseek' && !modelId.toLowerCase().includes('reasoner')) {
    return { thinking: { type: 'enabled' } }
  }
  if (provider.id === 'openrouter') {
    return { reasoning: { enabled: true } }
  }
  if (provider.id === 'qwen' && !modelId.toLowerCase().startsWith('qwq')) {
    return { enable_thinking: true }
  }
  return null
}

/**
 * OpenAI 兼容协议流式请求（兼容 OpenAI / DeepSeek / OpenRouter / 通义千问 / 硅基流动 / 本地 Ollama 等）。
 * 自动解析 reasoning_content / reasoning / reasoning_details / thinking 以及 <think>...</think> 内嵌思维链，
 * 并通过稳定前缀、prompt_cache_key、OpenRouter cache_control 与完整断流检测提升缓存命中率与稳定性。
 */
async function* streamOpenAiCompatible(
  provider: ProviderConfig,
  modelId: string,
  systemPrompt: string,
  history: Message[],
  question: UserMessage,
  thinking: boolean,
  signal: AbortSignal,
  canvasContext?: string,
  prefix?: AssistantMessage,
  sessionId?: string
): AsyncGenerator<MessageStreamEvent> {
  const urlCandidates = resolveEndpointCandidates(provider.baseUrl, '/chat/completions')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  }
  const apiKey = normalizeApiKey(provider.apiKey)
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  const simpleMessages = buildSimpleMessages(systemPrompt, history, question, canvasContext, prefix)
  const basePayload: Record<string, unknown> = {
    model: modelId,
    messages: simpleMessages,
    stream: true,
    ...(isOpenAiReasoningOnlyModel(modelId) ? {} : { temperature: 0.5 }),
  }
  const thinkingExtra = buildOpenAiThinkingExtras(provider, modelId, thinking)
  const cacheExtras: Record<string, unknown> = {
    stream_options: { include_usage: true },
    ...(provider.id === 'openai' && sessionId ? { prompt_cache_key: sessionId } : {}),
  }
  const cachedMessages = supportsOpenRouterCacheControl(provider, modelId)
    ? attachOpenRouterCacheControl(simpleMessages)
    : simpleMessages

  const payloadVariants: Record<string, unknown>[] = []
  const primaryPayload: Record<string, unknown> = {
    ...basePayload,
    messages: cachedMessages,
    ...cacheExtras,
    ...(thinkingExtra ?? {}),
  }
  payloadVariants.push(primaryPayload)
  if (thinkingExtra) {
    payloadVariants.push({ ...basePayload, ...thinkingExtra })
  }
  payloadVariants.push(basePayload)

  let response: Response | null = null
  outer: for (let idx = 0; idx < urlCandidates.length; idx += 1) {
    const url = urlCandidates[idx]
    for (let pIdx = 0; pIdx < payloadVariants.length; pIdx += 1) {
      try {
        const attempt = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payloadVariants[pIdx]),
          signal,
        })
        if (attempt.status === 400 && pIdx + 1 < payloadVariants.length) {
          continue
        }
        if ((attempt.status === 404 || attempt.status === 405) && idx + 1 < urlCandidates.length) {
          continue outer
        }
        response = attempt
        break outer
      } catch (error) {
        if (signal.aborted) {
          throw error
        }
        if (idx + 1 < urlCandidates.length) {
          continue outer
        }
        throw new ApiError('network', error instanceof Error ? error.message : String(error))
      }
    }
  }

  if (!response) {
    throw new ApiError('network', '无法连接到模型接口')
  }
  if (!response.ok) {
    throw await readHttpError(response)
  }
  if (!response.body) {
    throw new ApiError('protocol', '服务端未返回可读的流式响应体')
  }

  let nextBlockIndex = 0
  let thinkingIndex: number | null = null
  let thinkingClosed = false
  let textIndex: number | null = null
  let hasThinking = false
  let hasText = false
  let stopReason: StopReason = 'end_turn'
  let latestUsage: MessageUsage | undefined
  const splitter = createThinkTagSplitter()

  const emitThinking = function* (chunkText: string): Generator<MessageStreamEvent> {
    if (!chunkText) {
      return
    }
    hasThinking = true
    if (thinkingIndex === null || thinkingClosed) {
      thinkingIndex = nextBlockIndex++
      thinkingClosed = false
      yield {
        type: 'content_block_start',
        index: thinkingIndex,
        content_block: { type: 'thinking', thinking: '', signature: '' },
      }
    }
    yield {
      type: 'content_block_delta',
      index: thinkingIndex,
      delta: { type: 'thinking_delta', thinking: chunkText },
    }
  }

  const emitText = function* (chunkText: string): Generator<MessageStreamEvent> {
    if (!chunkText) {
      return
    }
    hasText = true
    if (thinkingIndex !== null && !thinkingClosed) {
      yield { type: 'content_block_stop', index: thinkingIndex }
      thinkingClosed = true
    }
    if (textIndex === null) {
      textIndex = nextBlockIndex++
      yield {
        type: 'content_block_start',
        index: textIndex,
        content_block: { type: 'text', text: '' },
      }
    }
    yield {
      type: 'content_block_delta',
      index: textIndex,
      delta: { type: 'text_delta', text: chunkText },
    }
  }

  // 兼容部分中转站以 HTTP 200 + application/json 返回错误或非流式完整结果
  const contentType = (response.headers.get('Content-Type') ?? '').toLowerCase()
  if (contentType.includes('application/json') && !contentType.includes('text/event-stream')) {
    const rawText = await response.text().catch(() => '')
    let json: {
      choices?: { message?: Record<string, unknown>; finish_reason?: string | null }[]
      usage?: unknown
      error?: { message?: string }
      message?: string
    }
    try {
      json = JSON.parse(rawText) as typeof json
    } catch {
      throw new ApiError('protocol', rawText || '服务端返回了非流式异常响应')
    }
    if (json.error?.message) {
      throw new ApiError('stream', json.error.message)
    }
    const choice = json.choices?.[0]
    if (!choice?.message) {
      throw new ApiError('stream', json.message || '服务端未返回有效回复')
    }
    latestUsage = parseOpenAiUsage(json.usage)
    yield {
      type: 'message_start',
      message: { id: `openai-${Date.now()}`, model: modelId, usage: latestUsage },
    }
    const reasoning = extractOpenAiReasoning(choice.message)
    if (reasoning) {
      yield* emitThinking(reasoning)
    }
    for (const part of extractOpenAiContentParts(choice.message.content)) {
      if (part.kind === 'thinking') {
        yield* emitThinking(part.text)
      } else {
        for (const piece of splitter.push(part.text)) {
          if (piece.kind === 'thinking') {
            yield* emitThinking(piece.text)
          } else {
            yield* emitText(piece.text)
          }
        }
      }
    }
    for (const piece of splitter.flush()) {
      if (piece.kind === 'thinking') {
        yield* emitThinking(piece.text)
      } else {
        yield* emitText(piece.text)
      }
    }
    if (thinkingIndex !== null && !thinkingClosed) {
      yield { type: 'content_block_stop', index: thinkingIndex }
    }
    if (textIndex !== null) {
      yield { type: 'content_block_stop', index: textIndex }
    }
    stopReason = mapOpenAiFinishReason(choice.finish_reason)
    if (!hasThinking && !hasText && stopReason !== 'refusal') {
      throw new ApiError('interrupted', '')
    }
    yield {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: latestUsage,
    }
    yield { type: 'message_stop' }
    return
  }

  yield {
    type: 'message_start',
    message: { id: `openai-${Date.now()}`, model: modelId },
  }

  let receivedDone = false
  let receivedFinishReason: string | null = null

  try {
    for await (const { event: eventName, data } of readServerSentEvents(response.body, signal)) {
      const trimmed = data.trim()
      if (!trimmed) {
        continue
      }
      if (trimmed === '[DONE]') {
        receivedDone = true
        break
      }
      let chunk: {
        choices?: {
          delta?: Record<string, unknown>
          finish_reason?: string | null
        }[]
        usage?: unknown
        error?: { message?: string }
      }
      try {
        chunk = JSON.parse(trimmed) as typeof chunk
      } catch {
        if (eventName === 'error') {
          throw new ApiError('stream', trimmed)
        }
        continue
      }
      if (chunk.error?.message) {
        throw new ApiError('stream', chunk.error.message)
      }
      if (eventName === 'error') {
        throw new ApiError('stream', trimmed)
      }
      const parsedUsage = parseOpenAiUsage(chunk.usage)
      if (parsedUsage) {
        latestUsage = parsedUsage
      }
      const choice = chunk.choices?.[0]
      if (!choice) {
        continue
      }
      if (typeof choice.finish_reason === 'string' && choice.finish_reason.length > 0) {
        receivedFinishReason = choice.finish_reason
        stopReason = mapOpenAiFinishReason(choice.finish_reason)
      }
      const reasoning = extractOpenAiReasoning(choice.delta)
      if (reasoning) {
        yield* emitThinking(reasoning)
      }
      for (const part of extractOpenAiContentParts(choice.delta?.content)) {
        if (part.kind === 'thinking') {
          yield* emitThinking(part.text)
        } else {
          for (const piece of splitter.push(part.text)) {
            if (piece.kind === 'thinking') {
              yield* emitThinking(piece.text)
            } else {
              yield* emitText(piece.text)
            }
          }
        }
      }
    }
  } catch (error) {
    if (signal.aborted || error instanceof ApiError) {
      throw error
    }
    throw new ApiError('interrupted', error instanceof Error ? error.message : String(error))
  }

  for (const piece of splitter.flush()) {
    if (piece.kind === 'thinking') {
      yield* emitThinking(piece.text)
    } else {
      yield* emitText(piece.text)
    }
  }

  if (thinkingIndex !== null && !thinkingClosed) {
    yield { type: 'content_block_stop', index: thinkingIndex }
  }
  if (textIndex !== null) {
    yield { type: 'content_block_stop', index: textIndex }
  }

  // 未收到 [DONE] 且未收到任何 finish_reason 说明底层流异常断开，不能伪装成正常完成
  if (!receivedDone && !receivedFinishReason) {
    throw new ApiError('interrupted', '')
  }
  if (!hasThinking && !hasText && stopReason !== 'refusal') {
    throw new ApiError('interrupted', '')
  }

  yield {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: latestUsage,
  }
  yield { type: 'message_stop' }
}

const parseAnthropicUsage = (raw: unknown, previous?: MessageUsage): MessageUsage | undefined => {
  if (!isRecord(raw)) {
    return previous
  }
  const hasInput = typeof raw.input_tokens === 'number'
  const hasCacheCreate = typeof raw.cache_creation_input_tokens === 'number'
  const hasCacheRead = typeof raw.cache_read_input_tokens === 'number'
  const hasOutput = typeof raw.output_tokens === 'number'
  if (!hasInput && !hasCacheCreate && !hasCacheRead && !hasOutput) {
    return previous
  }
  return {
    input_tokens: hasInput ? toNonNegativeInt(raw.input_tokens) : (previous?.input_tokens ?? 0),
    cache_creation_input_tokens: hasCacheCreate
      ? toNonNegativeInt(raw.cache_creation_input_tokens)
      : (previous?.cache_creation_input_tokens ?? 0),
    cache_read_input_tokens: hasCacheRead
      ? toNonNegativeInt(raw.cache_read_input_tokens)
      : (previous?.cache_read_input_tokens ?? 0),
    output_tokens: hasOutput ? toNonNegativeInt(raw.output_tokens) : (previous?.output_tokens ?? 0),
  }
}

const mapAnthropicStopReason = (reason: string | undefined): StopReason => {
  if (reason === 'max_tokens') {
    return 'max_tokens'
  }
  if (reason === 'refusal') {
    return 'refusal'
  }
  if (reason === 'tool_use') {
    return 'tool_use'
  }
  return 'end_turn'
}

/**
 * 标准 Anthropic Messages API 流式请求（兼容 Claude 官方接口与 OneAPI/NewAPI 等 Bearer 鉴权代理）。
 * 自动为静态 system prompt 和历史最后一轮注入 ephemeral cache_control 断点以启用 Prompt Caching，
 * 并在第三方代理不支持时自动降级回普通格式。
 */
async function* streamAnthropicStandard(
  provider: ProviderConfig,
  modelId: string,
  systemPrompt: string,
  history: Message[],
  question: UserMessage,
  thinking: boolean,
  signal: AbortSignal,
  canvasContext?: string,
  prefix?: AssistantMessage
): AsyncGenerator<MessageStreamEvent> {
  const urlCandidates = resolveEndpointCandidates(provider.baseUrl, '/messages')
  const plainMessages = buildSimpleMessages(systemPrompt, history, question, canvasContext, prefix)
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }))

  const historyBreakpointIndex = plainMessages.length >= 2 ? plainMessages.length - 2 : -1
  const cachedMessages = plainMessages.map((m, index) =>
    index === historyBreakpointIndex
      ? {
          role: m.role,
          content: [
            {
              type: 'text' as const,
              text: m.content,
              cache_control: { type: 'ephemeral' as const },
            },
          ],
        }
      : m
  )
  const cachedSystem: CacheControlBlock[] = [
    {
      type: 'text',
      text: systemPrompt,
      cache_control: { type: 'ephemeral' },
    },
  ]

  const cachedBase: Record<string, unknown> = {
    model: modelId,
    max_tokens: 8192,
    system: cachedSystem,
    messages: cachedMessages,
    stream: true,
  }
  const plainFallback: Record<string, unknown> = {
    model: modelId,
    max_tokens: 4096,
    system: systemPrompt,
    messages: plainMessages,
    stream: true,
  }

  const payloadVariants: Record<string, unknown>[] = thinking
    ? [
        {
          ...cachedBase,
          max_tokens: 16384,
          thinking: { type: 'enabled', budget_tokens: 8192 },
        },
        {
          ...cachedBase,
          max_tokens: 8192,
          thinking: { type: 'enabled', budget_tokens: 2048 },
        },
        cachedBase,
        plainFallback,
      ]
    : [cachedBase, plainFallback]

  const apiKey = normalizeApiKey(provider.apiKey)
  const headerVariants: Record<string, string>[] = [
    {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    ...(apiKey
      ? [
          {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            Authorization: `Bearer ${apiKey}`,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
        ]
      : []),
  ]

  let response: Response | null = null
  outer: for (let uIdx = 0; uIdx < urlCandidates.length; uIdx += 1) {
    const url = urlCandidates[uIdx]
    for (let hIdx = 0; hIdx < headerVariants.length; hIdx += 1) {
      const headers = headerVariants[hIdx]
      for (let pIdx = 0; pIdx < payloadVariants.length; pIdx += 1) {
        try {
          const attempt = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payloadVariants[pIdx]),
            signal,
          })
          if (attempt.status === 400 && pIdx + 1 < payloadVariants.length) {
            continue
          }
          if (
            (attempt.status === 401 || attempt.status === 403) &&
            hIdx + 1 < headerVariants.length
          ) {
            break
          }
          if (
            (attempt.status === 404 || attempt.status === 405) &&
            uIdx + 1 < urlCandidates.length
          ) {
            continue outer
          }
          response = attempt
          break outer
        } catch (error) {
          if (signal.aborted) {
            throw error
          }
          if (uIdx + 1 < urlCandidates.length) {
            continue outer
          }
          throw new ApiError('network', error instanceof Error ? error.message : String(error))
        }
      }
    }
  }

  if (!response) {
    throw new ApiError('network', '无法连接到 Anthropic 接口')
  }
  if (!response.ok) {
    throw await readHttpError(response)
  }
  if (!response.body) {
    throw new ApiError('protocol', '服务端未返回流式响应')
  }

  // 兼容非流式 JSON 错误或完整返回
  const contentType = (response.headers.get('Content-Type') ?? '').toLowerCase()
  if (contentType.includes('application/json') && !contentType.includes('text/event-stream')) {
    const rawText = await response.text().catch(() => '')
    let json: {
      content?: { type?: string; text?: string; thinking?: string; signature?: string }[]
      stop_reason?: string
      usage?: unknown
      error?: { message?: string }
      message?: string
    }
    try {
      json = JSON.parse(rawText) as typeof json
    } catch {
      throw new ApiError('protocol', rawText || 'Anthropic 返回了非流式异常响应')
    }
    if (json.error?.message) {
      throw new ApiError('stream', json.error.message)
    }
    if (!Array.isArray(json.content)) {
      throw new ApiError('stream', json.message || 'Anthropic 未返回有效回复')
    }
    const usage = parseAnthropicUsage(json.usage)
    yield {
      type: 'message_start',
      message: { id: `anthropic-${Date.now()}`, model: modelId, usage },
    }
    let idx = 0
    for (const block of json.content) {
      if (block.type === 'thinking' && typeof block.thinking === 'string') {
        const mapped = idx++
        yield {
          type: 'content_block_start',
          index: mapped,
          content_block: {
            type: 'thinking',
            thinking: block.thinking,
            signature: block.signature ?? '',
          },
        }
        yield { type: 'content_block_stop', index: mapped }
      } else if (block.type === 'text' && typeof block.text === 'string') {
        const mapped = idx++
        yield {
          type: 'content_block_start',
          index: mapped,
          content_block: { type: 'text', text: block.text },
        }
        yield { type: 'content_block_stop', index: mapped }
      }
    }
    const stopReason = mapAnthropicStopReason(json.stop_reason)
    if (idx === 0 && stopReason !== 'refusal' && stopReason !== 'tool_use') {
      throw new ApiError('interrupted', '')
    }
    yield {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage,
    }
    yield { type: 'message_stop' }
    return
  }

  yield {
    type: 'message_start',
    message: { id: `anthropic-${Date.now()}`, model: modelId },
  }

  const indexMap = new Map<number, number>()
  const openMappedIndexes = new Set<number>()
  let nextIdx = 0
  let stopReason: StopReason = 'end_turn'
  let receivedStopReason = false
  let receivedMessageStop = false
  let hasThinking = false
  let hasText = false
  let latestUsage: MessageUsage | undefined

  try {
    for await (const { event: eventName, data } of readServerSentEvents(response.body, signal)) {
      let payload: {
        type?: string
        index?: number
        message?: { usage?: unknown }
        content_block?: { type?: string; text?: string; thinking?: string; signature?: string }
        delta?: {
          type?: string
          text?: string
          thinking?: string
          signature?: string
          stop_reason?: string
        }
        usage?: unknown
        error?: { message?: string }
      }
      try {
        payload = JSON.parse(data) as typeof payload
      } catch {
        if (eventName === 'error') {
          throw new ApiError('stream', data)
        }
        continue
      }
      if (payload.error?.message) {
        throw new ApiError('stream', payload.error.message)
      }
      if (eventName === 'error') {
        throw new ApiError('stream', data)
      }
      if (payload.type === 'message_start') {
        latestUsage = parseAnthropicUsage(payload.message?.usage, latestUsage)
        if (latestUsage) {
          yield {
            type: 'message_start',
            message: { id: `anthropic-${Date.now()}`, model: modelId, usage: latestUsage },
          }
        }
      } else if (payload.type === 'content_block_start' && typeof payload.index === 'number') {
        const kind = payload.content_block?.type
        if (kind === 'thinking' || kind === 'text') {
          const mapped = nextIdx++
          indexMap.set(payload.index, mapped)
          openMappedIndexes.add(mapped)
          if (kind === 'thinking' && payload.content_block?.thinking) {
            hasThinking = true
          }
          if (kind === 'text' && payload.content_block?.text) {
            hasText = true
          }
          yield {
            type: 'content_block_start',
            index: mapped,
            content_block:
              kind === 'thinking'
                ? {
                    type: 'thinking',
                    thinking: payload.content_block?.thinking ?? '',
                    signature: payload.content_block?.signature ?? '',
                  }
                : { type: 'text', text: payload.content_block?.text ?? '' },
          }
        }
      } else if (payload.type === 'content_block_delta' && typeof payload.index === 'number') {
        const mapped = indexMap.get(payload.index)
        if (mapped === undefined || !payload.delta) {
          continue
        }
        if (payload.delta.type === 'thinking_delta' && typeof payload.delta.thinking === 'string') {
          if (payload.delta.thinking.length > 0) {
            hasThinking = true
          }
          yield {
            type: 'content_block_delta',
            index: mapped,
            delta: { type: 'thinking_delta', thinking: payload.delta.thinking },
          }
        } else if (
          payload.delta.type === 'signature_delta' &&
          typeof payload.delta.signature === 'string'
        ) {
          yield {
            type: 'content_block_delta',
            index: mapped,
            delta: { type: 'signature_delta', signature: payload.delta.signature },
          }
        } else if (payload.delta.type === 'text_delta' && typeof payload.delta.text === 'string') {
          if (payload.delta.text.length > 0) {
            hasText = true
          }
          yield {
            type: 'content_block_delta',
            index: mapped,
            delta: { type: 'text_delta', text: payload.delta.text },
          }
        }
      } else if (payload.type === 'content_block_stop' && typeof payload.index === 'number') {
        const mapped = indexMap.get(payload.index)
        if (mapped !== undefined && openMappedIndexes.has(mapped)) {
          openMappedIndexes.delete(mapped)
          yield { type: 'content_block_stop', index: mapped }
        }
      } else if (payload.type === 'message_delta') {
        latestUsage = parseAnthropicUsage(payload.usage, latestUsage)
        if (
          typeof payload.delta?.stop_reason === 'string' &&
          payload.delta.stop_reason.length > 0
        ) {
          receivedStopReason = true
          stopReason = mapAnthropicStopReason(payload.delta.stop_reason)
        }
      } else if (payload.type === 'message_stop') {
        receivedMessageStop = true
        break
      }
    }
  } catch (error) {
    if (signal.aborted || error instanceof ApiError) {
      throw error
    }
    throw new ApiError('interrupted', error instanceof Error ? error.message : String(error))
  }

  for (const mapped of openMappedIndexes) {
    yield { type: 'content_block_stop', index: mapped }
  }

  if (!receivedMessageStop && !receivedStopReason) {
    throw new ApiError('interrupted', '')
  }
  if (!hasThinking && !hasText && stopReason !== 'refusal' && stopReason !== 'tool_use') {
    throw new ApiError('interrupted', '')
  }

  yield {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: latestUsage,
  }
  yield { type: 'message_stop' }
}

const parseGeminiUsage = (raw: unknown): MessageUsage | undefined => {
  if (!isRecord(raw)) {
    return undefined
  }
  const promptTokens = toNonNegativeInt(raw.promptTokenCount)
  const cachedTokens = toNonNegativeInt(raw.cachedContentTokenCount)
  const candidatesTokens = toNonNegativeInt(raw.candidatesTokenCount)
  const thoughtsTokens = toNonNegativeInt(raw.thoughtsTokenCount)
  const outputTokens = candidatesTokens + thoughtsTokens
  if (promptTokens === 0 && cachedTokens === 0 && outputTokens === 0) {
    return undefined
  }
  return {
    input_tokens: Math.max(0, promptTokens - cachedTokens),
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: cachedTokens,
    output_tokens: outputTokens,
  }
}

const mapGeminiFinishReason = (reason: string | undefined): StopReason => {
  if (reason === 'MAX_TOKENS') {
    return 'max_tokens'
  }
  if (
    reason === 'SAFETY' ||
    reason === 'RECITATION' ||
    reason === 'PROHIBITED_CONTENT' ||
    reason === 'BLOCKLIST' ||
    reason === 'SPII'
  ) {
    return 'refusal'
  }
  return 'end_turn'
}

/**
 * Google Gemini 原生 REST SSE 流式接口（streamGenerateContent?alt=sse）。
 * 支持 thinkingConfig.includeThoughts 开启思维链并分离 part.thought 输出；
 * 保持 systemInstruction 纯静态与历史前缀稳定，自动触发 Gemini 隐式上下文缓存。
 */
async function* streamGemini(
  provider: ProviderConfig,
  modelId: string,
  systemPrompt: string,
  history: Message[],
  question: UserMessage,
  thinking: boolean,
  signal: AbortSignal,
  canvasContext?: string,
  prefix?: AssistantMessage
): AsyncGenerator<MessageStreamEvent> {
  const rawBase = provider.baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/models$/i, '')
  const baseCandidates = [rawBase]
  if (!/\/v\d+(?:alpha|beta)?$/i.test(rawBase)) {
    baseCandidates.push(`${rawBase}/v1beta`)
  }
  const apiKey = normalizeApiKey(provider.apiKey)
  const contents = buildSimpleMessages(systemPrompt, history, question, canvasContext, prefix)
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }))

  const baseBody = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: { temperature: 0.5 },
  }
  const payloadVariants = thinking
    ? [
        {
          ...baseBody,
          generationConfig: {
            temperature: 0.5,
            thinkingConfig: { includeThoughts: true },
          },
        },
        baseBody,
      ]
    : [baseBody]

  let response: Response | null = null
  outer: for (let bIdx = 0; bIdx < baseCandidates.length; bIdx += 1) {
    const base = baseCandidates[bIdx]
    const endpoint = `${base}/models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse`
    const attempts: { url: string; headers: Record<string, string> }[] = [
      {
        url: apiKey ? `${endpoint}&key=${encodeURIComponent(apiKey)}` : endpoint,
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'x-goog-api-key': apiKey } : {}),
        },
      },
      ...(apiKey
        ? [
            {
              url: endpoint,
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
              },
            },
          ]
        : []),
    ]
    for (let aIdx = 0; aIdx < attempts.length; aIdx += 1) {
      for (let pIdx = 0; pIdx < payloadVariants.length; pIdx += 1) {
        try {
          const attempt = await fetch(attempts[aIdx].url, {
            method: 'POST',
            headers: attempts[aIdx].headers,
            body: JSON.stringify(payloadVariants[pIdx]),
            signal,
          })
          if (attempt.status === 400 && pIdx + 1 < payloadVariants.length) {
            continue
          }
          if ((attempt.status === 401 || attempt.status === 403) && aIdx + 1 < attempts.length) {
            break
          }
          if (
            (attempt.status === 404 || attempt.status === 405) &&
            bIdx + 1 < baseCandidates.length
          ) {
            continue outer
          }
          response = attempt
          break outer
        } catch (error) {
          if (signal.aborted) {
            throw error
          }
          if (bIdx + 1 < baseCandidates.length) {
            continue outer
          }
          throw new ApiError('network', error instanceof Error ? error.message : String(error))
        }
      }
    }
  }

  if (!response) {
    throw new ApiError('network', '无法连接到 Gemini 接口')
  }
  if (!response.ok) {
    throw await readHttpError(response)
  }
  if (!response.body) {
    throw new ApiError('protocol', 'Gemini 未返回流式响应')
  }

  const state: {
    nextIdx: number
    thinkingIdx: number | null
    thinkingClosed: boolean
    textIdx: number | null
    hasThinking: boolean
    hasText: boolean
    stopReason: StopReason
    receivedFinishReason: boolean
    latestUsage: MessageUsage | undefined
  } = {
    nextIdx: 0,
    thinkingIdx: null,
    thinkingClosed: false,
    textIdx: null,
    hasThinking: false,
    hasText: false,
    stopReason: 'end_turn',
    receivedFinishReason: false,
    latestUsage: undefined,
  }

  const emitGeminiPayload = function* (payload: {
    candidates?: {
      content?: { parts?: { text?: string; thought?: boolean }[] }
      finishReason?: string
    }[]
    usageMetadata?: unknown
    error?: { message?: string }
  }): Generator<MessageStreamEvent> {
    if (payload.error?.message) {
      throw new ApiError('stream', payload.error.message)
    }
    const parsedUsage = parseGeminiUsage(payload.usageMetadata)
    if (parsedUsage) {
      state.latestUsage = parsedUsage
    }
    const candidate = payload.candidates?.[0]
    if (!candidate) {
      return
    }
    if (typeof candidate.finishReason === 'string' && candidate.finishReason.length > 0) {
      state.receivedFinishReason = true
      state.stopReason = mapGeminiFinishReason(candidate.finishReason)
    }
    const parts = candidate.content?.parts ?? []
    for (const part of parts) {
      if (typeof part.text !== 'string' || part.text.length === 0) {
        continue
      }
      if (part.thought) {
        state.hasThinking = true
        if (state.thinkingIdx === null || state.thinkingClosed) {
          state.thinkingIdx = state.nextIdx++
          state.thinkingClosed = false
          yield {
            type: 'content_block_start',
            index: state.thinkingIdx,
            content_block: { type: 'thinking', thinking: '', signature: '' },
          }
        }
        yield {
          type: 'content_block_delta',
          index: state.thinkingIdx,
          delta: { type: 'thinking_delta', thinking: part.text },
        }
      } else {
        state.hasText = true
        if (state.thinkingIdx !== null && !state.thinkingClosed) {
          yield { type: 'content_block_stop', index: state.thinkingIdx }
          state.thinkingClosed = true
        }
        if (state.textIdx === null) {
          state.textIdx = state.nextIdx++
          yield {
            type: 'content_block_start',
            index: state.textIdx,
            content_block: { type: 'text', text: '' },
          }
        }
        yield {
          type: 'content_block_delta',
          index: state.textIdx,
          delta: { type: 'text_delta', text: part.text },
        }
      }
    }
  }

  // 兼容非流式 JSON 返回
  const contentType = (response.headers.get('Content-Type') ?? '').toLowerCase()
  if (contentType.includes('application/json') && !contentType.includes('text/event-stream')) {
    const rawText = await response.text().catch(() => '')
    let parsed: unknown
    try {
      parsed = JSON.parse(rawText)
    } catch {
      throw new ApiError('protocol', rawText || 'Gemini 返回了非流式异常响应')
    }
    yield {
      type: 'message_start',
      message: { id: `gemini-${Date.now()}`, model: modelId },
    }
    const list = Array.isArray(parsed) ? parsed : [parsed]
    for (const item of list) {
      if (isRecord(item)) {
        yield* emitGeminiPayload(item as Parameters<typeof emitGeminiPayload>[0])
      }
    }
    if (state.thinkingIdx !== null && !state.thinkingClosed) {
      yield { type: 'content_block_stop', index: state.thinkingIdx }
    }
    if (state.textIdx !== null) {
      yield { type: 'content_block_stop', index: state.textIdx }
    }
    if (!state.hasThinking && !state.hasText && state.stopReason !== 'refusal') {
      throw new ApiError('interrupted', '')
    }
    yield {
      type: 'message_delta',
      delta: { stop_reason: state.stopReason, stop_sequence: null },
      usage: state.latestUsage,
    }
    yield { type: 'message_stop' }
    return
  }

  yield {
    type: 'message_start',
    message: { id: `gemini-${Date.now()}`, model: modelId },
  }

  try {
    for await (const { event: eventName, data } of readServerSentEvents(response.body, signal)) {
      let payload: Parameters<typeof emitGeminiPayload>[0]
      try {
        payload = JSON.parse(data) as Parameters<typeof emitGeminiPayload>[0]
      } catch {
        if (eventName === 'error') {
          throw new ApiError('stream', data)
        }
        continue
      }
      if (eventName === 'error' && !payload.error?.message) {
        throw new ApiError('stream', data)
      }
      yield* emitGeminiPayload(payload)
    }
  } catch (error) {
    if (signal.aborted || error instanceof ApiError) {
      throw error
    }
    throw new ApiError('interrupted', error instanceof Error ? error.message : String(error))
  }

  if (state.thinkingIdx !== null && !state.thinkingClosed) {
    yield { type: 'content_block_stop', index: state.thinkingIdx }
  }
  if (state.textIdx !== null) {
    yield { type: 'content_block_stop', index: state.textIdx }
  }

  if (!state.receivedFinishReason) {
    throw new ApiError('interrupted', '')
  }
  if (!state.hasThinking && !state.hasText && state.stopReason !== 'refusal') {
    throw new ApiError('interrupted', '')
  }

  yield {
    type: 'message_delta',
    delta: { stop_reason: state.stopReason, stop_sequence: null },
    usage: state.latestUsage,
  }
  yield { type: 'message_stop' }
}

/** 统一多服务商流式调用入口 */
export function streamMultiProviderMessage(options: {
  provider: ProviderConfig
  modelId: string
  systemPrompt: string
  history: Message[]
  question: UserMessage
  thinking: boolean
  signal: AbortSignal
  canvasContext?: string
  prefix?: AssistantMessage
  sessionId?: string
}): AsyncGenerator<MessageStreamEvent> {
  const {
    provider,
    modelId,
    systemPrompt,
    history,
    question,
    thinking,
    signal,
    canvasContext,
    prefix,
    sessionId,
  } = options
  if (provider.protocol === 'anthropic') {
    return streamAnthropicStandard(
      provider,
      modelId,
      systemPrompt,
      history,
      question,
      thinking,
      signal,
      canvasContext,
      prefix
    )
  }
  if (provider.protocol === 'gemini') {
    return streamGemini(
      provider,
      modelId,
      systemPrompt,
      history,
      question,
      thinking,
      signal,
      canvasContext,
      prefix
    )
  }
  return streamOpenAiCompatible(
    provider,
    modelId,
    systemPrompt,
    history,
    question,
    thinking,
    signal,
    canvasContext,
    prefix,
    sessionId
  )
}

/**
 * 在设置页一键验证「完整对话链路」是否可用：直接走与主对话相同的流式请求通路。
 */
export const testProviderConnection = async (
  provider: ProviderConfig,
  modelId: string,
  signal?: AbortSignal
): Promise<string> => {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })

  const testQuestion: UserMessage = {
    id: 'test-q',
    role: 'user',
    content: 'Reply with OK only.',
    files: [],
    createdAt: Date.now(),
  }

  let replyText = ''
  try {
    const events =
      provider.protocol === 'deepseek-native'
        ? streamMessage(
            normalizeApiKey(provider.apiKey),
            {
              model: modelId === 'deepseek-v4-pro' ? 'deepseek-v4-pro' : 'deepseek-flash',
              system: 'You are a helpful assistant.',
              messages: [{ role: 'user', content: testQuestion.content }],
              thinking: { type: 'disabled' },
              safety_check: { level: 'high' },
              tools: [],
            },
            controller.signal
          )
        : streamMultiProviderMessage({
            provider,
            modelId,
            systemPrompt: 'You are a helpful assistant.',
            history: [],
            question: testQuestion,
            thinking: false,
            signal: controller.signal,
          })

    for await (const event of events) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        replyText += event.delta.text
      }
    }
    return replyText.trim() || 'OK'
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}
