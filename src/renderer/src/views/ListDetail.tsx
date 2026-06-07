import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Trash2, Film, Tv, Search, ArrowUp, ArrowDown, Zap, RefreshCw, Star, MessageSquare, Repeat2, Filter, ArrowUpDown, Edit2 } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useStore } from '../lib/store'
import { useMediaStats, isEpisodeItem, parseEpisodeItem } from '../lib/mediaStats'
import type { LibraryEntry, ListItemMeta, ListRules } from '../types'
import { cn, posterUrl, fmtDate, fmtRating, statusLabel, resolvePageSize, DEFAULT_PAGINATION, effectiveRating } from '../lib/utils'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { Badge } from '../components/ui/badge'
import { EmptyState } from '../components/shared/EmptyState'
import { MarkdownContent } from '../components/shared/MarkdownContent'
import { ListFormModal } from '../components/shared/ListFormModal'
import { MediaStatsBar } from '../components/shared/MediaStatsBar'
import { FIELD_META, OPERATOR_LABEL, normalizeScope } from '../lib/rulesEngine'
import { toast } from 'sonner'

type ItemSortKey = 'order' | 'title' | 'year' | 'rating' | 'watchedDate' | 'addedDate'
type MediaFilter = 'all' | 'movie' | 'tv' | 'anime' | 'episode'
type SortDir = 'asc' | 'desc'

const LS = {
  search: 'cinemate-list-detail-search',
  media: 'cinemate-list-detail-media',
  sort: 'cinemate-list-detail-sort',
  sortDir: 'cinemate-list-detail-sort-dir',
} as const

const ITEM_SORT_KEYS: ItemSortKey[] = ['order', 'title', 'year', 'rating', 'watchedDate', 'addedDate']
const MEDIA_FILTERS: MediaFilter[] = ['all', 'movie', 'tv', 'anime', 'episode']
const SORT_DIRS: SortDir[] = ['asc', 'desc']

function readLS<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const v = localStorage.getItem(key)
  return (v && (allowed as readonly string[]).includes(v)) ? (v as T) : fallback
}

/**
 * Build a display-only LibraryEntry for a list item that isn't in the library.
 * The card and the sort/filter pipeline only read title/year/mediaType/poster
 * for these; the watch-status fields stay neutral and are never rendered for a
 * standalone item (the card hides them when inLibrary is false).
 */
function synthEntry(id: string, meta: ListItemMeta): LibraryEntry {
  return {
    id,
    mediaType: meta.mediaType,
    tmdbId: meta.tmdbId,
    title: meta.title,
    posterPath: meta.posterPath,
    backdropPath: null,
    releaseYear: meta.releaseYear,
    status: 'watchlist',          // inert - standalone cards never render status
    userRating: null,
    review: '',
    watchedDate: null,
    addedDate: meta.addedAt ?? 0,
    listIds: [],
    genreIds: [],
    tvProgress: null,
    seasonRatings: {},
    runtime: null,
  }
}

