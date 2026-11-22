import { create } from 'zustand'
import { createId } from '../../utils/id.js'

export type ApiProtocol = 'demo' | 'deepseek-native' | 'openai' | 'anthropic' | 'gemini'

export type ModelOption = {
  id: string
  name: string
  description?: string
  supportsThinking?: boolean
}

export type ProviderConfig = {
  id: string
  name: string
  protocol: ApiProtocol
  baseUrl: string
  apiKey: string
  models: ModelOption[]
  isCustom?: boolean
  enabled: boolean
}

export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    id: 'demo',
    name: '内置苏格拉底演示',
    protocol: 'demo',
    baseUrl: '',
    apiKey: '',
    enabled: true,
    models: [
      {
        id: 'socratic-demo-v1',
        name: 'Socratic Tutor 演示引擎',
        description: '免 API Key 即刻体验动态坐标系、动点辅助线与渐进流程图',
        supportsThinking: true,
      },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    enabled: true,
    models: [
      {
        id: 'deepseek-chat',
        name: 'DeepSeek-V3 (Chat)',
        description: '均衡高效，适合日常数学与英语启发式对话',
      },
      {
        id: 'deepseek-reasoner',
        name: 'DeepSeek-R1 (Reasoner)',
        description: '深度推理链，适合压轴几何题与复杂逻辑推演',
        supportsThinking: true,
      },
    ],
  },
  {
    id: 'deepseek-native',
    name: 'DeepSeek (ChatDemo 原生)',
    protocol: 'deepseek-native',
    baseUrl: 'https://api.deepseek.com',
    apiKey: '',
    enabled: true,
    models: [
      {
        id: 'deepseek-flash',
        name: 'DeepSeek Flash (原生)',
        description: '支持联网搜索、深度思考与文件解析',
        supportsThinking: true,
      },
      {
        id: 'deepseek-v4-pro',
        name: 'DeepSeek V4 Pro (原生)',
        description: '旗舰推理与多模态能力',
        supportsThinking: true,
      },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI (ChatGPT)',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    enabled: true,
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', description: '全能多模态，响应快速流畅' },
      { id: 'gpt-4.1', name: 'GPT-4.1', description: '精准指令遵循与工具调用' },
      {
        id: 'o3-mini',
        name: 'o3-mini',
        description: '高性价比数学与逻辑推理',
        supportsThinking: true,
      },
      { id: 'gpt-4o-mini', name: 'GPT-4o mini', description: '轻量低延迟日常辅导' },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: '',
    enabled: true,
    models: [
      {
        id: 'claude-sonnet-4-20250514',
        name: 'Claude Sonnet 4',
        description: '极佳的苏格拉底引导与清晰讲解风格',
        supportsThinking: true,
      },
      {
        id: 'claude-3-7-sonnet-latest',
        name: 'Claude 3.7 Sonnet',
        description: '支持扩展思考，擅长英语与数学分步教学',
        supportsThinking: true,
      },
      {
        id: 'claude-3-5-haiku-latest',
        name: 'Claude 3.5 Haiku',
        description: '极速响应，适合轻量互动练习',
      },
    ],
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    protocol: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: '',
    enabled: true,
    models: [
      {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        description: '强大数理推理与长上下文教学',
        supportsThinking: true,
      },
      {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        description: '高性价比快速交互',
        supportsThinking: true,
      },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter (聚合网关)',
    protocol: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: '',
    enabled: true,
    models: [
      { id: 'openai/gpt-4o', name: 'OpenAI: GPT-4o' },
      { id: 'anthropic/claude-3.7-sonnet', name: 'Anthropic: Claude 3.7 Sonnet' },
      { id: 'deepseek/deepseek-r1', name: 'DeepSeek: R1', supportsThinking: true },
      { id: 'google/gemini-2.5-pro', name: 'Google: Gemini 2.5 Pro' },
    ],
  },
  {
    id: 'qwen',
    name: '通义千问 (DashScope)',
    protocol: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: '',
    enabled: true,
    models: [
      { id: 'qwen-max', name: 'Qwen-Max', description: '中文与学科综合能力旗舰' },
      { id: 'qwen-plus', name: 'Qwen-Plus', description: '均衡速度与质量' },
      {
        id: 'qwq-plus',
        name: 'QwQ-Plus',
        description: '数学与逻辑深度思考',
        supportsThinking: true,
      },
    ],
  },
  {
    id: 'ollama',
    name: 'Ollama (本地模型)',
    protocol: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    apiKey: '',
    enabled: true,
    models: [
      { id: 'qwen2.5:14b', name: 'Qwen 2.5 14B (本地)' },
      { id: 'deepseek-r1:14b', name: 'DeepSeek R1 14B (本地)', supportsThinking: true },
      { id: 'llama3.2', name: 'Llama 3.2 (本地)' },
    ],
  },
]

const STORAGE_KEY = 'ai-tutor:providers:v1'
const ACTIVE_KEY = 'ai-tutor:active-model:v1'

type ActiveSelection = {
  providerId: string
  modelId: string
}

type ProviderStoreState = {
  providers: ProviderConfig[]
  activeProviderId: string
  activeModelId: string
}

const loadProviders = (): ProviderConfig[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      // 兼容已有 chat-demo API Key
      const legacyKey = localStorage.getItem('chat-demo:api-key') ?? ''
      if (legacyKey) {
        return DEFAULT_PROVIDERS.map((p) =>
          p.id === 'deepseek-native' || p.id === 'deepseek' ? { ...p, apiKey: legacyKey } : p
        )
      }
      return DEFAULT_PROVIDERS
    }
    const saved = JSON.parse(raw) as ProviderConfig[]
    if (!Array.isArray(saved) || saved.length === 0) {
      return DEFAULT_PROVIDERS
    }
    const savedMap = new Map(saved.map((p) => [p.id, p]))
    const merged: ProviderConfig[] = DEFAULT_PROVIDERS.map((preset) => {
      const existing = savedMap.get(preset.id)
      if (!existing) {
        return preset
      }
      savedMap.delete(preset.id)
      return {
        ...preset,
        baseUrl: typeof existing.baseUrl === 'string' ? existing.baseUrl : preset.baseUrl,
        apiKey: typeof existing.apiKey === 'string' ? existing.apiKey : preset.apiKey,
        enabled: typeof existing.enabled === 'boolean' ? existing.enabled : preset.enabled,
        models:
          Array.isArray(existing.models) && existing.models.length > 0
            ? existing.models
            : preset.models,
      }
    })
    for (const custom of savedMap.values()) {
      if (custom && typeof custom.id === 'string' && typeof custom.name === 'string') {
        merged.push({ ...custom, isCustom: true })
      }
    }
    return merged
  } catch {
    return DEFAULT_PROVIDERS
  }
}

