import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { selectProviderModel, useProviderStore } from '../../services/tutor/providers.js'
import { openSettings } from '../settings/settingsDialogState.js'
import styles from './ModelSelector.module.css'

/**
 * 仿 ChatGPT 顶部直觉式多服务商模型选择器：
 * 支持一键在「免 Key 演示引擎 / DeepSeek / OpenAI / Claude / Gemini / OpenRouter / 通义千问 / Ollama / 自定义接口」之间切换。
 */
export const ModelSelector = ({ className }: { className?: string }) => {
  const providers = useProviderStore((state) => state.providers)
  const activeProviderId = useProviderStore((state) => state.activeProviderId)
  const activeModelId = useProviderStore((state) => state.activeModelId)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)

  const activeProvider = providers.find((p) => p.id === activeProviderId) ?? providers[0]
  const activeModel =
    activeProvider.models.find((m) => m.id === activeModelId) ?? activeProvider.models[0]

  useEffect(() => {
    if (!open) {
      return
    }
    const onPointerDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase()
    return providers
      .filter((p) => p.enabled && (p.protocol === 'demo' || p.apiKey.trim().length > 0))
      .map((provider) => ({
        provider,
        models: q
          ? provider.models.filter(
              (m) =>
                m.name.toLowerCase().includes(q) ||
                m.id.toLowerCase().includes(q) ||
                provider.name.toLowerCase().includes(q)
            )
          : provider.models,
      }))
      .filter((g) => g.models.length > 0)
  }, [providers, query])

  const isDemo = activeProvider.protocol === 'demo'

  return (
    <div ref={wrapRef} className={clsx(styles.wrap, className)}>
      <button
        type="button"
        className={clsx(styles.trigger, open && styles.triggerOpen)}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className={styles.modelName}>{activeModel?.name ?? activeModelId}</span>
        <span className={clsx(styles.badge, isDemo && styles.badgeDemo)}>
          {isDemo ? '演示' : activeProvider.name.split(' ')[0]}
        </span>
        <span className={clsx(styles.caret, open && styles.caretOpen)}>▾</span>
      </button>

      {open ? (
        <div className={styles.popover} role="dialog" aria-label="选择 AI 服务商与模型">
          <div className={styles.searchBox}>
            <input
              type="text"
              className={styles.searchInput}
              placeholder="搜索已配置的模型..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoFocus
            />
          </div>

          <div className={styles.list}>
            {filteredGroups.map(({ provider, models }) => (
              <div key={provider.id} className={styles.group}>
                <div className={styles.groupHeader}>
                  <span>{provider.name}</span>
                  <span className={styles.statusDot}>
                    <span className={styles.dotReady} />
                    {provider.protocol === 'demo' ? '免 Key 体验' : '已就绪'}
                  </span>
                </div>
                {models.map((model) => {
                  const selected = provider.id === activeProviderId && model.id === activeModelId
                  return (
                    <button
                      key={`${provider.id}:${model.id}`}
                      type="button"
                      className={clsx(styles.option, selected && styles.optionSelected)}
                      onClick={() => {
                        selectProviderModel(provider.id, model.id)
                        setOpen(false)
                        setQuery('')
                      }}
                    >
                      <span className={styles.optionMain}>
                        <span className={styles.optionTitle}>{model.name}</span>
                        {model.description ? (
                          <span className={styles.optionDesc}>{model.description}</span>
                        ) : null}
                      </span>
                      {selected ? <span className={styles.check}>✓</span> : null}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>

          <div className={styles.footer}>
            <button
              type="button"
              className={styles.manageBtn}
              onClick={() => {
                setOpen(false)
                openSettings('providers')
              }}
            >
              配置更多服务商 / API Key / 自定义网关...
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
