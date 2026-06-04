import { parseImportDate } from './utils'
import type { CollectionFormat } from '../types'

export type ImportSource = 'letterboxd' | 'trakt' | 'csv' | 'csv-watchlist'

// ─── Schema ───────────────────────────────────────────────────────────────────

/** One concrete watch of a movie (or unscoped TV watch). */
export interface ImportPlay {
  watchedAt: string | null  // ISO datetime
  rating: number | null      // per-play rating (Letterboxd diary)
  review: string             // per-play review text
  tags: string[]             // per-play tags
  isRewatch: boolean
}

/** One concrete watch of a single episode. */
export interface ImportEpisodePlay {
  watchedAt: string          // ISO datetime
}

/** Aggregated data for a single episode of a show. */
export interface ImportEpisode {
  rating: number | null
  note: string
  plays: ImportEpisodePlay[]
}

export interface RawImportItem {
  title: string
  year: number | null
  tmdbId: number | null
  mediaType: 'movie' | 'tv'
  status: 'watched' | 'watchlist' | 'in_progress'

  userRating: number | null         // overall rating (movie/show level)
  review: string                    // overall review/note

  plays: ImportPlay[]               // every play of this title (movies)
  episodes: Record<string, ImportEpisode>   // "s:e" → per-episode (TV)
  seasonRatings: Record<number, number>     // season → rating (TV)
  airedEpisodes: number | null      // for completeness check (TV)
  listedAt?: number | null          // ms timestamp when added to watchlist
}

export interface ParsedListItem {
  mediaType: 'movie' | 'tv'
  tmdbId: number | null
  title: string
  year: number | null
  notes: string | null
  addedAt?: number | null
}

export interface ParsedList {
  name: string
  description: string
  createdAt: string
  items: ParsedListItem[]
}

export interface ParsedCollectionItem {
  title: string
  year: number | null
  tmdbId: number
  mediaType: 'movie' | 'tv'
  format: CollectionFormat
  purchasedDate: string | null
  notes: string
}

export interface ParsedImport {
  items: RawImportItem[]
  source: ImportSource
  errors: string[]
  lists: ParsedList[]
  collectionItems: ParsedCollectionItem[]
  profile?: { username?: string }
}

function blankItem(p: Partial<RawImportItem> & Pick<RawImportItem, 'title' | 'mediaType'>): RawImportItem {
  return {
    title: p.title,
    year: p.year ?? null,
    tmdbId: p.tmdbId ?? null,
    mediaType: p.mediaType,
    status: p.status ?? 'watched',
    userRating: p.userRating ?? null,
    review: p.review ?? '',
    plays: p.plays ?? [],
    episodes: p.episodes ?? {},
    seasonRatings: p.seasonRatings ?? {},
    airedEpisodes: p.airedEpisodes ?? null,
    listedAt: p.listedAt ?? null,
  }
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current)
  return result
}

function parseCSV(text: string): Record<string, string>[] {
  // CSV may legitimately contain newlines inside quoted fields (e.g. review text).
  // Walk char-by-char so we don't break those rows.
  const rows: string[] = []
  let buf = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') { buf += '""'; i++ }
      else { buf += ch; inQuotes = !inQuotes }
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (buf.length > 0) rows.push(buf)
      buf = ''
      if (ch === '\r' && text[i + 1] === '\n') i++
    } else {
      buf += ch
    }
  }
  if (buf.length > 0) rows.push(buf)

  if (rows.length < 2) return []
  const headers = parseCSVLine(rows[0]).map(h => h.trim())
  return rows.slice(1).map(line => {
    const vals = parseCSVLine(line)
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = (vals[i] ?? '').trim() })
    return row
  }).filter(row => Object.values(row).some(v => v))
}

/**
 * Letterboxd custom list CSVs have two sections separated by a blank line:
 * first the list metadata (Date,Name,Tags,URL,Description), then the items
 * (Position,Name,Year,URL,Description). Split on the first unquoted blank
 * line so each half can be parsed with the normal CSV parser.
 */
function splitOnBlankLine(text: string): [string, string] | null {
  let inQuotes = false
  let sawNewline = false
  let firstNewlineIdx = -1
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') i++
      else inQuotes = !inQuotes
      sawNewline = false
      continue
    }
    if (inQuotes) { sawNewline = false; continue }
    if (ch === '\n') {
      if (sawNewline) return [text.slice(0, firstNewlineIdx + 1), text.slice(i + 1)]
      sawNewline = true
      firstNewlineIdx = i
    } else if (ch !== '\r') {
      sawNewline = false
    }
  }
  return null
}

// ─── Letterboxd ───────────────────────────────────────────────────────────────

function lbRatingTo10(r: string | undefined | null): number | null {
  if (!r) return null
  const n = parseFloat(r)
  if (isNaN(n) || n <= 0) return null
  return Math.round(n * 2)
}

function lbTags(s: string | undefined): string[] {
  return s ? s.split(',').map(t => t.trim()).filter(Boolean) : []
}

