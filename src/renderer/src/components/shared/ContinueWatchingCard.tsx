import { useEffect, useMemo, useState } from 'react'
import { Tv, Check, Ban, AlertTriangle } from 'lucide-react'
import { getSeason } from '../../lib/tmdb'
import { useStore } from '../../lib/store'
import type { MediaTarget } from '../../lib/mediaActions'
import { cn, posterUrl } from '../../lib/utils'
import { LogEntryModal } from './LogEntryModal'
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip'
import { toast } from 'sonner'
import type { LibraryEntry, EpisodeProgress, WatchHistoryEntry } from '../../types'

// Derive best-guess next episode from tvProgress keys alone
export function guessNextEp(tvProgress: Record<string, EpisodeProgress> | null): { season: number; episode: number } {
  const watched = Object.entries(tvProgress ?? {})
    .filter(([, p]) => p.watchedAt)
    .map(([key]) => {
      const [s, e] = key.split(':').map(Number)
      return { season: s, episode: e }
    })
    .sort((a, b) => a.season !== b.season ? a.season - b.season : a.episode - b.episode)

  if (watched.length === 0) return { season: 1, episode: 1 }
  const last = watched[watched.length - 1]
  return { season: last.season, episode: last.episode + 1 }
}

interface NextEpInfo {
  season: number
  episode: number
  title: string | null
}

interface ContinueWatchingCardProps {
  entry: LibraryEntry
  onNavigate: (path: string, extraState?: Record<string, unknown>) => void
  width?: number
}

