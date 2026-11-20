import { ApiError } from '../api/client.js'
import { readServerSentEvents } from '../api/sse.js'
import type { MessageStreamEvent } from '../api/types.js'
import { getContextRounds, getReplyText } from '../chat/reply.js'
import type { Message, UserMessage } from '../chat/types.js'
import type { ProviderConfig } from './providers.js'

type SimpleRoleMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const buildSimpleMessages = (
  systemPrompt: string,
  history: Message[],
  question: UserMessage
): SimpleRoleMessage[] => {
  const result: SimpleRoleMessage[] = [{ role: 'system', content: systemPrompt }]
  for (const [user, reply] of getContextRounds(history)) {
    const userText = user.content.trim()
    const replyText = getReplyText(reply).trim()
    if (userText && replyText) {
      result.push({ role: 'user', content: userText })
      result.push({ role: 'assistant', content: replyText })
    }
  }
  result.push({ role: 'user', content: question.content })
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
 * OpenAI 兼容协议流式请求（兼容 OpenAI / DeepSeek / OpenRouter / 通义千问 / 硅基流动 / 本地 Ollama 等）。
 * 同时支持 DeepSeek-R1 / QwQ 的 reasoning_content 思考流，以及标准 content 正文流。
 */
async function* streamOpenAiCompatible(
  provider: ProviderConfig,
  modelId: string,
  systemPrompt: string,
  history: Message[],
  question: UserMessage,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const base = provider.baseUrl.trim().replace(/\/+$/, '')
  const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  }
  if (provider.apiKey.trim()) {
    headers.Authorization = `Bearer ${provider.apiKey.trim()}`
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: modelId,
        messages: buildSimpleMessages(systemPrompt, history, question),
        stream: true,
        temperature: 0.5,
      }),
      signal,
    })
  } catch (error) {
    if (signal.aborted) {
      throw error
    }
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }

  if (!response.ok) {
    throw await readHttpError(response)
  }
  if (!response.body) {
    throw new ApiError('protocol', '服务端未返回可读的流式响应体')
  }

  yield {
    type: 'message_start',
    message: { id: `openai-${Date.now()}`, model: modelId },
  }

  let nextBlockIndex = 0
  let thinkingIndex: number | null = null
  let textIndex: number | null = null
  let stopReason: 'end_turn' | 'max_tokens' = 'end_turn'

  for await (const { data } of readServerSentEvents(response.body, signal)) {
    const trimmed = data.trim()
    if (!trimmed || trimmed === '[DONE]') {
      continue
    }
    let chunk: {
      choices?: {
        delta?: { content?: string | null; reasoning_content?: string | null }
        finish_reason?: string | null
      }[]
      error?: { message?: string }
    }
    try {
      chunk = JSON.parse(trimmed) as typeof chunk
    } catch {
      continue
    }
    if (chunk.error?.message) {
      throw new ApiError('stream', chunk.error.message)
    }
    const choice = chunk.choices?.[0]
    if (!choice) {
      continue
    }
    if (choice.finish_reason === 'length') {
      stopReason = 'max_tokens'
    }
    const reasoning = choice.delta?.reasoning_content
    if (typeof reasoning === 'string' && reasoning.length > 0) {
      if (thinkingIndex === null) {
        thinkingIndex = nextBlockIndex++
        yield {
          type: 'content_block_start',
          index: thinkingIndex,
          content_block: { type: 'thinking', thinking: '', signature: '' },
        }
      }
      yield {
        type: 'content_block_delta',
        index: thinkingIndex,
        delta: { type: 'thinking_delta', thinking: reasoning },
      }
    }
    const text = choice.delta?.content
    if (typeof text === 'string' && text.length > 0) {
      if (thinkingIndex !== null && textIndex === null) {
        yield { type: 'content_block_stop', index: thinkingIndex }
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
        delta: { type: 'text_delta', text },
      }
    }
  }

  if (thinkingIndex !== null && textIndex === null) {
    yield { type: 'content_block_stop', index: thinkingIndex }
  }
  if (textIndex !== null) {
    yield { type: 'content_block_stop', index: textIndex }
  }
  yield {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
  }
  yield { type: 'message_stop' }
}

/**
 * 标准 Anthropic Messages API 流式请求（兼容 Claude 官方接口与兼容代理）。
 */