function lbKey(name: string, yearStr: string | null | undefined): string {
  return `${(name ?? '').trim().toLowerCase()}|${yearStr ?? ''}`
}

function lbWatchedDate(row: Record<string, string>): string | null {
  return row['Watched Date'] || row['Date'] || null
}

/**
 * Letterboxd's export is CSV-based. Movie identity is `Name|Year` (no TMDb id).
 * Multiple plays of the same film appear as separate diary/review rows - we
 * preserve every play instead of collapsing them.
 */
export function parseLetterboxdFiles(files: Record<string, string>): ParsedImport {
  const errors: string[] = []
  const map = new Map<string, RawImportItem>()
  const watchlistItems: RawImportItem[] = []
  const lists: ParsedList[] = []
  let profile: ParsedImport['profile']

  const norm = (s: string) => s.replace(/\\/g, '/').toLowerCase()
  const findCsv = (predicate: (name: string) => boolean): string => {
    const entry = Object.entries(files).find(([name]) => predicate(norm(name)))
    return entry ? entry[1] : ''
  }
  // Match only top-level files - skip deleted/* and orphaned/* subdirs that
  // share filenames (otherwise an empty deleted/diary.csv clobbers real data).
  const root = (basename: string) => (name: string) => name === basename

  const diaryText = findCsv(root('diary.csv'))
  const reviewsText = findCsv(root('reviews.csv'))
  const ratingsText = findCsv(root('ratings.csv'))
  const watchedText = findCsv(root('watched.csv'))
  const watchlistText = findCsv(root('watchlist.csv'))
  const likesText = findCsv(name => name === 'likes/films.csv' || name.endsWith('/likes/films.csv'))
  const profileText = findCsv(root('profile.csv'))

  const getOrCreate = (name: string, yearStr: string): RawImportItem => {
    const k = lbKey(name, yearStr)
    let it = map.get(k)
    if (!it) {
      it = blankItem({
        title: name,
        year: yearStr ? parseInt(yearStr) : null,
        mediaType: 'movie',
        status: 'watched',
      })
      map.set(k, it)
    }
    return it
  }

  // diary.csv - one row = one play.
  if (diaryText) {
    for (const row of parseCSV(diaryText)) {
      if (!row['Name']) continue
      const it = getOrCreate(row['Name'], row['Year'])
      const rating = lbRatingTo10(row['Rating'])
      it.plays.push({
        watchedAt: lbWatchedDate(row),
        rating,
        review: '',
        tags: lbTags(row['Tags']),
        isRewatch: (row['Rewatch'] ?? '').toLowerCase() === 'yes',
      })
      if (rating !== null) it.userRating = rating
    }
  }

  // reviews.csv - attach review (and any review-only fields) to its matching
  // diary play. If no match, create a new play row.
  if (reviewsText) {
    for (const row of parseCSV(reviewsText)) {
      if (!row['Name']) continue
      const it = getOrCreate(row['Name'], row['Year'])
      const watchedAt = lbWatchedDate(row)
      const rating = lbRatingTo10(row['Rating'])
      const review = (row['Review'] ?? '').trim()
      const tags = lbTags(row['Tags'])
      const isRewatch = (row['Rewatch'] ?? '').toLowerCase() === 'yes'

      const idx = watchedAt ? it.plays.findIndex(p => p.watchedAt === watchedAt) : -1
      if (idx >= 0) {
        const p = it.plays[idx]
        if (review && !p.review) p.review = review
        if (rating !== null && p.rating === null) p.rating = rating
        if (tags.length && !p.tags.length) p.tags = tags
        if (isRewatch && !p.isRewatch) p.isRewatch = isRewatch
      } else {
        it.plays.push({ watchedAt, rating, review, tags, isRewatch })
      }
      if (review && !it.review) it.review = review
      if (rating !== null) it.userRating = rating
    }
  }

  // watched.csv - ensures every watched film has an entry, even if it never
  // hit the diary (e.g. bulk-marked watched).
  if (watchedText) {
    for (const row of parseCSV(watchedText)) {
      if (!row['Name']) continue
      getOrCreate(row['Name'], row['Year'])
    }
  }

  // ratings.csv - Date here is the rating date (not a watch). Only set rating.
  if (ratingsText) {
    for (const row of parseCSV(ratingsText)) {
      if (!row['Name']) continue
      const rating = lbRatingTo10(row['Rating'])
      if (rating === null) continue
      const it = getOrCreate(row['Name'], row['Year'])
      if (it.userRating === null) it.userRating = rating
    }
  }

  // watchlist.csv - only include items not already watched.
  if (watchlistText) {
    for (const row of parseCSV(watchlistText)) {
      if (!row['Name']) continue
      const k = lbKey(row['Name'], row['Year'])
      if (map.has(k)) continue
      const addedAt = parseImportDate(row['Date'])
      watchlistItems.push(blankItem({
        title: row['Name'],
        year: row['Year'] ? parseInt(row['Year']) : null,
        mediaType: 'movie',
        status: 'watchlist',
        listedAt: !isNaN(addedAt) ? addedAt : null,
      }))
    }
  }

  // likes/films.csv - built as a "Liked Films" custom list.
  if (likesText) {
    const items: ParsedListItem[] = []
    for (const row of parseCSV(likesText)) {
      if (!row['Name']) continue
      items.push({
        mediaType: 'movie',
        tmdbId: null,
        title: row['Name'],
        year: row['Year'] ? parseInt(row['Year']) : null,
        notes: null,
      })
    }
    if (items.length > 0) {
      lists.push({
        name: 'Liked Films',
        description: 'Films you liked on Letterboxd',
        createdAt: new Date().toISOString(),
        items,
      })
    }
  }

  // lists/*.csv - user's custom lists. Each file has a metadata section then
  // an items section, separated by a blank line.
  for (const [path, content] of Object.entries(files)) {
    const np = norm(path)
    if (!/(^|\/)lists\/[^/]+\.csv$/.test(np)) continue
    const split = splitOnBlankLine(content)
    if (!split) continue
    const metaRows = parseCSV(split[0])
    const itemRows = parseCSV(split[1])
    if (metaRows.length === 0 || itemRows.length === 0) continue
    const meta = metaRows[0]
    const items: ParsedListItem[] = []
    for (const row of itemRows) {
      if (!row['Name']) continue
      items.push({
        mediaType: 'movie',
        tmdbId: null,
        title: row['Name'],
        year: row['Year'] ? parseInt(row['Year']) : null,
        notes: (row['Description'] ?? '').trim() || null,
      })
    }
    if (items.length === 0) continue
    const fallbackName = np.split('/').pop()?.replace(/\.csv$/i, '') ?? 'Letterboxd List'
    lists.push({
      name: meta['Name']?.trim() || fallbackName,
      description: meta['Description'] ?? '',
      createdAt: meta['Date'] || new Date().toISOString(),
      items,
    })
  }

  // profile.csv - capture username for the profile import step.
  if (profileText) {
    const rows = parseCSV(profileText)
    if (rows.length > 0 && rows[0]['Username']) {
      profile = { username: rows[0]['Username'] }
    }
  }

  return {
    items: [...map.values(), ...watchlistItems],
    source: 'letterboxd',
    errors,
    lists,
    collectionItems: [],
    profile,
  }
}

