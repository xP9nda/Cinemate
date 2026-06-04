import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Clock, Trash2, Star, Search, CheckSquare, Square, X, Filter, Edit2, Repeat2, CalendarDays, Grid, List as ListIcon, MessageSquare, Tv, MonitorPlay, Film, Tag, Plus, Check, ListPlus, ArrowUpDown, Clapperboard, Calendar as CalendarIcon } from 'lucide-react'
import { useStore } from '../lib/store'
import { cn, posterUrl, fmtDate, fmtRating, fmtRelative, fmtRuntime, uid, resolvePageSize, DEFAULT_PAGINATION } from '../lib/utils'
import { playMinutes } from '../lib/mediaStats'
import { EmptyState } from '../components/shared/EmptyState'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { ScrollArea } from '../components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover'
import { Calendar } from '../components/ui/calendar'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { format, startOfWeek } from 'date-fns'
import { toast } from 'sonner'
import { LogEntryModal } from '../components/shared/LogEntryModal'
import { RatingInput } from '../components/shared/RatingInput'
import type { LibraryEntry, WatchHistoryEntry, CustomList, RatingSystem, LogGroupBy } from '../types'

// Section header label for a play, given the chosen grouping granularity. The
// returned string is also used as the group key, so it must be unique per
// bucket (each granularity's format embeds the year, week the week-start date).
function logGroupLabel(ts: number, groupBy: LogGroupBy): string {
  const d = new Date(ts)
  switch (groupBy) {
    case 'day': return format(d, 'EEEE, MMMM d, yyyy')
    case 'week': return `Week of ${format(startOfWeek(d), 'MMM d, yyyy')}`
    case 'year': return format(d, 'yyyy')
    case 'month':
    default: return format(d, 'MMMM yyyy')
  }
}

// Per-section tallies for a Watch Log header: how many movie plays, how many
// episode plays, and the total runtime watched in that bucket. Runtime is read
// synchronously via playMinutes - the exact per-episode runtime where a Detail
// visit has filled it in, otherwise the show's average episode runtime (or the
// movie runtime). Show-level plays (no episodeKey, not a movie) don't occur in
// practice and fall into neither tally.
function logGroupStats(
  entries: WatchHistoryEntry[],
  library: Record<string, LibraryEntry>,
): { movieCount: number; episodeCount: number; watchedRuntime: number } {
  let movieCount = 0, episodeCount = 0, watchedRuntime = 0
  for (const h of entries) {
    const lib = library[h.mediaId]
    if (h.episodeKey) {
      episodeCount++
      watchedRuntime += playMinutes(lib, h.episodeKey)
    } else if (lib?.mediaType === 'movie') {
      movieCount++
      watchedRuntime += playMinutes(lib)
    }
  }
  return { movieCount, episodeCount, watchedRuntime }
}

// The stats breakdown shown beside a Watch Log section header in place of the
// plain entry count. Only used for month-or-finer buckets (see showGroupStats);
// coarser groupings hold too much of too many kinds to read at a glance.
const LogGroupStats = React.memo(function LogGroupStats({
  entries, library,
}: { entries: WatchHistoryEntry[]; library: Record<string, LibraryEntry> }) {
  const { movieCount, episodeCount, watchedRuntime } = useMemo(
    () => logGroupStats(entries, library),
    [entries, library],
  )
  const parts: React.ReactNode[] = []
  if (movieCount > 0) parts.push(
    <span key="m" className="inline-flex items-center gap-1">
      <Film className="h-3 w-3" />{movieCount} movie{movieCount !== 1 ? 's' : ''}
    </span>
  )
  if (episodeCount > 0) parts.push(
    <span key="e" className="inline-flex items-center gap-1">
      <MonitorPlay className="h-3 w-3" />{episodeCount} episode{episodeCount !== 1 ? 's' : ''}
    </span>
  )
  if (watchedRuntime > 0) parts.push(
    <span key="r" className="inline-flex items-center gap-1">
      <Clock className="h-3 w-3" />{fmtRuntime(watchedRuntime)}
    </span>
  )
  // Nothing to tally (e.g. only show-level plays with no stored runtime): keep the
  // old count so the header never goes blank.
  if (parts.length === 0) {
    return <span className="text-muted-foreground/60">({entries.length})</span>
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-normal normal-case tracking-normal text-muted-foreground/60">
      {parts}
    </span>
  )
})

const GENRE_NAMES: Record<number, string> = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
  99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
  27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi',
  53: 'Thriller', 10752: 'War', 37: 'Western',
  10759: 'Action & Adventure', 10762: 'Kids', 10765: 'Sci-Fi & Fantasy',
}

type MediaFilter = 'all' | 'movie' | 'anime' | 'episode'
type SortOrder = 'newest' | 'oldest' | 'rating_desc' | 'rating_asc'
type RewatchFilter = 'all' | 'first' | 'rewatch'
type RatingFilter = 'all' | 'rated' | 'unrated' | `=${number}`
type ViewMode = 'grid' | 'list'

const VIEW_LS_KEY = 'cinemate-log-view'

