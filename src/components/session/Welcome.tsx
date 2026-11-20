import clsx from 'clsx'
import { useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { EMPTY_DRAFT, useDrafts } from '../../services/chat/drafts.js'
import { sendQuickMessage } from '../../services/chat/store.js'
import { useSettings } from '../../services/settings.js'
import { toggleCanvasPanel, useCanvasStore } from '../../services/tutor/canvasStore.js'
import { GUIDED_LESSONS } from '../../services/tutor/demoEngine.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { ModelSelector } from '../modelSelector/ModelSelector.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './Welcome.module.css'

/**
 * 极简舒心的新对话欢迎页：
 * - 还原 DeepSeek 清爽主页气质，输入框下方不再堆砌任何杂乱卡片；
 * - 仅在未打开输入框且无草稿时轻巧展示 4 个单行快捷体验标签，一旦点击输入框或开始输入立即自动消失且不再出现。
 */
export const Welcome = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const locale = useSettings((state) => state.locale)
  const siderCollapsed = useSettings((state) => state.siderCollapsed) && !isMobile
  const canvasOpen = useCanvasStore((state) => state.open)
  const draft = useDrafts((state) => state.drafts.get(null) ?? EMPTY_DRAFT)
  const [inputOpened, setInputOpened] = useState(false)

  const showQuickPills = !inputOpened && draft.text.length === 0 && draft.attachments.length === 0

  return (
    <div className={styles.container}>
      {isMobile ? (
        <MobileHeader />
      ) : (
        <div className={styles.topBar}>
          <div className={clsx(siderCollapsed && styles.withCollapsedSider)}>
            <ModelSelector />
          </div>
          <button
            type="button"
            className={clsx(styles.canvasBtn, canvasOpen && styles.canvasBtnActive)}
            onClick={toggleCanvasPanel}
          >
            {canvasOpen ? t('canvasClose') : t('canvasOpen')}
          </button>
        </div>
      )}
      <div className={styles.welcome}>
        <div className={styles.hero}>
          <h1 className={styles.greeting}>{t('welcomeMessageChat250808')}</h1>
          {showQuickPills ? (
            <div className={styles.quickPills} aria-label="快速体验">
              {GUIDED_LESSONS.map((lesson) => {
                const isEn = locale === 'en-US'
                return (
                  <button
                    key={lesson.id}
                    type="button"
                    className={styles.quickPill}
                    onClick={() => {
                      if (ensureApiKey()) {
                        sendQuickMessage(null, isEn ? lesson.promptEn : lesson.promptZh)
                      }
                    }}
                  >
                    {isEn ? lesson.titleEn : lesson.titleZh}
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>

        <div
          className={styles.inputSlot}
          onFocusCapture={() => setInputOpened(true)}
          onMouseDownCapture={() => setInputOpened(true)}
          onTouchStartCapture={() => setInputOpened(true)}
        >
          <ChatInput sessionId={null} />
        </div>
        {isMobile ? <div className={styles.caveat}>{t('contentCaveat')}</div> : null}
      </div>
    </div>
  )
}
