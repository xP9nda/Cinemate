import type {
  AppSettings, CustomList, EpisodeProgress, LibraryEntry, ListItemMeta,
  MediaType, TMDbSeason, WatchHistoryEntry, WatchStatus,
} from '../types'
import type { AppStore } from './store'
import * as db from './db'
import { getTV, getSeason } from './tmdb'
import { uid, nowLocalDT } from './utils'

// A reference to a piece of media, plus enough metadata to mint a fresh library
// entry when one doesn't exist yet. Callers pass whatever they have on hand (a
// detail page has full TMDb data; a search card has the search result) so that
// no action ever creates a metadata-poor entry.
export interface MediaTarget {
  mediaType: MediaType
  tmdbId: number
  title?: string
  posterPath?: string | null
  backdropPath?: string | null
  releaseYear?: number | null
  genreIds?: number[]
  runtime?: number | null
}

// One episode in a show's catalogue, used to decide completion / caught-up state.
export interface CatalogEpisode {
  key: string                 // "s:e"
  airDate: string | null
}

// A list item to add/remove: a title ("movie:550") or an episode ("tv:1396::1:3").
// `meta` is only used for a title that isn't in the library (stored on the list).
export interface ListItemRef {
  itemId: string
  meta?: ListItemMeta
}

const idOf = (t: MediaTarget): string => `${t.mediaType}:${t.tmdbId}`
const isEpisodeItem = (itemId: string): boolean => itemId.includes('::')

/** Build a fresh library entry from TMDb-derived data. Shared by the store and the actions. */
export function buildLibEntry(
  tmdbId: number,
  mediaType: MediaType,
  title: string,
  posterPath: string | null,
  backdropPath: string | null | undefined,
  releaseYear: number | null,
  status: LibraryEntry['status'],
  genreIds?: number[],
  runtime?: number | null,
): LibraryEntry {
  return {
    id: `${mediaType}:${tmdbId}`,
    mediaType,
    tmdbId,
    title,
    posterPath,
    backdropPath: backdropPath ?? null,
    releaseYear,
    status,
    userRating: null,
    review: '',
    watchedDate: status === 'watched' ? new Date().toISOString() : null,
    addedDate: Date.now(),
    listIds: [],
    genreIds,
    tvProgress: null,
    seasonRatings: {},
    runtime: runtime ?? null,
  }
}

/** Most recent play (ISO local datetime) for a title across all its plays, or null. */
export function latestPlayDate(history: WatchHistoryEntry[], mediaId: string): string | null {
  let best: WatchHistoryEntry | null = null
  for (const h of history) {
    if (h.mediaId !== mediaId) continue
    if (!best || h.watchedAt > best.watchedAt) best = h
  }
  return best ? best.watchedAtDT : null
}

function catalogFromSeasons(seasons: TMDbSeason[]): CatalogEpisode[] {
  const eps: CatalogEpisode[] = []
  for (const s of seasons) {
    for (const e of s.episodes) {
      eps.push({ key: `${e.season_number}:${e.episode_number}`, airDate: e.air_date })
    }
  }
  return eps
}

// Fetch many seasons with a concurrency cap so a 30-season show doesn't flood the
// rate limiter. Mirrors Detail's loader so behaviour is identical when we fetch.
async function fetchSeasonsThrottled(tvId: number, seasonNumbers: number[], limit: number): Promise<TMDbSeason[]> {
  const results: TMDbSeason[] = new Array(seasonNumbers.length)
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const i = cursor++
      if (i >= seasonNumbers.length) return
      results[i] = await getSeason(tvId, seasonNumbers[i])
    }
  }
  const workers: Promise<void>[] = []
  for (let i = 0; i < Math.min(limit, seasonNumbers.length); i++) workers.push(worker())
  await Promise.all(workers)
  return results
}