// ─── Trakt ────────────────────────────────────────────────────────────────────

interface TraktIds { tmdb?: number; trakt?: number; imdb?: string; slug?: string }
interface TraktMovie { title: string; year: number; ids: TraktIds }
interface TraktShow { title: string; year: number; ids: TraktIds; aired_episodes?: number }
interface TraktEpisode { season: number; number: number; title?: string; ids?: TraktIds }
interface TraktSeason { number: number; ids?: TraktIds; aired_episodes?: number }

interface TraktHistoryEvent {
  id: number
  watched_at: string
  action: string
  type: 'movie' | 'episode'
  movie?: TraktMovie
  episode?: TraktEpisode
  show?: TraktShow
}
interface TraktRatingEntry {
  rated_at: string
  rating: number
  type: 'movie' | 'show' | 'episode' | 'season'
  movie?: TraktMovie
  show?: TraktShow
  episode?: TraktEpisode
  season?: TraktSeason
}
interface TraktNoteEntry {
  type: string
  movie?: TraktMovie
  show?: TraktShow
  episode?: TraktEpisode
  season?: TraktSeason
  note?: { notes: string }
}
interface TraktWatchlistEntry {
  listed_at?: string
  type: 'movie' | 'show' | 'episode' | 'season'
  movie?: TraktMovie
  show?: TraktShow
  notes: string | null
}
interface TraktListMeta {
  name: string
  description?: string
  created_at: string
  ids?: { slug?: string; trakt?: number }
}
interface TraktListItem {
  type: 'movie' | 'show' | 'episode' | 'season' | 'person'
  movie?: TraktMovie
  show?: TraktShow
  notes: string | null
}
interface TraktCollectionEpisode {
  number: number
  collected_at?: string
  metadata?: { media_type?: string; resolution?: string }
}
interface TraktCollectionEntry {
  type?: string
  movie?: TraktMovie
  show?: TraktShow
  episode?: TraktEpisode
  collected_at?: string
  last_collected_at?: string
  metadata?: { media_type?: string; resolution?: string }
  seasons?: Array<{ number: number; episodes: TraktCollectionEpisode[] }>
}

function safeJson<T>(text: string, label: string, errors: string[]): T | null {
  if (!text) return null
  try { return JSON.parse(text) as T }
  catch { errors.push(`Could not parse ${label}`); return null }
}

function traktKey(mediaType: 'movie' | 'tv', tmdbId: number): string {
  return `${mediaType}:${tmdbId}`
}


/**
 * Map a Trakt list/favorites payload to ParsedListItems. Episode and season
 * entries collapse to their parent show - Cinemate's lists track shows, not
 * individual episodes. Duplicate parents (e.g. many episodes of the same
 * show in a yearly list) are deduped.
 */