async function* streamAnthropicStandard(
  provider: ProviderConfig,
  modelId: string,
  systemPrompt: string,
  history: Message[],
  question: UserMessage,
  thinking: boolean,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const base = provider.baseUrl.trim().replace(/\/+$/, '')
  const url = base.endsWith('/messages') ? base : `${base}/messages`
  const messages = buildSimpleMessages(systemPrompt, history, question)
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }))

  const body: Record<string, unknown> = {
    model: modelId,
    max_tokens: 4096,
    system: systemPrompt,
    messages,
    stream: true,
  }
  if (thinking) {
    body.thinking = { type: 'enabled', budget_tokens: 2048 }
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'x-api-key': provider.apiKey.trim(),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (signal.aborted) {
      throw error
    }
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }

  if (!response.ok) {
    throw await readHttpError(response)
  }
  if (!response.body) {
    throw new ApiError('protocol', '服务端未返回流式响应')
  }

  yield {
    type: 'message_start',
    message: { id: `anthropic-${Date.now()}`, model: modelId },
  }

  const indexMap = new Map<number, number>()
  let nextIdx = 0
  let stopReason: 'end_turn' | 'max_tokens' = 'end_turn'

  for await (const { data } of readServerSentEvents(response.body, signal)) {
    let payload: {
      type?: string
      index?: number
      content_block?: { type?: string; text?: string; thinking?: string }
      delta?: { type?: string; text?: string; thinking?: string; stop_reason?: string }
      error?: { message?: string }
    }
    try {
      payload = JSON.parse(data) as typeof payload
    } catch {
      continue
    }
    if (payload.error?.message) {
      throw new ApiError('stream', payload.error.message)
    }
    if (payload.type === 'content_block_start' && typeof payload.index === 'number') {
      const kind = payload.content_block?.type
      if (kind === 'thinking' || kind === 'text') {
        const mapped = nextIdx++
        indexMap.set(payload.index, mapped)
        yield {
          type: 'content_block_start',
          index: mapped,
          content_block:
            kind === 'thinking'
              ? { type: 'thinking', thinking: payload.content_block?.thinking ?? '', signature: '' }
              : { type: 'text', text: payload.content_block?.text ?? '' },
        }
      }
    } else if (payload.type === 'content_block_delta' && typeof payload.index === 'number') {
      const mapped = indexMap.get(payload.index)
      if (mapped === undefined || !payload.delta) {
        continue
      }
      if (payload.delta.type === 'thinking_delta' && typeof payload.delta.thinking === 'string') {
        yield {
          type: 'content_block_delta',
          index: mapped,
          delta: { type: 'thinking_delta', thinking: payload.delta.thinking },
        }
      } else if (payload.delta.type === 'text_delta' && typeof payload.delta.text === 'string') {
        yield {
          type: 'content_block_delta',
          index: mapped,
          delta: { type: 'text_delta', text: payload.delta.text },
        }
      }
    } else if (payload.type === 'content_block_stop' && typeof payload.index === 'number') {
      const mapped = indexMap.get(payload.index)
      if (mapped !== undefined) {
        yield { type: 'content_block_stop', index: mapped }
      }
    } else if (payload.type === 'message_delta' && payload.delta?.stop_reason === 'max_tokens') {
      stopReason = 'max_tokens'
    }
  }

  yield {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
  }
  yield { type: 'message_stop' }
}

/**
 * Google Gemini 原生 REST SSE 流式接口（streamGenerateContent?alt=sse）。
 */
async function* streamGemini(
  provider: ProviderConfig,
  modelId: string,
  systemPrompt: string,
  history: Message[],
  question: UserMessage,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const base = provider.baseUrl.trim().replace(/\/+$/, '')
  const url = `${base}/models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(provider.apiKey.trim())}`
  const contents = buildSimpleMessages(systemPrompt, history, question)
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }))

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { temperature: 0.5 },
      }),
      signal,
    })
  } catch (error) {
    if (signal.aborted) {
      throw error
    }
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }

  if (!response.ok) {
    throw await readHttpError(response)
  }
  if (!response.body) {
    throw new ApiError('protocol', 'Gemini 未返回流式响应')
  }

  yield {
    type: 'message_start',
    message: { id: `gemini-${Date.now()}`, model: modelId },
  }

  let textStarted = false
  for await (const { data } of readServerSentEvents(response.body, signal)) {
    let payload: {
      candidates?: { content?: { parts?: { text?: string }[] } }[]
      error?: { message?: string }
    }
    try {
      payload = JSON.parse(data) as typeof payload
    } catch {
      continue
    }
    if (payload.error?.message) {
      throw new ApiError('stream', payload.error.message)
    }
    const parts = payload.candidates?.[0]?.content?.parts ?? []
    for (const part of parts) {
      if (typeof part.text === 'string' && part.text.length > 0) {
        if (!textStarted) {
          textStarted = true
          yield {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
          }
        }
        yield {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: part.text },
        }
      }
    }
  }

  if (textStarted) {
    yield { type: 'content_block_stop', index: 0 }
  }
  yield {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
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
}): AsyncGenerator<MessageStreamEvent> {
  const { provider, modelId, systemPrompt, history, question, thinking, signal } = options
  if (provider.protocol === 'anthropic') {
    return streamAnthropicStandard(
      provider,
      modelId,
      systemPrompt,
      history,
      question,
      thinking,
      signal
    )
  }
  if (provider.protocol === 'gemini') {
    return streamGemini(provider, modelId, systemPrompt, history, question, signal)
  }
  return streamOpenAiCompatible(provider, modelId, systemPrompt, history, question, signal)
}
