import clsx from 'clsx'
import { useState } from 'react'
import { jumpToMessageStep } from '../../services/tutor/canvasStore.js'
import { isCoordinateTool, isFlowchartTool } from '../../services/tutor/toolParser.js'
import type { TutorToolCall } from '../../services/tutor/types.js'
import styles from './TutorReplyExtras.module.css'

const getToolBadge = (call: TutorToolCall): { label: string; kind: 'coord' | 'aux' | 'flow' } => {
  if (call.tool === 'board_switch') {
    return { label: '切换', kind: 'coord' }
  }
  if (
    call.tool === 'coord_remove' ||
    call.tool === 'flow_remove' ||
    call.tool === 'coord_remove_constraint' ||
    call.tool === 'coord_remove_script'
  ) {
    return { label: '擦除', kind: 'aux' }
  }
  if (isFlowchartTool(call.tool)) {
    return { label: '流程', kind: 'flow' }
  }
  if (call.tool === 'coord_add_constraint') {
    return { label: '约束', kind: 'flow' }
  }
  if (call.tool === 'coord_set_script') {
    return { label: '程序', kind: 'flow' }
  }
  if (call.tool === 'coord_add_slider' || call.tool === 'coord_set_param') {
    return { label: '滑块', kind: 'coord' }
  }
  if (call.tool === 'coord_add_derived_point') {
    return { label: '构造', kind: 'aux' }
  }
  if (call.tool === 'coord_draw_angle') {
    return { label: '角度', kind: 'aux' }
  }
  if (call.tool === 'coord_toggle_trace') {
    return { label: '轨迹', kind: 'aux' }
  }
  if (call.tool === 'coord_update') {
    return { label: '更新', kind: 'coord' }
  }
  if (call.tool === 'coord_draw_auxiliary_line' || call.tool === 'coord_add_moving_point') {
    return {
      label: call.tool === 'coord_add_moving_point' ? '动点' : '辅助线',
      kind: 'aux',
    }
  }
  return { label: '坐标', kind: 'coord' }
}

/** 展示本轮回复中 AI Agent 调用的画板工具聚合卡片；支持一键查看画板或点击单项精准高亮对应元素 */
export const TutorToolCallList = ({
  messageId,
  toolCalls,
  pendingLabel,
}: {
  messageId: string
  toolCalls: TutorToolCall[]
  pendingLabel: string | null
}) => {
  const [expanded, setExpanded] = useState(false)

  if (toolCalls.length === 0 && !pendingLabel) {
    return null
  }

  const hasCoord = toolCalls.some((c) => isCoordinateTool(c.tool))
  const hasFlow = toolCalls.some((c) => isFlowchartTool(c.tool))
  const headerKind: 'coord' | 'flow' | 'mixed' =
    hasCoord && hasFlow ? 'mixed' : hasFlow ? 'flow' : 'coord'
  const headerTitle =
    headerKind === 'mixed'
      ? '双画板联动更新'
      : headerKind === 'flow'
        ? '思维流程图更新'
        : '坐标系画板更新'

  const maxVisible = 3
  const visibleCalls = expanded ? toolCalls : toolCalls.slice(0, maxVisible)
  const hiddenCount = Math.max(0, toolCalls.length - maxVisible)

  return (
    <div className={styles.toolWrap}>
      {toolCalls.length > 0 ? (
        <div className={styles.toolBox}>
          <div className={styles.toolHeader}>
            <div className={styles.toolHeaderLeft}>
              <span
                className={clsx(
                  styles.toolHeaderDot,
                  headerKind === 'flow' && styles.toolHeaderDotFlow,
                  headerKind === 'mixed' && styles.toolHeaderDotMixed
                )}
              />
              <span className={styles.toolHeaderTitle}>{headerTitle}</span>
              <span className={styles.toolCount}>{toolCalls.length} 步操作</span>
            </div>
            <button
              type="button"
              className={styles.toolOpenBtn}
              onClick={() => jumpToMessageStep(messageId, toolCalls.at(-1))}
            >
              定位到画板 →
            </button>
          </div>
          <div className={styles.toolChipGrid}>
            {visibleCalls.map((call) => {
              const badge = getToolBadge(call)
              return (
                <button
                  key={call.id}
                  type="button"
                  className={styles.toolChip}
                  title="点击切换到对应画板并高亮该元素"
                  onClick={() => jumpToMessageStep(messageId, call)}
                >
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
                </button>
              )
            })}
            {hiddenCount > 0 ? (
              <button
                type="button"
                className={styles.toolMoreBtn}
                onClick={() => setExpanded((prev) => !prev)}
              >
                {expanded ? '收起' : `展开其余 ${hiddenCount} 项`}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {pendingLabel ? (
        <div className={styles.pendingTool}>
          <span className={styles.pendingPulse} />
          <span>{pendingLabel}</span>
        </div>
      ) : null}
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