export function ListDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const lists = useStore(s => s.lists)
  const library = useStore(s => s.library)
  const watchHistory = useStore(s => s.watchHistory)
  const ratingSystem = useStore(s => s.settings.ratingSystem)
  const listItemsPageSize = useStore(s => s.settings.pagination?.listItems)
  const removeListItem = useStore(s => s.removeListItem)
  const setList = useStore(s => s.setList)
  const recomputeAutoLists = useStore(s => s.recomputeAutoLists)
  const PAGE_SIZE = resolvePageSize(listItemsPageSize, DEFAULT_PAGINATION.listItems)

  const scrollRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const [colCount, setColCount] = useState(4)
  const [scrollMargin, setScrollMargin] = useState(0)
  const CARD_WIDTH = 140
  const GAP = 16

  const measureScrollMargin = useCallback(() => {
    if (!gridRef.current) return
    let offset = 0
    let node: HTMLElement | null = gridRef.current
    while (node && node !== scrollRef.current) {
      offset += node.offsetTop
      node = node.offsetParent as HTMLElement | null
    }
    setScrollMargin(offset)
  }, [])

  const list = lists.find((l) => l.id === id)

  const itemIds = list?.itemIds ?? []
  const itemMeta = list?.itemMeta

  // Resolve a non-episode item to a display entry: the live library entry if
  // present, otherwise a synthesized entry from the list's stored metadata
  // (a list item doesn't need to be in the library). Returns null if neither.
  const resolveEntry = useCallback((itemId: string): LibraryEntry | null => {
    const lib = library[itemId]
    if (lib) return lib
    const meta = itemMeta?.[itemId]
    return meta ? synthEntry(itemId, meta) : null
  }, [library, itemMeta])

  // Show items backed by the library OR by list metadata. Episode items are
  // always library-backed (their show lives in the library).
  const validItemIds = useMemo(() => itemIds.filter(itemId => {
    if (isEpisodeItem(itemId)) return library[parseEpisodeItem(itemId).libId] !== undefined
    return library[itemId] !== undefined || itemMeta?.[itemId] !== undefined
  }), [itemIds, library, itemMeta])

  const stats = useMediaStats(validItemIds, library, itemMeta)

  const [search, setSearch] = useState(() => localStorage.getItem(LS.search) ?? '')
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>(
    () => readLS<MediaFilter>(LS.media, MEDIA_FILTERS, 'all')
  )
  const [sort, setSort] = useState<ItemSortKey>(
    () => readLS<ItemSortKey>(LS.sort, ITEM_SORT_KEYS, 'order')
  )
  const [sortDir, setSortDir] = useState<SortDir>(
    () => readLS<SortDir>(LS.sortDir, SORT_DIRS, 'asc')
  )

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [editOpen, setEditOpen] = useState(false)

  useEffect(() => { localStorage.setItem(LS.search, search) }, [search])
  useEffect(() => { localStorage.setItem(LS.media, mediaFilter) }, [mediaFilter])
  useEffect(() => { localStorage.setItem(LS.sort, sort) }, [sort])
  useEffect(() => { localStorage.setItem(LS.sortDir, sortDir) }, [sortDir])
  // Reset paging when the result set changes (filters/sort), the page size
  // setting changes, or we navigate to a different list.
  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [search, mediaFilter, sort, sortDir, PAGE_SIZE, id])

  const visibleItemIds = useMemo(() => {
    let items = validItemIds.map((itemId, originalIndex) => {
      const isEpisode = isEpisodeItem(itemId)
      const episodeKey = isEpisode ? parseEpisodeItem(itemId).episodeKey : undefined
      const libId = isEpisode ? parseEpisodeItem(itemId).libId : itemId
      const entry = isEpisode ? library[libId]! : resolveEntry(itemId)!
      return { itemId, originalIndex, isEpisode, episodeKey, entry }
    })

    if (mediaFilter === 'episode') {
      items = items.filter(({ isEpisode }) => isEpisode)
    } else if (mediaFilter !== 'all') {
      items = items.filter(({ entry, isEpisode }) => !isEpisode && entry.mediaType === mediaFilter)
    }
    const q = search.trim().toLowerCase()
    if (q) {
      items = items.filter(({ entry }) => entry.title.toLowerCase().includes(q))
    }

    // For episode items, pull the per-episode rating / watchedAt out of
    // tvProgress rather than from the parent show row - otherwise every
    // episode of a 9-rated show sorts above every episode of an 8-rated show
    // regardless of how each individual episode was actually rated.
    const ratingOf = (it: typeof items[number]): number | null =>
      effectiveRating(it.entry, it.isEpisode ? it.episodeKey : undefined)
    const watchedTsOf = (it: typeof items[number]): number => {
      if (it.isEpisode && it.episodeKey) {
        const at = it.entry.tvProgress?.[it.episodeKey]?.watchedAt
        return at ? new Date(at).getTime() : 0
      }
      return it.entry.watchedDate ? new Date(it.entry.watchedDate).getTime() : 0
    }

    items.sort((a, b) => {
      if (sort === 'order') {
        return sortDir === 'asc' ? a.originalIndex - b.originalIndex : b.originalIndex - a.originalIndex
      }
      let av: number | string = 0
      let bv: number | string = 0
      switch (sort) {
        case 'title':
          av = a.entry.title.toLowerCase(); bv = b.entry.title.toLowerCase(); break
        case 'year':
          av = a.entry.releaseYear ?? 0; bv = b.entry.releaseYear ?? 0; break
        case 'rating':
          av = ratingOf(a) ?? -1; bv = ratingOf(b) ?? -1; break
        case 'addedDate':
          av = a.entry.addedDate; bv = b.entry.addedDate; break
        case 'watchedDate':
          av = watchedTsOf(a); bv = watchedTsOf(b); break
      }
      if (typeof av === 'string') {
        return sortDir === 'asc'
          ? av.localeCompare(bv as string)
          : (bv as string).localeCompare(av)
      }
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number)
    })

    return items.map((i) => i.itemId)
  }, [validItemIds, library, resolveEntry, mediaFilter, search, sort, sortDir])

  // Only the first `visibleCount` filtered items are rendered; the rest load
  // on demand via the Load More button below the grid.
  const pagedItemIds = useMemo(
    () => visibleItemIds.slice(0, visibleCount),
    [visibleItemIds, visibleCount]
  )

  const filtersActive = !!search.trim() || mediaFilter !== 'all'

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

  // Re-measure whenever the container height changes (description reflow)
  useLayoutEffect(() => {
    measureScrollMargin()
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(measureScrollMargin)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measureScrollMargin])

  const rowCount = Math.ceil(pagedItemIds.length / colCount)
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => Math.round(CARD_WIDTH * 1.5) + GAP,
    overscan: 3,
    scrollMargin,
  })
  useEffect(() => { rowVirtualizer.measure() }, [colCount])
  useEffect(() => { rowVirtualizer.measure() }, [pagedItemIds.length])

  if (!list) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-muted-foreground text-sm">List not found.</p>
        <Button variant="outline" onClick={() => navigate('/lists')}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Lists
        </Button>
      </div>
    )
  }

  const isSmart = !!list.rules?.enabled

  const handleRemove = async (itemId: string) => {
    if (isSmart) return
    await removeListItem(list, itemId)
    toast.success('Removed from list')
  }

  const handleEdit = async (name: string, description: string, rules: ListRules) => {
    await setList({ ...list, name, description, rules })
    toast.success('List updated')
    setEditOpen(false)
  }

  const [refreshing, setRefreshing] = useState(false)
  const handleRefresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    const start = Date.now()
    try {
      await recomputeAutoLists()
    } finally {
      const elapsed = Date.now() - start
      const wait = Math.max(0, 600 - elapsed)
      setTimeout(() => {
        setRefreshing(false)
        toast.success('Smart list refreshed')
      }, wait)
    }
  }

  return (
    <>
    <div ref={scrollRef} className="h-full overflow-y-auto overflow-x-hidden">
      <div ref={containerRef} className="p-4 space-y-4">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate('/lists')} className="-ml-2 mb-3 gap-1">
            <ArrowLeft className="h-4 w-4" /> Lists
          </Button>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="font-serif text-2xl font-normal">{list.name}</h1>
            {isSmart && (
              <Badge variant="default" className="gap-1">
                <Zap className="h-3 w-3" />
                Smart list
              </Badge>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setEditOpen(true)}
                  aria-label="Edit list"
                >
                  <Edit2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Edit list</TooltipContent>
            </Tooltip>
            {isSmart && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={handleRefresh}
                    disabled={refreshing}
                    aria-label="Recompute now"
                    aria-busy={refreshing}
                    className="disabled:opacity-60"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 transition-transform${refreshing ? ' animate-spin text-primary' : ''}`} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{refreshing ? 'Recomputing...' : 'Recompute now'}</TooltipContent>
              </Tooltip>
            )}
          </div>
          {list.description && (
            <CollapsibleDescription description={list.description} />
          )}
          {isSmart && list.rules && <RuleSummary rules={list.rules} />}
          <p className="text-xs text-muted-foreground mt-2">
            {filtersActive && visibleItemIds.length !== validItemIds.length
              ? <>Showing {visibleItemIds.length} of {validItemIds.length} item{validItemIds.length !== 1 ? 's' : ''}</>
              : <>{validItemIds.length} item{validItemIds.length !== 1 ? 's' : ''}</>}
          </p>

          {validItemIds.length > 0 && (
            <MediaStatsBar stats={stats} className="mt-1.5" />
          )}
        </div>

        {validItemIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-32">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Filter..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 w-full text-sm"
                aria-label="Filter items"
              />
            </div>
            <Select value={mediaFilter} onValueChange={(v) => setMediaFilter(v as MediaFilter)}>
              <SelectTrigger className="h-8 w-32 text-xs">
                <Filter className="h-3 w-3 mr-1 opacity-60" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="movie">Movies</SelectItem>
                <SelectItem value="tv">TV Shows</SelectItem>
                <SelectItem value="anime">Anime</SelectItem>
                <SelectItem value="episode">Episodes</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(v) => setSort(v as ItemSortKey)}>
              <SelectTrigger className="h-8 w-40 text-xs">
                <ArrowUpDown className="h-3 w-3 mr-1 opacity-60" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="order">List Order</SelectItem>
                <SelectItem value="title">Title</SelectItem>
                <SelectItem value="year">Year</SelectItem>
                <SelectItem value="rating">Rating</SelectItem>
                <SelectItem value="watchedDate">Date Watched</SelectItem>
                <SelectItem value="addedDate">Date Added</SelectItem>
              </SelectContent>
            </Select>
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
          </div>
        )}

        {validItemIds.length === 0 ? (
          <EmptyState
            icon={Film}
            title="This list is empty"
            description="Add items from any movie or TV show's detail page."
          />
        ) : visibleItemIds.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No matching items"
            description="Try a different search term or filter."
          />
        ) : (
          <>
          <div ref={gridRef} style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const startIdx = virtualRow.index * colCount
              const rowIds = pagedItemIds.slice(startIdx, startIdx + colCount)
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: virtualRow.start - scrollMargin,
                    left: 0,
                    right: 0,
                    display: 'grid',
                    gridTemplateColumns: `repeat(${colCount}, ${CARD_WIDTH}px)`,
                    justifyContent: 'start',
                    columnGap: GAP,
                    rowGap: 0,
                    paddingBottom: GAP,
                  }}
                >
                  {rowIds.map((itemId) => {
                    if (isEpisodeItem(itemId)) {
                      const { libId, episodeKey } = parseEpisodeItem(itemId)
                      const show = library[libId]!
                      const plays = watchHistory.filter(h => h.mediaId === libId && h.episodeKey === episodeKey).length
                      return (
                        <EpisodeListCard
                          key={itemId}
                          show={show}
                          episodeKey={episodeKey}
                          playCount={plays}
                          ratingSystem={ratingSystem}
                          onNavigate={() => navigate(`/detail/${show.mediaType}/${show.tmdbId}`, { state: { backLabel: 'List' } })}
                          onRemove={isSmart ? undefined : () => handleRemove(itemId)}
                        />
                      )
                    }
                    const inLibrary = library[itemId] !== undefined
                    const entry = resolveEntry(itemId)!
                    const plays = inLibrary ? watchHistory.filter(h => h.mediaId === entry.id && !h.episodeKey).length : 0
                    return (
                      <ListItemCard
                        key={itemId}
                        entry={entry}
                        inLibrary={inLibrary}
                        playCount={plays}
                        ratingSystem={ratingSystem}
                        onNavigate={() => navigate(`/detail/${entry.mediaType}/${entry.tmdbId}`, { state: { backLabel: 'List' } })}
                        onRemove={isSmart ? undefined : () => handleRemove(itemId)}
                      />
                    )
                  })}
                </div>
              )
            })}
          </div>
          {pagedItemIds.length < visibleItemIds.length && (
            <div className="flex justify-center pt-2 pb-4">
              <Button variant="outline" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
                Load More ({visibleItemIds.length - pagedItemIds.length} remaining)
              </Button>
            </div>
          )}
          </>
        )}
      </div>
    </div>
    <ListFormModal
      open={editOpen}
      onClose={() => setEditOpen(false)}
      onSave={handleEdit}
      title="Edit List"
      initialName={list.name}
      initialDescription={list.description}
      initialRules={list.rules}
    />
    </>
  )
}

interface ListItemCardProps {
  entry: ReturnType<typeof useStore.getState>['library'][string]
  inLibrary: boolean
  playCount: number
  ratingSystem: '10star' | '5star'
  onNavigate: () => void
  onRemove?: () => void
}

function ListItemCard({ entry, inLibrary, playCount, ratingSystem, onNavigate, onRemove }: ListItemCardProps) {
  const [imgLoaded, setImgLoaded] = useState(false)
  const imgSrc = posterUrl(entry.posterPath, 'w300')
  const hasReview = !!entry.review?.trim()
  const watched = entry.watchedDate ? fmtDate(entry.watchedDate, 'MMM d, yyyy') : null
  const showRewatchBadge = playCount > 1
  const showWatched = entry.status === 'watched' && watched

  return (
    <div
      className="group relative rounded-lg cursor-pointer focus-within:ring-2 focus-within:ring-ring"
      onClick={onNavigate}
      role="article"
      aria-label={entry.title}
    >
      <div className="relative w-full aspect-[2/3] rounded-lg overflow-hidden bg-secondary ring-1 ring-border/40 group-hover:ring-primary/50 transition-all duration-200">
        {!imgLoaded && <div className="absolute inset-0 skeleton" />}
        {imgSrc ? (
          <img
            src={imgSrc}
            alt={entry.title}
            className={cn(
              'absolute inset-0 w-full h-full object-cover transition-all duration-300 group-hover:scale-[1.03]',
              imgLoaded ? 'opacity-100' : 'opacity-0'
            )}
            onLoad={() => setImgLoaded(true)}
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground p-2 text-center">
            {entry.title}
          </div>
        )}

        {/* Remove button - top right (hover) */}
        {onRemove && (
          <div className="absolute top-1.5 right-1.5 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              size="icon-sm"
              variant="ghost"
              className="h-6 w-6 bg-black/50 hover:bg-destructive/80 text-white rounded-md"
              onClick={(e) => { e.stopPropagation(); onRemove() }}
              aria-label="Remove from list"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        )}

        {/* Bottom gradient overlay - all info lives here */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/80 to-transparent pt-12 pb-2.5 px-2.5">
          {(showRewatchBadge || hasReview) && (
            <div className="flex items-center gap-1 mb-1.5">
              {showRewatchBadge && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-black/65 px-1.5 py-0.5 text-[10px] text-white">
                      <Repeat2 className="h-2.5 w-2.5" /> {playCount}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{playCount} plays</TooltipContent>
                </Tooltip>
              )}
              {hasReview && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center justify-center rounded-full bg-black/65 px-1 py-0.5">
                      <MessageSquare className="h-2.5 w-2.5 text-white" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Has review</TooltipContent>
                </Tooltip>
              )}
            </div>
          )}
          {entry.userRating != null && (
            <span className="flex items-center gap-0.5 text-[10px] text-warning font-medium ml-auto">
              <Star className="h-2.5 w-2.5 fill-warning" />
              {fmtRating(entry.userRating, ratingSystem)}
            </span>
          )}
          <p className="text-[11px] font-semibold text-white line-clamp-2 leading-tight">{entry.title}</p>
          <p className="text-[10px] text-white/70 leading-tight truncate mt-0.5">
            {inLibrary
              ? (showWatched ? `Watched ${watched}` : statusLabel(entry.status))
              : (entry.releaseYear ?? '')}
          </p>
        </div>
      </div>
    </div>
  )
}

interface EpisodeListCardProps {
  show: ReturnType<typeof useStore.getState>['library'][string]
  episodeKey: string
  playCount: number
  ratingSystem: '10star' | '5star'
  onNavigate: () => void
  onRemove?: () => void
}

function EpisodeListCard({ show, episodeKey, playCount, ratingSystem, onNavigate, onRemove }: EpisodeListCardProps) {
  const [imgLoaded, setImgLoaded] = useState(false)
  const imgSrc = posterUrl(show.posterPath, 'w300')
  const [sNum, eNum] = episodeKey.split(':')
  const epLabel = `S${sNum}E${eNum}`

  const progress = show.tvProgress?.[episodeKey] ?? null
  const watched = progress?.watchedAt ? fmtDate(progress.watchedAt, 'MMM d, yyyy') : null
  const hasNote = !!progress?.note?.trim()
  const epRating = progress?.rating ?? null
  const showRewatchBadge = playCount > 1

  return (
    <div
      className="group relative rounded-lg cursor-pointer focus-within:ring-2 focus-within:ring-ring"
      onClick={onNavigate}
      role="article"
      aria-label={`${show.title} ${epLabel}`}
    >
      <div className="relative w-full aspect-[2/3] rounded-lg overflow-hidden bg-secondary ring-1 ring-border/40 group-hover:ring-primary/50 transition-all duration-200">
        {!imgLoaded && <div className="absolute inset-0 skeleton" />}
        {imgSrc ? (
          <img
            src={imgSrc}
            alt={show.title}
            className={cn(
              'absolute inset-0 w-full h-full object-cover transition-all duration-300 group-hover:scale-[1.03]',
              imgLoaded ? 'opacity-100' : 'opacity-0'
            )}
            onLoad={() => setImgLoaded(true)}
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground p-2 text-center">
            {show.title}
          </div>
        )}

        {/* Episode label badge - top left */}
        <div className="absolute top-1.5 left-1.5 z-10 inline-flex items-center gap-1 rounded-full bg-black/65 px-1.5 py-0.5">
          <Tv className="h-2.5 w-2.5 text-white/80" />
          <span className="text-[10px] font-mono text-white font-medium">{epLabel}</span>
        </div>

        {/* Remove button - top right (hover) */}
        {onRemove && (
          <div className="absolute top-1.5 right-1.5 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              size="icon-sm"
              variant="ghost"
              className="h-6 w-6 bg-black/50 hover:bg-destructive/80 text-white rounded-md"
              onClick={(e) => { e.stopPropagation(); onRemove() }}
              aria-label="Remove from list"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        )}

        {/* Bottom gradient overlay - all info lives here */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/80 to-transparent pt-12 pb-2.5 px-2.5">
          {(showRewatchBadge || hasNote) && (
            <div className="flex items-center gap-1 mb-1.5">
              {showRewatchBadge && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-black/65 px-1.5 py-0.5 text-[10px] text-white">
                      <Repeat2 className="h-2.5 w-2.5" /> {playCount}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{playCount} plays</TooltipContent>
                </Tooltip>
              )}
              {hasNote && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center justify-center rounded-full bg-black/65 px-1 py-0.5">
                      <MessageSquare className="h-2.5 w-2.5 text-white" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Has note</TooltipContent>
                </Tooltip>
              )}
            </div>
          )}
          {epRating != null && (
            <span className="flex items-center gap-0.5 text-[10px] text-warning font-medium ml-auto">
              <Star className="h-2.5 w-2.5 fill-warning" />
              {fmtRating(epRating, ratingSystem)}
            </span>
          )}
          <p className="text-[11px] font-semibold text-white line-clamp-2 leading-tight">{show.title}</p>
          <p className="text-[10px] text-white/70 leading-tight truncate mt-0.5">
            {watched ? `Watched ${watched}` : 'Unwatched'}
          </p>
        </div>
      </div>
    </div>
  )
}

const COLLAPSED_MAX_HEIGHT = 88

function CollapsibleDescription({ description }: { description: string }) {
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return
    const check = () => setOverflows(el.scrollHeight > COLLAPSED_MAX_HEIGHT + 1)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [description])

  const collapsed = overflows && !expanded
  const maskStyle: React.CSSProperties = collapsed
    ? {
        maxHeight: COLLAPSED_MAX_HEIGHT,
        overflow: 'hidden',
        maskImage: 'linear-gradient(to bottom, black 60%, transparent)',
        WebkitMaskImage: 'linear-gradient(to bottom, black 60%, transparent)',
      }
    : {}

  return (
    <div className="mt-2">
      <div ref={contentRef} style={maskStyle}>
        <MarkdownContent>{description}</MarkdownContent>
      </div>
      {overflows && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-primary mt-1.5 hover:underline cursor-pointer"
        >
          {expanded ? 'See less' : 'See more'}
        </button>
      )}
    </div>
  )
}

function RuleSummary({ rules }: { rules: NonNullable<ReturnType<typeof useStore.getState>['lists'][number]['rules']> }) {
  if (rules.rules.length === 0) {
    return (
      <p className="text-xs text-muted-foreground mt-2 italic">
        No rules defined yet - edit the list to add some.
      </p>
    )
  }
  const scope = normalizeScope(rules.scope)
  const scopeBits: string[] = []
  if (scope.movies) scopeBits.push('movies')
  if (scope.shows) scopeBits.push('TV shows')
  if (scope.episodes) scopeBits.push('episodes')
  const scopeLabel = scopeBits.length === 0 ? 'nothing' : scopeBits.join(' + ')
  return (
    <div className="mt-2 text-xs text-muted-foreground flex flex-wrap items-center gap-1">
      <span>Add <span className="text-foreground/80 font-medium">{scopeLabel}</span> matching {rules.combinator}:</span>
      {rules.rules.map((r, i) => {
        const meta = FIELD_META[r.field]
        const op = OPERATOR_LABEL[r.operator]
        let display: string
        if (r.operator === 'is_set' || r.operator === 'is_not_set' || r.operator === 'is_true' || r.operator === 'is_false') {
          display = op
        } else if (r.operator === 'between') {
          display = `${op} ${r.value ?? '?'}-${r.value2 ?? '?'}`
        } else if (r.operator === 'in' || r.operator === 'not_in') {
          display = `${op} ${(r.values ?? []).join(', ') || '?'}`
        } else {
          display = `${op} ${r.value ?? '?'}`
        }
        return (
          <span key={r.id} className="inline-flex items-center gap-1">
            <Badge variant="outline" className="text-[10px] py-0">
              {meta?.label ?? r.field} {display}
            </Badge>
            {i < rules.rules.length - 1 && (
              <span className="text-[10px] text-muted-foreground/60 uppercase">
                {rules.combinator === 'all' ? 'and' : 'or'}
              </span>
            )}
          </span>
        )
      })}
    </div>
  )
}