function collectTraktListItems(arr: TraktListItem[]): ParsedListItem[] {
  const items: ParsedListItem[] = []
  const seen = new Set<string>()
  const push = (mt: 'movie' | 'tv', media: TraktMovie | TraktShow, notes: string | null) => {
    if (!media.ids?.tmdb) return
    const key = `${mt}:${media.ids.tmdb}`
    if (seen.has(key)) return
    seen.add(key)
    items.push({
      mediaType: mt,
      tmdbId: media.ids.tmdb,
      title: media.title,
      year: media.year ?? null,
      notes,
    })
  }
  for (const it of arr) {
    if (it.type === 'movie' && it.movie) push('movie', it.movie, it.notes ?? null)
    else if ((it.type === 'show' || it.type === 'season' || it.type === 'episode') && it.show) {
      push('tv', it.show, it.notes ?? null)
    }
  }
  return items
}

function inferFormat(metadata?: { media_type?: string; resolution?: string }): CollectionFormat {
  const mt = metadata?.media_type?.toLowerCase()
  const res = metadata?.resolution?.toLowerCase() ?? ''
  if (mt === 'bluray' || mt === 'blu-ray' || mt === 'hddvd') {
    return res.includes('uhd') || res.includes('4k') ? '4k' : 'blu-ray'
  }
  if (mt === 'dvd') return 'dvd'
  if (mt === 'digital') return 'digital'
  if (mt === 'vhs') return 'vhs'
  return 'other'
}

/**
 * Trakt's export is JSON-based with tmdb ids on every record, so we use those
 * directly (no fuzzy search needed). The paginated `watched-history-*.json`
 * files are the SOLE source of truth for the user's watch history: every
 * individual play of every movie and episode, each with a real timestamp and
 * the full media object (title/year/ids/aired_episodes).
 *
 * watched-movies.json / watched-shows.json are deliberately NOT used. They only
 * carry lifetime `plays` counts and a single `last_watched_at`, which can't
 * reconstruct per-play dates - mixing them in is what corrupted rewatch
 * tracking before. (A capped/broken export will simply contain less history;
 * we never fabricate plays to paper over that.)
 */
