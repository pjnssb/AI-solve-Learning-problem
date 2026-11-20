import clsx from 'clsx'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { sendQuickMessage } from '../../services/chat/store.js'
import { useSettings } from '../../services/settings.js'
import { toggleCanvasPanel, useCanvasStore } from '../../services/tutor/canvasStore.js'
import { GUIDED_LESSONS } from '../../services/tutor/demoEngine.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { ModelSelector } from '../modelSelector/ModelSelector.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './Welcome.module.css'

/** 新对话欢迎页：顶部仿 ChatGPT 模型选择器 + 居中 DeepSeek 风格输入框 + 4 个即点即学的交互课程 */
export const Welcome = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const locale = useSettings((state) => state.locale)
  const siderCollapsed = useSettings((state) => state.siderCollapsed) && !isMobile
  const canvasOpen = useCanvasStore((state) => state.open)

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
        <h1 className={styles.greeting}>{t('welcomeMessageChat250808')}</h1>
        <p className={styles.subtitle}>{t('welcomeSubtitle')}</p>
        <ChatInput sessionId={null} />

        <div className={styles.lessonsGrid} aria-label="精选交互式启发课程">
          {GUIDED_LESSONS.map((lesson) => {
            const isEn = locale === 'en-US'
            return (
              <button
                key={lesson.id}
                type="button"
                className={styles.lessonCard}
                onClick={() => {
                  if (ensureApiKey()) {
                    sendQuickMessage(null, isEn ? lesson.promptEn : lesson.promptZh)
                  }
                }}
              >
                <div className={styles.lessonTop}>
                  <span className={styles.lessonTitle}>
                    {isEn ? lesson.titleEn : lesson.titleZh}
                  </span>
                  <span
                    className={clsx(
                      styles.lessonTag,
                      lesson.boardType === 'flowchart' && styles.lessonTagFlow
                    )}
                  >
                    {isEn ? lesson.tagEn : lesson.tagZh}
                  </span>
                </div>
                <div className={styles.lessonDesc}>{isEn ? lesson.descEn : lesson.descZh}</div>
              </button>
            )
          })}
        </div>

        {isMobile ? <div className={styles.caveat}>{t('contentCaveat')}</div> : null}
      </div>
    </div>
  )
}
