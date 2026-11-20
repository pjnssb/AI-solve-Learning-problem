import { IconMenuOutline20, IconNewChatOutline20 } from '../base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import { newChat } from '../../services/chat/store.js'
import { toggleCanvasPanel, useCanvasStore } from '../../services/tutor/canvasStore.js'
import { IconButton } from '../base/IconButton.js'
import { ModelSelector } from '../modelSelector/ModelSelector.js'
import { openMobileSider } from '../sider/mobileSiderState.js'
import styles from './MobileHeader.module.css'

/** 移动端顶栏：左侧菜单打开侧边栏；中间模型选择器；右侧画板开关与新对话 */
export const MobileHeader = ({ title }: { title?: string }) => {
  const t = useTranslate()
  const canvasOpen = useCanvasStore((state) => state.open)
  const stepCount = useCanvasStore((state) => state.steps.length)
  return (
    <div className={styles.header}>
      <IconButton
        size="xl"
        tone="primary"
        icon={<IconMenuOutline20 />}
        aria-label={t('expandSiderbarButton')}
        onClick={openMobileSider}
      />
      <div className={styles.center}>
        <ModelSelector />
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.boardBtn} onClick={toggleCanvasPanel}>
          {canvasOpen ? t('canvasClose') : t('canvasOpen')}
          {!canvasOpen && stepCount > 0 ? ` (${stepCount})` : ''}
        </button>
        {title === undefined ? null : (
          <IconButton
            size="xl"
            tone="primary"
            icon={<IconNewChatOutline20 />}
            aria-label={t('newChat')}
            onClick={newChat}
          />
        )}
      </div>
    </div>
  )
}