const loadActive = (providers: ProviderConfig[]): ActiveSelection => {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ActiveSelection>
      const found = providers.find((p) => p.id === parsed.providerId)
      if (found) {
        const model = found.models.find((m) => m.id === parsed.modelId) ?? found.models[0]
        if (model) {
          return { providerId: found.id, modelId: model.id }
        }
      }
    }
  } catch {
    // 忽略损坏的存储项
  }
  const legacyKey = (() => {
    try {
      return localStorage.getItem('chat-demo:api-key')
    } catch {
      return null
    }
  })()
  if (legacyKey) {
    return { providerId: 'deepseek-native', modelId: 'deepseek-flash' }
  }
  return { providerId: 'demo', modelId: 'socratic-demo-v1' }
}

const persistProviders = (providers: ProviderConfig[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(providers))
  } catch {
    // 忽略存储限制
  }
}

const persistActive = (providerId: string, modelId: string) => {
  try {
    localStorage.setItem(ACTIVE_KEY, JSON.stringify({ providerId, modelId }))
  } catch {
    // 忽略存储限制
  }
}

const initialProviders = loadProviders()
const initialActive = loadActive(initialProviders)

export const useProviderStore = create<ProviderStoreState>(() => ({
  providers: initialProviders,
  activeProviderId: initialActive.providerId,
  activeModelId: initialActive.modelId,
}))

export const getActiveProviderAndModel = () => {
  const { providers, activeProviderId, activeModelId } = useProviderStore.getState()
  const provider = providers.find((p) => p.id === activeProviderId) ?? providers[0]
  const model = provider.models.find((m) => m.id === activeModelId) ?? provider.models[0]
  return { provider, model }
}

export const selectProviderModel = (providerId: string, modelId: string) => {
  const { providers } = useProviderStore.getState()
  const provider = providers.find((p) => p.id === providerId)
  if (!provider) {
    return
  }
  const model = provider.models.find((m) => m.id === modelId) ?? provider.models[0]
  if (!model) {
    return
  }
  persistActive(provider.id, model.id)
  useProviderStore.setState({ activeProviderId: provider.id, activeModelId: model.id })
}

