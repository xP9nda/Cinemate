import { parseImportDate } from './utils'
import type {
  EpisodeProgress,
  LibraryEntry,
  ListRule,
  ListRules,
  ListScope,
  RuleField,
  RuleOperator,
  WatchHistoryEntry,
} from '../types'

export interface EpisodeContext {
  key: string                       // "s:e"
  progress: EpisodeProgress | null
}

export const DEFAULT_SCOPE: ListScope = { movies: true, shows: true, episodes: false }

// Accepts the new object form, the legacy 'media' / 'episode' strings, or
// undefined and produces a usable ListScope.
export function normalizeScope(raw: unknown): ListScope {
  if (raw && typeof raw === 'object') {
    const s = raw as Partial<ListScope>
    return {
      movies: !!s.movies,
      shows: !!s.shows,
      episodes: !!s.episodes,
    }
  }
  if (raw === 'episode') return { movies: false, shows: false, episodes: true }
  return { ...DEFAULT_SCOPE }
}

function getYear(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null
  const t = typeof value === 'number' ? value : parseImportDate(value)
  if (!Number.isFinite(t)) return null
  const y = new Date(t).getFullYear()
  return Number.isFinite(y) ? y : null
}

function toNumber(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function compareNumeric(
  value: number | null,
  op: RuleOperator,
  target: number | null,
  target2: number | null
): boolean {
  if (value == null) return op === 'not_equals'
  if (target == null) return false
  switch (op) {
    case 'equals': return value === target
    case 'not_equals': return value !== target
    case 'gt': return value > target
    case 'gte': return value >= target
    case 'lt': return value < target
    case 'lte': return value <= target
    case 'between': {
      if (target2 == null) return false
      const lo = Math.min(target, target2)
      const hi = Math.max(target, target2)
      return value >= lo && value <= hi
    }
    default: return false
  }
}

function compareYears(
  years: number[],
  op: RuleOperator,
  target: number | null,
  target2: number | null,
  values: Array<string | number> | undefined
): boolean {
  if (op === 'is_set') return years.length > 0
  if (op === 'is_not_set') return years.length === 0
  if (op === 'in' || op === 'not_in') {
    const set = new Set((values ?? []).map((v) => Number(v)).filter((n) => Number.isFinite(n)))
    const hit = years.some((y) => set.has(y))
    return op === 'in' ? hit : !hit
  }
  if (target == null) return false
  if (op === 'equals') return years.includes(target)
  if (op === 'not_equals') return years.length === 0 || !years.includes(target)
  if (op === 'gt') return years.some((y) => y > target)
  if (op === 'gte') return years.some((y) => y >= target)
  if (op === 'lt') return years.some((y) => y < target)
  if (op === 'lte') return years.some((y) => y <= target)
  if (op === 'between') {
    if (target2 == null) return false
    const lo = Math.min(target, target2)
    const hi = Math.max(target, target2)
    return years.some((y) => y >= lo && y <= hi)
  }
  return false
}

function evalSetMembership(
  value: string,
  op: RuleOperator,
  rule: ListRule
): boolean {
  // An unconfigured single-value operator (rule.value missing) should not
  // match anything - otherwise `mediaType not_equals <empty>` matches the
  // entire library. Same for `in/not_in` with no chosen values.
  if (op === 'equals' || op === 'not_equals') {
    if (rule.value == null || rule.value === '') return false
    return op === 'equals' ? value === String(rule.value) : value !== String(rule.value)
  }
  if (op === 'in' || op === 'not_in') {
    const vals = (rule.values ?? []).map(String)
    if (vals.length === 0) return false
    return op === 'in' ? vals.includes(value) : !vals.includes(value)
  }
  return false
}

export function evaluateRule(
  entry: LibraryEntry,
  history: WatchHistoryEntry[],
  rule: ListRule,
  ep?: EpisodeContext
): boolean {
  const op = rule.operator
  const v = toNumber(rule.value)
  const v2 = toNumber(rule.value2)

  switch (rule.field) {
    case 'mediaType':
      return evalSetMembership(entry.mediaType, op, rule)

    case 'status':
      return evalSetMembership(entry.status, op, rule)

    case 'userRating': {
      // At episode scope, this rule targets the episode's rating, not the show's.
      const value = ep ? (ep.progress?.rating ?? null) : entry.userRating
      if (op === 'is_set') return value != null
      if (op === 'is_not_set') return value == null
      return compareNumeric(value, op, v, v2)
    }

    case 'releaseYear':
      if (op === 'is_set') return entry.releaseYear != null
      if (op === 'is_not_set') return entry.releaseYear == null
      return compareNumeric(entry.releaseYear, op, v, v2)

    case 'runtime':
      if (op === 'is_set') return entry.runtime != null
      if (op === 'is_not_set') return entry.runtime == null
      return compareNumeric(entry.runtime ?? null, op, v, v2)

    case 'addedYear': {
      const y = getYear(entry.addedDate)
      return compareYears(y == null ? [] : [y], op, v, v2, rule.values)
    }

    case 'watchedYear': {
      // At episode scope, use the episode's own watchedAt; else the show's.
      const source = ep ? (ep.progress?.watchedAt ?? null) : entry.watchedDate
      const y = getYear(source)
      return compareYears(y == null ? [] : [y], op, v, v2, rule.values)
    }

    case 'loggedYear': {
      const relevant = ep
        ? history.filter((h) => h.mediaId === entry.id && h.episodeKey === ep.key)
        : history.filter((h) => h.mediaId === entry.id)
      const years = Array.from(
        new Set(
          relevant
            .map((h) => getYear(h.watchedAt))
            .filter((y): y is number => y != null)
        )
      )
      return compareYears(years, op, v, v2, rule.values)
    }

    case 'genreId': {
      const genres = (entry.genreIds ?? []).map(String)
      if (op === 'equals' || op === 'not_equals') {
        if (rule.value == null || rule.value === '') return false
        const target = String(rule.value)
        return op === 'equals' ? genres.includes(target) : !genres.includes(target)
      }
      if (op === 'in' || op === 'not_in') {
        const vals = (rule.values ?? []).map(String)
        if (vals.length === 0) return false
        return op === 'in' ? vals.some((g) => genres.includes(g)) : !vals.some((g) => genres.includes(g))
      }
      return false
    }

    case 'hasReview': {
      const text = ep ? (ep.progress?.note ?? '') : entry.review
      const has = !!(text && text.trim())
      if (op === 'is_true') return has
      if (op === 'is_false') return !has
      return false
    }

    case 'playCount': {
      // At show/movie scope, only count whole-title plays - including the
      // per-episode entries here makes `playCount >= 2` falsely match any
      // show with two or more logged episodes.
      const count = ep
        ? history.filter((h) => h.mediaId === entry.id && h.episodeKey === ep.key).length
        : history.filter((h) => h.mediaId === entry.id && !h.episodeKey).length
      if (op === 'is_set') return count > 0
      if (op === 'is_not_set') return count === 0
      return compareNumeric(count, op, v, v2)
    }

    default:
      return false
  }
}

export function matchesRules(
  entry: LibraryEntry,
  history: WatchHistoryEntry[],
  rules: ListRules | undefined,
  ep?: EpisodeContext
): boolean {
  if (!rules || !rules.enabled || rules.rules.length === 0) return false
  const results = rules.rules.map((r) => evaluateRule(entry, history, r, ep))
  return rules.combinator === 'all' ? results.every(Boolean) : results.some(Boolean)
}

export function computeRuleItemIds(
  library: Record<string, LibraryEntry>,
  history: WatchHistoryEntry[],
  rules: ListRules | undefined
): string[] {
  if (!rules || !rules.enabled || rules.rules.length === 0) return []
  const scope = normalizeScope(rules.scope)
  if (!scope.movies && !scope.shows && !scope.episodes) return []

  const ids: string[] = []
  const wantShow = (e: LibraryEntry): boolean =>
    e.mediaType === 'movie' ? scope.movies : scope.shows

  for (const entry of Object.values(library)) {
    if (wantShow(entry) && matchesRules(entry, history, rules)) {
      ids.push(entry.id)
    }
    if (scope.episodes && entry.mediaType !== 'movie') {
      const progress = entry.tvProgress ?? {}
      const keys = new Set<string>(Object.keys(progress))
      for (const h of history) {
        if (h.mediaId === entry.id && h.episodeKey) keys.add(h.episodeKey)
      }
      for (const key of keys) {
        const ctx: EpisodeContext = { key, progress: progress[key] ?? null }
        if (matchesRules(entry, history, rules, ctx)) {
          ids.push(`${entry.id}::${key}`)
        }
      }
    }
  }

  // Preserve library iteration order (insertion order) - the view's sort
  // selector governs display order. Sorting ids lexicographically here made
  // 'movie:1000' precede 'movie:101' precede 'movie:9', which the user reads
  // as random. arraysEqualSet is order-independent, so recompute detection is
  // unaffected.
  return ids
}

export function arraysEqualSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  for (const v of b) if (!set.has(v)) return false
  return true
}

