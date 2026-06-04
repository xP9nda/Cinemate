import { useRef, useState, useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { profileUrl } from '../../lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { SpoilerText } from './SpoilerText'

export interface CastMember {
  id: number
  name: string
  character: string
  profile_path: string | null
  episodeCount?: number
}

const CARD_WIDTH = 80   // matches w-20
const GAP = 12          // matches gap-3
const PAD_TOP = 8       // py-2 on the scroll container
// Vertical centre of the avatar circle, used to anchor the scroll arrows.
const ARROW_TOP = PAD_TOP + CARD_WIDTH / 2

// Above this many people, render a horizontal window instead of mounting every
// card. Each card is a Radix Tooltip, and a long-running show's guest-star list
// can reach several thousand entries - otherwise that many live tooltip
// contexts. Smaller casts keep the plain flow layout (cheap, and avoids the
// fixed-height track a windowed list needs).
const VIRTUALIZE_THRESHOLD = 60

interface CastRowProps {
  members: CastMember[]
  blurEpisodeCounts: boolean
  onSelect: (id: number) => void
}

function CastCard({ member, blurEpisodeCounts, onSelect }: {
  member: CastMember
  blurEpisodeCounts: boolean
  onSelect: (id: number) => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className="flex-shrink-0 w-20 text-center cursor-pointer group"
          onClick={() => onSelect(member.id)}
        >
          <div className="h-20 w-20 rounded-full overflow-hidden bg-secondary mx-auto mb-1.5 outline outline-2 outline-transparent group-hover:outline-primary transition-all">
            {member.profile_path ? (
              <img src={profileUrl(member.profile_path)} alt={member.name} className="w-full h-full object-cover" loading="lazy" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
                {member.name.slice(0, 2)}
              </div>
            )}
          </div>
          <p className="text-xs font-medium line-clamp-1 group-hover:text-primary transition-colors">{member.name}</p>
          <p className="text-xs text-muted-foreground line-clamp-1 leading-tight">{member.character}</p>
          {member.episodeCount != null && (
            <SpoilerText blur={blurEpisodeCounts} className="text-[11px] text-muted-foreground/70 leading-tight block mt-0.5">
              {member.episodeCount} ep{member.episodeCount !== 1 ? 's' : ''}
            </SpoilerText>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p className="font-medium">{member.name}</p>
        {member.character && <p className="text-xs opacity-75">{member.character}</p>}
        {member.episodeCount != null && !blurEpisodeCounts && (
          <p className="text-xs opacity-75">{member.episodeCount} episodes</p>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

// Windowed horizontal track for large casts. Kept as its own component so the
// virtualizer hook only runs when virtualisation is actually in use.
function VirtualTrack({ members, scrollRef, blurEpisodeCounts, onSelect }: {
  members: CastMember[]
  scrollRef: React.RefObject<HTMLDivElement>
  blurEpisodeCounts: boolean
  onSelect: (id: number) => void
}) {
  // Cards are uniform; their height differs only by the optional episode-count
  // line, so a fixed track height per case is enough for absolute positioning.
  const hasEpCounts = members.some((m) => m.episodeCount != null)
  const trackHeight = hasEpCounts ? 134 : 118

  const virtualizer = useVirtualizer({
    horizontal: true,
    count: members.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CARD_WIDTH,
    gap: GAP,
    overscan: 6,
  })

  return (
    <div style={{ width: virtualizer.getTotalSize(), height: trackHeight, position: 'relative' }}>
      {virtualizer.getVirtualItems().map((vi) => (
        <div
          key={members[vi.index].id}
          // Position with `left`, not `transform`: a transformed ancestor becomes
          // the containing block for the tooltip's position:fixed content and
          // would clip it inside the scroll container. `left` keeps the tooltip
          // anchored to the viewport so it can overflow the row like the flow layout.
          style={{ position: 'absolute', top: 0, left: vi.start, height: '100%', width: CARD_WIDTH }}
        >
          <CastCard member={members[vi.index]} blurEpisodeCounts={blurEpisodeCounts} onSelect={onSelect} />
        </div>
      ))}
    </div>
  )
}

export function CastRow({ members, blurEpisodeCounts, onSelect }: CastRowProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  const updateArrows = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanLeft(el.scrollLeft > 4)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    updateArrows()
    el.addEventListener('scroll', updateArrows, { passive: true })
    const ro = new ResizeObserver(updateArrows)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', updateArrows)
      ro.disconnect()
    }
  }, [updateArrows, members.length])

  const scrollBy = (dir: 'left' | 'right') => {
    scrollRef.current?.scrollBy({ left: dir === 'left' ? -320 : 320, behavior: 'smooth' })
  }

  const virtualize = members.length > VIRTUALIZE_THRESHOLD

  return (
    <div className="relative min-w-0">
      <div
        ref={scrollRef}
        className="overflow-x-auto px-1.5 py-2"
        style={{ scrollbarWidth: 'none' }}
      >
        {virtualize ? (
          <VirtualTrack members={members} scrollRef={scrollRef} blurEpisodeCounts={blurEpisodeCounts} onSelect={onSelect} />
        ) : (
          <div className="flex gap-3">
            {members.map((m) => (
              <CastCard key={m.id} member={m} blurEpisodeCounts={blurEpisodeCounts} onSelect={onSelect} />
            ))}
          </div>
        )}
      </div>
      {canLeft && (
        <button
          onClick={() => scrollBy('left')}
          style={{ top: ARROW_TOP }}
          className="absolute left-0 -translate-y-1/2 -translate-x-3 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-card border border-border shadow-lg text-foreground hover:bg-secondary transition-colors"
          aria-label="Scroll left"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      )}
      {canRight && (
        <button
          onClick={() => scrollBy('right')}
          style={{ top: ARROW_TOP }}
          className="absolute right-0 -translate-y-1/2 translate-x-3 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-card border border-border shadow-lg text-foreground hover:bg-secondary transition-colors"
          aria-label="Scroll right"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