/**
 * Decide a show's status after its episode progress changes - the single
 * authority for the "did watching this episode complete (or catch up) the show?"
 * question that previously lived only in Detail's episode-save handler.
 *
 * - All episodes watched, or (when enabled) all *aired* episodes watched → watched.
 * - Otherwise a watchlist item becomes in_progress only if autoRemoveWatchlist is on.
 * - An already-watched show stays watched; anything else becomes in_progress.
 *
 * An empty `episodeCatalog` (e.g. a failed fetch) simply means "not complete",
 * so we fall through to the status rules rather than fabricating a completion.
 */
export function deriveShowStatus(args: {
  existingStatus: WatchStatus
  progress: Record<string, EpisodeProgress>
  episodeCatalog: CatalogEpisode[]
  settings: AppSettings
}): WatchStatus {
  const { existingStatus, progress, episodeCatalog, settings } = args
  const allKeys = episodeCatalog.map((e) => e.key)
  const allWatched = allKeys.length > 0 && allKeys.every((k) => progress[k]?.watchedAt)

  let caughtUp = false
  if (!allWatched && settings.markCaughtUpAsWatched) {
    const today = nowLocalDT().slice(0, 10)
    const airedKeys = episodeCatalog.filter((e) => e.airDate && e.airDate <= today).map((e) => e.key)
    caughtUp = airedKeys.length > 0 && airedKeys.every((k) => progress[k]?.watchedAt)
  }

  if (allWatched || caughtUp) return 'watched'
  if (existingStatus === 'watchlist') return settings.autoRemoveWatchlist ? 'in_progress' : 'watchlist'
  if (existingStatus === 'watched') return 'watched'
  return 'in_progress'
}

/**
 * Single source of truth for every user action on a piece of media: watchlist,
 * watched, dropped, episode logging, ratings, reviews and list membership.
 *
 * Constructed once by the store with its `get`/`set`. It owns the *flows* and
 * *status derivation*; it persists by calling the store's own low-level actions
 * (setLibraryEntry / addHistory / removeHistory / bulkRemoveHistory / setList),
 * which already centralise prevStatus stamping, overall-rating mirroring,
 * auto-list recompute and post-removal status sync. Components never re-implement
 * any of this - they call the matching store action, which delegates here.
 */
export class MediaActions {
  constructor(
    private get: () => AppStore,
    private set: (fn: (s: AppStore) => Partial<AppStore>) => void,
  ) {}

  // ── helpers ──────────────────────────────────────────────────────────────────

  /** Existing library entry, or a freshly built one (not yet persisted) from the target hints. */
  private ensureEntry(target: MediaTarget, fallbackStatus: WatchStatus): LibraryEntry {
    const existing = this.get().library[idOf(target)]
    if (existing) return existing
    return buildLibEntry(
      target.tmdbId, target.mediaType, target.title ?? '',
      target.posterPath ?? null, target.backdropPath ?? null,
      target.releaseYear ?? null, fallbackStatus, target.genreIds, target.runtime,
    )
  }

  /** Every known episode of a show - fetched (cached) when a caller can't supply it. */
  async episodeCatalogFor(target: MediaTarget): Promise<CatalogEpisode[]> {
    try {
      const tv = await getTV(target.tmdbId)
      const realSeasons = tv.seasons.filter((s) => s.season_number > 0)
      if (realSeasons.length === 0) return []
      const seasons = await fetchSeasonsThrottled(target.tmdbId, realSeasons.map((s) => s.season_number), 4)
      return catalogFromSeasons(seasons)
    } catch {
      return []
    }
  }

  // ── status / watchlist / drop ────────────────────────────────────────────────

  async setStatus(target: MediaTarget, status: WatchStatus): Promise<void> {
    const base = this.ensureEntry(target, status)
    const watchedDate = status === 'watched' ? (base.watchedDate ?? new Date().toISOString()) : base.watchedDate
    await this.get().setLibraryEntry({ ...base, status, watchedDate })
  }

  async toggleWatchlist(target: MediaTarget): Promise<'added' | 'removed'> {
    const entry = this.get().library[idOf(target)]
    if (entry?.status === 'watchlist') {
      await this.get().removeFromWatchlist(entry.id)
      return 'removed'
    }
    const base = this.ensureEntry(target, 'watchlist')
    await this.get().setLibraryEntry({ ...base, status: 'watchlist' })
    return 'added'
  }

