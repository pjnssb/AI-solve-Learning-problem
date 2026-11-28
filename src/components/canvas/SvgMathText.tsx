import { memo, useMemo } from 'react'

export type SvgMathSegment = {
  kind: 'normal' | 'sub' | 'sup'
  text: string
}

const normalizeSvgMathDelimiters = (raw: string): string => {
  if (!raw.includes('$') && !raw.includes('\\(')) {
    return raw
  }
  const formatInlineLatex = (expr: string) =>
    expr
      .replace(/\\triangle\b/g, '△')
      .replace(/\\angle\b/g, '∠')
      .replace(/\\perp\b/g, '⊥')
      .replace(/\\parallel\b/g, '∥')
      .replace(/\\times\b/g, '×')
      .replace(/\\div\b/g, '÷')
      .replace(/\\pm\b/g, '±')
      .replace(/\\leq?\b/g, '≤')
      .replace(/\\geq?\b/g, '≥')
      .replace(/\\neq?\b/g, '≠')
      .replace(/\\approx\b/g, '≈')
      .replace(/\\cdot\b/g, '·')
      .replace(/\\pi\b/g, 'π')
      .replace(/\\sqrt\b/g, '√')
      .replace(/_\{([^{}]+)\}/g, '<sub>$1</sub>')
      .replace(/_([A-Za-z0-9△])/g, '<sub>$1</sub>')
      .replace(/\^\{([^{}]+)\}/g, '<sup>$1</sup>')
      .replace(/\^([A-Za-z0-9+\-'])/g, '<sup>$1</sup>')

  return raw
    .replace(/\$([^$]+?)\$/g, (_m, expr: string) => formatInlineLatex(expr))
    .replace(/\\\((.+?)\\\)/g, (_m, expr: string) => formatInlineLatex(expr))
}

export const parseSvgMathSegments = (raw: string): SvgMathSegment[] => {
  const normalized = normalizeSvgMathDelimiters(raw)
  if (!normalized.includes('<')) {
    return [{ kind: 'normal', text: normalized }]
  }
  const re = /<(sub|sup)\b[^>]*>([\s\S]*?)<\/\1>/gi
  const segments: SvgMathSegment[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(normalized)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: 'normal', text: normalized.slice(lastIndex, match.index) })
    }
    const kind = match[1].toLowerCase() === 'sup' ? 'sup' : 'sub'
    const inner = match[2].replace(/<\/?(?:sub|sup|b|i|u|span)\b[^>]*>/gi, '')
    if (inner) {
      segments.push({ kind, text: inner })
    }
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < normalized.length) {
    segments.push({ kind: 'normal', text: normalized.slice(lastIndex) })
  }
  return segments.length > 0 ? segments : [{ kind: 'normal', text: normalized }]
}

/** 提取纯文本用于 SVG 宽度估算，避免把 <sub>/<sup> 标签计入字符宽度 */
export const stripSvgMathTags = (raw: string): string =>
  parseSvgMathSegments(raw)
    .map((seg) => seg.text)
    .join('')

/** 在 SVG <text> 内渲染支持 <sub>、<sup> 及简单 $...$ 上下标的数学文字 */
export const SvgMathText = memo(function SvgMathText({ text }: { text: string }) {
  const segments = useMemo(() => parseSvgMathSegments(text), [text])
  if (segments.length === 1 && segments[0].kind === 'normal') {
    return <>{segments[0].text}</>
  }

  let currentOffsetEm = 0
  return (
    <>
      {segments.map((seg, idx) => {
        const targetOffsetEm = seg.kind === 'sub' ? 0.22 : seg.kind === 'sup' ? -0.32 : 0
        const scale = seg.kind === 'normal' ? 1 : 0.75
        const deltaEm = Math.round(((targetOffsetEm - currentOffsetEm) / scale) * 1000) / 1000
        currentOffsetEm = targetOffsetEm
        const dy = deltaEm !== 0 ? `${deltaEm}em` : undefined
        if (seg.kind === 'normal') {
          return dy ? (
            <tspan key={idx} dy={dy}>
              {seg.text}
            </tspan>
          ) : (
            <tspan key={idx}>{seg.text}</tspan>
          )
        }
        return (
          <tspan key={idx} dy={dy} fontSize="0.75em">
            {seg.text}
          </tspan>
        )
      })}
    </>
  )
})