export const updateProviderConfig = (
  providerId: string,
  patch: Partial<
    Pick<ProviderConfig, 'name' | 'baseUrl' | 'apiKey' | 'protocol' | 'enabled' | 'models'>
  >
) => {
  const next = useProviderStore
    .getState()
    .providers.map((p) => (p.id === providerId ? { ...p, ...patch } : p))
  persistProviders(next)
  useProviderStore.setState({ providers: next })
}

export const addCustomProvider = (input: {
  name: string
  protocol: Exclude<ApiProtocol, 'demo'>
  baseUrl: string
  apiKey: string
  modelId: string
  models?: ModelOption[]
}) => {
  const id = `custom-${createId().slice(0, 8)}`
  const fallbackModelId = input.modelId.trim() || 'gpt-4o'
  const models =
    input.models && input.models.length > 0
      ? input.models
      : [{ id: fallbackModelId, name: fallbackModelId }]
  const created: ProviderConfig = {
    id,
    name: input.name.trim() || '自定义服务商',
    protocol: input.protocol,
    baseUrl: input.baseUrl.trim().replace(/\/+$/, ''),
    apiKey: input.apiKey.trim(),
    enabled: true,
    isCustom: true,
    models,
  }
  const next = [...useProviderStore.getState().providers, created]
  persistProviders(next)
  useProviderStore.setState({ providers: next })
  return created
}

export const removeCustomProvider = (providerId: string) => {
  const state = useProviderStore.getState()
  const target = state.providers.find((p) => p.id === providerId)
  if (!target?.isCustom) {
    return
  }
  const next = state.providers.filter((p) => p.id !== providerId)
  persistProviders(next)
  if (state.activeProviderId === providerId) {
    persistActive('demo', 'socratic-demo-v1')
    useProviderStore.setState({
      providers: next,
      activeProviderId: 'demo',
      activeModelId: 'socratic-demo-v1',
    })
  } else {
    useProviderStore.setState({ providers: next })
  }
}

export const addModelToProvider = (providerId: string, modelId: string, name?: string) => {
  const trimmed = modelId.trim()
  if (!trimmed) {
    return
  }
  const provider = useProviderStore.getState().providers.find((p) => p.id === providerId)
  if (!provider || provider.models.some((m) => m.id === trimmed)) {
    return
  }
  updateProviderConfig(providerId, {
    models: [...provider.models, { id: trimmed, name: name?.trim() || trimmed }],
  })
}

export const removeModelFromProvider = (providerId: string, modelId: string) => {
  const state = useProviderStore.getState()
  const provider = state.providers.find((p) => p.id === providerId)
  if (!provider || provider.models.length <= 1) {
    return
  }
  const models = provider.models.filter((m) => m.id !== modelId)
  updateProviderConfig(providerId, { models })
  if (state.activeProviderId === providerId && state.activeModelId === modelId) {
    selectProviderModel(providerId, models[0].id)
  }
}

/** 同步旧版 DeepSeek API Key 输入到多服务商配置 */
export const syncDeepseekApiKey = (apiKey: string) => {
  const { providers } = useProviderStore.getState()
  const next = providers.map((p) =>
    p.id === 'deepseek-native' || (p.id === 'deepseek' && !p.apiKey) ? { ...p, apiKey } : p
  )
  persistProviders(next)
  useProviderStore.setState({ providers: next })
}

type FetchModelsInput = Pick<ProviderConfig, 'protocol' | 'baseUrl' | 'apiKey'>

/** 剥离用户误粘贴的 /chat/completions、/messages、/models 后缀，得到干净的 API 根路径 */
const normalizeModelsBase = (raw: string): string =>
  raw
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/(chat\/completions|completions|messages|models)$/i, '')

