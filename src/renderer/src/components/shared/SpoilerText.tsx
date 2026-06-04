import { useState } from 'react'
import { cn } from '../../lib/utils'

// Blurs its children until clicked. Used for ratings, descriptions and episode
// counts that would otherwise spoil unwatched titles. A no-op passthrough when
// `blur` is false so callers can wire it in unconditionally.
export function SpoilerText({ blur, className, children }: { blur: boolean; className?: string; children: React.ReactNode }) {
  const [revealed, setRevealed] = useState(false)
  if (!blur) return <span className={className}>{children}</span>
  return (
    <span
      className={cn(className, 'spoiler-blur', revealed && 'revealed')}
      onClick={(e) => { e.stopPropagation(); setRevealed(true) }}
    >
      {children}
    </span>
  )
}