  async drop(target: MediaTarget): Promise<void> {
    const entry = this.get().library[idOf(target)]
    if (!entry) return
    await this.get().setLibraryEntry({ ...entry, status: 'dropped' })
  }

  /**
   * Undo a drop: restore the status the entry's data implies (it was kept intact -
   * a drop is just a status label). A show with watched-episode progress returns to
   * in_progress; a title with plays but no progress to watched; anything else to the
   * watchlist. We don't fabricate a 'watched' completion for a show from progress
   * alone (that needs the TMDb catalogue), matching removeFromWatchlist. No-op unless
   * the entry is currently dropped.
   */
  async undrop(target: MediaTarget): Promise<void> {
    const entry = this.get().library[idOf(target)]
    if (!entry || entry.status !== 'dropped') return
    const hasProgress = !!entry.tvProgress && Object.values(entry.tvProgress).some((p) => p.watchedAt)
    const hasPlays = this.get().watchHistory.some((h) => h.mediaId === entry.id)
    let status: WatchStatus
    if (entry.mediaType !== 'movie' && hasProgress) status = 'in_progress'
    else if (hasPlays) status = 'watched'
    else status = 'watchlist'
    const watchedDate = status === 'watched'
      ? (entry.watchedDate ?? latestPlayDate(this.get().watchHistory, entry.id))
      : entry.watchedDate
    await this.get().setLibraryEntry({ ...entry, status, watchedDate })
  }

  // ── movies ───────────────────────────────────────────────────────────────────

  /**
   * Reconcile a movie's status after a play is logged (the LogEntryModal already
   * stored the history entry). Logging a play marks the movie watched; leaving the
   * watchlist honours the autoRemoveWatchlist setting. Never downgrades a status.
   * Unifies Detail's and MediaCard's previously divergent post-log handlers.
   */
  async reconcileMovieLog(target: MediaTarget, histEntry: WatchHistoryEntry): Promise<void> {
    const settings = this.get().settings
    const entry = this.get().library[idOf(target)]
    if (!entry) {
      const built = this.ensureEntry(target, 'watched')
      await this.get().setLibraryEntry({ ...built, status: 'watched', watchedDate: histEntry.watchedAtDT })
      return
    }
    if (entry.status === 'watchlist') {
      if (!settings.autoRemoveWatchlist) return
      await this.get().setLibraryEntry({ ...entry, status: 'watched', watchedDate: histEntry.watchedAtDT })
      return
    }
    if (entry.status !== 'watched') {
      await this.get().setLibraryEntry({ ...entry, status: 'watched', watchedDate: histEntry.watchedAtDT })
    }
  }

  // ── episodes ─────────────────────────────────────────────────────────────────

  /**
   * Apply an episode watch (the modal already added the play): set the episode's
   * watchedAt/note in tvProgress and recompute the show's status via
   * deriveShowStatus. Pass `episodeCatalog` when the caller already has the season
   * data (Detail) to avoid a refetch; otherwise it's fetched so completion is
   * detected everywhere (e.g. the Continue Watching card).
   */
  async logEpisode(target: MediaTarget, histEntry: WatchHistoryEntry, episodeCatalog?: CatalogEpisode[]): Promise<void> {
    const key = histEntry.episodeKey
    if (!key) return
    const settings = this.get().settings
    const existing = this.get().library[idOf(target)]
    const base = existing ?? this.ensureEntry(target, 'in_progress')
    const progress: Record<string, EpisodeProgress> = { ...(existing?.tvProgress ?? {}) }
    progress[key] = {
      ...progress[key],   // keep a stored per-episode runtime (and any future fields)
      watchedAt: histEntry.watchedAtDT,
      rating: progress[key]?.rating ?? null,
      note: histEntry.note,
    }
    const catalog = episodeCatalog ?? await this.episodeCatalogFor(target)
    const status = deriveShowStatus({
      existingStatus: existing?.status ?? 'in_progress',
      progress,
      episodeCatalog: catalog,
      settings,
    })
    // When the show is (or stays) watched, pin watchedDate to the most recent play.
    const watchedDate = status === 'watched'
      ? (latestPlayDate(this.get().watchHistory, idOf(target)) ?? base.watchedDate)
      : base.watchedDate
    await this.get().setLibraryEntry({ ...base, status, watchedDate, tvProgress: progress })
  }