export function parseTraktFiles(files: Record<string, string>): ParsedImport {
  const errors: string[] = []
  const map = new Map<string, RawImportItem>()
  const watchlistItems: RawImportItem[] = []
  const lists: ParsedList[] = []
  let profile: ParsedImport['profile']

  const find = (basename: string): string => {
    if (files[basename] !== undefined) return files[basename]
    const lower = basename.toLowerCase()
    const k = Object.keys(files).find(p => {
      const np = p.replace(/\\/g, '/').toLowerCase()
      return np === lower || np.endsWith('/' + lower)
    })
    return k ? files[k] : ''
  }

  // Trakt paginates large datasets into <basename>-1.json, <basename>-2.json
  // etc. Concatenate every page so we don't lose plays just because the
  // export got split.
  const findPaginatedArray = <T>(basename: string, label: string): T[] | null => {
    const stem = basename.replace(/\.json$/i, '')
    const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`^${escaped}(?:-\\d+)?\\.json$`, 'i')
    const contents: string[] = []
    for (const [path, content] of Object.entries(files)) {
      const fname = path.replace(/\\/g, '/').split('/').pop() ?? path
      if (re.test(fname)) contents.push(content)
    }
    if (contents.length === 0) return null
    const merged: T[] = []
    for (const text of contents) {
      const arr = safeJson<T[]>(text, label, errors)
      if (Array.isArray(arr)) merged.push(...arr)
    }
    return merged
  }

  const watchedHistory = findPaginatedArray<TraktHistoryEvent>('watched-history.json', 'watched-history.json')

  // All array-shaped Trakt exports paginate into `<basename>-1.json`,
  // `<basename>-2.json`, ... for heavy users. Use findPaginatedArray so we
  // don't silently drop everything past page 1.
  const ratingsMovies = findPaginatedArray<TraktRatingEntry>('ratings-movies.json', 'ratings-movies.json')
  const ratingsShows = findPaginatedArray<TraktRatingEntry>('ratings-shows.json', 'ratings-shows.json')
  const ratingsEpisodes = findPaginatedArray<TraktRatingEntry>('ratings-episodes.json', 'ratings-episodes.json')
  const ratingsSeasons = findPaginatedArray<TraktRatingEntry>('ratings-seasons.json', 'ratings-seasons.json')

  const notesMovies = findPaginatedArray<TraktNoteEntry>('notes-movies.json', 'notes-movies.json')
  const notesShows = findPaginatedArray<TraktNoteEntry>('notes-shows.json', 'notes-shows.json')
  const notesEpisodes = findPaginatedArray<TraktNoteEntry>('notes-episodes.json', 'notes-episodes.json')

  const watchlistEntries = findPaginatedArray<TraktWatchlistEntry>('lists-watchlist.json', 'lists-watchlist.json')
  const favoritesEntries = findPaginatedArray<TraktListItem>('lists-favorites.json', 'lists-favorites.json')
  const listsMeta = findPaginatedArray<TraktListMeta>('lists-lists.json', 'lists-lists.json')

  const collectionMovies = findPaginatedArray<TraktCollectionEntry>('collection-movies.json', 'collection-movies.json')
  const collectionShows = findPaginatedArray<TraktCollectionEntry>('collection-shows.json', 'collection-shows.json')
  const collectionEpisodes = findPaginatedArray<TraktCollectionEntry>('collection-episodes.json', 'collection-episodes.json')

  const userProfile = safeJson<{ username?: string }>(find('user-profile.json'), 'user-profile.json', errors)
  if (userProfile?.username) profile = { username: userProfile.username }

  // ── Build the watch history from the watched-history pages ───────────────
  // Group every play by its media's tmdb id, keeping a representative media
  // object (for title/year/aired_episodes) alongside the play timestamps.
  // This is the only place watch dates come from.
  const movieHistory = new Map<number, { movie: TraktMovie; dates: string[] }>()
  const showHistory = new Map<number, { show: TraktShow; episodes: Map<string, string[]> }>()
  if (watchedHistory) {
    for (const ev of watchedHistory) {
      if (ev.type === 'movie' && ev.movie?.ids?.tmdb) {
        const id = ev.movie.ids.tmdb
        let e = movieHistory.get(id)
        if (!e) { e = { movie: ev.movie, dates: [] }; movieHistory.set(id, e) }
        e.dates.push(ev.watched_at)
      } else if (ev.type === 'episode' && ev.show?.ids?.tmdb && ev.episode) {
        const id = ev.show.ids.tmdb
        let e = showHistory.get(id)
        if (!e) { e = { show: ev.show, episodes: new Map() }; showHistory.set(id, e) }
        // Keep the most complete show snapshot (highest aired_episodes).
        if ((ev.show.aired_episodes ?? 0) > (e.show.aired_episodes ?? 0)) e.show = ev.show
        const key = `${ev.episode.season}:${ev.episode.number}`
        const arr = e.episodes.get(key)
        if (arr) arr.push(ev.watched_at)
        else e.episodes.set(key, [ev.watched_at])
      }
    }
    const byTime = (a: string, b: string) => new Date(a).getTime() - new Date(b).getTime()
    for (const e of movieHistory.values()) e.dates.sort(byTime)
    for (const e of showHistory.values()) for (const arr of e.episodes.values()) arr.sort(byTime)
  }

  // ── Index ratings + notes by (show, ep) and tmdb id ─────────────────────
  const epRatings: Record<number, Record<string, number>> = {}
  if (ratingsEpisodes) {
    for (const r of ratingsEpisodes) {
      if (!r.show?.ids?.tmdb || !r.episode) continue
      const m = (epRatings[r.show.ids.tmdb] ??= {})
      m[`${r.episode.season}:${r.episode.number}`] = r.rating
    }
  }
  const seasonRatings: Record<number, Record<number, number>> = {}
  if (ratingsSeasons) {
    for (const r of ratingsSeasons) {
      if (!r.show?.ids?.tmdb || !r.season) continue
      ;(seasonRatings[r.show.ids.tmdb] ??= {})[r.season.number] = r.rating
    }
  }
  const epNotes: Record<number, Record<string, string>> = {}
  if (notesEpisodes) {
    for (const n of notesEpisodes) {
      if (!n.show?.ids?.tmdb || !n.episode || !n.note?.notes) continue
      const m = (epNotes[n.show.ids.tmdb] ??= {})
      m[`${n.episode.season}:${n.episode.number}`] = n.note.notes
    }
  }
  const movieNotes: Record<number, string> = {}
  if (notesMovies) {
    for (const n of notesMovies) {
      if (!n.movie?.ids?.tmdb || !n.note?.notes) continue
      movieNotes[n.movie.ids.tmdb] = n.note.notes
    }
  }
  const showNotes: Record<number, string> = {}
  if (notesShows) {
    for (const n of notesShows) {
      if (!n.show?.ids?.tmdb || !n.note?.notes) continue
      showNotes[n.show.ids.tmdb] = n.note.notes
    }
  }

  // ── Watched movies (built from history) ──────────────────────────────────
  for (const { movie, dates } of movieHistory.values()) {
    const tmdbId = movie.ids?.tmdb
    if (!tmdbId) continue
    const it = blankItem({
      title: movie.title,
      year: movie.year ?? null,
      tmdbId,
      mediaType: 'movie',
      status: 'watched',
      review: movieNotes[tmdbId] ?? '',
    })
    // Dates are sorted ascending: the earliest play is the original watch,
    // every later play is a rewatch.
    it.plays = dates.map((d, i) => ({
      watchedAt: d,
      rating: null,
      review: '',
      tags: [],
      isRewatch: i > 0,
    }))
    map.set(traktKey('movie', tmdbId), it)
  }

  // ── Watched shows (built from history) ───────────────────────────────────
  for (const { show, episodes } of showHistory.values()) {
    const tmdbId = show.ids?.tmdb
    if (!tmdbId) continue
    const it = blankItem({
      title: show.title,
      year: show.year ?? null,
      tmdbId,
      mediaType: 'tv',
      status: 'in_progress',
      review: showNotes[tmdbId] ?? '',
      airedEpisodes: show.aired_episodes ?? null,
    })

    const ratingsForShow = epRatings[tmdbId] ?? {}
    const notesForShow = epNotes[tmdbId] ?? {}
    let totalWatched = 0

    // Each distinct episode key carries every one of its plays (repeat plays
    // are rewatches); sorted ascending so the first play reads as the original.
    for (const [key, dates] of episodes) {
      it.episodes[key] = {
        rating: ratingsForShow[key] ?? null,
        note: notesForShow[key] ?? '',
        plays: dates.map(d => ({ watchedAt: d })),
      }
      totalWatched++
    }
    const sr = seasonRatings[tmdbId]
    if (sr) it.seasonRatings = { ...sr }

    // A show counts as fully watched once watched episodes reach the aired
    // count (specials can push the total over, hence >=).
    if (it.airedEpisodes && totalWatched >= it.airedEpisodes) {
      it.status = 'watched'
    }
    map.set(traktKey('tv', tmdbId), it)
  }

  // ── Movie ratings (creates rated-but-not-watched entries) ───────────────
  if (ratingsMovies) {
    for (const r of ratingsMovies) {
      const tmdbId = r.movie?.ids?.tmdb
      if (!tmdbId || !r.movie) continue
      const k = traktKey('movie', tmdbId)
      const existing = map.get(k)
      if (existing) {
        if (existing.userRating === null) existing.userRating = r.rating
      } else {
        map.set(k, blankItem({
          title: r.movie.title,
          year: r.movie.year ?? null,
          tmdbId,
          mediaType: 'movie',
          status: 'watched',
          userRating: r.rating,
          review: movieNotes[tmdbId] ?? '',
        }))
      }
    }
  }

  // ── Show ratings ────────────────────────────────────────────────────────
  if (ratingsShows) {
    for (const r of ratingsShows) {
      const tmdbId = r.show?.ids?.tmdb
      if (!tmdbId || !r.show) continue
      const k = traktKey('tv', tmdbId)
      const existing = map.get(k)
      if (existing) {
        if (existing.userRating === null) existing.userRating = r.rating
      } else {
        map.set(k, blankItem({
          title: r.show.title,
          year: r.show.year ?? null,
          tmdbId,
          mediaType: 'tv',
          status: 'in_progress',
          userRating: r.rating,
          airedEpisodes: r.show.aired_episodes ?? null,
          review: showNotes[tmdbId] ?? '',
        }))
      }
    }
  }

  // ── Watchlist ───────────────────────────────────────────────────────────
  // Episodes/seasons on the watchlist map to the parent show - Cinemate's
  // library entries are at the show level, not episode level.
  if (watchlistEntries) {
    const seenWatchlistTmdb = new Set<string>()
    for (const w of watchlistEntries) {
      let mt: 'movie' | 'tv'
      let media: TraktMovie | TraktShow | undefined
      if (w.type === 'movie') {
        mt = 'movie'
        media = w.movie
      } else if (w.type === 'show' || w.type === 'season' || w.type === 'episode') {
        mt = 'tv'
        media = w.show
      } else {
        continue
      }
      if (!media?.ids?.tmdb) continue
      const k = traktKey(mt, media.ids.tmdb)
      if (map.has(k) || seenWatchlistTmdb.has(k)) continue
      seenWatchlistTmdb.add(k)
      watchlistItems.push(blankItem({
        title: media.title,
        year: media.year ?? null,
        tmdbId: media.ids.tmdb,
        mediaType: mt,
        status: 'watchlist',
        listedAt: w.listed_at ? new Date(w.listed_at).getTime() : null,
      }))
    }
  }

  // ── Lists (paginated: lists-list-{id}-slug.json or -slug-N.json) ────────
  if (listsMeta) {
    const filesByListId: Record<number, string[]> = {}
    for (const [path, content] of Object.entries(files)) {
      const fname = path.replace(/\\/g, '/').split('/').pop() ?? path
      const m = fname.match(/^lists-list-(\d+)-/i)
      if (!m) continue
      const id = parseInt(m[1])
      ;(filesByListId[id] ??= []).push(content)
    }

    for (const meta of listsMeta) {
      const traktId = meta.ids?.trakt
      if (!traktId) continue
      const contents = filesByListId[traktId] ?? []
      if (contents.length === 0) continue

      const items = collectTraktListItems(contents.flatMap(text => {
        const arr = safeJson<TraktListItem[]>(text, `list ${meta.name}`, errors)
        return Array.isArray(arr) ? arr : []
      }))
      if (items.length > 0) {
        lists.push({
          name: meta.name,
          description: meta.description ?? '',
          createdAt: meta.created_at,
          items,
        })
      }
    }
  }

  // ── Favorites list ──────────────────────────────────────────────────────
  if (favoritesEntries && favoritesEntries.length > 0) {
    const items = collectTraktListItems(favoritesEntries)
    if (items.length > 0) {
      lists.push({
        name: 'Favorites',
        description: 'Your Trakt favorites',
        createdAt: new Date().toISOString(),
        items,
      })
    }
  }

  // ── Collection ──────────────────────────────────────────────────────────
  const collectionItems: ParsedCollectionItem[] = []
  const seenInCollection = new Set<string>()

  if (collectionMovies) {
    for (const c of collectionMovies) {
      const tmdbId = c.movie?.ids?.tmdb
      if (!tmdbId || !c.movie) continue
      const k = traktKey('movie', tmdbId)
      if (seenInCollection.has(k)) continue
      seenInCollection.add(k)
      collectionItems.push({
        title: c.movie.title,
        year: c.movie.year ?? null,
        tmdbId,
        mediaType: 'movie',
        format: inferFormat(c.metadata),
        purchasedDate: c.collected_at ?? null,
        notes: '',
      })
    }
  }
  if (collectionShows) {
    for (const c of collectionShows) {
      const tmdbId = c.show?.ids?.tmdb
      if (!tmdbId || !c.show) continue
      const k = traktKey('tv', tmdbId)
      if (seenInCollection.has(k)) continue
      seenInCollection.add(k)
      const firstMeta = c.seasons?.[0]?.episodes?.[0]?.metadata
      collectionItems.push({
        title: c.show.title,
        year: c.show.year ?? null,
        tmdbId,
        mediaType: 'tv',
        format: inferFormat(firstMeta),
        purchasedDate: c.last_collected_at ?? null,
        notes: '',
      })
    }
  }
  if (collectionEpisodes) {
    for (const c of collectionEpisodes) {
      const tmdbId = c.show?.ids?.tmdb
      if (!tmdbId || !c.show) continue
      const k = traktKey('tv', tmdbId)
      if (seenInCollection.has(k)) continue
      seenInCollection.add(k)
      collectionItems.push({
        title: c.show.title,
        year: c.show.year ?? null,
        tmdbId,
        mediaType: 'tv',
        format: inferFormat(c.metadata),
        purchasedDate: c.collected_at ?? null,
        notes: '',
      })
    }
  }

  return {
    items: [...map.values(), ...watchlistItems],
    source: 'trakt',
    errors,
    lists,
    collectionItems,
    profile,
  }
}

