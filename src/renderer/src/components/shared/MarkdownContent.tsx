import React, { useMemo } from 'react'
import { cn } from '../../lib/utils'

interface MarkdownContentProps {
  children: string
  className?: string
}

// ── Inline parser ─────────────────────────────────────────────────────────────

type InlineNode = string | React.ReactElement

function parseInline(text: string, prefix: string): InlineNode[] {
  const pattern = /\*\*(.+?)\*\*|\*(.+?)\*|~~(.+?)~~|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g
  const nodes: InlineNode[] = []
  let last = 0
  let m: RegExpExecArray | null

  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const k = `${prefix}:${m.index}`
    if (m[1] !== undefined) {
      nodes.push(<strong key={k} className="font-semibold text-foreground">{m[1]}</strong>)
    } else if (m[2] !== undefined) {
      nodes.push(<em key={k} className="italic">{m[2]}</em>)
    } else if (m[3] !== undefined) {
      nodes.push(<del key={k} className="line-through opacity-60">{m[3]}</del>)
    } else if (m[4] !== undefined) {
      nodes.push(<code key={k} className="bg-secondary/80 text-foreground rounded px-1 py-0.5 text-xs font-mono">{m[4]}</code>)
    } else if (m[5] !== undefined) {
      const url = m[6]
      nodes.push(
        <a key={k} className="text-primary underline underline-offset-2 hover:opacity-80 cursor-pointer"
          onClick={(e) => { e.preventDefault(); window.open(url, '_blank') }}>
          {m[5]}
        </a>
      )
    }
    last = m.index + m[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes.length ? nodes : [text]
}

function Inline({ text, prefix }: { text: string; prefix: string }) {
  return <>{parseInline(text, prefix)}</>
}

// ── Block parser ──────────────────────────────────────────────────────────────

type MDBlock =
  | { t: 'h'; level: 1 | 2 | 3; text: string }
  | { t: 'p'; lines: string[] }
  | { t: 'ul'; items: string[] }
  | { t: 'ol'; items: string[] }
  | { t: 'bq'; text: string }
  | { t: 'hr' }

function parseBlocks(md: string): MDBlock[] {
  const lines = md.split('\n')
  const blocks: MDBlock[] = []
  let i = 0

  while (i < lines.length) {
    const raw = lines[i]

    if (!raw.trim()) { i++; continue }

    const hm = raw.match(/^(#{1,3}) (.+)/)
    if (hm) {
      blocks.push({ t: 'h', level: hm[1].length as 1 | 2 | 3, text: hm[2].trim() })
      i++; continue
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(raw.trim())) {
      blocks.push({ t: 'hr' })
      i++; continue
    }

    if (/^[-*+] /.test(raw)) {
      const items: string[] = []
      while (i < lines.length && /^[-*+] /.test(lines[i])) {
        items.push(lines[i].replace(/^[-*+] +/, ''))
        i++
      }
      blocks.push({ t: 'ul', items }); continue
    }

    if (/^\d+\. /.test(raw)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\. +/, ''))
        i++
      }
      blocks.push({ t: 'ol', items }); continue
    }

    if (raw.startsWith('> ')) {
      const qlines: string[] = []
      while (i < lines.length && lines[i].startsWith('> ')) {
        qlines.push(lines[i].slice(2))
        i++
      }
      blocks.push({ t: 'bq', text: qlines.join('\n') }); continue
    }

    // Paragraph: consume consecutive non-block lines
    const plines: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^#{1,3} /.test(lines[i]) &&
      !/^[-*+] /.test(lines[i]) &&
      !/^\d+\. /.test(lines[i]) &&
      !lines[i].startsWith('> ') &&
      !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim())
    ) {
      plines.push(lines[i])
      i++
    }
    if (plines.length) blocks.push({ t: 'p', lines: plines })
  }

  return blocks
}

// ── Block renderer ────────────────────────────────────────────────────────────

function MDBlock({ block, idx }: { block: MDBlock; idx: number }) {
  switch (block.t) {
    case 'h': {
      const cls =
        block.level === 1 ? 'text-base font-semibold text-foreground' :
        block.level === 2 ? 'text-sm font-semibold text-foreground' :
                            'text-sm font-medium text-foreground'
      const inner = <Inline text={block.text} prefix={`${idx}`} />
      if (block.level === 1) return <h1 className={cls}>{inner}</h1>
      if (block.level === 2) return <h2 className={cls}>{inner}</h2>
      return <h3 className={cls}>{inner}</h3>
    }
    case 'p':
      return (
        <p className="text-sm text-muted-foreground leading-relaxed">
          {block.lines.map((line, li) => (
            <React.Fragment key={li}>
              {li > 0 && <br />}
              <Inline text={line} prefix={`${idx}-${li}`} />
            </React.Fragment>
          ))}
        </p>
      )
    case 'ul':
      return (
        <ul className="list-disc list-inside space-y-0.5 text-sm text-muted-foreground">
          {block.items.map((item, ii) => (
            <li key={ii}><Inline text={item} prefix={`${idx}-${ii}`} /></li>
          ))}
        </ul>
      )
    case 'ol':
      return (
        <ol className="list-decimal list-inside space-y-0.5 text-sm text-muted-foreground">
          {block.items.map((item, ii) => (
            <li key={ii}><Inline text={item} prefix={`${idx}-${ii}`} /></li>
          ))}
        </ol>
      )
    case 'bq':
      return (
        <blockquote className="border-l-2 border-border pl-3 text-muted-foreground/80 italic text-sm">
          <Inline text={block.text} prefix={`${idx}`} />
        </blockquote>
      )
    case 'hr':
      return <hr className="border-border" />
    default:
      return null
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function MarkdownContent({ children, className }: MarkdownContentProps) {
  const blocks = useMemo(() => parseBlocks(children), [children])
  return (
    <div className={cn('space-y-1.5', className)}>
      {blocks.map((block, i) => <MDBlock key={i} block={block} idx={i} />)}
    </div>
  )
}

export function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*(.+?)\*\*/gs, '$1')
    .replace(/\*(.+?)\*/gs, '$1')
    .replace(/~~(.+?)~~/gs, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\n{2,}/g, ' ')
    .trim()
}