// ─── Metadata used by the UI editor ──────────────────────────────────────────

export interface FieldMeta {
  label: string
  operators: RuleOperator[]
  valueKind: 'number' | 'year' | 'rating' | 'select' | 'genre' | 'boolean' | 'none'
  selectOptions?: Array<{ value: string; label: string }>
}

export const FIELD_META: Record<RuleField, FieldMeta> = {
  mediaType: {
    label: 'Media type',
    operators: ['equals', 'not_equals', 'in', 'not_in'],
    valueKind: 'select',
    selectOptions: [
      { value: 'movie', label: 'Movie' },
      { value: 'tv', label: 'TV Show' },
      { value: 'anime', label: 'Anime' },
    ],
  },
  status: {
    label: 'Status',
    operators: ['equals', 'not_equals', 'in', 'not_in'],
    valueKind: 'select',
    selectOptions: [
      { value: 'watched', label: 'Watched' },
      { value: 'watchlist', label: 'Watchlist' },
      { value: 'in_progress', label: 'In progress' },
      { value: 'dropped', label: 'Dropped' },
    ],
  },
  userRating: {
    label: 'Rating',
    operators: ['gte', 'lte', 'gt', 'lt', 'equals', 'between', 'is_set', 'is_not_set'],
    valueKind: 'rating',
  },
  releaseYear: {
    label: 'Release year',
    operators: ['equals', 'gte', 'lte', 'gt', 'lt', 'between', 'is_set', 'is_not_set'],
    valueKind: 'year',
  },
  addedYear: {
    label: 'Added year',
    operators: ['equals', 'gte', 'lte', 'between'],
    valueKind: 'year',
  },
  watchedYear: {
    label: 'Watched year',
    operators: ['equals', 'gte', 'lte', 'between', 'is_set', 'is_not_set'],
    valueKind: 'year',
  },
  loggedYear: {
    label: 'Logged in year',
    operators: ['equals', 'not_equals', 'gte', 'lte', 'between', 'is_set', 'is_not_set'],
    valueKind: 'year',
  },
  genreId: {
    label: 'Genre',
    operators: ['equals', 'not_equals', 'in', 'not_in'],
    valueKind: 'genre',
  },
  hasReview: {
    label: 'Has review',
    operators: ['is_true', 'is_false'],
    valueKind: 'none',
  },
  playCount: {
    label: 'Play count',
    operators: ['gte', 'lte', 'gt', 'lt', 'equals', 'between'],
    valueKind: 'number',
  },
  runtime: {
    label: 'Runtime (min)',
    operators: ['gte', 'lte', 'gt', 'lt', 'between', 'is_set', 'is_not_set'],
    valueKind: 'number',
  },
}

export const OPERATOR_LABEL: Record<RuleOperator, string> = {
  equals: 'is',
  not_equals: 'is not',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  between: 'between',
  in: 'is any of',
  not_in: 'is none of',
  is_set: 'is set',
  is_not_set: 'is empty',
  is_true: 'yes',
  is_false: 'no',
}

export function defaultRule(): ListRule {
  return {
    id: Math.random().toString(36).slice(2, 10),
    field: 'userRating',
    operator: 'gte',
    value: 8,
  }
}

export function emptyRules(): ListRules {
  return { enabled: false, combinator: 'all', rules: [], scope: { ...DEFAULT_SCOPE } }
}
