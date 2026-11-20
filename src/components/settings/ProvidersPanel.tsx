import clsx from 'clsx'
import { useMemo, useState } from 'react'
import {
  addCustomProvider,
  addModelToProvider,
  fetchProviderModels,
  removeCustomProvider,
  removeModelFromProvider,
  selectProviderModel,
  updateProviderConfig,
  useProviderStore,
  type ApiProtocol,
  type ModelOption,
} from '../../services/tutor/providers.js'
import { setApiKey } from '../../services/settings.js'
import { Button } from '../base/Button.js'
import styles from './ProvidersPanel.module.css'

/**
 * 设置页「多服务商与模型配置」面板：
 * 支持 DeepSeek / OpenAI / Anthropic Claude / Google Gemini / OpenRouter / 通义千问 / Ollama 以及任意自定义兼容端点；
 * 添加自定义网关时即可直接一键拉取 /models 列表并勾选/搜索模型。
 */
export const ProvidersPanel = () => {
  const providers = useProviderStore((state) => state.providers)
  const activeProviderId = useProviderStore((state) => state.activeProviderId)
  const activeModelId = useProviderStore((state) => state.activeModelId)

  const [selectedId, setSelectedId] = useState(activeProviderId)
  const [newModelId, setNewModelId] = useState('')
  const [modelFilter, setModelFilter] = useState('')
  const [fetching, setFetching] = useState(false)
  const [statusMsg, setStatusMsg] = useState<{ text: string; error?: boolean } | null>(null)
  const [addingCustom, setAddingCustom] = useState(false)
  const [customForm, setCustomForm] = useState({
    name: '',
    protocol: 'openai' as Exclude<ApiProtocol, 'demo'>,
    baseUrl: '',
    apiKey: '',
    modelId: '',
  })
  const [customFetchedModels, setCustomFetchedModels] = useState<ModelOption[]>([])
  const [customModelFilter, setCustomModelFilter] = useState('')

  const current = providers.find((p) => p.id === selectedId) ?? providers[0]

  const onFetchCurrentModels = async () => {
    setFetching(true)
    setStatusMsg(null)
    try {
      const models = await fetchProviderModels(current)
      if (models.length === 0) {
        setStatusMsg({ text: '接口连接成功，但未返回任何模型，可直接在下方手动添加模型 ID。' })
      } else {
        updateProviderConfig(current.id, { models })
        setStatusMsg({ text: `已成功从网关拉取 ${models.length} 个可用模型并更新列表。` })
      }
    } catch (error) {
      setStatusMsg({
        text: `拉取模型失败：${error instanceof Error ? error.message : String(error)}`,
        error: true,
      })
    } finally {
      setFetching(false)
    }
  }

  const onFetchCustomModels = async () => {
    if (!customForm.baseUrl.trim()) {
      setStatusMsg({
        text: '请先填写自定义网关的 API Base URL（例如 https://your-gateway.com/v1）',
        error: true,
      })
      return
    }
    setFetching(true)
    setStatusMsg(null)
    try {
      const models = await fetchProviderModels({
        protocol: customForm.protocol,
        baseUrl: customForm.baseUrl,
        apiKey: customForm.apiKey,
      })
      setCustomFetchedModels(models)
      if (models.length === 0) {
        setStatusMsg({ text: '接口返回成功，但列表为空，请手动输入默认模型 ID。' })
      } else {
        setCustomForm((prev) => ({ ...prev, modelId: prev.modelId.trim() || models[0].id }))
        setStatusMsg({
          text: `成功拉取 ${models.length} 个模型！点击下方任意模型可设为默认，保存后全部导入。`,
        })
      }
    } catch (error) {
      setStatusMsg({
        text: `拉取模型失败：${error instanceof Error ? error.message : String(error)}`,
        error: true,
      })
    } finally {
      setFetching(false)
    }
  }

  const filteredCurrentModels = useMemo(() => {
    const q = modelFilter.trim().toLowerCase()
    return q
      ? current.models.filter(
          (m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
        )
      : current.models
  }, [current.models, modelFilter])

  const filteredCustomModels = useMemo(() => {
    const q = customModelFilter.trim().toLowerCase()
    return q
      ? customFetchedModels.filter(
          (m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
        )
      : customFetchedModels
  }, [customFetchedModels, customModelFilter])

  return (
    <div className={styles.wrap}>
      <div className={styles.providerPills}>
        {providers.map((p) => {
          const configured = p.protocol === 'demo' || p.apiKey.trim().length > 0
          return (
            <button
              key={p.id}
              type="button"
              className={clsx(
                styles.pill,
                !addingCustom && p.id === current.id && styles.pillActive
              )}
              onClick={() => {
                setAddingCustom(false)
                setSelectedId(p.id)
                setModelFilter('')
                setStatusMsg(null)
              }}
            >
              {configured ? <span className={styles.dot} /> : null}
              {p.name}
            </button>
          )
        })}
        <button
          type="button"
          className={clsx(styles.pill, addingCustom && styles.pillActive)}
          onClick={() => {
            setAddingCustom(true)
            setStatusMsg(null)
          }}
        >
          + 添加自定义接口
        </button>
      </div>

      {addingCustom ? (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.cardTitle}>添加自定义 AI 服务商 / 聚合网关</div>
            <Button
              variant="primary"
              size="s"
              disabled={fetching}
              onClick={() => void onFetchCustomModels()}
            >
              {fetching ? '正在拉取模型...' : '一键拉取模型列表'}
            </Button>
          </div>
          <div className={styles.row}>
            <div className={clsx(styles.field, styles.flex1)}>
              <label className={styles.fieldLabel}>服务商名称</label>
              <input
                className={styles.input}
                placeholder="例如：硅基流动 / OneAPI / NewAPI"
                value={customForm.name}
                onChange={(event) =>
                  setCustomForm((prev) => ({ ...prev, name: event.target.value }))
                }
              />
            </div>
            <div className={clsx(styles.field, styles.flex1)}>
              <label className={styles.fieldLabel}>接口协议</label>
              <select
                className={styles.select}
                value={customForm.protocol}
                onChange={(event) =>
                  setCustomForm((prev) => ({
                    ...prev,
                    protocol: event.target.value as Exclude<ApiProtocol, 'demo'>,
                  }))
                }
              >
                <option value="openai">OpenAI 兼容 (/v1/chat/completions)</option>
                <option value="anthropic">Anthropic 兼容 (/v1/messages)</option>
                <option value="gemini">Google Gemini 原生协议</option>
              </select>
            </div>
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>API Base URL（支持自动补全 /v1）</label>
            <input
              type="text"
              autoComplete="off"
              spellCheck={false}
              className={styles.input}
              placeholder="https://api.example.com/v1"
              value={customForm.baseUrl}
              onChange={(event) =>
                setCustomForm((prev) => ({ ...prev, baseUrl: event.target.value }))
              }
            />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>API Key</label>
            <input
              type="text"
              autoComplete="off"
              spellCheck={false}
              className={styles.input}
              placeholder="sk-..."
              value={customForm.apiKey}
              onChange={(event) =>
                setCustomForm((prev) => ({ ...prev, apiKey: event.target.value }))
              }
            />
          </div>
          <div className={styles.field}>
            <div className={styles.fieldHeader}>
              <label className={styles.fieldLabel}>
                默认模型 ID
                {customFetchedModels.length > 0
                  ? `（已拉取 ${customFetchedModels.length} 个）`
                  : ''}
              </label>
              <Button
                variant="outlined"
                size="s"
                disabled={fetching}
                onClick={() => void onFetchCustomModels()}
              >
                {fetching ? '正在拉取...' : '拉取 /models'}
              </Button>
            </div>
            <input
              className={styles.input}
              placeholder="点击「一键拉取模型列表」，或手动输入模型 ID（如 gpt-4o / deepseek-v3）"
              value={customForm.modelId}
              onChange={(event) =>
                setCustomForm((prev) => ({ ...prev, modelId: event.target.value }))
              }
            />
            {customFetchedModels.length > 0 ? (
              <div className={styles.fetchedBox}>
                {customFetchedModels.length > 10 ? (
                  <input
                    className={styles.input}
                    placeholder={`在 ${customFetchedModels.length} 个已拉取模型中搜索...`}
                    value={customModelFilter}
                    onChange={(event) => setCustomModelFilter(event.target.value)}
                  />
                ) : null}
                <div className={styles.modelTagsScrollable}>
                  {filteredCustomModels.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className={clsx(
                        styles.modelChip,
                        customForm.modelId === m.id && styles.modelChipSelected
                      )}
                      onClick={() => setCustomForm((prev) => ({ ...prev, modelId: m.id }))}
                    >
                      {m.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {statusMsg ? (
            <div className={clsx(styles.statusText, statusMsg.error && styles.statusError)}>
              {statusMsg.text}
            </div>
          ) : null}

          <div className={styles.row}>
            <Button
              variant="primary"
              size="s"
              onClick={() => {
                if (!customForm.baseUrl.trim()) {
                  setStatusMsg({ text: '请先填写 API Base URL', error: true })
                  return
                }
                const chosenId = customForm.modelId.trim() || customFetchedModels[0]?.id || 'gpt-4o'
                const mergedModels =
                  customFetchedModels.length > 0
                    ? customFetchedModels.some((m) => m.id === chosenId)
                      ? customFetchedModels
                      : [{ id: chosenId, name: chosenId }, ...customFetchedModels]
                    : [{ id: chosenId, name: chosenId }]
                const created = addCustomProvider({
                  ...customForm,
                  modelId: chosenId,
                  models: mergedModels,
                })
                selectProviderModel(created.id, chosenId)
                setSelectedId(created.id)
                setCustomForm({
                  name: '',
                  protocol: 'openai',
                  baseUrl: '',
                  apiKey: '',
                  modelId: '',
                })
                setCustomFetchedModels([])
                setCustomModelFilter('')
                setAddingCustom(false)
                setStatusMsg({
                  text: `已保存「${created.name}」（共 ${created.models.length} 个模型）并切换为当前模型 ${chosenId}`,
                })
              }}
            >
              保存并启用
            </Button>
            <Button
              variant="outlined"
              size="s"
              onClick={() => {
                setAddingCustom(false)
                setStatusMsg(null)
              }}
            >
              取消
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.cardTitle}>{current.name}</div>
            <span className={styles.protocolTag}>{current.protocol}</span>
          </div>

          {current.protocol === 'demo' ? (
            <div className={styles.demoNote}>
              内置苏格拉底教学演示引擎无需 API
              Key，开箱即可体验「数学动点与动态辅助线」以及「英语长难句 / 数学逻辑渐进式流程图」。
              若想辅导任意自拟题目，请在上方选择 DeepSeek、OpenAI、Claude、Gemini 或自定义接口并填入
              API Key。
            </div>
          ) : (
            <>
              {current.isCustom ? (
                <div className={styles.row}>
                  <div className={clsx(styles.field, styles.flex1)}>
                    <label className={styles.fieldLabel}>服务商名称</label>
                    <input
                      className={styles.input}
                      value={current.name}
                      onChange={(event) =>
                        updateProviderConfig(current.id, { name: event.target.value })
                      }
                    />
                  </div>
                  <div className={clsx(styles.field, styles.flex1)}>
                    <label className={styles.fieldLabel}>接口协议</label>
                    <select
                      className={styles.select}
                      value={current.protocol}
                      onChange={(event) =>
                        updateProviderConfig(current.id, {
                          protocol: event.target.value as Exclude<ApiProtocol, 'demo'>,
                        })
                      }
                    >
                      <option value="openai">OpenAI 兼容</option>
                      <option value="anthropic">Anthropic 兼容</option>
                      <option value="gemini">Gemini 原生</option>
                    </select>
                  </div>
                </div>
              ) : null}

              <div className={styles.field}>
                <label className={styles.fieldLabel}>API Base URL</label>
                <input
                  className={styles.input}
                  value={current.baseUrl}
                  placeholder="https://api.openai.com/v1"
                  onChange={(event) =>
                    updateProviderConfig(current.id, { baseUrl: event.target.value })
                  }
                />
              </div>

              <div className={styles.field}>
                <label className={styles.fieldLabel}>
                  API Key（仅保存在本地浏览器，明文显示方便核对）
                </label>
                <input
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  className={styles.input}
                  value={current.apiKey}
                  placeholder="请输入该服务商的 API Key（填完后将自动出现在顶部模型列表）"
                  onChange={(event) => {
                    const value = event.target.value
                    updateProviderConfig(current.id, { apiKey: value })
                    if (current.id === 'deepseek-native') {
                      setApiKey(value.trim() || null)
                    }
                  }}
                />
              </div>

              <div className={styles.field}>
                <div className={styles.fieldHeader}>
                  <label className={styles.fieldLabel}>
                    可用模型（共 {current.models.length} 个，点击切换）
                  </label>
                  {current.protocol !== 'deepseek-native' ? (
                    <Button
                      variant="outlined"
                      size="s"
                      disabled={fetching}
                      onClick={() => void onFetchCurrentModels()}
                    >
                      {fetching ? '正在拉取...' : '拉取 /models'}
                    </Button>
                  ) : null}
                </div>
                {current.models.length > 10 ? (
                  <input
                    className={styles.input}
                    placeholder="搜索当前服务商下的模型..."
                    value={modelFilter}
                    onChange={(event) => setModelFilter(event.target.value)}
                  />
                ) : null}
                <div className={styles.modelTagsScrollable}>
                  {filteredCurrentModels.map((m) => {
                    const isCurrent = activeProviderId === current.id && activeModelId === m.id
                    return (
                      <div
                        key={m.id}
                        className={clsx(styles.modelChip, isCurrent && styles.modelChipSelected)}
                        onClick={() => selectProviderModel(current.id, m.id)}
                      >
                        <span>{m.name}</span>
                        {current.models.length > 1 ? (
                          <button
                            type="button"
                            className={styles.removeModelBtn}
                            aria-label={`移除 ${m.name}`}
                            onClick={(event) => {
                              event.stopPropagation()
                              removeModelFromProvider(current.id, m.id)
                            }}
                          >
                            ×
                          </button>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className={styles.row}>
                <input
                  className={styles.input}
                  placeholder="手动添加模型 ID（如 gpt-4.1-mini / deepseek-r1）"
                  value={newModelId}
                  onChange={(event) => setNewModelId(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && newModelId.trim()) {
                      addModelToProvider(current.id, newModelId)
                      setNewModelId('')
                    }
                  }}
                />
                <Button
                  variant="outlined"
                  size="s"
                  onClick={() => {
                    if (newModelId.trim()) {
                      addModelToProvider(current.id, newModelId)
                      setNewModelId('')
                    }
                  }}
                >
                  添加模型
                </Button>
              </div>

              <div className={styles.row}>
                <Button
                  variant="primary"
                  size="s"
                  onClick={() => {
                    selectProviderModel(current.id, current.models[0].id)
                    setStatusMsg({
                      text: `已切换到 ${current.name} · ${current.models[0].name}`,
                    })
                  }}
                >
                  使用此服务商
                </Button>
                {current.isCustom ? (
                  <Button
                    variant="dangerOutlined"
                    size="s"
                    onClick={() => {
                      removeCustomProvider(current.id)
                      setSelectedId('demo')
                    }}
                  >
                    删除此接口
                  </Button>
                ) : null}
              </div>
            </>
          )}

          {statusMsg ? (
            <div className={clsx(styles.statusText, statusMsg.error && styles.statusError)}>
              {statusMsg.text}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
