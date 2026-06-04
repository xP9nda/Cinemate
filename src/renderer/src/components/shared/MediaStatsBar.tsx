import { Film, Tv, MonitorPlay, Clock, Loader2 } from 'lucide-react'
import { cn, fmtRuntime } from '../../lib/utils'
import type { MediaStats } from '../../lib/mediaStats'

interface MediaStatsBarProps {
  stats: MediaStats
  /**
   * Lead with the time left to watch rather than the total. Used by the
   * library's In Progress tab, where "how much is left to finish" is the
   * headline number rather than the full runtime of every show.
   */
  emphasizeRemaining?: boolean
  className?: string
}

/**
 * The compact meta row shown under a list (and under the library tabs): item
 * counts plus runtime totals. Runtime resolves asynchronously via useMediaStats,
 * so it shows a "calculating" hint until the show/movie details arrive.
 */
export function MediaStatsBar({ stats, emphasizeRemaining = false, className }: MediaStatsBarProps) {
  const { movieCount, showCount, episodeCount, totalRuntime, watchedRuntime, remainingRuntime, runtimeResolved } = stats
  const pct = totalRuntime > 0 ? Math.round((watchedRuntime / totalRuntime) * 100) : 0
  const partial = watchedRuntime > 0 && watchedRuntime < totalRuntime

  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground', className)}>
      {movieCount > 0 && (
        <span className="inline-flex items-center gap-1">
          <Film className="h-3 w-3" />
          {movieCount} movie{movieCount !== 1 ? 's' : ''}
        </span>
      )}
      {showCount > 0 && (
        <span className="inline-flex items-center gap-1">
          <Tv className="h-3 w-3" />
          {showCount} show{showCount !== 1 ? 's' : ''}
        </span>
      )}
      {episodeCount > 0 && (
        <span className="inline-flex items-center gap-1">
          <MonitorPlay className="h-3 w-3" />
          {episodeCount} episode{episodeCount !== 1 ? 's' : ''}
        </span>
      )}
      {!runtimeResolved ? (
        <span className="inline-flex items-center gap-1 text-muted-foreground/70">
          <Loader2 className="h-3 w-3 animate-spin" />
          Calculating runtime…
        </span>
      ) : totalRuntime > 0 && (
        emphasizeRemaining ? (
          <>
            <span className="inline-flex items-center gap-1 font-medium text-primary tabular-nums">
              <Clock className="h-3 w-3" />
              {remainingRuntime > 0 ? `${fmtRuntime(remainingRuntime)} remaining` : 'Caught up'}
            </span>
            {watchedRuntime > 0 && (
              <span className="text-primary/80 tabular-nums">{fmtRuntime(watchedRuntime)} watched</span>
            )}
            <span className="tabular-nums">{pct}% complete</span>
          </>
        ) : (
          <>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span className="tabular-nums">{fmtRuntime(totalRuntime)}</span>
            </span>
            {/* watched / remaining / % only when there's a mix - on the all-watched
                or nothing-watched tabs they'd just echo the total. */}
            {partial && (
              <>
                <span className="text-primary/80 tabular-nums">{fmtRuntime(watchedRuntime)} watched</span>
                <span className="tabular-nums">{fmtRuntime(remainingRuntime)} remaining</span>
                <span className="inline-flex items-center gap-1 font-medium text-primary tabular-nums">
                  {pct}% complete
                </span>
              </>
            )}
          </>
        )
      )}
    </div>
  )
}