// ─── History CSV ────────────────────────────────────────────────────────────────

// ISO 8601: a date, optionally followed by a time and zone. Anything that isn't
// ISO 8601 (e.g. a US-style date) is rejected so a row never imports a bogus
// timestamp.
const ISO_8601 =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/

/**
 * A flat watch-history CSV (one row per play). This importer is deliberately
 * history-only - it reconstructs the user's watch history and nothing else (no
 * watchlist, lists, collection, ratings, notes, genres or runtime).
 *
 * Only these columns are read:
 *   - `watched_at`  ISO 8601 datetime (rows in any other format are skipped)
 *   - `type`        'movie' | 'episode'
 *   - `tmdb_id`     the movie's id (movie rows) OR the parent SHOW's id (episode rows)
 *   - `season_number` / `episode_number`  episode rows only - together they form the
 *                   "s:e" key. The per-episode `episode_tmdb_id` is intentionally
 *                   ignored: episodes are keyed by their parent show's tmdb id +
 *                   season:episode, exactly like the rest of the app.
 *
 * `title`/`year` are read solely as a display fallback (shown in the progress and
 * failed lists); the import loop overwrites both from TMDb, so they never decide
 * what gets imported. Every movie row becomes a 'watched' play; shows arrive as
 * 'in_progress' (the CSV has no aired-episode count) and the import loop promotes
 * them to 'watched' once every episode TMDb knows about has been logged.
 */
