import clsx from 'clsx'
import { jumpToMessageStep } from '../../services/tutor/canvasStore.js'
import { isFlowchartTool } from '../../services/tutor/toolParser.js'
import type { TutorToolCall } from '../../services/tutor/types.js'
import styles from './TutorReplyExtras.module.css'

const getToolBadge = (call: TutorToolCall): { label: string; kind: 'coord' | 'aux' | 'flow' } => {
  if (call.tool === 'board_switch') {
    return { label: '切换画板', kind: 'coord' }
  }
  if (call.tool === 'coord_remove' || call.tool === 'flow_remove') {
    return { label: '删除元素', kind: 'aux' }
  }
  if (isFlowchartTool(call.tool)) {
    return { label: '流程图工具', kind: 'flow' }
  }
  if (call.tool === 'coord_draw_auxiliary_line' || call.tool === 'coord_add_moving_point') {
    return {
      label: call.tool === 'coord_add_moving_point' ? '动点工具' : '辅助线工具',
      kind: 'aux',
    }
  }
  return { label: '坐标系工具', kind: 'coord' }
}

/** 展示本轮回复中 AI Agent 逐步调用的画板工具卡片；点击可聚焦到对应步骤的画板状态 */
export const TutorToolCallList = ({
  messageId,
  toolCalls,
  pendingLabel,
}: {
  messageId: string
  toolCalls: TutorToolCall[]
  pendingLabel: string | null
}) => {
  if (toolCalls.length === 0 && !pendingLabel) {
    return null
  }
  return (
    <div className={styles.toolList}>
      {toolCalls.map((call) => {
        const badge = getToolBadge(call)
        return (
          <button
            key={call.id}
            type="button"
            className={styles.toolCard}
            onClick={() => jumpToMessageStep(messageId)}
          >
            <span className={styles.toolLeft}>
              <span
                className={clsx(
                  styles.toolTag,
                  badge.kind === 'aux' && styles.toolTagAux,
                  badge.kind === 'flow' && styles.toolTagFlow
                )}
              >
                {badge.label}
              </span>
              <span className={styles.toolSummary}>{call.summary}</span>
            </span>
            <span className={styles.toolAction}>查看画板 →</span>
          </button>
        )
      })}
      {pendingLabel ? <div className={styles.pendingTool}>{pendingLabel}</div> : null}
    </div>
  )
}

/** 启发式引导快捷回复选项（点击直接发送，或在下方自由输入自己的想法） */
export const TutorQuickChoices = ({
  choices,
  disabled,
  onSelect,
}: {
  choices: string[]
  disabled: boolean
  onSelect: (choice: string) => void
}) => {
  if (choices.length === 0) {
    return null
  }
  return (
    <div className={styles.choicesWrap}>
      <div className={styles.choicesHint}>可直接点击下方思路回应，或在输入框写出你的想法：</div>
      <div className={styles.choicesList}>
        {choices.map((choice) => (
          <button
            key={choice}
            type="button"
            className={styles.choiceChip}
            disabled={disabled}
            onClick={() => onSelect(choice)}
          >
            {choice}
          </button>
        ))}
      </div>
    </div>
  )
}
