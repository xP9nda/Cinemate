import React, { useState, useRef, useCallback } from 'react'
import JSZip from 'jszip'
import { Upload, AlertCircle, CheckCircle2, Loader2, Film, Tv, BookmarkPlus, List, Package, X, OctagonX, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Progress } from './ui/progress'
import { ScrollArea } from './ui/scroll-area'
import { useStore } from '../lib/store'
import * as db from '../lib/db'
import {
  parseLetterboxdFiles,
  parseTraktFiles,
  parseHistoryCsv,
  parseWatchlistCsv,
  type ImportSource,
  type ParsedImport,
  type RawImportItem,
} from '../lib/importHelpers'
import { searchMoviesWithYear, getMovie, getTV, getSeason } from '../lib/tmdb'
import { estimateEntryStats } from '../lib/mediaStats'
import { parseImportDate, dayFloor, parseDateMs } from '../lib/utils'
import type { LibraryEntry, WatchHistoryEntry, EpisodeProgress, CustomList, CollectionEntry, ListItemMeta, TMDbTV } from '../types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialSource?: ImportSource
}

// A show's stored `runtime` is its average episode length, used as the per-episode
// figure for every watch-time stat (Stats hours, the watch-log header aggregates).
// TMDb very often returns an empty `episode_run_time`, which used to leave runtime
// null - and a null runtime makes every episode of that show count as 0 minutes.
// Fall back to averaging a real season's actual episode runtimes (the same source
// the Detail page averages). One extra cached fetch per affected show; returns null
// only if even that season carries no runtimes (a later Detail visit can still fix it).
async function deriveShowRuntime(d: TMDbTV): Promise<number | null> {
  const declared = d.episode_run_time?.find((r) => r > 0)
  if (declared) return declared
  const season = (d.seasons ?? []).find((s) => s.season_number > 0 && s.episode_count > 0)
  if (!season) return null
  try {
    const full = await getSeason(d.id, season.season_number)
    const rts = full.episodes.map((e) => e.runtime ?? 0).filter((r) => r > 0)
    if (rts.length === 0) return null
    return Math.round(rts.reduce((a, b) => a + b, 0) / rts.length)
  } catch {
    return null
  }
}

type Step = 'source' | 'files' | 'preview' | 'importing' | 'done'

interface ImportProgress {
  current: number
  total: number
  label: string
}

interface ImportResult {
  imported: number
  merged: number
  skipped: number
  failed: string[]
  listsImported: number
  collectionImported: number
}