  /**
   * View-time reconciliation of the "caught up" state. Being caught up is
   * inherently time-dependent - a show with every aired episode watched is
   * caught up today but stops being so the moment a new episode airs - so it
   * can't be settled once at episode-log time. The Continue Watching card calls
   * this when it resolves a next-up episode that hasn't aired yet: with
   * markCaughtUpAsWatched on, a show whose every aired episode is watched flips
   * to 'watched' (and so drops out of Continue Watching / In Progress); with the
   * setting off it's a no-op. deriveShowStatus stays the arbiter, so a show with
   * earlier unwatched aired episodes (skipped, not actually caught up) is left
   * in_progress. Only writes when the status actually changes.
   */
  async reconcileCaughtUp(target: MediaTarget): Promise<void> {
    const settings = this.get().settings
    if (!settings.markCaughtUpAsWatched) return
    const entry = this.get().library[idOf(target)]
    if (!entry || entry.mediaType === 'movie' || entry.status !== 'in_progress') return
    const catalog = await this.episodeCatalogFor(target)
    const status = deriveShowStatus({
      existingStatus: entry.status,
      progress: entry.tvProgress ?? {},
      episodeCatalog: catalog,
      settings,
    })
    if (status !== 'watched') return
    const watchedDate = latestPlayDate(this.get().watchHistory, entry.id) ?? entry.watchedDate
    await this.get().setLibraryEntry({ ...entry, status, watchedDate })
  }