const extractModelOptions = (payload: unknown, isGemini: boolean): ModelOption[] => {
  const rawList: unknown[] = Array.isArray(payload)
    ? payload
    : typeof payload === 'object' && payload !== null
      ? Array.isArray((payload as { data?: unknown }).data)
        ? (payload as { data: unknown[] }).data
        : Array.isArray((payload as { models?: unknown }).models)
          ? (payload as { models: unknown[] }).models
          : []
      : []

  const seen = new Set<string>()
  const result: ModelOption[] = []
  for (const item of rawList) {
    let id = ''
    let name = ''
    if (typeof item === 'string') {
      id = item.trim()
      name = id
    } else if (typeof item === 'object' && item !== null) {
      const rec = item as Record<string, unknown>
      const rawId =
        typeof rec.id === 'string'
          ? rec.id
          : typeof rec.name === 'string'
            ? rec.name
            : typeof rec.model === 'string'
              ? rec.model
              : ''
      id = rawId.trim().replace(/^models\//, '')
      name =
        (typeof rec.display_name === 'string' && rec.display_name.trim()) ||
        (typeof rec.displayName === 'string' && rec.displayName.trim()) ||
        id
    }
    if (!id || seen.has(id)) {
      continue
    }
    if (isGemini && !id.toLowerCase().includes('gemini') && !id.toLowerCase().includes('gemma')) {
      continue
    }
    seen.add(id)
    result.push({ id, name })
  }
  return result.slice(0, 200)
}

/**
 * 从 OpenAI / Anthropic / Gemini 及各类自定义聚合网关（OneAPI / NewAPI / 硅基流动等）拉取可用模型列表。
 * 自动兼容：是否包含 /v1、误粘贴完整 /chat/completions 地址、Bearer / x-api-key 鉴权及多种 JSON 返回结构。
 */
export const fetchProviderModels = async (
  provider: FetchModelsInput,
  signal?: AbortSignal
): Promise<ModelOption[]> => {
  const base = normalizeModelsBase(provider.baseUrl)
  if (!base) {
    throw new Error('请先填写 API Base URL')
  }
  const apiKey = provider.apiKey.trim().replace(/^Bearer\s+/i, '').trim()

  if (provider.protocol === 'gemini') {
    const candidates = [
      `${base}/models${apiKey ? `?key=${encodeURIComponent(apiKey)}` : ''}`,
      ...(!/\/v1beta$/i.test(base)
        ? [`${base}/v1beta/models${apiKey ? `?key=${encodeURIComponent(apiKey)}` : ''}`]
        : []),
    ]
    let lastError: Error | null = null
    for (const url of candidates) {
      try {
        const response = await fetch(url, { signal })
        if (!response.ok) {
          lastError = new Error(`HTTP ${response.status}`)
          continue
        }
        const models = extractModelOptions(await response.json(), true)
        if (models.length > 0) {
          return models
        }
      } catch (error) {
        if (signal?.aborted) {
          throw error
        }
        lastError = error instanceof Error ? error : new Error(String(error))
      }
    }
    throw new Error(
      lastError?.message === 'Failed to fetch'
        ? '网络请求失败或被浏览器 CORS 拦截，请检查 Base URL 或网关跨域配置'
        : lastError?.message || '未能拉取到 Gemini 模型列表'
    )
  }

  // 构建候选 /models URL：若未带 /v1，自动顺延尝试 /v1/models
  const urlCandidates = [`${base}/models`]
  if (!/\/v\d+(?:alpha|beta)?$/i.test(base)) {
    urlCandidates.push(`${base}/v1/models`)
  }

  // 构建鉴权头方案：Anthropic 兼容网关优先 x-api-key，若失败再兜底 Bearer（兼容 OneAPI/NewAPI）
  const headerVariants: Record<string, string>[] = []
  if (provider.protocol === 'anthropic') {
    headerVariants.push({
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    })
    if (apiKey) {
      headerVariants.push({ Authorization: `Bearer ${apiKey}` })
    }
  } else {
    headerVariants.push(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
  }

  let lastError: Error | null = null
  for (const url of urlCandidates) {
    for (const headers of headerVariants) {
      try {
        const response = await fetch(url, { headers, signal })
        if (!response.ok) {
          lastError = new Error(`HTTP ${response.status} (${url})`)
          continue
        }
        const payload: unknown = await response.json()
        return extractModelOptions(payload, false)
      } catch (error) {
        if (signal?.aborted) {
          throw error
        }
        lastError = error instanceof Error ? error : new Error(String(error))
      }
    }
  }

  const msg = lastError?.message ?? '未知错误'
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    throw new Error(
      '请求被浏览器拦截或无法连接（常见原因：该自定义网关未开启浏览器 CORS 跨域头，或 Base URL 填写有误；你仍可手动输入模型 ID 使用）'
    )
  }
  throw new Error(msg)
}
