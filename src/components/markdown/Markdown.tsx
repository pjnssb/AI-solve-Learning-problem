import { memo, useMemo } from 'react'
import type { PhrasingContent } from 'mdast'
import type { Source } from '../../services/chat/view.js'
import { toMdAst } from '../../services/markdown/parse.js'
import { useScrollToBottom } from '../messages/scrollContext.js'
import { MarkdownAstRenderer, MarkdownPhrasingContent } from './MarkdownAstRenderer.js'
import { useThrottleMarkdownRender } from './useThrottleMarkdownRender.js'
import './markdown.css'
import './highlight.css'

/**
 * 渲染链路：节流 → 解析 AST → 渲染。
 * 传入 sources 时把正文里的 [citation:N] 渲染为角标。
 */
export const Markdown = memo(function Markdown({
  content,
  loading,
  cacheKey,
  className,
  disableLink,
  sources,
}: {
  content: string
  loading: boolean
  cacheKey: string
  className?: string
  disableLink: boolean
  sources?: Source[]
}) {
  const scrollToBottom = useScrollToBottom()
  const throttledMarkdown = useThrottleMarkdownRender(content, loading)
  const ast = useMemo(
    () => (throttledMarkdown ? toMdAst(throttledMarkdown, { sources, disableLink }) : null),
    [throttledMarkdown, sources, disableLink]
  )
  return ast ? (
    <MarkdownAstRenderer
      key={cacheKey}
      className={className}
      ast={ast}
      loading={loading}
      onUpdate={scrollToBottom}
    />
  ) : null
})

/** 轻量行内富文本渲染：支持 $...$、\(...\)、<sub>、<sup>、**...** 等，适用于选项按钮与画板文字 */
export const InlineMarkdown = memo(function InlineMarkdown({ text }: { text: string }) {
  const nodes = useMemo((): PhrasingContent[] | null => {
    if (!text) {
      return null
    }
    const ast = toMdAst(text, { sources: undefined, disableLink: true })
    if (ast.children.length === 1 && ast.children[0].type === 'paragraph') {
      return ast.children[0].children
    }
    return null
  }, [text])

  if (!nodes) {
    return <>{text}</>
  }
  return (
    <span className="ds-markdown ds-markdown-inline">
      <MarkdownPhrasingContent nodes={nodes} />
    </span>
  )
})
