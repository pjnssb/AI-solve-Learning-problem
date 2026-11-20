import clsx from 'clsx'
import { useState } from 'react'
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
} from '../../services/tutor/providers.js'
import { setApiKey } from '../../services/settings.js'
import { Button } from '../base/Button.js'
import styles from './ProvidersPanel.module.css'

/**
 * 设置页「多服务商与模型配置」面板：
 * 支持 DeepSeek / OpenAI / Anthropic Claude / Google Gemini / OpenRouter / 通义千问 / Ollama 以及任意自定义兼容端点。
 */
export const ProvidersPanel = () => {
  const providers = useProviderStore((state) => state.providers)
  const activeProviderId = useProviderStore((state) => state.activeProviderId)
  const activeModelId = useProviderStore((state) => state.activeModelId)

  const [selectedId, setSelectedId] = useState(activeProviderId)
  const [newModelId, setNewModelId] = useState('')
  const [fetching, setFetching] = useState(false)
  const [statusMsg, setStatusMsg] = useState<{ text: string; error?: boolean } | null>(null)
  const [addingCustom, setAddingCustom] = useState(false)
  const [customForm, setCustomForm] = useState({
    name: '',
    protocol: 'openai' as Exclude<ApiProtocol, 'demo'>,
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    modelId: 'gpt-4o',
  })

  const current = providers.find((p) => p.id === selectedId) ?? providers[0]

  const onFetchModels = async () => {
    setFetching(true)
    setStatusMsg(null)
    try {
      const models = await fetchProviderModels(current)
      if (models.length === 0) {
        setStatusMsg({ text: '接口返回成功，但未检测到可用模型列表。' })
      } else {
        updateProviderConfig(current.id, { models })
        setStatusMsg({ text: `已成功拉取 ${models.length} 个可用模型并更新列表。` })
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

  return (
    <div className={styles.wrap}>
      <div className={styles.providerPills}>
        {providers.map((p) => {
          const configured =
            p.protocol === 'demo' || p.id === 'ollama' || p.apiKey.trim().length > 0
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
          <div className={styles.cardTitle}>添加自定义 AI 服务商 / 聚合代理</div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>服务商名称</label>
            <input
              className={styles.input}
              placeholder="例如：硅基流动 / OneAPI / 公司内网网关"
              value={customForm.name}
              onChange={(event) => setCustomForm((prev) => ({ ...prev, name: event.target.value }))}
            />
          </div>
          <div className={styles.field}>
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
              <option value="openai">OpenAI 兼容协议 (/chat/completions)</option>
              <option value="anthropic">Anthropic 兼容协议 (/messages)</option>
              <option value="gemini">Google Gemini 原生协议</option>
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>API Base URL</label>
            <input
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
              type="password"
              className={styles.input}
              placeholder="sk-..."
              value={customForm.apiKey}
              onChange={(event) =>
                setCustomForm((prev) => ({ ...prev, apiKey: event.target.value }))
              }
            />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>默认模型 ID</label>
            <input
              className={styles.input}
              placeholder="例如：deepseek-ai/DeepSeek-V3 或 gpt-4o"
              value={customForm.modelId}
              onChange={(event) =>
                setCustomForm((prev) => ({ ...prev, modelId: event.target.value }))
              }
            />
          </div>
          <div className={styles.row}>
            <Button
              variant="primary"
              size="s"
              onClick={() => {
                const created = addCustomProvider(customForm)
                selectProviderModel(created.id, created.models[0].id)
                setSelectedId(created.id)
                setAddingCustom(false)
                setStatusMsg({ text: `已添加并切换到「${created.name}」` })
              }}
            >
              保存并启用
            </Button>
            <Button variant="outlined" size="s" onClick={() => setAddingCustom(false)}>
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
              内置苏格拉底教学演示引擎无需 API Key，开箱即可体验「数学动点与动态辅助线」、「GeoGebra
              联动」以及「英语长难句 / 数学逻辑渐进式流程图」。 若想辅导任意自拟题目，请在上方选择
              DeepSeek、OpenAI、Claude、Gemini 或自定义接口并填入 API Key。
            </div>
          ) : (
            <>
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
                <label className={styles.fieldLabel}>API Key（仅保存在本地浏览器）</label>
                <input
                  type="password"
                  className={styles.input}
                  value={current.apiKey}
                  placeholder="请输入该服务商的 API Key"
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
                <label className={styles.fieldLabel}>可用模型（点击即可设为当前默认模型）</label>
                <div className={styles.modelTags}>
                  {current.models.map((m) => {
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
                {current.protocol !== 'deepseek-native' ? (
                  <Button
                    variant="outlined"
                    size="s"
                    disabled={fetching}
                    onClick={() => void onFetchModels()}
                  >
                    {fetching ? '拉取中...' : '拉取 /models'}
                  </Button>
                ) : null}
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