export function ContinueWatchingCard({ entry, onNavigate, width = 144 }: ContinueWatchingCardProps) {
  const dropMedia = useStore(s => s.dropMedia)
  const setMediaStatus = useStore(s => s.setStatus)
  const logEpisode = useStore(s => s.logEpisode)
  const target: MediaTarget = {
    mediaType: entry.mediaType,
    tmdbId: entry.tmdbId,
    title: entry.title,
    posterPath: entry.posterPath,
    backdropPath: entry.backdropPath ?? null,
    releaseYear: entry.releaseYear,
    genreIds: entry.genreIds,
    runtime: entry.runtime ?? null,
  }
  const guess = useMemo(() => guessNextEp(entry.tvProgress), [entry.tvProgress])
  const [nextEp, setNextEp] = useState<NextEpInfo>({ ...guess, title: null })
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [logModalOpen, setLogModalOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setStatus('loading')
      try {
        const season = await getSeason(entry.tmdbId, guess.season)
        if (cancelled) return
        const found = season.episodes.find((e) => e.episode_number === guess.episode)
        if (found) {
          setNextEp({ season: guess.season, episode: guess.episode, title: found.name })
          setStatus('ready')
          return
        }
        // Overshot the season - roll over to the first episode of the next season.
        // Commit S(n+1)E01 immediately so we never leave a non-existent episode (e.g.
        // S02E07 for a 6-episode season) on screen; enrich with the title separately
        // so a failed next-season fetch keeps the (correct) episode rather than erroring.
        if (guess.episode > season.episodes.length && season.episodes.length > 0) {
          const nextSeason = guess.season + 1
          setNextEp({ season: nextSeason, episode: 1, title: null })
          setStatus('ready')
          try {
            const next = await getSeason(entry.tmdbId, nextSeason)
            if (cancelled) return
            const ep1 = next.episodes.find((e) => e.episode_number === 1) ?? next.episodes[0]
            if (ep1) setNextEp({ season: nextSeason, episode: ep1.episode_number, title: ep1.name })
          } catch { /* keep S(n+1)E01 without a title */ }
          return
        }
        // Couldn't resolve a real next episode - surface a warning rather than a guess.
        if (!cancelled) setStatus('error')
      } catch {
        if (!cancelled) setStatus('error')
      }
    }
    load()
    return () => { cancelled = true }
  }, [entry.tmdbId, guess.season, guess.episode])

  const watchedCount = useMemo(
    () => Object.values(entry.tvProgress ?? {}).filter((p) => p.watchedAt).length,
    [entry.tvProgress]
  )

  const epCode = `S${String(nextEp.season).padStart(2, '0')} E${String(nextEp.episode).padStart(2, '0')}`
  const libId = `${entry.mediaType}:${entry.tmdbId}`
  const episodeKey = `${nextEp.season}:${nextEp.episode}`
  const episodeTitle = `S${nextEp.season}E${nextEp.episode}${nextEp.title ? ': ' + nextEp.title : ''}`

  const handleDrop = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await dropMedia(target)
    toast.success(`${entry.title} dropped`, {
      action: {
        label: 'Undo',
        onClick: () => setMediaStatus(target, 'in_progress')
      }
    })
  }

  // Routes through the single source of truth so logging the next episode here
  // recomputes the show's status exactly like the detail page does - finishing
  // (or catching up on) a show now marks it watched and clears the watchlist.
  const handleEpisodeSaved = async (histEntry: WatchHistoryEntry) => {
    await logEpisode(target, histEntry)
  }

  return (
    <>
      <div
        className="flex-shrink-0 text-left group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
        style={{ width }}
        role="button"
        tabIndex={0}
        onClick={() => onNavigate(`/detail/${entry.mediaType}/${entry.tmdbId}`, { scrollToEpisode: nextEp })}
        onKeyDown={(e) => e.key === 'Enter' && onNavigate(`/detail/${entry.mediaType}/${entry.tmdbId}`, { scrollToEpisode: nextEp })}
      >
        <div className="relative w-full aspect-[2/3] rounded-lg overflow-hidden bg-secondary ring-1 ring-border/40 group-hover:ring-primary/50 transition-all duration-200">
          {entry.posterPath ? (
            <img
              src={posterUrl(entry.posterPath, 'w500')}
              alt={entry.title}
              className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Tv className="h-8 w-8 text-muted-foreground/30" />
            </div>
          )}
          {/* Checkbox to log next episode - disabled when the episode can't be resolved */}
          <HoverTooltip label={status === 'error' ? "Couldn't determine next episode" : `Mark S${nextEp.season}E${nextEp.episode} as watched`}>
            <button
              className={cn(
                'absolute top-2 right-2 z-10 h-7 w-7 rounded-full border-2 border-white/50 bg-black/50 backdrop-blur-sm flex items-center justify-center transition-all',
                status === 'error'
                  ? 'opacity-40 cursor-not-allowed'
                  : 'hover:border-primary hover:bg-primary/30 cursor-pointer'
              )}
              aria-disabled={status === 'error'}
              onClick={(e) => { e.stopPropagation(); if (status !== 'error') setLogModalOpen(true) }}
              aria-label={status === 'error' ? 'Next episode unavailable' : `Mark S${nextEp.season}E${nextEp.episode} as watched`}
            >
              <Check className="h-3.5 w-3.5 text-white/70" />
            </button>
          </HoverTooltip>
          {/* Drop show - revealed on hover, tailored to the Up Next schema */}
          <HoverTooltip label="Drop show">
            <button
              className="absolute top-2 left-2 z-10 h-7 w-7 rounded-full border-2 border-white/50 bg-black/50 backdrop-blur-sm flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:border-destructive hover:bg-destructive/40 cursor-pointer"
              onClick={handleDrop}
              aria-label={`Drop ${entry.title}`}
            >
              <Ban className="h-3.5 w-3.5 text-white/70" />
            </button>
          </HoverTooltip>
          {/* Gradient overlay - all text lives here */}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/75 to-transparent pt-12 pb-2.5 px-2.5 flex flex-col gap-0.5">
            <p className="text-[11px] font-semibold text-white line-clamp-2 leading-tight">{entry.title}</p>
            {status === 'error' ? (
              <p className="text-[10px] font-medium text-warning truncate leading-tight flex items-center gap-1">
                <AlertTriangle className="h-2.5 w-2.5 shrink-0" /> Up Next: Error retrieving info
              </p>
            ) : (
              <p className="text-[10px] font-medium text-primary truncate leading-tight">Up Next: {epCode}</p>
            )}
            <p className="text-[10px] text-white/50 leading-tight">{watchedCount} ep{watchedCount !== 1 ? 's' : ''} watched</p>
          </div>
        </div>
      </div>

      {logModalOpen && (
        <LogEntryModal
          open={logModalOpen}
          onClose={() => setLogModalOpen(false)}
          mediaId={libId}
          mediaTitle={entry.title}
          episodeKey={episodeKey}
          episodeTitle={episodeTitle}
          onSaved={handleEpisodeSaved}
        />
      )}
    </>
  )
}

// Controlled `open` so Radix's pointer listeners on the Trigger are the single source
// of truth - keeps tooltips from sticking when the card's hover state transitions out.
function HoverTooltip({ label, children }: { label: string; children: React.ReactElement }) {
  const [open, setOpen] = useState(false)
  return (
    <Tooltip open={open} onOpenChange={setOpen} delayDuration={0}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