export function parseHistoryCsv(text: string): ParsedImport {
  const errors: string[] = []
  const rows = parseCSV(text.replace(/^﻿/, ''))  // strip a leading BOM (Excel CSVs)

  const isValidIso = (s: string) => ISO_8601.test(s) && !isNaN(new Date(s).getTime())

  const movies = new Map<number, { title: string; year: number | null; dates: string[] }>()
  const shows = new Map<number, { title: string; year: number | null; episodes: Map<string, string[]> }>()
  let skipped = 0

  for (const row of rows) {
    const type = (row['type'] ?? '').trim().toLowerCase()
    const watchedAt = (row['watched_at'] ?? '').trim()
    const tmdbId = parseInt(row['tmdb_id'] ?? '', 10)
    const title = (row['title'] ?? '').trim()
    const yearNum = parseInt(row['year'] ?? '', 10)
    const year = isNaN(yearNum) ? null : yearNum

    if (!isValidIso(watchedAt) || isNaN(tmdbId)) { skipped++; continue }

    if (type === 'movie') {
      let e = movies.get(tmdbId)
      if (!e) { e = { title, year, dates: [] }; movies.set(tmdbId, e) }
      e.dates.push(watchedAt)
    } else if (type === 'episode') {
      const season = parseInt(row['season_number'] ?? '', 10)
      const episode = parseInt(row['episode_number'] ?? '', 10)
      if (isNaN(season) || isNaN(episode)) { skipped++; continue }
      let e = shows.get(tmdbId)
      if (!e) { e = { title, year, episodes: new Map() }; shows.set(tmdbId, e) }
      const key = `${season}:${episode}`
      const arr = e.episodes.get(key)
      if (arr) arr.push(watchedAt)
      else e.episodes.set(key, [watchedAt])
    } else {
      skipped++
    }
  }

  const byTime = (a: string, b: string) => new Date(a).getTime() - new Date(b).getTime()
  const items: RawImportItem[] = []

  // Dates sorted ascending: the earliest play is the original watch, every later
  // play is a rewatch - matching how the Trakt importer builds history.
  for (const [tmdbId, e] of movies) {
    e.dates.sort(byTime)
    const it = blankItem({ title: e.title || `Movie ${tmdbId}`, year: e.year, tmdbId, mediaType: 'movie', status: 'watched' })
    it.plays = e.dates.map((d, i) => ({ watchedAt: d, rating: null, review: '', tags: [], isRewatch: i > 0 }))
    items.push(it)
  }

  for (const [tmdbId, e] of shows) {
    const it = blankItem({ title: e.title || `Show ${tmdbId}`, year: e.year, tmdbId, mediaType: 'tv', status: 'in_progress' })
    for (const [key, dates] of e.episodes) {
      dates.sort(byTime)
      it.episodes[key] = { rating: null, note: '', plays: dates.map(d => ({ watchedAt: d })) }
    }
    items.push(it)
  }

  if (skipped > 0) {
    errors.push(`Skipped ${skipped} row${skipped === 1 ? '' : 's'} with a missing/invalid date, TMDb id, or type.`)
  }

  return { items, source: 'csv', errors, lists: [], collectionItems: [] }
}

