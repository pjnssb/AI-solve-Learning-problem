import { useEffect, useState } from 'react'

type VersionManifest = {
  version?: string
  builtAt?: string
}

const RELOADED_KEY = 'ai-tutor:reloaded-version'
const CHECK_INTERVAL_MS = 60_000

/**
 * 检查远端 version.json 是否已发布新版本；
 * 若当前浏览器加载的是旧缓存页面，返回新版本号并支持一键带 ?v=<version> 强制刷新绕过缓存。
 */
export const useVersionCheck = () => {
  const [latestVersion, setLatestVersion] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!__IS_PROD__ || typeof window === 'undefined') {
      return
    }
    if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') {
      return
    }

    let cancelled = false
    let lastCheckedAt = 0

    const check = async () => {
      const now = Date.now()
      if (now - lastCheckedAt < CHECK_INTERVAL_MS) {
        return
      }
      lastCheckedAt = now
      try {
        const res = await fetch(`./version.json?_=${now}`, { cache: 'no-store' })
        if (!res.ok) {
          return
        }
        const data = (await res.json()) as VersionManifest
        const remote = typeof data.version === 'string' ? data.version.trim() : ''
        if (!remote || remote === __APP_VERSION__) {
          return
        }
        try {
          if (sessionStorage.getItem(RELOADED_KEY) === remote) {
            return
          }
        } catch {
          // 忽略隐私模式 storage 异常
        }
        if (!cancelled) {
          setLatestVersion(remote)
        }
      } catch {
        // 离线或网络波动时静默忽略
      }
    }

    void check()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void check()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  const applyUpdate = () => {
    if (!latestVersion) {
      return
    }
    try {
      sessionStorage.setItem(RELOADED_KEY, latestVersion)
    } catch {
      // 忽略存储异常
    }
    const url = new URL(window.location.href)
    url.searchParams.set('v', latestVersion)
    window.location.replace(url.toString())
  }

  return {
    latestVersion: dismissed ? null : latestVersion,
    applyUpdate,
    dismissUpdate: () => setDismissed(true),
  }
}
