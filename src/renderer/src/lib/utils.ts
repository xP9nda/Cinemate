import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNow, parseISO } from 'date-fns'
import type { LibraryEntry, PaginationSettings } from '../types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Default page size per paginated view. 0 in settings means "show all".
export const DEFAULT_PAGINATION: PaginationSettings = {
  library: 50,
  log: 50,
  lists: 50,
  listItems: 100,
  collection: 50,
}

// Page-size options offered in Settings. '0' (-> All) disables paging.
export const PAGE_SIZE_OPTIONS = [25, 50, 100, 200, 0] as const

// Resolve a stored pagination value to an effective limit. A missing value
// falls back to the default; 0 (or negative) means "no limit" -> Infinity, so
// `slice(0, limit)` returns everything and "Load More" never appears.
export function resolvePageSize(size: number | undefined, fallback: number): number {
  const n = size ?? fallback
  return n <= 0 ? Infinity : n
}

export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

export function posterUrl(path: string | null | undefined, size: 'w92' | 'w185' | 'w300' | 'w500' | 'original' = 'w300'): string {
  if (!path) return ''
  return `${TMDB_IMAGE_BASE}/${size}${path}`
}

export function backdropUrl(path: string | null | undefined, size: 'w300' | 'w780' | 'w1280' | 'original' = 'w1280'): string {
  if (!path) return ''
  return `${TMDB_IMAGE_BASE}/${size}${path}`
}

export function profileUrl(path: string | null | undefined, size: 'w45' | 'w185' | 'h632' = 'w185'): string {
  if (!path) return ''
  return `${TMDB_IMAGE_BASE}/${size}${path}`
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

export function fmtDate(dt: string | number | null | undefined, fmt = 'MMM d, yyyy'): string {
  if (!dt) return ''
  try {
    const d = typeof dt === 'number' ? new Date(dt) : parseISO(dt as string)
    return format(d, fmt)
  } catch {
    return ''
  }
}

export function fmtRelative(dt: string | number | null | undefined): string {
  if (!dt) return ''
  try {
    const d = typeof dt === 'number' ? new Date(dt) : parseISO(dt as string)
    return formatDistanceToNow(d, { addSuffix: true })
  } catch {
    return ''
  }
}

export function fmtRuntime(minutes: number | null | undefined): string {
  if (!minutes) return ''
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

export function fmtRating(r: number | null | undefined, system: '10star' | '5star' = '10star'): string {
  if (r == null) return 'N/A'
  if (system === '5star') return `${r}/5`
  return `${r}/10`
}

// The single canonical rating for whatever a watch-history play / list row refers
// to: an episode's own rating (tvProgress[epKey].rating) when episodeKey is given,
// otherwise the title's overall rating (userRating). Ratings live only on the
// library entry - plays never carry one - so every "rating to show for this row"
// read goes through here instead of re-inlining the branch.
export function effectiveRating(
  entry: LibraryEntry | null | undefined,
  episodeKey?: string | null,
): number | null {
  if (!entry) return null
  if (episodeKey) return entry.tvProgress?.[episodeKey]?.rating ?? null
  return entry.userRating ?? null
}

export function releaseYear(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null
  const year = parseInt(dateStr.slice(0, 4), 10)
  return isNaN(year) ? null : year
}

// Date-only 'YYYY-MM-DD' strings (TMDb release_date, Letterboxd diary, Trakt
// date-only fields) parse to UTC midnight via `new Date(s)`, which shifts the
// calendar day backward in negative-UTC zones. Treat date-only as LOCAL
// midnight so downstream `getFullYear/getMonth/getDay` return the user's day.
export function parseImportDate(value: string | null | undefined): number {
  if (!value) return NaN
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(value + 'T00:00:00').getTime()
  }
  return new Date(value).getTime()
}

export function dayFloor(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// Epoch ms for a stored/imported date string, or null if absent/unparseable.
// Uses parseImportDate so date-only values stay on the user's local calendar day,
// and guards the many rating-time reads against a NaN silently poisoning a chart
// bucket (NaN.getFullYear() etc).
export function parseDateMs(s: string | null | undefined): number | null {
  if (!s) return null
  const t = parseImportDate(s)
  return Number.isNaN(t) ? null : t
}

// Approximate when an entry's rating happened when no explicit timestamp is
// stored: its most recent watch date, else when it was added. Shared by the Stats
// "Average Rating Over Time" chart and the store's one-time rating-timestamp
// backfill so the two approximations never drift apart.
export function ratingDateProxy(entry: { watchedDate: string | null; addedDate: number }): number {
  return parseDateMs(entry.watchedDate) ?? entry.addedDate
}

export function nowLocalDT(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    watched: 'Watched',
    watchlist: 'Watchlist',
    in_progress: 'In Progress',
    dropped: 'Dropped',
  }
  return map[status] ?? status
}

export function statusColor(status: string): string {
  const map: Record<string, string> = {
    watched: 'text-success',
    watchlist: 'text-info',
    in_progress: 'text-warning',
    dropped: 'text-destructive',
  }
  return map[status] ?? 'text-muted-foreground'
}

export function mediaLabel(type: string): string {
  const map: Record<string, string> = {
    movie: 'Movie',
    tv: 'TV Show',
    anime: 'Anime'
  }
  return map[type] ?? type
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debounce<T extends (...args: any[]) => any>(fn: T, ms: number): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>
  return (...args: Parameters<T>) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}