/**
 * A flat watchlist CSV (one row per watchlisted title). Like the history CSV this
 * is single-purpose: it only adds items to the watchlist and reads nothing else
 * (no ratings, notes, genres, runtime, plays).
 *
 * Only these columns are read:
 *   - `listed_at`   ISO 8601 datetime the item was added (used as addedDate; a
 *                   missing/non-ISO value just falls back to import time)
 *   - `type`        'movie' | 'show' | 'episode'
 *   - `tmdb_id`     the movie's id, or for show/episode rows the parent SHOW's id
 *   - `season_number` / `episode_number`  episode rows only - validated so a
 *                   malformed episode row is skipped. Cinemate watchlists at the
 *                   movie/show level, so an episode entry maps to its parent show
 *                   (its `tmdb_id`); the per-episode `episode_tmdb_id` is unused.
 *
 * `title`/`year` are read only as a display fallback (the import loop overwrites
 * both from TMDb). Entries are deduped by movie/show so a show listed via several
 * episodes lands on the watchlist once.
 */
export function parseWatchlistCsv(text: string): ParsedImport {
  const errors: string[] = []
  const rows = parseCSV(text.replace(/^﻿/, ''))  // strip a leading BOM (Excel CSVs)

  const seen = new Set<string>()
  const items: RawImportItem[] = []
  let skipped = 0

  for (const row of rows) {
    const type = (row['type'] ?? '').trim().toLowerCase()
    const tmdbId = parseInt(row['tmdb_id'] ?? '', 10)
    if (isNaN(tmdbId)) { skipped++; continue }

    // movie | show | episode. Shows and (parent-mapped) episodes are 'tv'; the
    // per-episode/season ids are irrelevant since the watchlist is show-level.
    let mediaType: 'movie' | 'tv'
    if (type === 'movie') {
      mediaType = 'movie'
    } else if (type === 'show') {
      mediaType = 'tv'
    } else if (type === 'episode') {
      const season = parseInt(row['season_number'] ?? '', 10)
      const episode = parseInt(row['episode_number'] ?? '', 10)
      if (isNaN(season) || isNaN(episode)) { skipped++; continue }
      mediaType = 'tv'
    } else {
      skipped++
      continue
    }

    const key = `${mediaType}:${tmdbId}`
    if (seen.has(key)) continue
    seen.add(key)

    // listed_at is the add timestamp; take it only when it's ISO 8601, otherwise
    // leave it null and let the import fall back to the current time.
    const listedAtRaw = (row['listed_at'] ?? '').trim()
    const listedAt = ISO_8601.test(listedAtRaw) && !isNaN(new Date(listedAtRaw).getTime())
      ? new Date(listedAtRaw).getTime()
      : null

    const title = (row['title'] ?? '').trim()
    const yearNum = parseInt(row['year'] ?? '', 10)

    items.push(blankItem({
      title: title || (mediaType === 'movie' ? `Movie ${tmdbId}` : `Show ${tmdbId}`),
      year: isNaN(yearNum) ? null : yearNum,
      tmdbId,
      mediaType,
      status: 'watchlist',
      listedAt,
    }))
  }

  if (skipped > 0) {
    errors.push(`Skipped ${skipped} row${skipped === 1 ? '' : 's'} with a missing/invalid TMDb id or type.`)
  }

  return { items, source: 'csv-watchlist', errors, lists: [], collectionItems: [] }
}
