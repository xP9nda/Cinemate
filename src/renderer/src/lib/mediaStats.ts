import { useEffect, useMemo, useState } from 'react'
import { getTV, getSeason, getMovieBasic } from './tmdb'
import type { LibraryEntry, ListItemMeta, MediaType, WatchStatus } from '../types'

// List item ids encode an episode as "libId::epKey" (e.g. "tv:1396::1:3").
// Library entries are never episode-encoded, so these are no-ops there.
export function isEpisodeItem(id: string): boolean {
  return id.includes('::')
}

export function parseEpisodeItem(id: string): { libId: string; episodeKey: string } {
  const idx = id.indexOf('::')
  return { libId: id.slice(0, idx), episodeKey: id.slice(idx + 2) }
}

// Run an async task over a list with a bounded number of workers, so a set
// with dozens of shows doesn't fire dozens of TMDb requests at once.
async function throttledForEach<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  const worker = async () => {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

interface ShowRuntime {
  epRuntime: Map<string, number>  // "s:e" -> runtime in minutes
  total: number                   // full show runtime (real seasons only, specials excluded)
  fallback: number                // per-episode runtime used when an episode carries none
}

// Resolve a show's full runtime the same way the Detail page does: sum the
// actual per-episode runtimes across the real seasons, falling back to the
// stored/average episode runtime for any episode TMDb has no runtime for.
async function fetchShowRuntime(tmdbId: number, libRuntime: number | null): Promise<ShowRuntime> {
  const tv = await getTV(tmdbId)
  const fallback = libRuntime ?? tv.episode_run_time?.find(r => r > 0) ?? 0
  const seasonNums = (tv.seasons ?? []).filter(s => s.season_number > 0).map(s => s.season_number)
  const seasons = await Promise.all(
    // Bounded inside via the shared rate limiter; per-show season counts are small.
    seasonNums.map(n => getSeason(tmdbId, n).catch(() => null))
  )
  const epRuntime = new Map<string, number>()
  let total = 0
  for (const season of seasons) {
    if (!season) continue
    for (const ep of season.episodes) {
      const rt = ep.runtime && ep.runtime > 0 ? ep.runtime : fallback
      epRuntime.set(`${ep.season_number}:${ep.episode_number}`, rt)
      total += rt
    }
  }
  return { epRuntime, total, fallback }
}

export interface MediaStats {
  movieCount: number
  showCount: number
  episodeCount: number
  totalRuntime: number      // full runtime of every item (shows counted in their entirety)
  watchedRuntime: number    // runtime the user has actually watched
  remainingRuntime: number  // totalRuntime - watchedRuntime
  runtimeResolved: boolean   // false while show/movie runtimes are still being fetched
}

/**
 * Aggregate stats for a set of items - a list's items, or a slice of the
 * library. Type counts are derived synchronously from the library / list
 * metadata. Runtime needs each show's *total* episode count (so a full show
 * contributes its entire runtime, not just watched episodes), which only TMDb
 * knows - those details are fetched (and cached for 7 days) and the runtime
 * totals resolve once they arrive.
 *
 * `itemMeta` is for items not in the library (standalone list items); pass it
 * omitted for library-only sets where every id resolves to a live entry.
 */
export function useMediaStats(
  itemIds: string[],
  library: Record<string, LibraryEntry>,
  itemMeta?: Record<string, ListItemMeta>
): MediaStats {
  const counts = useMemo(() => {
    let movieCount = 0, showCount = 0, episodeCount = 0
    for (const itemId of itemIds) {
      if (isEpisodeItem(itemId)) { episodeCount++; continue }
      const mediaType = library[itemId]?.mediaType ?? itemMeta?.[itemId]?.mediaType
      if (mediaType === 'movie') movieCount++
      else if (mediaType != null) showCount++
    }
    return { movieCount, showCount, episodeCount }
  }, [itemIds, library, itemMeta])

  const [runtime, setRuntime] = useState({ total: 0, watched: 0, resolved: false })

  useEffect(() => {
    let cancelled = false
    setRuntime(r => ({ ...r, resolved: false }))

    const run = async () => {
      // Every referenced show needs its seasons fetched (for the real per-episode
      // runtimes); standalone movies need a fetch only when no library runtime is
      // on hand. The map value is the lib runtime to use as the episode fallback.
      const showIds = new Map<number, number | null>()
      const movieIds = new Set<number>()
      for (const itemId of itemIds) {
        if (isEpisodeItem(itemId)) {
          const show = library[parseEpisodeItem(itemId).libId]
          if (show) showIds.set(show.tmdbId, show.runtime ?? null)
          continue
        }
        const lib = library[itemId]
        const meta = itemMeta?.[itemId]
        const mediaType = lib?.mediaType ?? meta?.mediaType
        const tmdbId = lib?.tmdbId ?? meta?.tmdbId
        if (tmdbId == null) continue
        if (mediaType === 'movie') {
          if (lib?.runtime == null) movieIds.add(tmdbId)
        } else if (mediaType != null) {
          showIds.set(tmdbId, lib?.runtime ?? null)
        }
      }

      const showData = new Map<number, ShowRuntime>()
      const movieRt = new Map<number, number>()
      await Promise.all([
        throttledForEach([...showIds.keys()], 3, async (id) => {
          try { showData.set(id, await fetchShowRuntime(id, showIds.get(id) ?? null)) } catch { /* drop this show's runtime */ }
        }),
        throttledForEach([...movieIds], 4, async (id) => {
          try { movieRt.set(id, (await getMovieBasic(id)).runtime ?? 0) } catch { /* drop */ }
        }),
      ])
      if (cancelled) return

      let total = 0, watched = 0
      for (const itemId of itemIds) {
        if (isEpisodeItem(itemId)) {
          const { libId, episodeKey } = parseEpisodeItem(itemId)
          const show = library[libId]
          if (!show) continue
          const data = showData.get(show.tmdbId)
          const rt = data?.epRuntime.get(episodeKey) ?? data?.fallback ?? show.runtime ?? 0
          total += rt
          if (show.tvProgress?.[episodeKey]?.watchedAt) watched += rt
          continue
        }
        const lib = library[itemId]
        const meta = itemMeta?.[itemId]
        const mediaType = lib?.mediaType ?? meta?.mediaType
        const tmdbId = lib?.tmdbId ?? meta?.tmdbId
        if (tmdbId == null) continue
        if (mediaType === 'movie') {
          const rt = lib?.runtime ?? movieRt.get(tmdbId) ?? 0
          total += rt
          if (lib?.status === 'watched') watched += rt
        } else if (mediaType != null) {
          const data = showData.get(tmdbId)
          total += data?.total ?? 0
          if (lib && data) {
            for (const [key, p] of Object.entries(lib.tvProgress ?? {})) {
              if (p.watchedAt) watched += data.epRuntime.get(key) ?? data.fallback
            }
          }
        }
      }
      if (!cancelled) setRuntime({ total, watched, resolved: true })
    }

    run()
    return () => { cancelled = true }
  }, [itemIds, library, itemMeta])

  return {
    ...counts,
    totalRuntime: runtime.total,
    watchedRuntime: runtime.watched,
    remainingRuntime: Math.max(0, runtime.total - runtime.watched),
    runtimeResolved: runtime.resolved,
  }
}

export interface EntryStats {
  runtime: { total: number; watched: number }   // minutes
  episodes: { total: number; watched: number }   // counts (movies: { 0, 0 })
}

/**
 * Compute a single entry's denormalised totals in one fetch. Runtime (minutes):
 * movies use the stored runtime (fetched once if missing); shows sum the real
 * per-episode runtimes (cached 7 days). Episodes: movies have none; shows count
 * the real-season episodes (specials excluded) against those watched. Called on the
 * write path (store.setLibraryEntry and the history-removal syncs) so the result is
 * stored alongside the entry - the library never recomputes this when it's viewed.
 */
export async function computeEntryStats(entry: LibraryEntry): Promise<EntryStats> {
  try {
    if (entry.mediaType === 'movie') {
      const total = entry.runtime ?? (await getMovieBasic(entry.tmdbId)).runtime ?? 0
      return {
        runtime: { total, watched: entry.status === 'watched' ? total : 0 },
        episodes: { total: 0, watched: 0 },
      }
    }
    const { epRuntime, total, fallback } = await fetchShowRuntime(entry.tmdbId, entry.runtime ?? null)
    let watched = 0, watchedEps = 0
    for (const [key, p] of Object.entries(entry.tvProgress ?? {})) {
      if (p.watchedAt) { watched += epRuntime.get(key) ?? fallback; watchedEps++ }
    }
    const episodeTotal = epRuntime.size
    return {
      runtime: { total, watched },
      // Clamp: watched specials (absent from epRuntime) could push the tally past
      // the real episode count, and watched must never exceed total.
      episodes: { total: episodeTotal, watched: Math.min(episodeTotal, watchedEps) },
    }
  } catch {
    // Leave the entry untracked on a failed fetch rather than zeroing real totals.
    return { runtime: { total: 0, watched: 0 }, episodes: { total: 0, watched: 0 } }
  }
}

/** Minutes left to watch for an entry, read from its denormalised stats (0 if untracked). */
export function entryTimeRemaining(entry: LibraryEntry): number {
  const s = entry.runtimeStats
  return s ? Math.max(0, s.total - s.watched) : 0
}

/** Episodes left to watch for an entry, read from its denormalised stats (0 if untracked / movie). */
export function entryEpisodesRemaining(entry: LibraryEntry): number {
  const s = entry.episodeStats
  return s ? Math.max(0, s.total - s.watched) : 0
}

/**
 * Minutes for a single play, read synchronously by the stats and watch-log views.
 * For an episode it prefers the exact per-episode runtime (filled in on a Detail
 * visit) and falls back to the show's average episode runtime; for a movie it's the
 * movie runtime. 0 when nothing is known yet (fills in as titles are opened/updated).
 */
export function playMinutes(entry: LibraryEntry | undefined, episodeKey?: string): number {
  if (!entry) return 0
  if (episodeKey) return entry.tvProgress?.[episodeKey]?.runtime ?? entry.runtime ?? 0
  return entry.runtime ?? 0
}

/**
 * Seed entry stats from data already on hand at import time (the movie/show detail
 * the importer just fetched) - an episode-count × average-runtime estimate, with no
 * per-season fetch so a bulk import doesn't fan out to TMDb. Interactive writes later
 * refine it to the exact per-episode sum via computeEntryStats. Returns null when there
 * isn't enough information to estimate (caller leaves the entry untracked).
 */
export function estimateEntryStats(args: {
  mediaType: MediaType
  status: WatchStatus
  runtime: number | null            // movie runtime, or average episode runtime for shows
  episodeCount?: number | null       // total episode count (shows)
  watchedEpisodeCount?: number       // episodes carrying a watchedAt (shows)
}): EntryStats | null {
  const { mediaType, status, runtime } = args
  if (runtime == null || runtime <= 0) return null
  if (mediaType === 'movie') {
    return {
      runtime: { total: runtime, watched: status === 'watched' ? runtime : 0 },
      episodes: { total: 0, watched: 0 },
    }
  }
  const episodeCount = args.episodeCount ?? null
  if (episodeCount == null || episodeCount <= 0) return null
  // Clamp: imported specials can push the watched-episode tally past the real
  // episode count, and watched must never exceed total.
  const watchedEps = Math.min(episodeCount, args.watchedEpisodeCount ?? 0)
  return {
    runtime: { total: episodeCount * runtime, watched: watchedEps * runtime },
    episodes: { total: episodeCount, watched: watchedEps },
  }
}

/**
 * Sum the denormalised runtime totals across a set of library entries - the cheap,
 * synchronous read path for the library stats bar (no TMDb, no effect, no async).
 * Entries without runtimeStats yet (never touched since the feature shipped) still
 * count toward the type tallies but contribute no runtime, so the totals simply
 * fill in as titles are watched/updated.
 */
export function aggregateEntryStats(entries: LibraryEntry[]): MediaStats {
  let movieCount = 0, showCount = 0, total = 0, watched = 0
  for (const e of entries) {
    if (e.mediaType === 'movie') movieCount++
    else showCount++
    if (e.runtimeStats) {
      total += e.runtimeStats.total
      watched += e.runtimeStats.watched
    }
  }
  return {
    movieCount,
    showCount,
    episodeCount: 0,
    totalRuntime: total,
    watchedRuntime: watched,
    remainingRuntime: Math.max(0, total - watched),
    runtimeResolved: true,
  }
}
