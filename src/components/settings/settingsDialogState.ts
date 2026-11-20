import { create } from 'zustand'
import { useSettings } from '../../services/settings.js'
import { getActiveProviderAndModel } from '../../services/tutor/providers.js'

/** 设置弹窗的分组：通用设置 / 模型与服务商 / 数据管理 */
export type SettingsSection = 'general' | 'providers' | 'data'

/** 设置弹窗：侧边栏底部、模型选择器与缺少 API Key 时的操作都可以打开 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'general' as SettingsSection,
}))

export const openSettings = (section: SettingsSection) =>
  useSettingsDialog.setState({ open: true, section })

export const closeSettings = () => useSettingsDialog.setState({ open: false })

/** 校验当前选中服务商是否已具备可用凭据；内置演示模式与本地 Ollama 无需 API Key */
export const ensureApiKey = () => {
  const { provider } = getActiveProviderAndModel()
  if (provider.protocol === 'demo' || provider.id === 'ollama') {
    return true
  }
  if (provider.protocol === 'deepseek-native') {
    if (provider.apiKey.trim() || useSettings.getState().apiKey) {
      return true
    }
    openSettings('providers')
    return false
  }
  if (provider.apiKey.trim()) {
    return true
  }
  openSettings('providers')
  return false
}
