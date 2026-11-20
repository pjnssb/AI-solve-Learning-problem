import clsx from 'clsx'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import type { Session } from '../../services/chat/types.js'
import { toggleCanvasPanel, useCanvasStore } from '../../services/tutor/canvasStore.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MessageList } from '../messages/MessageList.js'
import { ModelSelector } from '../modelSelector/ModelSelector.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './SessionView.module.css'

/** 会话页：顶部模型选择器 + 标题 + 画板开关；消息列表与吸底输入框 */
export const SessionView = ({
  session,
  streaming,
  siderCollapsed,
}: {
  session: Session
  streaming: boolean
  siderCollapsed: boolean
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const canvasOpen = useCanvasStore((state) => state.open)
  const stepCount = useCanvasStore((state) => state.steps.length)
  const title = session.title || t('untitledChat')
  return (
    <div className={styles.view}>
      {isMobile ? (
        <MobileHeader title={title} />
      ) : (
        <div className={styles.header}>
          <div className={clsx(styles.headerLeft, siderCollapsed && styles.withCollapsedSider)}>
            <ModelSelector />
            <span className={styles.headerSep} aria-hidden />
            <div className={styles.title}>{title}</div>
          </div>
          <button
            type="button"
            className={clsx(styles.canvasToggle, canvasOpen && styles.canvasToggleActive)}
            onClick={toggleCanvasPanel}
          >
            <span>{canvasOpen ? t('canvasClose') : t('canvasOpen')}</span>
            {stepCount > 0 ? <span className={styles.stepCount}>{stepCount} 步</span> : null}
          </button>
        </div>
      )}
      <MessageList
        session={session}
        streaming={streaming}
        footer={
          <div className={styles.inputContainer}>
            <ChatInput sessionId={session.id} />
            <div className={styles.caveat}>{t('contentCaveat')}</div>
          </div>
        }
      />
    </div>
  )
}