export function Log() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const episodeKeyParam = searchParams.get('episodeKey')
  const mediaIdParam = searchParams.get('mediaId')
  const dateParam = searchParams.get('date')
  const monthDayParam = searchParams.get('monthDay')
  const sortOrderParam = searchParams.get('sortOrder') as SortOrder | null
  const mediaFilterParam = searchParams.get('mediaFilter') as MediaFilter | null
  const ratingParam = searchParams.get('rating')
  const decadeParam = searchParams.get('decade')
  const yearParam = searchParams.get('year')
  const genreParam = searchParams.get('genre')
  const dateFromParam = searchParams.get('dateFrom')
  const dateToParam = searchParams.get('dateTo')
  const hasUrlFilter = !!(mediaFilterParam || sortOrderParam || ratingParam || decadeParam || yearParam || genreParam || dateFromParam || dateToParam)
  const watchHistory = useStore(s => s.watchHistory)
  const library = useStore(s => s.library)
  const settings = useStore(s => s.settings)
  const removeHistory = useStore(s => s.removeHistory)
  const bulkRemoveHistory = useStore(s => s.bulkRemoveHistory)
  const repairOrphans = useStore(s => s.repairOrphans)
  const lists = useStore(s => s.lists)

  // Heal any history entries whose library entry is missing (e.g., logged in
  // a previous session before the init-time repair had run, or before this
  // self-heal existed). The ref guard prevents re-runs if TMDb 404s a
  // tombstoned id and the entry stays orphaned after a repair pass.
  const orphansRepairedRef = useRef(false)
  useEffect(() => {
    if (orphansRepairedRef.current) return
    const hasOrphan = watchHistory.some(h => !library[h.mediaId])
    if (hasOrphan) {
      orphansRepairedRef.current = true
      repairOrphans().catch(() => { /* best-effort */ })
    }
  }, [watchHistory, library, repairOrphans])

  const savedFilters = (): Partial<{
    query: string; mediaFilter: MediaFilter; sortOrder: SortOrder
    rewatchFilter: RewatchFilter; ratingFilter: RatingFilter; yearFilter: string; genreFilter: string
    tagFilter: string; dateFrom: string; dateTo: string
  }> => {
    try { return JSON.parse(localStorage.getItem('cinemate-log-filters') ?? '{}') } catch { return {} }
  }
  const sf = savedFilters()

  // When deep-linked from Stats/etc with filter params, start from a clean
  // slate and apply only the linked filters; otherwise restore saved filters.
  const baseSaved = hasUrlFilter ? ({} as typeof sf) : sf
  const ratingFromUrl: RatingFilter | null =
    ratingParam != null && !Number.isNaN(Number(ratingParam)) ? `=${Number(ratingParam)}` : null
  const [query, setQuery] = useState(baseSaved.query ?? '')
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>(mediaFilterParam ?? baseSaved.mediaFilter ?? 'all')
  const validSortOrders: SortOrder[] = ['newest', 'oldest', 'rating_desc', 'rating_asc']
  const savedSortOrder = sortOrderParam ?? baseSaved.sortOrder ?? 'newest'
  const [sortOrder, setSortOrder] = useState<SortOrder>(
    validSortOrders.includes(savedSortOrder as SortOrder) ? (savedSortOrder as SortOrder) : 'newest'
  )
  const [rewatchFilter, setRewatchFilter] = useState<RewatchFilter>(baseSaved.rewatchFilter ?? 'all')
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>(ratingFromUrl ?? baseSaved.ratingFilter ?? 'all')
  const [yearFilter, setYearFilter] = useState<string>(yearParam ?? baseSaved.yearFilter ?? 'all')
  const [genreFilter, setGenreFilter] = useState<string>(genreParam ?? baseSaved.genreFilter ?? 'all')
  const [tagFilter, setTagFilter] = useState<string>(baseSaved.tagFilter ?? 'all')
  const [dateFrom, setDateFrom] = useState<string>(dateFromParam ?? baseSaved.dateFrom ?? '')
  const [dateTo, setDateTo] = useState<string>(dateToParam ?? baseSaved.dateTo ?? '')
  const [decadeFilter, setDecadeFilter] = useState<number | null>(
    decadeParam != null && !Number.isNaN(Number(decadeParam)) ? Number(decadeParam) : null
  )
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [confirmBulk, setConfirmBulk] = useState(false)
  const [editingEntry, setEditingEntry] = useState<WatchHistoryEntry | null>(null)
  const PAGE_SIZE = resolvePageSize(settings.pagination?.log, DEFAULT_PAGINATION.log)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [view, setView] = useState<ViewMode>(() => {
    const v = localStorage.getItem(VIEW_LS_KEY)
    return v === 'grid' || v === 'list' ? v : 'list'
  })

  useEffect(() => { localStorage.setItem(VIEW_LS_KEY, view) }, [view])

  const CARD_WIDTH = 140
  const GAP = 12
  const [colCount, setColCount] = useState(4)
  const observerRef = useRef<ResizeObserver | null>(null)

  // Callback ref re-runs on mount/unmount of the grid container, which can
  // happen when filters reduce results to zero (EmptyState renders instead)
  // and then bring them back. A useEffect with [view] dep wouldn't reattach.
  const setGridContainer = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width
      setColCount(Math.max(1, Math.floor((w + GAP) / (CARD_WIDTH + GAP))))
    })
    ro.observe(el)
    observerRef.current = ro
  }, [])

  // Derive available year options from history
  const availableYears = useMemo(() => {
    const years = new Set<number>()
    for (const h of watchHistory) {
      years.add(new Date(h.watchedAt).getFullYear())
    }
    return Array.from(years).sort((a, b) => b - a)
  }, [watchHistory])

  // Derive available genres from library entries referenced in history
  const availableGenres = useMemo(() => {
    const counts: Record<number, number> = {}
    for (const h of watchHistory) {
      const lib = library[h.mediaId]
      for (const gid of (lib?.genreIds ?? [])) {
        counts[gid] = (counts[gid] ?? 0) + 1
      }
    }
    return Object.entries(counts)
      .map(([id, count]) => ({ id: Number(id), name: GENRE_NAMES[Number(id)], count }))
      .filter((g) => g.name)
      .sort((a, b) => b.count - a.count)
      .slice(0, 12)
  }, [watchHistory, library])

  // Derive available tags (with usage counts) from history entries
  const availableTags = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const h of watchHistory) {
      for (const t of (h.tags ?? [])) counts[t] = (counts[t] ?? 0) + 1
    }
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }, [watchHistory])

  const maxRating = settings.ratingSystem === '5star' ? 5 : 10

  const filtered = useMemo(() => {
    let items = [...watchHistory]

    if (episodeKeyParam && mediaIdParam) {
      return items
        .filter((h) => h.mediaId === mediaIdParam && h.episodeKey === episodeKeyParam)
        .sort((a, b) => b.watchedAt - a.watchedAt)
    }

    if (dateParam) {
      return items
        .filter((h) => {
          const d = new Date(h.watchedAt)
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
          return key === dateParam
        })
        .sort((a, b) => b.watchedAt - a.watchedAt)
    }

    if (monthDayParam) {
      return items
        .filter((h) => {
          const d = new Date(h.watchedAt)
          const key = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
          return key === monthDayParam
        })
        .sort((a, b) => b.watchedAt - a.watchedAt)
    }

    if (query.trim()) {
      const q = query.toLowerCase()
      items = items.filter((h) => {
        const lib = library[h.mediaId]
        return (
          (lib?.title ?? h.mediaId).toLowerCase().includes(q) ||
          (h.episodeTitle ?? '').toLowerCase().includes(q) ||
          (h.note ?? '').toLowerCase().includes(q)
        )
      })
    }

    if (mediaFilter === 'episode') {
      items = items.filter((h) => !!h.episodeKey)
    } else if (mediaFilter === 'movie') {
      items = items.filter((h) => {
        const lib = library[h.mediaId]
        return lib?.mediaType === 'movie' && !h.episodeKey
      })
    } else if (mediaFilter !== 'all') {
      // For 'tv' / 'anime', include both episode plays and any other entries
      // whose library mediaType matches - clicking "Anime" in the pie chart
      // should surface anime episode watches too, not just non-episode plays.
      items = items.filter((h) => library[h.mediaId]?.mediaType === mediaFilter)
    }

    if (rewatchFilter === 'first') items = items.filter((h) => !h.isRewatch)
    else if (rewatchFilter === 'rewatch') items = items.filter((h) => !!h.isRewatch)

    const effectiveRating = (h: WatchHistoryEntry) =>
      h.episodeKey ? (library[h.mediaId]?.tvProgress?.[h.episodeKey]?.rating ?? null) : h.rating

    if (ratingFilter === 'rated') items = items.filter((h) => effectiveRating(h) != null)
    else if (ratingFilter === 'unrated') items = items.filter((h) => effectiveRating(h) == null)
    else if (typeof ratingFilter === 'string' && ratingFilter.startsWith('=')) {
      const exact = Number(ratingFilter.slice(1))
      if (!Number.isNaN(exact)) {
        items = items.filter((h) => {
          const r = effectiveRating(h)
          return r != null && Math.round(r) === exact
        })
      }
    }

    if (yearFilter !== 'all') {
      const yr = Number(yearFilter)
      items = items.filter((h) => new Date(h.watchedAt).getFullYear() === yr)
    }

    if (decadeFilter != null) {
      items = items.filter((h) => {
        const ry = library[h.mediaId]?.releaseYear
        return ry != null && Math.floor(ry / 10) * 10 === decadeFilter
      })
    }

    if (dateFrom) {
      const from = new Date(dateFrom + 'T00:00:00').getTime()
      items = items.filter((h) => h.watchedAt >= from)
    }
    if (dateTo) {
      const to = new Date(dateTo + 'T23:59:59').getTime()
      items = items.filter((h) => h.watchedAt <= to)
    }

    if (genreFilter !== 'all') {
      const gid = Number(genreFilter)
      items = items.filter((h) => (library[h.mediaId]?.genreIds ?? []).includes(gid))
    }

    if (tagFilter === '__tagged__') {
      items = items.filter((h) => (h.tags?.length ?? 0) > 0)
    } else if (tagFilter === '__untagged__') {
      items = items.filter((h) => (h.tags?.length ?? 0) === 0)
    } else if (tagFilter !== 'all') {
      items = items.filter((h) => (h.tags ?? []).includes(tagFilter))
    }

    const getEffectiveRating = (h: WatchHistoryEntry) =>
      h.episodeKey ? (library[h.mediaId]?.tvProgress?.[h.episodeKey]?.rating ?? null) : h.rating

    items.sort((a, b) => {
      if (sortOrder === 'newest') return b.watchedAt - a.watchedAt
      if (sortOrder === 'oldest') return a.watchedAt - b.watchedAt
      if (sortOrder === 'rating_desc') return (getEffectiveRating(b) ?? -1) - (getEffectiveRating(a) ?? -1)
      if (sortOrder === 'rating_asc') return (getEffectiveRating(a) ?? 99) - (getEffectiveRating(b) ?? 99)
      return 0
    })

    return items
  }, [watchHistory, library, query, mediaFilter, sortOrder, rewatchFilter, ratingFilter, decadeFilter, yearFilter, genreFilter, tagFilter, dateFrom, dateTo, episodeKeyParam, mediaIdParam, dateParam, monthDayParam, maxRating])

  // Reset pagination when the filter/sort criteria change - but NOT when the
  // underlying watchHistory mutates (e.g. editing a single entry). Depending on
  // `filtered` here would collapse the list back to 50 and reset scroll on every
  // edit; depending on the criteria keeps the loaded page intact across edits.
  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [
    query, mediaFilter, sortOrder, rewatchFilter, ratingFilter, yearFilter,
    genreFilter, tagFilter, dateFrom, dateTo, decadeFilter,
    episodeKeyParam, mediaIdParam, dateParam, monthDayParam, PAGE_SIZE,
  ])

  // Persist filters to localStorage whenever they change
  useEffect(() => {
    if (episodeKeyParam || mediaIdParam || dateParam || monthDayParam) return
    localStorage.setItem('cinemate-log-filters', JSON.stringify({
      query, mediaFilter, sortOrder, rewatchFilter, ratingFilter, yearFilter, genreFilter, tagFilter, dateFrom, dateTo
    }))
  }, [query, mediaFilter, sortOrder, rewatchFilter, ratingFilter, yearFilter, genreFilter, tagFilter, dateFrom, dateTo, episodeKeyParam, mediaIdParam, dateParam, monthDayParam])

  const visibleFiltered = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount])

  const grouped = useMemo<[string, typeof visibleFiltered][]>(() => {
    const groupBy = settings.logGroupBy ?? 'month'
    // Grouping only makes sense in chronological order; for rating sorts (or when
    // grouping is turned off) fall back to a single unlabelled section.
    if ((sortOrder !== 'newest' && sortOrder !== 'oldest') || groupBy === 'none') {
      return [['All entries', visibleFiltered]]
    }
    // A Map preserves insertion order for every key type. A plain object would
    // silently re-sort integer-like keys (e.g. a year "2026") into ascending
    // numeric order, breaking the newest/oldest ordering of visibleFiltered.
    const groups = new Map<string, typeof visibleFiltered>()
    for (const h of visibleFiltered) {
      const key = logGroupLabel(h.watchedAt, groupBy)
      const arr = groups.get(key)
      if (arr) arr.push(h)
      else groups.set(key, [h])
    }
    return Array.from(groups)
  }, [visibleFiltered, sortOrder, settings.logGroupBy])

  // The header stats breakdown is only legible for month-or-finer buckets; year
  // (and the unlabelled single section for "none"/rating sorts) keep the plain count.
  const logGroupBy = settings.logGroupBy ?? 'month'
  const showGroupStats = logGroupBy === 'day' || logGroupBy === 'week' || logGroupBy === 'month'

  // The actual entry objects behind the selected ids - needed by the bulk-action
  // bar to compute the tag union and the set of media to add to lists.
  const selectedEntries = useMemo(
    () => watchHistory.filter((h) => selected.has(h.id)),
    [watchHistory, selected]
  )

  const toggleSelectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map((h) => h.id)))
    }
  }

  // Stable per-row callbacks so memoized LogRow/LogCard only re-render the one
  // entry whose data actually changed (e.g. after an edit), not the whole list.
  const selectEntry = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])
  const editEntry = useCallback((h: WatchHistoryEntry) => setEditingEntry(h), [])
  const requestDelete = useCallback((id: string) => setConfirmDelete(id), [])
  const goToDetail = useCallback((lib: LibraryEntry | undefined) => {
    if (lib) navigate(`/detail/${lib.mediaType}/${lib.tmdbId}`, { state: { backLabel: 'Watch Log' } })
  }, [navigate])

  const handleDelete = async (id: string) => {
    await removeHistory(id)
    toast.success('Entry removed')
    setConfirmDelete(null)
  }

  const handleBulkDelete = async () => {
    await bulkRemoveHistory(Array.from(selected))
    toast.success(`Deleted ${selected.size} entries`)
    setSelected(new Set())
    setSelectMode(false)
    setConfirmBulk(false)
  }

  const exitSelectMode = () => {
    setSelectMode(false)
    setSelected(new Set())
    setConfirmBulk(false)
  }

  // Strip any of our deep-link query params (banner clears + clearFilters
  // should drop them so the URL doesn't keep re-applying on remount).
  const stripUrlFilterParams = () => {
    const next = new URLSearchParams(searchParams)
    for (const k of ['rating', 'decade', 'year', 'genre', 'dateFrom', 'dateTo', 'mediaFilter', 'sortOrder']) {
      next.delete(k)
    }
    setSearchParams(next, { replace: true })
  }

  const clearFilters = () => {
    setQuery(''); setMediaFilter('all'); setSortOrder('newest')
    setRewatchFilter('all'); setRatingFilter('all'); setYearFilter('all'); setGenreFilter('all')
    setTagFilter('all'); setDateFrom(''); setDateTo('')
    setDecadeFilter(null)
    stripUrlFilterParams()
    localStorage.removeItem('cinemate-log-filters')
  }

  const hasFilters = query || mediaFilter !== 'all' || sortOrder !== 'newest'
    || rewatchFilter !== 'all' || ratingFilter !== 'all' || yearFilter !== 'all' || genreFilter !== 'all'
    || tagFilter !== 'all' || dateFrom || dateTo || decadeFilter != null

  if (watchHistory.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState
          icon={Clock}
          title="No watch history yet"
          description="Start watching and logging movies and episodes to see them here."
        />
      </div>
    )
  }

  return (
    <>
    <ScrollArea className="h-full">
      <div className="view-container p-6 w-full">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="flex-1 min-w-0">
            <h1 className="font-serif text-2xl font-normal">Watch Log</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {filtered.length !== watchHistory.length
                ? `${filtered.length} of ${watchHistory.length} entries`
                : `${watchHistory.length} entries`}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {selectMode ? (
              <>
                <span className="text-xs text-muted-foreground">{selected.size} selected</span>
                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={exitSelectMode}>
                  <X className="h-3.5 w-3.5" /> Done
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setSelectMode(true)}>
                  <CheckSquare className="h-3.5 w-3.5" /> Multi Select
                </Button>
                <div className="flex items-center gap-1">
                  <Button size="icon-sm" variant={view === 'grid' ? 'default' : 'ghost'} onClick={() => setView('grid')} aria-label="Grid view">
                    <Grid className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon-sm" variant={view === 'list' ? 'default' : 'ghost'} onClick={() => setView('list')} aria-label="List view">
                    <ListIcon className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Episode filter banner */}
        {episodeKeyParam && (
          <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20">
            <span className="text-xs text-primary flex-1 truncate">
              Showing plays for: {filtered[0]?.episodeTitle ?? episodeKeyParam}
            </span>
            <Button size="sm" variant="ghost" className="h-6 text-xs px-2 flex-shrink-0" onClick={() => navigate('/log')}>
              <X className="h-3 w-3 mr-1" /> Clear
            </Button>
          </div>
        )}

        {/* Date filter banner */}
        {dateParam && (
          <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20">
            <span className="text-xs text-primary flex-1 truncate">
              Showing entries for: {new Date(dateParam + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            </span>
            <Button size="sm" variant="ghost" className="h-6 text-xs px-2 flex-shrink-0" onClick={() => navigate('/log')}>
              <X className="h-3 w-3 mr-1" /> Clear
            </Button>
          </div>
        )}

        {/* Month-day filter banner */}
        {monthDayParam && (
          <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20">
            <span className="text-xs text-primary flex-1 truncate">
              Showing entries for {new Date(`2024-${monthDayParam}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} across all years
            </span>
            <Button size="sm" variant="ghost" className="h-6 text-xs px-2 flex-shrink-0" onClick={() => navigate('/log')}>
              <X className="h-3 w-3 mr-1" /> Clear
            </Button>
          </div>
        )}

        {/* Decade banner (from Stats decade chart click) */}
        {decadeFilter != null && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-info/10 border border-info/20">
            <CalendarDays className="h-3.5 w-3.5 text-info flex-shrink-0" />
            <span className="text-xs text-info flex-1 truncate">
              Showing entries released in the {decadeFilter}s
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs px-2 flex-shrink-0 text-info hover:text-info"
              onClick={() => {
                setDecadeFilter(null)
                const next = new URLSearchParams(searchParams)
                next.delete('decade')
                setSearchParams(next, { replace: true })
              }}
            >
              <X className="h-3 w-3 mr-1" /> Clear
            </Button>
          </div>
        )}

        {/* Filters */}
        {!episodeKeyParam && !dateParam && !monthDayParam && (
          <div className="space-y-2 mb-6">
            <div className="flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-40">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Search title, episode, note..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-8 h-8 text-xs"
                />
              </div>
              <Select value={mediaFilter} onValueChange={(v) => setMediaFilter(v as MediaFilter)}>
                <SelectTrigger className="w-32 h-8 text-xs">
                  <Filter className="h-3 w-3 mr-1 opacity-60" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="movie">Movies</SelectItem>
                  <SelectItem value="episode">Episodes</SelectItem>
                  <SelectItem value="anime">Anime</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as SortOrder)}>
                <SelectTrigger className="w-40 h-8 text-xs">
                  <ArrowUpDown className="h-3 w-3 mr-1 opacity-60" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Newest first</SelectItem>
                  <SelectItem value="oldest">Oldest first</SelectItem>
                  <SelectItem value="rating_desc">Highest rated</SelectItem>
                  <SelectItem value="rating_asc">Lowest rated</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={rewatchFilter} onValueChange={(v) => setRewatchFilter(v as RewatchFilter)}>
                <SelectTrigger className="w-32 h-8 text-xs">
                  <Repeat2 className="h-3 w-3 mr-1 opacity-60" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All watches</SelectItem>
                  <SelectItem value="first">First watches</SelectItem>
                  <SelectItem value="rewatch">Rewatches</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={ratingFilter}
                onValueChange={(v) => {
                  setRatingFilter(v as RatingFilter)
                  if (ratingParam) {
                    const next = new URLSearchParams(searchParams)
                    next.delete('rating')
                    setSearchParams(next, { replace: true })
                  }
                }}
              >
                <SelectTrigger className="w-32 h-8 text-xs">
                  <Star className="h-3 w-3 mr-1 opacity-60" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any rating</SelectItem>
                  <SelectItem value="rated">Is rated</SelectItem>
                  <SelectItem value="unrated">Unrated</SelectItem>
                  {Array.from({ length: maxRating }, (_, i) => maxRating - i).map((n) => (
                    <SelectItem key={n} value={`=${n}`}>
                      {n} {n === 1 ? 'star' : 'stars'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {availableYears.length > 1 && (
                <Select value={yearFilter} onValueChange={setYearFilter}>
                  <SelectTrigger className="w-28 h-8 text-xs">
                    <CalendarIcon className="h-3 w-3 mr-1 opacity-60" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All years</SelectItem>
                    {availableYears.map((y) => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {availableGenres.length > 0 && (
                <Select value={genreFilter} onValueChange={setGenreFilter}>
                  <SelectTrigger className="w-32 h-8 text-xs">
                    <Clapperboard className="h-3 w-3 mr-1 opacity-60" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All genres</SelectItem>
                    {availableGenres.map((g) => (
                      <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Select value={tagFilter} onValueChange={setTagFilter}>
                <SelectTrigger className="w-32 h-8 text-xs">
                  <Tag className="h-3 w-3 mr-1 opacity-60" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All tags</SelectItem>
                  <SelectItem value="__tagged__">Tagged</SelectItem>
                  <SelectItem value="__untagged__">Untagged</SelectItem>
                  {availableTags.map((t) => (
                    <SelectItem key={t.name} value={t.name}>{t.name} ({t.count})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <CalendarDays className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <DatePicker
                  value={dateFrom}
                  onChange={setDateFrom}
                  maxDate={dateTo ? new Date(dateTo + 'T12:00:00') : new Date()}
                  placeholder="Start date"
                />
                <span className="text-muted-foreground/50 text-xs select-none">to</span>
                <DatePicker
                  value={dateTo}
                  onChange={setDateTo}
                  minDate={dateFrom ? new Date(dateFrom + 'T12:00:00') : undefined}
                  placeholder="End date"
                />
                {(dateFrom || dateTo) && (
                  <button
                    onClick={() => { setDateFrom(''); setDateTo('') }}
                    className="h-5 w-5 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              {hasFilters && (
                <Button size="sm" variant="ghost" className="h-8 text-xs px-2 text-muted-foreground" onClick={clearFilters}>
                  <X className="h-3 w-3 mr-1" /> Clear
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Bulk action bar */}
        {selectMode && filtered.length > 0 && (
          <BulkActionBar
            selectedEntries={selectedEntries}
            allCount={filtered.length}
            allSelected={selected.size === filtered.length && filtered.length > 0}
            onToggleAll={toggleSelectAll}
            onDeleteRequest={() => setConfirmBulk(true)}
            ratingSystem={settings.ratingSystem}
            lists={lists}
          />
        )}

        {filtered.length === 0 ? (
          <EmptyState icon={Search} title="No results" description="Try adjusting your search or filters." />
        ) : (
          <div ref={setGridContainer} className="space-y-8">
            {grouped.map(([group, entries]) => (
              <section key={group}>
                {group !== 'All entries' && (
                  <h2 className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 sticky top-0 bg-background py-1">
                    <span>{group}</span>
                    {showGroupStats
                      ? <LogGroupStats entries={entries} library={library} />
                      : <span className="text-muted-foreground/60">({entries.length})</span>}
                  </h2>
                )}
                {view === 'grid' ? (
                  <div
                    className="grid"
                    style={{
                      gridTemplateColumns: `repeat(${colCount}, ${CARD_WIDTH}px)`,
                      gap: GAP,
                      justifyContent: 'start',
                    }}
                  >
                    {entries.map((h) => {
                      const libEntry = library[h.mediaId]
                      return (
                        <LogCard
                          key={h.id}
                          entry={h}
                          libEntry={libEntry}
                          ratingSystem={settings.ratingSystem}
                          timeFormat={settings.timeFormat}
                          selectMode={selectMode}
                          selected={selected.has(h.id)}
                          onSelect={selectEntry}
                          onNavigate={goToDetail}
                          onEdit={editEntry}
                          onDelete={requestDelete}
                        />
                      )
                    })}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {entries.map((h) => {
                      const libEntry = library[h.mediaId]
                      return (
                        <LogRow
                          key={h.id}
                          entry={h}
                          libEntry={libEntry}
                          ratingSystem={settings.ratingSystem}
                          timeFormat={settings.timeFormat}
                          selectMode={selectMode}
                          selected={selected.has(h.id)}
                          onSelect={selectEntry}
                          onNavigate={goToDetail}
                          onEdit={editEntry}
                          onDelete={requestDelete}
                        />
                      )
                    })}
                  </div>
                )}
              </section>
            ))}
            {visibleCount < filtered.length && (
              <div className="flex flex-col items-center gap-1.5 pt-2 pb-4">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                >
                  Load more
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  Showing {Math.min(visibleCount, filtered.length)} of {filtered.length}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {editingEntry && (
        <LogEntryModal
          open
          onClose={() => setEditingEntry(null)}
          mediaId={editingEntry.mediaId}
          mediaTitle={library[editingEntry.mediaId]?.title ?? editingEntry.mediaId}
          episodeKey={editingEntry.episodeKey}
          episodeTitle={editingEntry.episodeTitle}
          existingEntry={editingEntry}
        />
      )}
    </ScrollArea>

    <Dialog open={confirmDelete !== null} onOpenChange={(open) => { if (!open) setConfirmDelete(null) }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Remove this entry?</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">This play will be permanently removed from your watch history. This cannot be undone.</p>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button variant="destructive" onClick={() => confirmDelete && handleDelete(confirmDelete)}>Remove</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={confirmBulk} onOpenChange={(open) => { if (!open) setConfirmBulk(false) }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Remove {selected.size} {selected.size === 1 ? 'entry' : 'entries'}?</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">These plays will be permanently removed from your watch history. This cannot be undone.</p>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => setConfirmBulk(false)}>Cancel</Button>
          <Button variant="destructive" onClick={handleBulkDelete}>Remove {selected.size === 1 ? 'entry' : 'entries'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}

interface BulkActionBarProps {
  selectedEntries: WatchHistoryEntry[]
  allCount: number
  allSelected: boolean
  onToggleAll: () => void
  onDeleteRequest: () => void
  ratingSystem: RatingSystem
  lists: CustomList[]
}

// Toolbar shown in multi-select mode. Each action applies to every selected play
// at once: set/clear a rating, add/remove tags, add the entries to a list, flag
// rewatches, or delete. Backed by the store's bulk* actions, which preserve the
// object identity of untouched entries so only changed rows re-render.
function BulkActionBar({
  selectedEntries, allCount, allSelected, onToggleAll, onDeleteRequest, ratingSystem, lists,
}: BulkActionBarProps) {
  const watchHistory = useStore(s => s.watchHistory)
  const customTags = useStore(s => s.settings.customTags)
  const bulkSetHistoryRating = useStore(s => s.bulkSetHistoryRating)
  const bulkSetHistoryRewatch = useStore(s => s.bulkSetHistoryRewatch)
  const bulkUpdateHistoryTags = useStore(s => s.bulkUpdateHistoryTags)
  const addItemsToList = useStore(s => s.addItemsToList)
  const setList = useStore(s => s.setList)

  const count = selectedEntries.length
  const disabled = count === 0
  const ids = useMemo(() => selectedEntries.map(e => e.id), [selectedEntries])
  // Add each selected play to the list exactly as it is: an episode play becomes
  // an episode item ("libId::epKey"), a movie/show-level play becomes the title.
  const listItemIds = useMemo(
    () => Array.from(new Set(selectedEntries.map(e => e.episodeKey ? `${e.mediaId}::${e.episodeKey}` : e.mediaId))),
    [selectedEntries]
  )
  const plural = (n: number) => (n === 1 ? 'entry' : 'entries')

  const [rateOpen, setRateOpen] = useState(false)
  const [rateValue, setRateValue] = useState<number | null>(null)
  const [tagInput, setTagInput] = useState('')
  const [listsOpen, setListsOpen] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [rewatchOpen, setRewatchOpen] = useState(false)

  const selectedTagUnion = useMemo(() => {
    const set = new Set<string>()
    for (const e of selectedEntries) for (const t of (e.tags ?? [])) set.add(t)
    return Array.from(set).sort()
  }, [selectedEntries])

  const allKnownTags = useMemo(() => {
    const freq: Record<string, number> = {}
    for (const h of watchHistory) for (const t of (h.tags ?? [])) freq[t] = (freq[t] ?? 0) + 1
    const fromHistory = Object.keys(freq).sort((a, b) => freq[b] - freq[a])
    return Array.from(new Set([...(customTags ?? []), ...fromHistory]))
  }, [watchHistory, customTags])

  const tagSuggestions = useMemo(() => {
    const q = tagInput.trim().toLowerCase()
    const base = allKnownTags.filter(t => !selectedTagUnion.includes(t))
    return (q ? base.filter(t => t.includes(q)) : base).slice(0, 12)
  }, [allKnownTags, selectedTagUnion, tagInput])

  const applyRating = async (value: number | null) => {
    if (disabled) return
    await bulkSetHistoryRating(ids, value)
    toast.success(value == null ? `Cleared rating on ${count} ${plural(count)}` : `Rated ${count} ${plural(count)} ${value}★`)
    setRateOpen(false)
  }

  const addTag = async (raw: string) => {
    const tag = raw.trim().toLowerCase().replace(/[,;]/g, '')
    if (!tag || disabled) return
    await bulkUpdateHistoryTags(ids, [tag], [])
    toast.success(`Added "${tag}" to ${count} ${plural(count)}`)
    setTagInput('')
  }

  const removeTag = async (tag: string) => {
    await bulkUpdateHistoryTags(ids, [], [tag])
    toast.success(`Removed "${tag}"`)
  }

  const setRewatch = async (val: boolean) => {
    if (disabled) return
    await bulkSetHistoryRewatch(ids, val)
    toast.success(val ? `Marked ${count} ${plural(count)} as rewatch` : `Marked ${count} ${plural(count)} as first watch`)
    setRewatchOpen(false)
  }

  const addToList = async (listId: string) => {
    const n = await addItemsToList(listItemIds, listId)
    const name = lists.find(l => l.id === listId)?.name ?? 'list'
    toast.success(n > 0 ? `Added ${n} ${n === 1 ? 'item' : 'items'} to "${name}"` : `Already in "${name}"`)
  }

  const createAndAdd = async (name: string) => {
    const trimmed = name.trim()
    if (!trimmed || disabled) return
    const newList: CustomList = { id: `list:${uid()}`, name: trimmed, description: '', createdAt: Date.now(), itemIds: [] }
    await setList(newList)
    const n = await addItemsToList(listItemIds, newList.id)
    toast.success(`Created "${trimmed}" with ${n} ${n === 1 ? 'item' : 'items'}`)
    setNewListName('')
    setListsOpen(false)
  }

  const manualLists = lists.filter(l => !l.rules?.enabled)
  const actionBtn = 'h-7 text-xs gap-1'

  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-card border border-border/60 shadow-sm">
      <button
        onClick={onToggleAll}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        {allSelected ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
        {allSelected ? 'Deselect all' : `Select all (${allCount})`}
      </button>

      <div className="h-4 w-px bg-border/60 mx-1" />
      <span className="text-xs font-medium text-foreground">{count} selected</span>

      <div className="flex-1 min-w-0" />

      {/* Rate */}
      <Popover open={rateOpen} onOpenChange={setRateOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" className={actionBtn} disabled={disabled}>
            <Star className="h-3.5 w-3.5" /> Rate
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3" align="end">
          <p className="text-xs font-medium mb-2">Set rating for {count} {plural(count)}</p>
          <RatingInput value={rateValue} onChange={setRateValue} system={ratingSystem} size="md" />
          <div className="flex items-center gap-2 mt-3">
            <Button size="sm" className="h-7 text-xs flex-1" disabled={rateValue == null} onClick={() => applyRating(rateValue)}>
              Apply
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => applyRating(null)}>
              Clear
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {/* Tags */}
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" className={actionBtn} disabled={disabled}>
            <Tag className="h-3.5 w-3.5" /> Tags
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align="end">
          <p className="text-xs font-medium mb-2">Add tag to {count} {plural(count)}</p>
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(tagInput) } }}
            placeholder="Type a tag, press Enter"
            className="w-full h-8 px-2 text-xs rounded-md border border-border bg-secondary/40 outline-none focus:border-primary/50"
          />
          {tagSuggestions.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {tagSuggestions.map(t => (
                <button
                  key={t}
                  onClick={() => addTag(t)}
                  className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-secondary text-muted-foreground hover:bg-primary/10 hover:text-primary text-xs transition-colors"
                >
                  <Plus className="h-2.5 w-2.5" /> {t}
                </button>
              ))}
            </div>
          )}
          {selectedTagUnion.length > 0 && (
            <>
              <p className="text-[11px] text-muted-foreground mt-3 mb-1">On selection - click to remove</p>
              <div className="flex flex-wrap gap-1">
                {selectedTagUnion.map(t => (
                  <button
                    key={t}
                    onClick={() => removeTag(t)}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/15 text-primary text-xs hover:bg-primary/25 transition-colors"
                  >
                    {t} <X className="h-2.5 w-2.5" />
                  </button>
                ))}
              </div>
            </>
          )}
        </PopoverContent>
      </Popover>

      {/* Lists */}
      <Popover open={listsOpen} onOpenChange={setListsOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" className={actionBtn} disabled={disabled}>
            <ListPlus className="h-3.5 w-3.5" /> Lists
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2" align="end">
          <p className="text-xs font-medium px-1 mb-1.5">
            Add {listItemIds.length} {listItemIds.length === 1 ? 'item' : 'items'} to list
          </p>
          <div className="space-y-0.5 max-h-56 overflow-y-auto">
            {manualLists.length === 0 && (
              <p className="text-xs text-muted-foreground px-1 py-2">No manual lists yet - create one below.</p>
            )}
            {manualLists.map(l => {
              const allIn = listItemIds.length > 0 && listItemIds.every(id => l.itemIds.includes(id))
              return (
                <button
                  key={l.id}
                  onClick={() => addToList(l.id)}
                  className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-xs hover:bg-secondary transition-colors text-left"
                >
                  <span className="truncate">{l.name}</span>
                  {allIn && <Check className="h-3.5 w-3.5 text-primary flex-shrink-0" />}
                </button>
              )
            })}
          </div>
          <div className="border-t border-border mt-1.5 pt-1.5 flex items-center gap-1">
            <input
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && newListName.trim()) createAndAdd(newListName) }}
              placeholder="New list..."
              className="flex-1 min-w-0 h-7 px-2 text-xs rounded-md border border-border bg-secondary/40 outline-none focus:border-primary/50"
            />
            <Button size="sm" className="h-7 text-xs" disabled={!newListName.trim()} onClick={() => createAndAdd(newListName)}>
              Add
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {/* Rewatch */}
      <Popover open={rewatchOpen} onOpenChange={setRewatchOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" className={actionBtn} disabled={disabled}>
            <Repeat2 className="h-3.5 w-3.5" /> Rewatch
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-1" align="end">
          <button
            onClick={() => setRewatch(true)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs hover:bg-secondary transition-colors text-left"
          >
            <Repeat2 className="h-3.5 w-3.5 text-info" /> Mark as rewatch
          </button>
          <button
            onClick={() => setRewatch(false)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs hover:bg-secondary transition-colors text-left"
          >
            <Square className="h-3.5 w-3.5 text-muted-foreground" /> Mark as first watch
          </button>
        </PopoverContent>
      </Popover>

      <Button size="sm" variant="destructive" className={actionBtn} disabled={disabled} onClick={onDeleteRequest}>
        <Trash2 className="h-3.5 w-3.5" /> Delete
      </Button>
    </div>
  )
}

interface LogRowProps {
  entry: ReturnType<typeof useStore.getState>['watchHistory'][0]
  libEntry: ReturnType<typeof useStore.getState>['library'][string] | undefined
  ratingSystem: string
  timeFormat: '12h' | '24h'
  selectMode: boolean
  selected: boolean
  onSelect: (id: string) => void
  onNavigate: (libEntry: LibraryEntry | undefined) => void
  onEdit: (entry: WatchHistoryEntry) => void
  onDelete: (id: string) => void
}

function DatePicker({ value, onChange, placeholder, minDate, maxDate }: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  minDate?: Date
  maxDate?: Date
}) {
  const [open, setOpen] = useState(false)
  const selected = value ? new Date(value + 'T12:00:00') : undefined

  const handleSelect = (day: Date | undefined) => {
    if (!day) return
    onChange(format(day, 'yyyy-MM-dd'))
    setOpen(false)
  }

  const disabledMatcher = [
    { after: maxDate ?? new Date() },
    ...(minDate ? [{ before: minDate }] : []),
  ]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={cn(
          'flex items-center h-8 px-2.5 rounded-md border text-xs gap-1.5 transition-colors cursor-pointer',
          value
            ? 'border-primary/40 bg-primary/10 text-foreground hover:bg-primary/15'
            : 'border-border/60 bg-secondary/40 text-muted-foreground hover:border-border hover:bg-secondary/60'
        )}>
          <CalendarDays className="h-3 w-3 flex-shrink-0 opacity-60" />
          {selected ? format(selected, 'MMM d, yyyy') : placeholder}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={handleSelect}
          disabled={disabledMatcher}
          initialFocus
        />
        {value && (
          <div className="border-t border-border px-3 py-2 flex justify-end">
            <button
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => { onChange(''); setOpen(false) }}
            >
              Clear date
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

const LogRow = React.memo(function LogRow({ entry, libEntry, ratingSystem, timeFormat, selectMode, selected, onSelect, onNavigate, onEdit, onDelete }: LogRowProps) {
  const imgSrc = libEntry ? posterUrl(libEntry.posterPath, 'w92') : null
  const title = libEntry?.title ?? entry.mediaId
  const displayRating = entry.episodeKey
    ? (libEntry?.tvProgress?.[entry.episodeKey]?.rating ?? null)
    : (entry.rating ?? libEntry?.userRating ?? null)

  return (
    <div
      className={cn(
        'flex items-start gap-3 p-3 rounded-lg bg-card border transition-colors',
        'border-border/40 hover:border-border',
        selected && 'border-primary/40 bg-primary/5'
      )}
      onClick={selectMode ? () => onSelect(entry.id) : undefined}
      role={selectMode ? 'button' : undefined}
      style={{ contentVisibility: 'auto', containIntrinsicSize: '0 88px', ...(selectMode ? { cursor: 'pointer' } : {}) } as React.CSSProperties}
    >
      {selectMode && (
        <div className="flex-shrink-0 flex items-center self-center">
          {selected ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4 text-muted-foreground" />}
        </div>
      )}

      <div
        className={cn('h-14 w-10 rounded overflow-hidden flex-shrink-0 bg-secondary transition-opacity', !selectMode && 'cursor-pointer hover:opacity-80')}
        onClick={selectMode ? undefined : () => onNavigate(libEntry)}
      >
        {imgSrc ? (
          <img src={imgSrc} alt={title} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">?</div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <button
            onClick={selectMode ? undefined : () => onNavigate(libEntry)}
            className={cn('text-sm font-medium text-foreground truncate', !selectMode && 'hover:text-primary transition-colors cursor-pointer')}
            tabIndex={selectMode ? -1 : 0}
          >
            {title}
          </button>
          {entry.isRewatch && (
            <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-info/10 text-info border border-info/20 flex-shrink-0">
              <Repeat2 className="h-2.5 w-2.5" /> Rewatch
            </span>
          )}
          {displayRating != null && (
            <span className="flex items-center gap-0.5 text-xs text-warning flex-shrink-0">
              <Star className="h-3 w-3 fill-warning" />
              {fmtRating(displayRating, ratingSystem as '10star' | '5star')}
            </span>
          )}
        </div>
        {entry.episodeTitle && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{entry.episodeTitle}</p>
        )}
        {entry.note && (
          <p className="text-xs text-muted-foreground mt-1 italic whitespace-pre-wrap line-clamp-3">"{entry.note}"</p>
        )}
        {entry.tags && entry.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {entry.tags.map((tag) => (
              <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{tag}</span>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground mt-1">
          {fmtDate(entry.watchedAtDT, 'EEEE, MMM d')} at {fmtDate(entry.watchedAtDT, timeFormat === '24h' ? 'HH:mm' : 'h:mm a')}, {fmtRelative(entry.watchedAt)}
        </p>
      </div>

      {!selectMode && (
        <div className="flex items-center gap-1 flex-shrink-0">
          <Button size="icon-sm" variant="ghost" onClick={() => onEdit(entry)} aria-label="Edit entry" className="text-muted-foreground hover:text-foreground">
            <Edit2 className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => onDelete(entry.id)} aria-label="Delete entry" className="text-muted-foreground hover:text-destructive">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  )
})

interface LogCardProps {
  entry: WatchHistoryEntry
  libEntry: LibraryEntry | undefined
  ratingSystem: string
  timeFormat: '12h' | '24h'
  selectMode: boolean
  selected: boolean
  onSelect: (id: string) => void
  onNavigate: (libEntry: LibraryEntry | undefined) => void
  onEdit: (entry: WatchHistoryEntry) => void
  onDelete: (id: string) => void
}


const LogCard = React.memo(function LogCard({ entry, libEntry, ratingSystem, timeFormat, selectMode, selected, onSelect, onNavigate, onEdit, onDelete }: LogCardProps) {
  const imgSrc = libEntry ? posterUrl(libEntry.posterPath, 'w300') : null
  const title = libEntry?.title ?? entry.mediaId
  const displayRating = entry.episodeKey
    ? (libEntry?.tvProgress?.[entry.episodeKey]?.rating ?? null)
    : (entry.rating ?? libEntry?.userRating ?? null)
  const hasNote = !!entry.note?.trim()
  const isEpisode = !!entry.episodeKey
  const epLabel = entry.episodeKey ? `S${entry.episodeKey.split(':')[0]}E${entry.episodeKey.split(':')[1]}` : null
  // The top-left badge already shows SxEy; strip that prefix from the subtitle so it doesn't repeat
  const epName = entry.episodeTitle?.replace(/^S\d+E\d+:?\s*/, '') ?? ''
  const watchedLine = `${fmtDate(entry.watchedAtDT, 'MMM d, yyyy')} at ${fmtDate(entry.watchedAtDT, timeFormat === '24h' ? 'HH:mm' : 'h:mm a')}`

  const handleClick = () => {
    if (selectMode) { onSelect(entry.id); return }
    onNavigate(libEntry)
  }

  return (
    <div
      className={cn(
        'group relative rounded-lg cursor-pointer focus-within:ring-2 focus-within:ring-ring',
        selected && 'ring-2 ring-primary'
      )}
      onClick={handleClick}
      role={selectMode ? 'button' : 'article'}
      aria-label={title}
    >
      <div className="relative w-full aspect-[2/3] rounded-lg overflow-hidden bg-secondary ring-1 ring-border/40 group-hover:ring-primary/50 transition-all duration-200">
        {imgSrc ? (
          <img
            src={imgSrc}
            alt={title}
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground p-2 text-center">
            {title}
          </div>
        )}

        {/* Top-left: selection checkbox OR episode/status badge */}
        {selectMode ? (
          <div className="absolute top-1.5 left-1.5 z-10 rounded-md bg-black/55 p-0.5">
            {selected
              ? <CheckSquare className="h-4 w-4 text-primary" />
              : <Square className="h-4 w-4 text-white" />}
          </div>
        ) : isEpisode ? (
          <div className="absolute top-1.5 left-1.5 z-10 inline-flex items-center gap-1 rounded-full bg-black/65 px-1.5 py-0.5">
            <Tv className="h-2.5 w-2.5 text-white/80" />
            <span className="text-[10px] font-mono text-white font-medium">{epLabel}</span>
          </div>
        ) : null}

        {/* Top-right hover actions */}
        {!selectMode && (
          <div className="absolute top-1.5 right-1.5 z-20 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
            <Button
              size="icon-sm"
              variant="ghost"
              className="h-6 w-6 bg-black/50 hover:bg-black/70 text-white rounded-md"
              onClick={(e) => { e.stopPropagation(); onEdit(entry) }}
              aria-label="Edit entry"
            >
              <Edit2 className="h-3 w-3" />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              className="h-6 w-6 bg-black/50 hover:bg-destructive/80 text-white rounded-md"
              onClick={(e) => { e.stopPropagation(); onDelete(entry.id) }}
              aria-label="Delete entry"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/80 to-transparent pt-12 pb-2.5 px-2.5">
          {(entry.isRewatch || hasNote) && (
            <div className="flex items-center gap-1 mb-1.5">
              {entry.isRewatch && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-black/65 px-1.5 py-0.5 text-[10px] text-white">
                      <Repeat2 className="h-2.5 w-2.5" /> Rewatch
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Rewatch</TooltipContent>
                </Tooltip>
              )}
              {hasNote && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center justify-center rounded-full bg-black/65 px-1 py-0.5">
                      <MessageSquare className="h-2.5 w-2.5 text-white" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs whitespace-pre-wrap italic">
                    "{entry.note}"
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          )}
          {displayRating != null && (
            <span className="flex items-center gap-0.5 text-[10px] text-warning font-medium">
              <Star className="h-2.5 w-2.5 fill-warning" />
              {fmtRating(displayRating, ratingSystem as '10star' | '5star')}
            </span>
          )}
          <p className="text-[11px] font-semibold text-white line-clamp-2 leading-tight">{title}</p>
          {epName && (
            <p className="text-[10px] text-white/70 truncate leading-tight">{epName}</p>
          )}
          <p className="text-[10px] text-white/70 leading-tight truncate mt-0.5">{watchedLine}</p>
        </div>
      </div>
    </div>
  )
})
