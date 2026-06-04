import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Grid, List, ArrowUp, ArrowDown, Search, Trash2, Edit2, MoreHorizontal, BookOpen, Star, Filter, ArrowUpDown, RotateCcw, Undo2
} from 'lucide-react'
import { useStore } from '../lib/store'
import type { MediaTarget } from '../lib/mediaActions'
import { aggregateEntryStats, entryTimeRemaining, entryEpisodesRemaining } from '../lib/mediaStats'
import { cn, posterUrl, fmtDate, fmtRating, statusLabel, statusColor, mediaLabel, resolvePageSize, DEFAULT_PAGINATION } from '../lib/utils'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Badge } from '../components/ui/badge'
import { EmptyState } from '../components/shared/EmptyState'
import { MediaEditSheet } from '../components/shared/MediaEditSheet'
import { useVirtualizer } from '@tanstack/react-virtual'
import { MediaCard } from '../components/shared/MediaCard'
import { ContinueWatchingCard } from '../components/shared/ContinueWatchingCard'
import { ScrollableRow } from '../components/shared/ScrollableRow'
import { MediaStatsBar } from '../components/shared/MediaStatsBar'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger
} from '../components/ui/dropdown-menu'
import { toast } from 'sonner'
import type { LibraryEntry, WatchStatus } from '../types'

// 'rewatching' is a derived view (entries with an active rewatch boundary), not a
// stored WatchStatus, so it lives alongside the real statuses as a virtual tab.
type LibTab = WatchStatus | 'all' | 'rewatching'

const STATUS_TABS: { value: LibTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'watched', label: 'Watched' },
  { value: 'watchlist', label: 'Watchlist' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'rewatching', label: 'Rewatching' },
  { value: 'dropped', label: 'Dropped' }
]

const TAB_VALUES: LibTab[] = ['all', 'watched', 'watchlist', 'in_progress', 'dropped', 'rewatching']

// A rewatch is "in progress" while its boundary is set and the show hasn't been
// fully re-watched back to 'watched'.
function isRewatching(e: LibraryEntry): boolean {
  return e.rewatchStartedAt != null && e.status === 'in_progress'
}

// A media reference carrying the entry's metadata, for actions that go through the
// MediaActions store layer (which never creates a metadata-poor entry).
function entryToTarget(e: LibraryEntry): MediaTarget {
  return {
    mediaType: e.mediaType,
    tmdbId: e.tmdbId,
    title: e.title,
    posterPath: e.posterPath,
    backdropPath: e.backdropPath ?? null,
    releaseYear: e.releaseYear,
    genreIds: e.genreIds,
    runtime: e.runtime ?? null,
  }
}

type SortKey = 'title' | 'rating' | 'year' | 'addedDate' | 'watchedDate' | 'timeRemaining' | 'episodesRemaining'
type MediaFilter = 'all' | 'movie' | 'tv' | 'anime'
type ViewMode = 'grid' | 'list'
type SortDir = 'asc' | 'desc'

const LS = {
  tab: 'cinemate-library-tab',
  search: 'cinemate-library-search',
  media: 'cinemate-library-media',
  sort: 'cinemate-library-sort',
  sortDir: 'cinemate-library-sort-dir',
  view: 'cinemate-library-view'
} as const

const SORT_KEYS: SortKey[] = ['title', 'rating', 'year', 'addedDate', 'watchedDate', 'timeRemaining', 'episodesRemaining']

const TAB_DEFAULT_SORT: Record<LibTab, SortKey> = {
  all: 'addedDate',
  watched: 'watchedDate',
  in_progress: 'watchedDate',
  watchlist: 'addedDate',
  dropped: 'addedDate',
  rewatching: 'watchedDate',
}

function readLS<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const v = localStorage.getItem(key)
  return (v && (allowed as readonly string[]).includes(v)) ? (v as T) : fallback
}