interface ImportOptions {
  watched: boolean
  watchlist: boolean
  lists: boolean
  collection: boolean
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

function buildLibraryId(mediaType: 'movie' | 'tv' | 'anime', tmdbId: number): string {
  return `${mediaType}:${tmdbId}`
}

function dayKeyOf(mediaId: string, episodeKey: string | undefined, ts: number): string {
  return `${mediaId}|${episodeKey ?? ''}|${dayFloor(ts)}`
}

/**
 * Read every file out of the ZIP and key by its full relative path (lowercased
 * for matching). We DO NOT collapse to basename - Letterboxd's `deleted/diary.csv`
 * would otherwise clobber the real `diary.csv`.
 */
async function extractZip(file: File): Promise<Record<string, string>> {
  const arrayBuffer = await file.arrayBuffer()
  const zip = await JSZip.loadAsync(arrayBuffer)
  const fileMap: Record<string, string> = {}
  await Promise.all(
    Object.entries(zip.files).map(async ([path, entry]) => {
      if (entry.dir) return
      const normalized = path.replace(/\\/g, '/')
      fileMap[normalized] = await entry.async('string')
    })
  )
  return fileMap
}

function latestPlayDate(item: RawImportItem): string | null {
  let latest: string | null = null
  let latestTs = -Infinity
  for (const p of item.plays) {
    if (!p.watchedAt) continue
    const t = parseImportDate(p.watchedAt)
    if (!isNaN(t) && t > latestTs) { latestTs = t; latest = p.watchedAt }
  }
  for (const ep of Object.values(item.episodes)) {
    for (const pl of ep.plays) {
      const t = parseImportDate(pl.watchedAt)
      if (!isNaN(t) && t > latestTs) { latestTs = t; latest = pl.watchedAt }
    }
  }
  return latest
}

// Earliest play across movie plays AND episode plays. Used for `addedDate` so
// a show is dated by its first watched episode, not the import time (its
// movie-level `plays` array is empty - all its plays live under `episodes`).
function earliestPlayDate(item: RawImportItem): string | null {
  let earliest: string | null = null
  let earliestTs = Infinity
  for (const p of item.plays) {
    if (!p.watchedAt) continue
    const t = parseImportDate(p.watchedAt)
    if (!isNaN(t) && t < earliestTs) { earliestTs = t; earliest = p.watchedAt }
  }
  for (const ep of Object.values(item.episodes)) {
    for (const pl of ep.plays) {
      const t = parseImportDate(pl.watchedAt)
      if (!isNaN(t) && t < earliestTs) { earliestTs = t; earliest = pl.watchedAt }
    }
  }
  return earliest
}

function totalPlays(item: RawImportItem): number {
  let n = item.plays.length
  for (const ep of Object.values(item.episodes)) n += ep.plays.length
  return n
}

// Per-field documentation shown on the CSV file-picker step - one widget per
// column the importer actually reads. `hint` is the format / allowed values
// (rendered in parentheses); everything else is filled in from TMDb.
interface CsvFieldInfo {
  name: string
  hint?: string
  desc: string
}

const CSV_HISTORY_FIELDS: CsvFieldInfo[] = [
  { name: 'watched_at', hint: 'ISO 8601 format', desc: 'The datetime you watched the entry' },
  { name: 'type', hint: "'movie' | 'episode'", desc: 'Whether the row is a movie or a TV episode' },
  { name: 'tmdb_id', desc: 'TMDb id of the movie, or of the parent show for episodes' },
  { name: 'season_number', desc: 'The season number (episode rows only)' },
  { name: 'episode_number', desc: 'The episode number within the season (episode rows only)' },
]

const CSV_WATCHLIST_FIELDS: CsvFieldInfo[] = [
  { name: 'listed_at', hint: 'ISO 8601 format', desc: 'When you added the entry to your watchlist' },
  { name: 'type', hint: "'movie' | 'show' | 'episode'", desc: 'The kind of entry being added' },
  { name: 'tmdb_id', desc: 'TMDb id of the movie or show' },
  { name: 'season_number', desc: 'The season number (episode rows only)' },
  { name: 'episode_number', desc: 'The episode number within the season (episode rows only)' },
]

export function ImportDialog({ open, onOpenChange, initialSource }: Props) {
  const settings = useStore(s => s.settings)

  const [step, setStep] = useState<Step>(() => initialSource ? 'files' : 'source')
  const [source, setSource] = useState<ImportSource | null>(initialSource ?? null)

  React.useEffect(() => {
    if (open && initialSource) {
      setStep('files')
      setSource(initialSource)
    }
  }, [open, initialSource])

  const [parsed, setParsed] = useState<ParsedImport | null>(null)
  const [options, setOptions] = useState<ImportOptions>({ watched: true, watchlist: true, lists: true, collection: true })
  const [progress, setProgress] = useState<ImportProgress>({ current: 0, total: 0, label: '' })
  const [result, setResult] = useState<ImportResult | null>(null)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const cancelSignal = useRef(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setStep(initialSource ? 'files' : 'source')
    setSource(initialSource ?? null)
    setParsed(null)
    setOptions({ watched: true, watchlist: true, lists: true, collection: true })
    setProgress({ current: 0, total: 0, label: '' })
    setResult(null)
    setShowCancelConfirm(false)
    cancelSignal.current = false
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleClose = (v: boolean) => {
    if (!v) reset()
    onOpenChange(v)
  }

  const selectSource = (s: ImportSource) => {
    setSource(s)
    setStep('files')
  }

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      // CSV imports are a single plain-text file; the others are ZIP exports.
      if (source === 'csv' || source === 'csv-watchlist') {
        const text = await file.text()
        setParsed(source === 'csv' ? parseHistoryCsv(text) : parseWatchlistCsv(text))
        setStep('preview')
        return
      }
      const fileMap = await extractZip(file)
      const parsedImport = source === 'letterboxd'
        ? parseLetterboxdFiles(fileMap)
        : parseTraktFiles(fileMap)
      setParsed(parsedImport)
      setStep('preview')
    } catch {
      toast.error(
        source === 'csv'
          ? 'Failed to read CSV file. Make sure it has watched_at, type, and tmdb_id columns.'
          : source === 'csv-watchlist'
          ? 'Failed to read CSV file. Make sure it has listed_at, type, and tmdb_id columns.'
          : 'Failed to read ZIP file. Make sure you selected the correct export file.'
      )
    }
  }, [source])

  const counts = parsed ? {
    watched: parsed.items.filter(i => i.status === 'watched' || i.status === 'in_progress').length,
    watchlist: parsed.items.filter(i => i.status === 'watchlist').length,
    movies: parsed.items.filter(i => i.mediaType === 'movie').length,
    shows: parsed.items.filter(i => i.mediaType === 'tv').length,
    episodes: parsed.items.reduce((sum, i) => sum + Object.keys(i.episodes).length, 0),
    episodePlays: parsed.items.reduce(
      (sum, i) => sum + Object.values(i.episodes).reduce((a, ep) => a + ep.plays.length, 0),
      0
    ),
    lists: parsed.lists.length,
    collection: parsed.collectionItems.length,
  } : null

  const doImport = async () => {
    if (!parsed) return
    cancelSignal.current = false
    setStep('importing')

    // Snapshot store state once so concurrent renders can't reshape the input
    // mid-import.
    const currentLibrary = { ...useStore.getState().library }
    const currentHistory = useStore.getState().watchHistory
    const currentLists = useStore.getState().lists
    const currentCollection = useStore.getState().collection

    // The libIndex starts as a *copy* of the current library and accumulates
    // both new and merged entries. `touched` tracks which ids need to be
    // persisted at the end.
    const libIndex: Record<string, LibraryEntry> = { ...currentLibrary }
    const touched = new Set<string>()
    const existedBefore = new Set<string>(Object.keys(currentLibrary))

    // Per-day index of existing plays. We dedupe imported plays against this
    // by COUNT, not by exact ms - multiple Letterboxd diary rows on the same
    // date all parse to identical timestamps and would collapse under the old
    // `${mediaId}|${epKey}|${ms}` key. With the count approach: skip imported
    // plays up to `existing.count`, then push the rest at `maxTs+1`, `+2`, ...
    // so re-imports stay idempotent and new same-day plays land as distinct
    // history entries.
    const existingPerDay = new Map<string, { count: number; maxTs: number }>()
    for (const h of currentHistory) {
      const k = dayKeyOf(h.mediaId, h.episodeKey, h.watchedAt)
      const prev = existingPerDay.get(k)
      if (prev) {
        prev.count++
        if (h.watchedAt > prev.maxTs) prev.maxTs = h.watchedAt
      } else {
        existingPerDay.set(k, { count: 1, maxTs: h.watchedAt })
      }
    }
    const importPerDayConsumed = new Map<string, number>()
    const newHistory: WatchHistoryEntry[] = []

    // Filter parsed items by what the user opted in to import.
    const requested = parsed.items.filter(item => {
      if (item.status === 'watchlist') return options.watchlist
      return options.watched
    })

    // List/collection items that aren't watched/watchlisted are NOT pulled into
    // the library - a list item is just a reference (stored as list metadata),
    // and collection entries render standalone. This keeps the user's Watchlist
    // limited to their actual watchlist instead of every custom-list title.
    const allItems = requested
    const totalSteps = allItems.length
      + (options.lists ? parsed.lists.length : 0)
      + (options.collection ? parsed.collectionItems.length : 0)

    setProgress({ current: 0, total: totalSteps, label: 'Starting...' })
    let stepsDone = 0
    const failed: string[] = []

    // Build a title|year → tmdbId reverse-lookup from the existing library so
    // Letterboxd re-imports can skip searchMoviesWithYear for known titles.
    const lbTitleYearToTmdbId = new Map<string, number>()
    if (parsed.source === 'letterboxd') {
      for (const entry of Object.values(currentLibrary)) {
        if (entry.mediaType !== 'movie') continue
        const key = `${entry.title.trim().toLowerCase()}|${entry.releaseYear ?? ''}`
        lbTitleYearToTmdbId.set(key, entry.tmdbId)
      }
    }

    // ── Per-item: resolve tmdb, fetch full details (caches under the same
    // key the detail page uses), then merge into libIndex.
    for (let i = 0; i < allItems.length; i++) {
      if (cancelSignal.current) break
      const item = allItems[i]
      const label = item.title || `Item ${i + 1}`
      setProgress({ current: stepsDone, total: totalSteps, label })

      try {
        let tmdbId = item.tmdbId

        // Letterboxd has no tmdb ids - check library first, then search TMDb.
        if (parsed.source === 'letterboxd' && !tmdbId) {
          const normKey = `${item.title.trim().toLowerCase()}|${item.year ?? ''}`
          const libraryMatch = lbTitleYearToTmdbId.get(normKey)
          if (libraryMatch) {
            tmdbId = libraryMatch
          } else {
            const res = await searchMoviesWithYear(item.title, item.year ?? undefined)
            const match = res.results.find(r =>
              item.year ? r.release_date?.startsWith(String(item.year)) : true
            ) ?? res.results[0]
            if (!match) {
              failed.push(item.title)
              stepsDone++
              continue
            }
            tmdbId = match.id
            lbTitleYearToTmdbId.set(normKey, tmdbId)
          }
        }
        if (!tmdbId) {
          failed.push(label)
          stepsDone++
          continue
        }

        // The library distinguishes anime (Japanese animation) as its own media
        // type, but importers only know 'movie'/'tv'. A show may already be
        // classified as anime from a prior import or a detail-page visit, so
        // look it up under both keys and start from whatever type it has.
        let effectiveMediaType: 'movie' | 'tv' | 'anime' = item.mediaType
        const existing =
          libIndex[buildLibraryId(item.mediaType, tmdbId)] ??
          (item.mediaType === 'tv' ? libIndex[buildLibraryId('anime', tmdbId)] : undefined)
        if (existing) effectiveMediaType = existing.mediaType

        let title = item.title
        let posterPath: string | null = null
        let backdropPath: string | null = null
        let releaseYear = item.year
        let genreIds: number[] = []
        let runtime: number | null = null
        let episodeCount: number | null = null

        // If the library entry already has full TMDb metadata (from a prior
        // import or detail page visit), use it directly - no API call needed.
        // releaseYear + genreIds being set is the reliable signal that the
        // entry was previously hydrated from TMDb.
        if (existing?.releaseYear != null && existing.genreIds != null) {
          title = existing.title
          posterPath = existing.posterPath ?? null
          backdropPath = existing.backdropPath ?? null
          releaseYear = existing.releaseYear
          genreIds = existing.genreIds
          runtime = existing.runtime ?? null
          // A prior import may have stored a null runtime (TMDb returned no
          // episode_run_time). Repair it here so a re-import fixes watch-time stats
          // for the whole library without needing a Detail visit per show.
          if (!runtime && (effectiveMediaType === 'tv' || effectiveMediaType === 'anime')) {
            try {
              const d = await getTV(tmdbId)
              runtime = await deriveShowRuntime(d)
              episodeCount = d.number_of_episodes ?? null
            } catch { /* leave runtime null; a later Detail visit can still fill it */ }
          }
        } else if (item.mediaType === 'movie') {
          const d = await getMovie(tmdbId)
          title = d.title || item.title
          posterPath = d.poster_path
          backdropPath = d.backdrop_path ?? null
          releaseYear = d.release_date ? parseInt(d.release_date.slice(0, 4)) : item.year
          genreIds = (d.genres ?? []).map(g => g.id)
          runtime = d.runtime ?? null
        } else {
          const d = await getTV(tmdbId)
          title = d.name || item.title
          posterPath = d.poster_path
          backdropPath = d.backdrop_path ?? null
          releaseYear = d.first_air_date ? parseInt(d.first_air_date.slice(0, 4)) : item.year
          genreIds = (d.genres ?? []).map(g => g.id)
          runtime = await deriveShowRuntime(d)
          episodeCount = d.number_of_episodes ?? null
          // Japanese animation → 'anime' so it filters separately from TV.
          if ((d.origin_country?.includes('JP') ?? false) && genreIds.includes(16)) {
            effectiveMediaType = 'anime'
          }
        }

        const libId = buildLibraryId(effectiveMediaType, tmdbId)

        // Merge episode progress: keep any existing episode data, fill in new
        // episodes from the import.
        let tvProgress: Record<string, EpisodeProgress> | null = null
        if (item.mediaType === 'tv') {
          const merged: Record<string, EpisodeProgress> = { ...(existing?.tvProgress ?? {}) }
          for (const [k, ep] of Object.entries(item.episodes)) {
            const lastPlay = ep.plays.length > 0 ? ep.plays[ep.plays.length - 1].watchedAt : null
            const ex = merged[k]
            const epRating = ex?.rating ?? ep.rating
            const epWatched = ex?.watchedAt ?? lastPlay
            merged[k] = {
              ...ex,   // keep a previously stored per-episode runtime
              watchedAt: epWatched,
              rating: epRating,
              // Stamp when the episode was rated (preserve a real existing stamp;
              // otherwise approximate by when it was watched) so the Stats chart can
              // date it without leaning on the one-time backfill.
              ratedAt: ex?.ratedAt ?? (epRating != null ? (parseDateMs(epWatched) ?? Date.now()) : null),
              note: (ex?.note && ex.note.length > 0) ? ex.note : ep.note,
            }
          }
          tvProgress = Object.keys(merged).length > 0 ? merged : (existing?.tvProgress ?? null)
        } else {
          tvProgress = existing?.tvProgress ?? null
        }

        // Pull real per-episode runtimes for the seasons that contain watched
        // episodes, so imported plays carry exact durations from the start (no Detail
        // visit needed). Bounded to watched seasons and cached: the fan-out is one
        // fetch per watched season, and re-imports reuse the cache. Episodes TMDb has
        // no runtime for keep falling back to the show's average runtime.
        // The same fetch yields episode names for the watch-log title.
        const epNames = new Map<string, string>()
        if (tvProgress && (effectiveMediaType === 'tv' || effectiveMediaType === 'anime')) {
          const progress = tvProgress
          const watchedSeasons = new Set<number>()
          for (const [key, p] of Object.entries(progress)) {
            if (!p.watchedAt) continue
            const s = Number(key.split(':')[0])
            if (s > 0) watchedSeasons.add(s)
          }
          if (watchedSeasons.size > 0) {
            const seasons = await Promise.all(
              [...watchedSeasons].map((s) => getSeason(tmdbId, s).catch(() => null))
            )
            const fetchedRts: number[] = []
            for (const season of seasons) {
              if (!season) continue
              for (const ep of season.episodes) {
                const key = `${ep.season_number}:${ep.episode_number}`
                // Capture the real episode name so watch-log entries read
                // "S1E2: The Name" instead of just the "S01E02" code.
                if (ep.name) epNames.set(key, ep.name)
                if (!(ep.runtime && ep.runtime > 0)) continue
                fetchedRts.push(ep.runtime)
                const prog = progress[key]
                if (prog?.watchedAt && prog.runtime !== ep.runtime) {
                  progress[key] = { ...prog, runtime: ep.runtime }
                }
              }
            }
            // Backfill the show average from this real data when TMDb gave none
            // earlier, so any watched episode lacking its own runtime still counts.
            if (runtime == null && fetchedRts.length > 0) {
              runtime = Math.round(fetchedRts.reduce((a, b) => a + b, 0) / fetchedRts.length)
            }
          }
        }

        const importedLatest = latestPlayDate(item)
        const importedEarliest = earliestPlayDate(item)
        const importedFirstTs = importedEarliest ? parseImportDate(importedEarliest) : NaN

        const watchedEpisodeCount = tvProgress
          ? Object.values(tvProgress).filter((p) => p.watchedAt).length
          : 0

        // Status: once an entry is 'watched' we don't downgrade it; otherwise
        // take the import's status (watched/in_progress/watchlist). A history-only
        // CSV has no aired-episode count, so its shows arrive as in_progress -
        // promote to watched here once every episode TMDb knows about is logged.
        let status: LibraryEntry['status'] =
          existing?.status === 'watched' ? 'watched' : item.status
        // A watchlist import is a status label, not a reset - never downgrade an
        // entry that already carries real watch progress (in-progress) back to
        // 'watchlist'. (Watched is already preserved above.)
        if (item.status === 'watchlist' && existing?.status === 'in_progress') {
          status = 'in_progress'
        }
        if (
          parsed.source === 'csv' &&
          status === 'in_progress' &&
          (effectiveMediaType === 'tv' || effectiveMediaType === 'anime') &&
          episodeCount != null && episodeCount > 0 &&
          watchedEpisodeCount >= episodeCount
        ) {
          status = 'watched'
        }

        const mergedSeasonRatings: Record<number, number | null> = { ...(existing?.seasonRatings ?? {}) }
        const mergedSeasonRatedAt: Record<number, number | null> = { ...(existing?.seasonRatedAt ?? {}) }
        // Approximate when a season was rated (latest watch, then earliest, then now)
        // so imported season ratings land on the Stats chart at the source.
        const seasonRatedProxy = parseDateMs(importedLatest)
          ?? (isNaN(importedFirstTs) ? (item.listedAt ?? Date.now()) : importedFirstTs)
        for (const [k, v] of Object.entries(item.seasonRatings)) {
          const sn = Number(k)
          if (mergedSeasonRatings[sn] == null) {
            mergedSeasonRatings[sn] = v
            if (v != null) mergedSeasonRatedAt[sn] = mergedSeasonRatedAt[sn] ?? seasonRatedProxy
          }
        }

        // Seed the denormalised runtime & episode aggregates as an episode-count × avg
        // estimate (the exact total needs every season; the per-episode fetch above only
        // covers watched seasons). Refined to the exact per-episode sum on the first
        // interactive write. Keep any existing value so a re-import never clobbers it.
        const estimated = estimateEntryStats({
          mediaType: effectiveMediaType,
          status,
          runtime: existing?.runtime ?? runtime,
          episodeCount: episodeCount ?? item.airedEpisodes,
          watchedEpisodeCount,
        })
        const runtimeStats = existing?.runtimeStats ?? estimated?.runtime ?? undefined
        const episodeStats = existing?.episodeStats ?? estimated?.episodes ?? undefined

        const finalUserRating = existing?.userRating ?? item.userRating
        const finalWatchedDate = existing?.watchedDate ?? importedLatest
        const finalAddedDate = existing?.addedDate ?? (isNaN(importedFirstTs) ? (item.listedAt ?? Date.now()) : importedFirstTs)
        // Stamp when the overall rating was given (preserve a real existing stamp;
        // otherwise approximate by the latest watch, then added date) so the Stats
        // chart can date it at the source rather than via the one-time backfill.
        const finalUserRatingAt = finalUserRating != null
          ? (existing?.userRatingAt ?? parseDateMs(finalWatchedDate) ?? finalAddedDate)
          : null

        const entry: LibraryEntry = {
          id: libId,
          mediaType: effectiveMediaType,
          tmdbId,
          title: existing?.title || title,
          posterPath: existing?.posterPath ?? posterPath,
          backdropPath: existing?.backdropPath ?? backdropPath,
          releaseYear: existing?.releaseYear ?? releaseYear,
          status,
          userRating: finalUserRating,
          userRatingAt: finalUserRatingAt,
          review: (existing?.review && existing.review.length > 0) ? existing.review : item.review,
          watchedDate: finalWatchedDate,
          addedDate: finalAddedDate,
          listIds: existing?.listIds ?? [],
          genreIds: existing?.genreIds ?? genreIds,
          tvProgress,
          seasonRatings: mergedSeasonRatings,
          seasonRatedAt: mergedSeasonRatedAt,
          runtime: existing?.runtime ?? runtime,
          runtimeStats,
          episodeStats,
        }
        libIndex[libId] = entry
        touched.add(libId)

        // ── Watch history: one entry per play (movies + episodes) ──────────
        if (item.status !== 'watchlist') {
          const pushPlay = (
            epKey: string | undefined,
            epTitle: string | undefined,
            play: { watchedAt: string | null; review?: string; tags?: string[]; isRewatch?: boolean },
            isLast: boolean,
            fallbackNote: string,
            isRewatchOverride?: boolean,
          ): void => {
            if (!play.watchedAt) return
            const t = parseImportDate(play.watchedAt)
            const baseTs = isNaN(t) ? Date.now() : t
            const dk = dayKeyOf(libId, epKey, baseTs)
            const slot = existingPerDay.get(dk) ?? { count: 0, maxTs: dayFloor(baseTs) - 1 }
            const consumed = importPerDayConsumed.get(dk) ?? 0
            importPerDayConsumed.set(dk, consumed + 1)
            // Plays up to `slot.count` are assumed to match existing entries
            // from a prior import - skip them so re-imports stay idempotent.
            if (consumed < slot.count) return
            const ts = Math.max(baseTs, slot.maxTs + 1)
            slot.maxTs = ts
            existingPerDay.set(dk, slot)
            const tags = play.tags && play.tags.length > 0 ? play.tags : undefined
            newHistory.push({
              id: `hist:${uid()}`,
              mediaId: libId,
              watchedAt: ts,
              watchedAtDT: play.watchedAt,
              note: (play.review && play.review.length > 0) ? play.review : (isLast ? fallbackNote : ''),
              tags,
              episodeKey: epKey,
              episodeTitle: epTitle,
              isRewatch: isRewatchOverride ?? play.isRewatch ?? false,
            })
          }

          for (let pi = 0; pi < item.plays.length; pi++) {
            pushPlay(undefined, undefined, item.plays[pi], pi === item.plays.length - 1, item.review)
          }
          for (const [epKey, ep] of Object.entries(item.episodes)) {
            const [sStr, eStr] = epKey.split(':')
            const epName = epNames.get(epKey)
            const epTitle = epName
              ? `S${Number(sStr)}E${Number(eStr)}: ${epName}`
              : `S${sStr.padStart(2, '0')}E${eStr.padStart(2, '0')}`
            for (let pi = 0; pi < ep.plays.length; pi++) {
              const isLast = pi === ep.plays.length - 1
              pushPlay(epKey, epTitle, { watchedAt: ep.plays[pi].watchedAt }, isLast, ep.note, pi > 0)
            }
          }
        }
      } catch (err) {
        console.error('Import error for', item.title, err)
        failed.push(item.title || label)
      }

      stepsDone++
    }

    // ── Persist library + history ────────────────────────────────────────────
    setProgress({ current: stepsDone, total: totalSteps, label: 'Saving library...' })
    try {
      if (touched.size > 0) {
        const toSave: LibraryEntry[] = []
        for (const id of touched) toSave.push(libIndex[id])
        await db.bulkSetLibraryEntries(toSave)
      }
      if (newHistory.length > 0) await db.bulkSetHistoryEntries(newHistory)
    } catch (err) {
      console.error(err)
      toast.error('Failed to save imported data')
    }

    // ── Lists ────────────────────────────────────────────────────────────────
    let listsImported = 0
    if (options.lists && parsed.lists.length > 0) {
      // libId → set of listIds it belongs to
      const entryListIds: Record<string, Set<string>> = {}
      const listsByName = new Map<string, CustomList>()
      for (const l of currentLists) listsByName.set(l.name.trim().toLowerCase(), l)

      // Letterboxd list items have no TMDb ids - resolve them by title|year
      // against the library. Items we can't resolve to an id (Letterboxd titles
      // not in the library) are skipped; items with a TMDb id that aren't in the
      // library are kept as standalone references via itemMeta.
      const titleYearToLibId = new Map<string, string>()
      if (parsed.source === 'letterboxd') {
        for (const entry of Object.values(libIndex)) {
          if (entry.mediaType !== 'movie') continue
          const key = `${entry.title.trim().toLowerCase()}|${entry.releaseYear ?? ''}`
          titleYearToLibId.set(key, entry.id)
        }
      }

      for (const parsedList of parsed.lists) {
        if (cancelSignal.current) break
        setProgress({ current: stepsDone, total: totalSteps, label: `Importing list: ${parsedList.name}` })

        const nameKey = parsedList.name.trim().toLowerCase()
        const existingList = listsByName.get(nameKey)

        const itemIds = new Set<string>(existingList?.itemIds ?? [])
        const itemMeta: Record<string, ListItemMeta> = { ...(existingList?.itemMeta ?? {}) }
        const wasNew = !existingList
        for (const li of parsedList.items) {
          let libId: string | undefined
          if (li.tmdbId !== null) {
            libId = buildLibraryId(li.mediaType, li.tmdbId)
          } else if (parsed.source === 'letterboxd' && li.mediaType === 'movie') {
            const key = `${li.title.trim().toLowerCase()}|${li.year ?? ''}`
            libId = titleYearToLibId.get(key)
          }
          if (!libId) continue
          itemIds.add(libId)
          // Not in the library - keep it as a list reference (only possible with
          // a TMDb id; Letterboxd title|year matches always resolve to a lib entry).
          if (!libIndex[libId] && li.tmdbId !== null && !itemMeta[libId]) {
            itemMeta[libId] = {
              mediaType: li.mediaType,
              tmdbId: li.tmdbId,
              title: li.title,
              posterPath: null,
              releaseYear: li.year,
              addedAt: li.addedAt ?? undefined,
            }
          }
        }

        const list: CustomList = {
          id: existingList?.id ?? `list:${uid()}`,
          name: existingList?.name ?? parsedList.name,
          description: existingList?.description || parsedList.description,
          createdAt: existingList?.createdAt
            ?? (parsedList.createdAt ? new Date(parsedList.createdAt).getTime() || Date.now() : Date.now()),
          itemIds: [...itemIds],
          ...(Object.keys(itemMeta).length > 0 ? { itemMeta } : {}),
        }
        for (const libId of itemIds) {
          ;(entryListIds[libId] ??= new Set()).add(list.id)
        }
        try {
          await db.setList(list)
          listsByName.set(nameKey, list)
          if (wasNew) listsImported++
        } catch { /* non-fatal */ }
        stepsDone++
      }

      // Backfill listIds onto each library entry.
      if (Object.keys(entryListIds).length > 0) {
        const updates: LibraryEntry[] = []
        for (const [libId, idSet] of Object.entries(entryListIds)) {
          const entry = libIndex[libId]
          if (!entry) continue
          const merged = new Set([...entry.listIds, ...idSet])
          if (merged.size === entry.listIds.length) continue
          const updated = { ...entry, listIds: [...merged] }
          libIndex[libId] = updated
          updates.push(updated)
        }
        if (updates.length > 0) {
          try { await db.bulkSetLibraryEntries(updates) } catch { /* non-fatal */ }
        }
      }
    }

    // ── Collection ───────────────────────────────────────────────────────────
    let collectionImported = 0
    if (options.collection && parsed.collectionItems.length > 0) {
      const existingByMediaId = new Set(
        currentCollection.filter(c => c.mediaId).map(c => c.mediaId as string)
      )
      for (const colItem of parsed.collectionItems) {
        if (cancelSignal.current) break
        setProgress({ current: stepsDone, total: totalSteps, label: `Importing collection: ${colItem.title}` })

        const libId = buildLibraryId(colItem.mediaType, colItem.tmdbId)
        if (existingByMediaId.has(libId)) {
          stepsDone++
          continue
        }
        const lib = libIndex[libId]
        const collEntry: CollectionEntry = {
          id: `col:${uid()}`,
          mediaId: lib ? libId : null,
          title: lib?.title || colItem.title,
          posterPath: lib?.posterPath ?? null,
          mediaType: colItem.mediaType,
          format: colItem.format,
          purchasedDate: colItem.purchasedDate,
          addedDate: colItem.purchasedDate
            ? (parseImportDate(colItem.purchasedDate) || Date.now())
            : Date.now(),
          notes: colItem.notes,
        }
        try {
          await db.setCollectionEntry(collEntry)
          existingByMediaId.add(libId)
          collectionImported++
        } catch { /* non-fatal */ }
        stepsDone++
      }
    }

    // ── Apply username from parsed profile (only if user hasn't set one) ────
    if (parsed.profile?.username) {
      try {
        const u = useStore.getState().settings.username
        if (!u || u === 'Guest') {
          await useStore.getState().updateSettings({ username: parsed.profile.username })
        }
      } catch { /* non-fatal */ }
    }

    setProgress({ current: totalSteps, total: totalSteps, label: 'Done' })
    try { await useStore.getState().init() } catch { /* non-fatal */ }

    let imported = 0
    let merged = 0
    let skipped = 0
    for (const id of touched) {
      if (!existedBefore.has(id)) imported++
      else if (newHistory.some(h => h.mediaId === id)) merged++
      else skipped++
    }
    setResult({ imported, merged, skipped, failed, listsImported, collectionImported })
    setStep('done')
  }

  return (
    <>
    <Dialog open={open} onOpenChange={step === 'importing' ? undefined : handleClose}>
      <DialogContent
        className="sm:max-w-md max-h-[90vh] overflow-y-auto"
        hideClose={step === 'importing'}
        onInteractOutside={step === 'importing' ? (e) => e.preventDefault() : undefined}
        onEscapeKeyDown={step === 'importing' ? (e) => e.preventDefault() : undefined}
      >
        <DialogHeader>
          <DialogTitle className="text-center">Import from Letterboxd / Trakt / CSV</DialogTitle>
        </DialogHeader>

        {step === 'source' && (
          <div className="space-y-4 pt-1">
            <p className="text-sm text-muted-foreground text-center">Choose where to import from:</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => selectSource('letterboxd')}
                className="flex flex-col items-center gap-3 p-5 rounded-xl border border-border/60 bg-card hover:border-primary/50 hover:bg-primary/5 transition-colors cursor-pointer"
              >
                <div className="h-10 w-10 rounded-full bg-[#00e054]/15 flex items-center justify-center">
                  <Film className="h-5 w-5 text-[#00e054]" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium">Letterboxd</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Movies only</p>
                </div>
              </button>
              <button
                onClick={() => selectSource('trakt')}
                className="flex flex-col items-center gap-3 p-5 rounded-xl border border-border/60 bg-card hover:border-primary/50 hover:bg-primary/5 transition-colors cursor-pointer"
              >
                <div className="h-10 w-10 rounded-full bg-[#ed1c24]/15 flex items-center justify-center">
                  <Tv className="h-5 w-5 text-[#ed1c24]" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium">Trakt</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Movies &amp; shows</p>
                </div>
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => selectSource('csv')}
                className="flex flex-col items-center gap-3 p-5 rounded-xl border border-border/60 bg-card hover:border-primary/50 hover:bg-primary/5 transition-colors cursor-pointer"
              >
                <div className="h-10 w-10 rounded-full bg-primary/15 flex items-center justify-center">
                  <FileText className="h-5 w-5 text-primary" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium">Watch History CSV</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Watched history</p>
                </div>
              </button>
              <button
                onClick={() => selectSource('csv-watchlist')}
                className="flex flex-col items-center gap-3 p-5 rounded-xl border border-border/60 bg-card hover:border-primary/50 hover:bg-primary/5 transition-colors cursor-pointer"
              >
                <div className="h-10 w-10 rounded-full bg-primary/15 flex items-center justify-center">
                  <BookmarkPlus className="h-5 w-5 text-primary" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium">Watchlist CSV</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">To-watch list</p>
                </div>
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground/50 text-center">
              Not affiliated with or endorsed by Letterboxd or Trakt.
            </p>
          </div>
        )}

        {step === 'files' && source === 'letterboxd' && (
          <div className="space-y-4 pt-1">
            <div className="space-y-2.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide text-center">How to export</p>
              <ol className="space-y-2">
                {[
                  <>Visit <span className="font-mono text-primary text-[11px]">letterboxd.com/settings/data/</span></>,
                  <>Click <span className="font-medium">Export your data</span></>,
                  <>Upload the <span className="font-medium">.zip</span> file you receive below</>,
                ].map((s, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-xs text-muted-foreground">
                    <span className="flex-shrink-0 h-4 w-4 rounded-full bg-primary/15 text-primary text-[10px] font-medium flex items-center justify-center mt-0.5">{i + 1}</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            </div>
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full flex flex-col items-center gap-2.5 p-6 rounded-xl border-2 border-dashed border-border/60 hover:border-primary/50 hover:bg-primary/5 transition-colors cursor-pointer"
            >
              <Upload className="h-6 w-6 text-muted-foreground" />
              <div className="text-center">
                <p className="text-sm font-medium">Select ZIP file</p>
                <p className="text-xs text-muted-foreground mt-0.5">Your Letterboxd export .zip</p>
              </div>
            </button>
            <input ref={fileRef} type="file" accept=".zip" className="hidden" onChange={handleFile} />
            <Button variant="ghost" size="sm" onClick={() => setStep('source')}>Back</Button>
          </div>
        )}

        {step === 'files' && source === 'trakt' && (
          <div className="space-y-4 pt-1">
            <div className="space-y-2.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide text-center">How to export</p>
              <ol className="space-y-2">
                {[
                  <>Visit <span className="font-mono text-primary text-[11px]">app.trakt.tv/settings/data</span></>,
                  <>Click <span className="font-medium">Export</span> next to <span className="font-medium">Raw Export</span></>,
                  <>Upload the <span className="font-medium">.zip</span> file you receive below</>,
                ].map((s, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-xs text-muted-foreground">
                    <span className="flex-shrink-0 h-4 w-4 rounded-full bg-primary/15 text-primary text-[10px] font-medium flex items-center justify-center mt-0.5">{i + 1}</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            </div>
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full flex flex-col items-center gap-2.5 p-6 rounded-xl border-2 border-dashed border-border/60 hover:border-primary/50 hover:bg-primary/5 transition-colors cursor-pointer"
            >
              <Upload className="h-6 w-6 text-muted-foreground" />
              <div className="text-center">
                <p className="text-sm font-medium">Select ZIP file</p>
                <p className="text-xs text-muted-foreground mt-0.5">Your Trakt export .zip</p>
              </div>
            </button>
            <input ref={fileRef} type="file" accept=".zip" className="hidden" onChange={handleFile} />
            <Button variant="ghost" size="sm" onClick={() => setStep('source')}>Back</Button>
          </div>
        )}

        {step === 'files' && (source === 'csv' || source === 'csv-watchlist') && (
          <div className="space-y-4 pt-1">
            <div className="space-y-2.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide text-center">
                {source === 'csv' ? 'Watch History CSV' : 'Watchlist CSV'}
              </p>
              <p className="text-[11px] text-muted-foreground text-center">
                These columns are read from your CSV - everything else is filled in from TMDb.
              </p>
              <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
                {(source === 'csv' ? CSV_HISTORY_FIELDS : CSV_WATCHLIST_FIELDS).map((f) => (
                  <div key={f.name} className="rounded-lg border border-border/50 bg-card/50 px-3 py-2">
                    <div className="flex items-baseline gap-1.5 flex-wrap">
                      <code className="font-mono text-[11px] text-primary">{f.name}</code>
                      {f.hint && (
                        <span className="text-[10px] text-muted-foreground/70">({f.hint})</span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{f.desc}</p>
                  </div>
                ))}
              </div>
            </div>
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full flex flex-col items-center gap-2.5 p-6 rounded-xl border-2 border-dashed border-border/60 hover:border-primary/50 hover:bg-primary/5 transition-colors cursor-pointer"
            >
              <Upload className="h-6 w-6 text-muted-foreground" />
              <div className="text-center">
                <p className="text-sm font-medium">Select CSV file</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {source === 'csv' ? 'Your watch-history .csv' : 'Your watchlist .csv'}
                </p>
              </div>
            </button>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
            <Button variant="ghost" size="sm" onClick={() => setStep('source')}>Back</Button>
          </div>
        )}

        {step === 'preview' && parsed && counts && (
          <div className="space-y-4 pt-1">
            <div className="grid grid-cols-2 gap-2">
              {counts.movies > 0 && (
                <div className="flex items-center gap-2.5 p-3 rounded-lg bg-card border border-border/50">
                  <Film className="h-4 w-4 text-primary flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium">{counts.movies}</p>
                    <p className="text-[11px] text-muted-foreground">Movies</p>
                    {(() => {
                      const totalMoviePlays = parsed.items
                        .filter(i => i.mediaType === 'movie')
                        .reduce((s, i) => s + totalPlays(i), 0)
                      return totalMoviePlays > counts.movies ? (
                        <p className="text-[11px] text-muted-foreground/60">{totalMoviePlays} plays</p>
                      ) : null
                    })()}
                  </div>
                </div>
              )}
              {counts.shows > 0 && (
                <div className="flex items-center gap-2.5 p-3 rounded-lg bg-card border border-border/50">
                  <Tv className="h-4 w-4 text-primary flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium">{counts.shows}</p>
                    <p className="text-[11px] text-muted-foreground">TV Shows</p>
                    {counts.episodes > 0 && (
                      <p className="text-[11px] text-muted-foreground/60">{counts.episodes} unique episodes</p>
                    )}
                    {counts.episodePlays > counts.episodes && (
                      <p className="text-[11px] text-muted-foreground/60">{counts.episodePlays} plays incl. rewatches</p>
                    )}
                  </div>
                </div>
              )}
              {counts.watchlist > 0 && (
                <div className="flex items-center gap-2.5 p-3 rounded-lg bg-card border border-border/50">
                  <BookmarkPlus className="h-4 w-4 text-primary flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium">{counts.watchlist}</p>
                    <p className="text-[11px] text-muted-foreground">Watchlist</p>
                  </div>
                </div>
              )}
              {counts.lists > 0 && (
                <div className="flex items-center gap-2.5 p-3 rounded-lg bg-card border border-border/50">
                  <List className="h-4 w-4 text-primary flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium">{counts.lists}</p>
                    <p className="text-[11px] text-muted-foreground">Lists</p>
                  </div>
                </div>
              )}
              {counts.collection > 0 && (
                <div className="flex items-center gap-2.5 p-3 rounded-lg bg-card border border-border/50">
                  <Package className="h-4 w-4 text-primary flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium">{counts.collection}</p>
                    <p className="text-[11px] text-muted-foreground">Collection</p>
                  </div>
                </div>
              )}
            </div>

            {parsed.errors.length > 0 && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-warning/10 border border-warning/30 text-xs text-warning">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <div>{parsed.errors.join('; ')}</div>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Import options</p>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <Checkbox
                  checked={options.watched}
                  onCheckedChange={v => setOptions(o => ({ ...o, watched: !!v }))}
                />
                <span className="text-sm">Watched / In-progress ({counts.watched})</span>
              </label>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <Checkbox
                  checked={options.watchlist}
                  onCheckedChange={v => setOptions(o => ({ ...o, watchlist: !!v }))}
                />
                <span className="text-sm">Watchlist ({counts.watchlist})</span>
              </label>
              {counts.lists > 0 && (
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <Checkbox
                    checked={options.lists}
                    onCheckedChange={v => setOptions(o => ({ ...o, lists: !!v }))}
                  />
                  <span className="text-sm">Lists ({counts.lists})</span>
                </label>
              )}
              {counts.collection > 0 && (
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <Checkbox
                    checked={options.collection}
                    onCheckedChange={v => setOptions(o => ({ ...o, collection: !!v }))}
                  />
                  <span className="text-sm">Collection ({counts.collection})</span>
                </label>
              )}
            </div>

            {parsed.source !== 'trakt' && (
              <p className="text-[11px] text-muted-foreground">
                {parsed.source === 'letterboxd'
                  ? 'Each title will be looked up on TMDb - this may take a few minutes for large libraries.'
                  : parsed.source === 'csv'
                  ? 'Each title is fetched from TMDb to fill in its details - this may take a few minutes for large histories.'
                  : 'Each title is fetched from TMDb to fill in its details - this may take a few minutes for large watchlists.'}
                {!settings.apiKey && (
                  <span className="text-destructive"> Add your TMDb API key in Settings first.</span>
                )}
              </p>
            )}

            <div className="flex gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={() => setStep('files')}>Back</Button>
              <Button
                size="sm"
                className="flex-1"
                onClick={doImport}
                disabled={!options.watched && !options.watchlist && !options.lists && !options.collection}
              >
                Import
              </Button>
            </div>
          </div>
        )}

        {step === 'importing' && (
          <div className="space-y-4 pt-2">
            <div className="flex flex-col items-center gap-3 py-4">
              <Loader2 className="h-8 w-8 text-primary animate-spin" />
              <p className="text-sm font-medium">Importing...</p>
              <p className="text-xs text-muted-foreground text-center truncate max-w-full px-2">
                {progress.label}
              </p>
            </div>
            {progress.total > 0 && (
              <div className="space-y-1.5">
                <Progress value={Math.round((progress.current / progress.total) * 100)} className="h-2" />
                <p className="text-[11px] text-muted-foreground text-right">
                  {progress.current} / {progress.total}
                </p>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground text-center">
              Fetching and caching details from TMDb so they load instantly later.
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground hover:text-destructive"
              onClick={() => setShowCancelConfirm(true)}
            >
              <OctagonX className="h-3.5 w-3.5 mr-1.5" />
              Stop import
            </Button>
          </div>
        )}

        {step === 'done' && result && (
          <div className="space-y-4 pt-1">
            <div className="flex flex-col items-center gap-2 py-3">
              <CheckCircle2 className="h-10 w-10 text-green-500" />
              <p className="text-base font-medium">Import complete</p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2.5 rounded-lg bg-card border border-border/50">
                <p className="text-lg font-semibold text-green-500">{result.imported}</p>
                <p className="text-[11px] text-muted-foreground">Imported</p>
              </div>
              <div className="p-2.5 rounded-lg bg-card border border-border/50">
                <p className="text-lg font-semibold text-primary">{result.merged}</p>
                <p className="text-[11px] text-muted-foreground">Merged</p>
              </div>
              <div className="p-2.5 rounded-lg bg-card border border-border/50">
                <p className="text-lg font-semibold text-destructive">{result.failed.length}</p>
                <p className="text-[11px] text-muted-foreground">Failed</p>
              </div>
            </div>
            {(result.listsImported > 0 || result.collectionImported > 0) && (
              <div className="grid grid-cols-2 gap-2 text-center">
                {result.listsImported > 0 && (
                  <div className="p-2.5 rounded-lg bg-card border border-border/50">
                    <p className="text-lg font-semibold text-green-500">{result.listsImported}</p>
                    <p className="text-[11px] text-muted-foreground">Lists</p>
                  </div>
                )}
                {result.collectionImported > 0 && (
                  <div className="p-2.5 rounded-lg bg-card border border-border/50">
                    <p className="text-lg font-semibold text-green-500">{result.collectionImported}</p>
                    <p className="text-[11px] text-muted-foreground">Collection</p>
                  </div>
                )}
              </div>
            )}
            {result.skipped > 0 && (
              <p className="text-[11px] text-muted-foreground">
                {result.skipped} {result.skipped === 1 ? 'entry was' : 'entries were'} already up to date.
              </p>
            )}
            {result.failed.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Could not find on TMDb:</p>
                <ScrollArea className="h-24">
                  <div className="space-y-0.5">
                    {result.failed.map((t, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <X className="h-3 w-3 text-destructive flex-shrink-0" />
                        {t}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}
            <Button className="w-full" onClick={() => handleClose(false)}>Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>

    <Dialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Stop import?</DialogTitle>
          <DialogDescription>
            Items imported so far will be kept. The rest will be skipped.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2 pt-1">
          <Button variant="ghost" className="flex-1" onClick={() => setShowCancelConfirm(false)}>
            Keep going
          </Button>
          <Button
            variant="destructive"
            className="flex-1"
            onClick={() => {
              cancelSignal.current = true
              setShowCancelConfirm(false)
            }}
          >
            Stop
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  )
}