  /**
   * The inverse of reconcileCaughtUp: revive a 'watched' show to 'in_progress'
   * once an episode it hasn't watched has aired. A show flipped to watched while
   * caught up (or finished normally) would otherwise stay buried in Watched when
   * a new episode airs, never resurfacing in Continue Watching - this scan, run
   * best-effort on launch, brings it back. Gated on markCaughtUpAsWatched so it
   * only applies to users who opted into the caught-up-as-watched model (and so
   * never demotes a deliberately-watched show for someone who didn't).
   *
   * Cost is kept down with a cheap per-show pre-filter: getTV's season summaries
   * give a catalogue episode count without fetching any season, and a show whose
   * catalogue isn't larger than the user's watched count can't have a new aired
   * episode, so its per-season fetch is skipped entirely. Only still-growing
   * shows pay for the full catalogue read. deriveShowStatus can't drive this -
   * it deliberately never demotes a watched show - so the aired-but-unwatched
   * check lives here.
   */
  async reconcileAiredSinceWatched(): Promise<void> {
    const settings = this.get().settings
    if (!settings.markCaughtUpAsWatched || !settings.apiKey) return
    const today = nowLocalDT().slice(0, 10)
    const candidates = Object.values(this.get().library).filter(
      (e) => e.status === 'watched'
        && (e.mediaType === 'tv' || e.mediaType === 'anime')
        && !!e.tvProgress && Object.values(e.tvProgress).some((p) => p.watchedAt),
    )
    if (candidates.length === 0) return

    const revive = async (entry: LibraryEntry): Promise<void> => {
      try {
        const tv = await getTV(entry.tmdbId)
        const realSeasons = tv.seasons.filter((s) => s.season_number > 0)
        const catalogTotal = realSeasons.reduce((n, s) => n + s.episode_count, 0)
        const watchedCount = Object.values(entry.tvProgress ?? {}).filter((p) => p.watchedAt).length
        // Catalogue counts include unaired episodes, so this only ever over-fetches
        // for still-airing shows - it never skips one that has a newly-aired episode.
        if (catalogTotal <= watchedCount) return
        const seasons = await fetchSeasonsThrottled(entry.tmdbId, realSeasons.map((s) => s.season_number), 4)
        const hasAiredUnwatched = catalogFromSeasons(seasons).some(
          (ep) => ep.airDate && ep.airDate <= today && !entry.tvProgress?.[ep.key]?.watchedAt,
        )
        if (!hasAiredUnwatched) return
        // Re-read: a write may have landed (or removed the entry) while we fetched.
        const cur = this.get().library[entry.id]
        if (!cur || cur.status !== 'watched') return
        await this.get().setLibraryEntry({ ...cur, status: 'in_progress' })
      } catch { /* best-effort: a failed fetch just leaves the show watched */ }
    }

    // Concurrency-limited so a large watched library doesn't flood the rate limiter.
    let cursor = 0
    const worker = async (): Promise<void> => {
      while (cursor < candidates.length) await revive(candidates[cursor++])
    }
    await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, () => worker()))
  }

  /** Log another play of an already-watched episode at the current time (always a rewatch). */
  async replayEpisode(target: MediaTarget, epKey: string, epTitle: string): Promise<void> {
    await this.get().addHistory({
      id: `hist:${uid()}`,
      mediaId: idOf(target),
      watchedAt: Date.now(),
      watchedAtDT: nowLocalDT(),
      rating: null,
      note: '',
      episodeKey: epKey,
      episodeTitle: epTitle,
      isRewatch: true,
    })
  }

  /** Remove every play of an episode; the store's removal sync updates tvProgress + status. */
  async removeEpisodePlays(target: MediaTarget, epKey: string): Promise<void> {
    const id = idOf(target)
    const plays = this.get().watchHistory.filter((h) => h.mediaId === id && h.episodeKey === epKey)
    if (plays.length > 0) await this.get().bulkRemoveHistory(plays.map((h) => h.id))
  }

  /**
   * Mark every episode of a show watched right now. Detail passes its already
   * loaded seasons; other callers omit them and the catalogue is fetched. Single
   * implementation behind both the detail page and the library card.
   */
  async logAllEpisodes(target: MediaTarget, seasons?: TMDbSeason[]): Promise<void> {
    let allSeasons = seasons
    if (!allSeasons) {
      const tv = await getTV(target.tmdbId)
      const realSeasons = tv.seasons.filter((s) => s.season_number > 0)
      allSeasons = await fetchSeasonsThrottled(target.tmdbId, realSeasons.map((s) => s.season_number), 4)
    }
    const id = idOf(target)
    const existing = this.get().library[id]
    const base = existing ?? this.ensureEntry(target, 'watched')
    const now = Date.now()
    const nowDT = nowLocalDT()
    const progress: Record<string, EpisodeProgress> = { ...(existing?.tvProgress ?? {}) }
    for (const season of allSeasons) {
      for (const ep of season.episodes) {
        const key = `${ep.season_number}:${ep.episode_number}`
        progress[key] = { ...progress[key], watchedAt: nowDT, rating: progress[key]?.rating ?? null, note: progress[key]?.note ?? '' }
        await this.get().addHistory({
          id: `hist:${uid()}`,
          mediaId: id,
          watchedAt: now,
          watchedAtDT: nowDT,
          rating: null,
          note: '',
          episodeKey: key,
          episodeTitle: `S${ep.season_number}E${ep.episode_number}: ${ep.name}`,
        })
      }
    }
    await this.get().setLibraryEntry({ ...base, status: 'watched', watchedDate: nowDT, tvProgress: progress })
  }

  /**
   * Start rewatching a show: clear every episode's watched marker and set the
   * show back to in_progress, so it returns to Up Next from S1E1. Episode and
   * season ratings, per-episode notes, the overall rating/review and the entire
   * watch history (every logged play) are kept - a rewatch builds on the record
   * rather than erasing it. The denormalised progress stats recompute to "0
   * watched" on this write; the all-time totals (time invested, rewatch count)
   * are read from the untouched watch history. No-op for movies (no episode
   * progress - rewatching a movie is just logging another play).
   */
  async startRewatch(target: MediaTarget): Promise<void> {
    const entry = this.get().library[idOf(target)]
    if (!entry || entry.mediaType === 'movie') return
    const progress: Record<string, EpisodeProgress> = {}
    for (const [key, p] of Object.entries(entry.tvProgress ?? {})) {
      progress[key] = { ...p, watchedAt: null }
    }
    // Stamp the rewatch boundary so the prior run's plays (kept in history for
    // all-time totals) no longer count as current progress - removing a freshly
    // logged rewatch play then can't fall back onto an older, pre-rewatch play.
    await this.get().setLibraryEntry({
      ...entry, status: 'in_progress', tvProgress: progress, rewatchStartedAt: Date.now(),
    })
  }

  /**
   * Undo an in-progress rewatch: clear the rewatch boundary and restore every
   * episode's watched marker from its most recent play in history, returning the
   * show to the state it was in before startRewatch nulled the markers. Status is
   * re-derived, so a show whose episodes are all (re)watched lands back on 'watched'.
   * Ratings, notes and the watch history are untouched. No-op for an entry that
   * isn't mid-rewatch (no rewatchStartedAt).
   */
  async undoRewatch(target: MediaTarget): Promise<void> {
    const entry = this.get().library[idOf(target)]
    if (!entry || entry.rewatchStartedAt == null) return
    // Latest play per episode across all runs - what each marker should point at.
    const latestDT: Record<string, string> = {}
    const latestMs: Record<string, number> = {}
    for (const h of this.get().watchHistory) {
      if (h.mediaId !== entry.id || !h.episodeKey) continue
      if (!(h.episodeKey in latestMs) || h.watchedAt > latestMs[h.episodeKey]) {
        latestMs[h.episodeKey] = h.watchedAt
        latestDT[h.episodeKey] = h.watchedAtDT
      }
    }
    const progress: Record<string, EpisodeProgress> = {}
    for (const [key, p] of Object.entries(entry.tvProgress ?? {})) {
      progress[key] = { ...p, watchedAt: latestDT[key] ?? p.watchedAt }
    }
    // Derive from the restored progress rather than forcing 'watched': a show that
    // was only partially watched before the rewatch comes back as in_progress.
    const catalog = await this.episodeCatalogFor(target)
    const status = deriveShowStatus({
      existingStatus: entry.status,
      progress,
      episodeCatalog: catalog,
      settings: this.get().settings,
    })
    const watchedDate = status === 'watched'
      ? (latestPlayDate(this.get().watchHistory, entry.id) ?? entry.watchedDate)
      : entry.watchedDate
    await this.get().setLibraryEntry({
      ...entry, status, watchedDate, tvProgress: progress, rewatchStartedAt: undefined,
    })
  }

  // ── ratings / review ─────────────────────────────────────────────────────────

  async setOverallRating(target: MediaTarget, value: number | null): Promise<void> {
    const entry = this.ensureEntry(target, 'watchlist')
    await this.get().setLibraryEntry({ ...entry, userRating: value })
  }

  async setReview(target: MediaTarget, review: string): Promise<void> {
    const entry = this.ensureEntry(target, 'watchlist')
    await this.get().setLibraryEntry({ ...entry, review })
  }

  async setEpisodeRating(target: MediaTarget, epKey: string, value: number | null): Promise<void> {
    const entry = this.get().library[idOf(target)]
    if (!entry) return
    const prev = entry.tvProgress?.[epKey] ?? { watchedAt: null, note: '' }
    await this.get().setLibraryEntry({
      ...entry,
      tvProgress: { ...entry.tvProgress, [epKey]: { ...prev, rating: value } },
    })
  }

  async setSeasonRating(target: MediaTarget, seasonNumber: number, value: number | null): Promise<void> {
    const entry = this.get().library[idOf(target)]
    if (!entry) return
    await this.get().setLibraryEntry({
      ...entry,
      seasonRatings: { ...entry.seasonRatings, [seasonNumber]: value },
    })
  }

  // ── lists ──────────────────────────────────────────────────────────────────
  // Manual-list membership has two mirrors that must stay in lockstep:
  // CustomList.itemIds (the source of truth for display) and LibraryEntry.listIds
  // (used by removal logic to know an entry is "in a list"). Episodes and
  // not-in-library titles live only in itemIds / itemMeta. Every add/remove path
  // funnels through these four methods so the mirrors never drift.

  async toggleListItem(list: CustomList, item: ListItemRef): Promise<'added' | 'removed'> {
    const inList = list.itemIds.includes(item.itemId)
    const entry = isEpisodeItem(item.itemId) ? undefined : this.get().library[item.itemId]

    if (entry) {
      const listIds = inList
        ? entry.listIds.filter((id) => id !== list.id)
        : [...entry.listIds, list.id]
      await this.get().setLibraryEntry({ ...entry, listIds })
      const itemIds = inList
        ? list.itemIds.filter((id) => id !== item.itemId)
        : [...list.itemIds, item.itemId]
      await this.get().setList({ ...list, itemIds })
    } else {
      const nextMeta = { ...(list.itemMeta ?? {}) }
      let itemIds: string[]
      if (inList) {
        itemIds = list.itemIds.filter((id) => id !== item.itemId)
        delete nextMeta[item.itemId]
      } else {
        itemIds = [...list.itemIds, item.itemId]
        if (item.meta) nextMeta[item.itemId] = item.meta
      }
      await this.get().setList({ ...list, itemIds, itemMeta: nextMeta })
    }
    return inList ? 'removed' : 'added'
  }

  async createListWith(name: string, item: ListItemRef): Promise<CustomList> {
    const entry = isEpisodeItem(item.itemId) ? undefined : this.get().library[item.itemId]
    const list: CustomList = {
      id: `list:${uid()}`,
      name: name.trim(),
      description: '',
      createdAt: Date.now(),
      itemIds: [item.itemId],
      ...(!entry && item.meta ? { itemMeta: { [item.itemId]: item.meta } } : {}),
    }
    await this.get().setList(list)
    if (entry) {
      await this.get().setLibraryEntry({ ...entry, listIds: [...entry.listIds, list.id] })
    }
    return list
  }

  /**
   * Add a set of list-item ids to a manual list, skipping duplicates and
   * mirroring membership onto any library-backed title items. Uses a single bulk
   * library write (no per-entry auto-list recompute). Returns the count added.
   */
  async addItemsToList(itemIds: string[], listId: string): Promise<number> {
    const list = this.get().lists.find((l) => l.id === listId)
    if (!list || list.rules?.enabled) return 0
    const existing = new Set(list.itemIds)
    const toAdd = Array.from(new Set(itemIds)).filter((id) => !existing.has(id))
    if (toAdd.length === 0) return 0
    await this.get().setList({ ...list, itemIds: [...list.itemIds, ...toAdd] })
    const libPatches: LibraryEntry[] = []
    for (const id of toAdd) {
      const entry = this.get().library[id]
      if (entry && !entry.listIds.includes(listId)) {
        libPatches.push({ ...entry, listIds: [...entry.listIds, listId] })
      }
    }
    if (libPatches.length > 0) {
      await db.bulkSetLibraryEntries(libPatches)
      this.set((s) => {
        const lib = { ...s.library }
        for (const e of libPatches) lib[e.id] = e
        return { library: lib }
      })
    }
    return toAdd.length
  }

  async removeListItem(list: CustomList, itemId: string): Promise<void> {
    if (list.rules?.enabled) return
    const nextMeta = list.itemMeta ? { ...list.itemMeta } : undefined
    if (nextMeta) delete nextMeta[itemId]
    await this.get().setList({ ...list, itemIds: list.itemIds.filter((id) => id !== itemId), itemMeta: nextMeta })
    const entry = isEpisodeItem(itemId) ? undefined : this.get().library[itemId]
    if (entry && entry.listIds.includes(list.id)) {
      await this.get().setLibraryEntry({ ...entry, listIds: entry.listIds.filter((id) => id !== list.id) })
    }
  }
}