function sortLSKey(tab: LibTab) { return `${LS.sort}-${tab}` }
function readTabSort(tab: LibTab) {
  return readLS<SortKey>(sortLSKey(tab), SORT_KEYS, TAB_DEFAULT_SORT[tab])
}

export function Library() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const library = useStore(s => s.library)
  const settings = useStore(s => s.settings)
  const removeLibraryEntry = useStore(s => s.removeLibraryEntry)
  const undoRewatch = useStore(s => s.undoRewatch)
  const undropMedia = useStore(s => s.undropMedia)
  const reconcileAiredSinceWatched = useStore(s => s.reconcileAiredSinceWatched)
  const initialTab = (TAB_VALUES.includes(searchParams.get('tab') as LibTab) ? searchParams.get('tab') as LibTab : null) ??
    readLS<LibTab>(LS.tab, TAB_VALUES, 'all')
  const [tab, setTab] = useState<LibTab>(initialTab)
  const [search, setSearch] = useState(() => localStorage.getItem(LS.search) ?? '')
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>(
    () => readLS<MediaFilter>(LS.media, ['all', 'movie', 'tv', 'anime'], 'all')
  )
  const [sort, setSort] = useState<SortKey>(() => readTabSort(initialTab))
  const [sortDir, setSortDir] = useState<SortDir>(
    () => readLS<SortDir>(LS.sortDir, ['asc', 'desc'], 'desc')
  )
  const [view, setView] = useState<ViewMode>(
    () => readLS<ViewMode>(LS.view, ['grid', 'list'], 'grid')
  )
  const [editEntry, setEditEntry] = useState<LibraryEntry | null>(null)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = resolvePageSize(settings.pagination?.library, DEFAULT_PAGINATION.library)

  // Virtual grid refs
  const scrollRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [colCount, setColCount] = useState(4)
  const CARD_WIDTH = 160
  const GAP = 12

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width
      setColCount(Math.max(1, Math.floor((w + GAP) / (CARD_WIDTH + GAP))))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => { localStorage.setItem(LS.tab, tab) }, [tab])
  // The Watched and In Progress tabs are where a revived show appears (or vanishes
  // from), so re-check for newly-aired episodes when either is opened (debounced in store).
  useEffect(() => {
    if (tab === 'watched' || tab === 'in_progress') reconcileAiredSinceWatched()
  }, [tab, reconcileAiredSinceWatched])
  useEffect(() => { localStorage.setItem(LS.search, search) }, [search])
  useEffect(() => { localStorage.setItem(LS.media, mediaFilter) }, [mediaFilter])
  useEffect(() => { localStorage.setItem(sortLSKey(tab), sort) }, [sort, tab])
  useEffect(() => { localStorage.setItem(LS.sortDir, sortDir) }, [sortDir])
  useEffect(() => { localStorage.setItem(LS.view, view) }, [view])

  // Tab + media-type scope, before the text filter is applied. The stats row
  // summarises this set, so typing in the filter box doesn't churn the runtime
  // fetch the way per-keystroke recomputation would.
  const scopedEntries = useMemo(() => {
    let entries = Object.values(library)
    if (tab === 'rewatching') entries = entries.filter(isRewatching)
    else if (tab !== 'all') entries = entries.filter((e) => e.status === tab)
    // In Progress mirrors Home's Continue Watching: TV/anime only (movies don't have episodic progress)
    if (tab === 'in_progress') entries = entries.filter((e) => e.mediaType === 'tv' || e.mediaType === 'anime')
    if (mediaFilter !== 'all') entries = entries.filter((e) => e.mediaType === mediaFilter)
    return entries
  }, [library, tab, mediaFilter])

  // Read the denormalised per-entry runtime totals - cheap synchronous sum, no
  // TMDb fetch on view. Totals are maintained on the write path (store.setLibraryEntry).
  const stats = useMemo(() => aggregateEntryStats(scopedEntries), [scopedEntries])

  const filtered = useMemo(() => {
    let entries = scopedEntries
    if (search.trim()) {
      const q = search.toLowerCase()
      entries = entries.filter((e) => e.title.toLowerCase().includes(q))
    }
    // Copy before sorting: when there's no search term `entries` is the memoised
    // scopedEntries array, and an in-place sort would mutate it.
    return [...entries].sort((a, b) => {
      let av: number | string = 0
      let bv: number | string = 0
      switch (sort) {
        case 'title': av = a.title.toLowerCase(); bv = b.title.toLowerCase(); break
        case 'rating': av = a.userRating ?? -1; bv = b.userRating ?? -1; break
        case 'year': av = a.releaseYear ?? 0; bv = b.releaseYear ?? 0; break
        case 'addedDate': av = a.addedDate; bv = b.addedDate; break
        case 'watchedDate':
          av = a.watchedDate ? new Date(a.watchedDate).getTime() : 0
          bv = b.watchedDate ? new Date(b.watchedDate).getTime() : 0
          break
        case 'timeRemaining': av = entryTimeRemaining(a); bv = entryTimeRemaining(b); break
        case 'episodesRemaining': av = entryEpisodesRemaining(a); bv = entryEpisodesRemaining(b); break
      }
      if (typeof av === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av)
      }
      return sortDir === 'asc' ? av - (bv as number) : (bv as number) - av
    })
  }, [scopedEntries, search, sort, sortDir])

  const paged = filtered.slice(0, page * PAGE_SIZE)
  const hasMore = paged.length < filtered.length

  // For grid view: virtualise rows. List view keeps paged rendering (rows are cheap).
  const gridRowCount = Math.ceil(paged.length / colCount)
  const gridVirtualizer = useVirtualizer({
    count: gridRowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => Math.round(CARD_WIDTH * 1.5),
    gap: GAP,
    overscan: 3,
  })

  // Remeasure when column count changes (items reflow)
  useEffect(() => { gridVirtualizer.measure() }, [colCount])
  // Scroll to top when filters change
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0 }, [tab, search, mediaFilter, sort, sortDir, view])

  // Stable callbacks so MediaCard's memo isn't broken every render
  const handleDelete = useCallback(async (entry: LibraryEntry) => {
    await removeLibraryEntry(entry.id)
    toast.success(`Removed ${entry.title}`)
  }, [removeLibraryEntry])
  const handleEdit = useCallback((entry: LibraryEntry) => setEditEntry(entry), [])
  const handleUndoRewatch = useCallback(async (entry: LibraryEntry) => {
    await undoRewatch(entryToTarget(entry))
    toast.success(`Stopped rewatching ${entry.title}`)
  }, [undoRewatch])
  const handleUndrop = useCallback(async (entry: LibraryEntry) => {
    await undropMedia(entryToTarget(entry))
    toast.success(`${entry.title} restored`)
  }, [undropMedia])

  const counts = useMemo(() => {
    const result = { all: 0, watched: 0, watchlist: 0, in_progress: 0, dropped: 0, rewatching: 0 }
    for (const e of Object.values(library)) {
      result.all++
      if (e.status === 'watched') result.watched++
      else if (e.status === 'watchlist') result.watchlist++
      else if (e.status === 'in_progress') result.in_progress++
      else if (e.status === 'dropped') result.dropped++
      if (isRewatching(e)) result.rewatching++
    }
    return result
  }, [library])

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border/50 space-y-3">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <h1 className="font-serif text-xl font-normal mr-2">Library</h1>
          <div className="relative flex-1 min-w-32">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Filter..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 w-full text-sm"
              aria-label="Filter library"
            />
          </div>
          <Select value={mediaFilter} onValueChange={(v) => setMediaFilter(v as typeof mediaFilter)}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <Filter className="h-3 w-3 mr-1 opacity-60" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="movie">Movies</SelectItem>
              <SelectItem value="tv">TV Shows</SelectItem>
              <SelectItem value="anime">Anime</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="h-8 w-40 text-xs">
              <ArrowUpDown className="h-3 w-3 mr-1 opacity-60" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="addedDate">Date Added</SelectItem>
              <SelectItem value="watchedDate">Date Watched</SelectItem>
              <SelectItem value="title">Title</SelectItem>
              <SelectItem value="rating">Rating</SelectItem>
              <SelectItem value="year">Year</SelectItem>
              <SelectItem value="timeRemaining">Time Remaining</SelectItem>
              <SelectItem value="episodesRemaining">Episodes Remaining</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="secondary"
                  onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                  aria-label="Toggle sort direction"
                >
                  {sortDir === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{sortDir === 'asc' ? 'Ascending' : 'Descending'}</TooltipContent>
            </Tooltip>
            {tab !== 'in_progress' && (
              <>
                <Button size="icon-sm" variant={view === 'grid' ? 'default' : 'ghost'} onClick={() => setView('grid')} aria-label="Grid view">
                  <Grid className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon-sm" variant={view === 'list' ? 'default' : 'ghost'} onClick={() => setView('list')} aria-label="List view">
                  <List className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>
        </div>

        <ScrollableRow>
          {STATUS_TABS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => { setTab(value); setSort(readTabSort(value)); setPage(1) }}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors cursor-pointer flex-shrink-0',
                tab === value
                  ? 'bg-primary/15 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              )}
            >
              {label}
              <span className="text-xs opacity-60">{counts[value as keyof typeof counts]}</span>
            </button>
          ))}
        </ScrollableRow>

        {scopedEntries.length > 0 && (
          <MediaStatsBar stats={stats} emphasizeRemaining={tab === 'in_progress'} />
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden">
        <div ref={containerRef} className="p-4 w-full min-w-0 box-border">
          {filtered.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title={search ? 'No results'
                : tab === 'rewatching' ? 'Nothing being rewatched'
                : `Nothing ${tab === 'all' ? 'in your library' : `in ${tab.replace(/_/g, ' ')}`}`}
              description={search ? 'Try a different search term.'
                : tab === 'rewatching' ? 'Start a rewatch from a show’s page to see it here.'
                : 'Start tracking by searching for movies and TV shows.'}
            />
          ) : (view === 'grid' || tab === 'in_progress') ? (
            <div className="space-y-4">
              <div style={{ height: gridVirtualizer.getTotalSize(), position: 'relative' }}>
                {gridVirtualizer.getVirtualItems().map((virtualRow) => {
                  const startIdx = virtualRow.index * colCount
                  const rowEntries = paged.slice(startIdx, startIdx + colCount)
                  return (
                    <div
                      key={virtualRow.key}
                      data-index={virtualRow.index}
                      ref={gridVirtualizer.measureElement}
                      style={{
                        position: 'absolute',
                        top: virtualRow.start,
                        left: 0,
                        right: 0,
                        display: 'grid',
                        gridTemplateColumns: `repeat(${colCount}, ${CARD_WIDTH}px)`,
                        gap: GAP,
                      }}
                    >
                      {rowEntries.map((entry) => (
                        tab === 'in_progress' ? (
                          <ContinueWatchingCard
                            key={entry.id}
                            entry={entry}
                            onNavigate={(path, extraState) => navigate(path, { state: { backLabel: 'Library', ...extraState } })}
                            width={CARD_WIDTH}
                          />
                        ) : (
                          <MediaCard
                            key={entry.id}
                            entry={entry}
                            backLabel="Library"
                            onEdit={handleEdit}
                            onDelete={handleDelete}
                            onUndoRewatch={tab === 'rewatching' ? handleUndoRewatch : undefined}
                            onUndrop={tab === 'dropped' ? handleUndrop : undefined}
                            width={CARD_WIDTH}
                            showDates
                          />
                        )
                      ))}
                    </div>
                  )
                })}
              </div>
              {hasMore && (
                <div className="flex justify-center pt-2 pb-2">
                  <Button variant="outline" onClick={() => setPage((p) => p + 1)}>
                    Load More ({filtered.length - paged.length} remaining)
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-1.5 w-full min-w-0">
              {paged.map((entry) => (
                <ListRow
                  key={entry.id}
                  entry={entry}
                  ratingSystem={settings.ratingSystem}
                  onNavigate={() => navigate(`/detail/${entry.mediaType}/${entry.tmdbId}`, { state: { backLabel: 'Library' } })}
                  onEdit={() => setEditEntry(entry)}
                  onDelete={() => handleDelete(entry)}
                  onUndoRewatch={tab === 'rewatching' ? () => handleUndoRewatch(entry) : undefined}
                  onUndrop={tab === 'dropped' ? () => handleUndrop(entry) : undefined}
                />
              ))}
              {hasMore && (
                <div className="flex justify-center pt-6">
                  <Button variant="outline" onClick={() => setPage((p) => p + 1)}>
                    Load More ({filtered.length - paged.length} remaining)
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {editEntry && (
        <MediaEditSheet open={!!editEntry} onClose={() => setEditEntry(null)} entry={editEntry} />
      )}
    </div>
  )
}

interface CardProps {
  entry: LibraryEntry
  ratingSystem: string
  onNavigate: () => void
  onEdit: () => void
  onDelete: () => void
  onUndoRewatch?: () => void
  onUndrop?: () => void
}

function ListRow({ entry, ratingSystem, onNavigate, onEdit, onDelete, onUndoRewatch, onUndrop }: CardProps) {
  const imgSrc = posterUrl(entry.posterPath, 'w92')
  const watchedEps = entry.tvProgress
    ? Object.values(entry.tvProgress).filter((v) => v.watchedAt).length
    : null

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border/40 hover:border-border transition-colors cursor-pointer"
      onClick={onNavigate}
      role="article"
    >
      <div className="h-16 w-11 rounded overflow-hidden flex-shrink-0 bg-secondary">
        {imgSrc ? (
          <img src={imgSrc} alt={entry.title} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">?</div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{entry.title}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <Badge variant="outline" className="text-[10px] px-1.5">{mediaLabel(entry.mediaType)}</Badge>
          {entry.releaseYear && <span className="text-xs text-muted-foreground">{entry.releaseYear}</span>}
          {watchedEps !== null && <span className="text-xs text-muted-foreground">{watchedEps} ep watched</span>}
        </div>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <span className="text-[11px] text-muted-foreground">Added {fmtDate(entry.addedDate, 'MMM d, yyyy')}</span>
          {entry.watchedDate && (
            <span className="text-[11px] text-muted-foreground">Watched {fmtDate(entry.watchedDate, 'MMM d, yyyy')}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 flex-shrink-0">
        <span className={cn('text-xs font-medium', statusColor(entry.status))}>{statusLabel(entry.status)}</span>
        {entry.userRating != null && (
          <span className="flex items-center gap-0.5 text-xs text-warning font-medium">
            <Star className="h-3 w-3 fill-warning" />
            {fmtRating(entry.userRating, ratingSystem as '10star' | '5star')}
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button size="icon-sm" variant="ghost" aria-label="More options">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit() }}>
              <Edit2 className="h-3.5 w-3.5 mr-2" /> Edit
            </DropdownMenuItem>
            {onUndoRewatch && (
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onUndoRewatch() }}>
                <RotateCcw className="h-3.5 w-3.5 mr-2" /> Undo rewatch
              </DropdownMenuItem>
            )}
            {onUndrop && (
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onUndrop() }}>
                <Undo2 className="h-3.5 w-3.5 mr-2" /> Undo drop
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={(e) => { e.stopPropagation(); onDelete() }}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5 mr-2" /> Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
