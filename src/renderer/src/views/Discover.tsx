import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Film, Tv, Layers, Star } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { getMovieGenres, getTVGenres, discoverMovies, discoverTV } from '../lib/tmdb'
import { useStore } from '../lib/store'
import { MediaCard, MediaCardSkeleton } from '../components/shared/MediaCard'
import { Button } from '../components/ui/button'
import { EmptyState } from '../components/shared/EmptyState'
import { Skeleton } from '../components/ui/skeleton'
import type { TMDbGenre, TMDbSearchResult } from '../types'

const currentDecade = Math.floor(new Date().getFullYear() / 10) * 10
const DECADES = Array.from(
  { length: Math.floor((currentDecade - 1920) / 10) + 2 },
  (_, i) => currentDecade - i * 10
).concat([-1]) // -1 = pre-1920
const SORT_OPTIONS = [
  { value: 'popularity.desc', label: 'Most Popular' },
  { value: 'vote_average.desc', label: 'Highest Rated' },
  { value: 'release_date.desc', label: 'Newest' }
]

const GAP = 12
const CARD_WIDTH = 150

type MediaFilter = 'all' | 'movie' | 'tv' | 'anime'

const MEDIA_TABS: { value: MediaFilter; label: string; icon: React.ReactNode }[] = [
  { value: 'all', label: 'All', icon: <Layers className="h-3.5 w-3.5" /> },
  { value: 'movie', label: 'Movies', icon: <Film className="h-3.5 w-3.5" /> },
  { value: 'tv', label: 'TV Shows', icon: <Tv className="h-3.5 w-3.5" /> },
  { value: 'anime', label: 'Anime', icon: <Star className="h-3.5 w-3.5" /> }
]

export function Discover() {
  const settings = useStore(s => s.settings)
  const [mediaType, setMediaType] = useState<MediaFilter>('all')
  const [genres, setGenres] = useState<TMDbGenre[]>([])
  const [selectedGenre, setSelectedGenre] = useState<number | null>(null)
  const [selectedDecade, setSelectedDecade] = useState<number | null>(null)
  const [sortBy, setSortBy] = useState('popularity.desc')
  const [results, setResults] = useState<TMDbSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [genresLoading, setGenresLoading] = useState(false)

  // Virtual grid state
  const scrollRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [colCount, setColCount] = useState(5)

  // Compute column count from container width
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

  const rowCount = Math.ceil(results.length / colCount)

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    // Card is just the poster (aspect 2/3) - title/year/rating are overlaid in the
    // gradient, not a separate info bar. Real heights come from measureElement on mount;
    // gap between rows is handled by the virtualizer's `gap`.
    estimateSize: () => Math.round(CARD_WIDTH * 1.5),
    gap: GAP,
    overscan: 3,
  })

  // Invalidate height cache when column count changes (items reflow into different rows)
  useEffect(() => {
    rowVirtualizer.measure()
  }, [colCount])

  const showGenres = mediaType === 'movie' || mediaType === 'tv'

  useEffect(() => {
    setSelectedGenre(null)
    if (!settings.apiKey || !showGenres) { setGenres([]); return }
    setGenresLoading(true)
    const fn = mediaType === 'movie' ? getMovieGenres() : getTVGenres()
    fn.then((d) => setGenres(d.genres)).catch(console.error).finally(() => setGenresLoading(false))
  }, [mediaType, settings.apiKey])

  const buildParams = useCallback((type: 'movie' | 'tv', extra: Record<string, string | number> = {}) => {
    const params: Record<string, string | number> = {
      sort_by: sortBy,
      'vote_count.gte': sortBy === 'vote_average.desc' ? 500 : 50,
      ...extra
    }
    if (selectedGenre && showGenres) params.with_genres = selectedGenre
    const datePrefix = type === 'movie' ? 'primary_release_date' : 'first_air_date'
    if (selectedDecade === -1) {
      params[`${datePrefix}.lte`] = '1919-12-31'
    } else if (selectedDecade) {
      params[`${datePrefix}.gte`] = `${selectedDecade}-01-01`
      params[`${datePrefix}.lte`] = `${selectedDecade + 9}-12-31`
    }
    return params
  }, [sortBy, selectedGenre, selectedDecade, showGenres])

  const doDiscover = useCallback(async (p: number) => {
    if (!settings.apiKey) return
    setLoading(true)
    try {
      if (mediaType === 'all') {
        const [movieData, tvData] = await Promise.all([
          discoverMovies(buildParams('movie'), p),
          discoverTV(buildParams('tv'), p)
        ])
        const merged = [
          ...movieData.results.map((r) => ({ ...r, media_type: 'movie' as const })),
          ...tvData.results.map((r) => ({ ...r, media_type: 'tv' as const }))
        ].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
        setResults(p === 1 ? merged : (prev) => [...prev, ...merged])
        setTotalPages(Math.min(movieData.total_pages, tvData.total_pages))
      } else if (mediaType === 'anime') {
        const data = await discoverTV(buildParams('tv', { with_genres: 16, with_origin_country: 'JP' }), p)
        setResults(p === 1 ? data.results : (prev) => [...prev, ...data.results])
        setTotalPages(data.total_pages)
      } else {
        const data = await (mediaType === 'movie' ? discoverMovies(buildParams('movie'), p) : discoverTV(buildParams('tv'), p))
        setResults(p === 1 ? data.results : (prev) => [...prev, ...data.results])
        setTotalPages(data.total_pages)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [mediaType, buildParams, settings.apiKey])

  useEffect(() => {
    setPage(1)
    setResults([])
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    doDiscover(1)
  }, [mediaType, selectedGenre, selectedDecade, sortBy])

  const handleLoadMore = () => {
    const next = page + 1
    setPage(next)
    doDiscover(next)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header/filters */}
      <div className="p-4 border-b border-border/50 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="font-serif text-xl font-normal mr-4">Discover</h1>
          {MEDIA_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setMediaType(tab.value)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors cursor-pointer ${mediaType === tab.value ? 'bg-primary/15 text-primary font-medium' : 'text-muted-foreground hover:bg-secondary'}`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* Sort */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground font-medium">Sort:</span>
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSortBy(opt.value)}
              className={`px-2.5 py-1 rounded-md text-xs transition-colors cursor-pointer ${sortBy === opt.value ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Genres */}
        {showGenres && (
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground font-medium">Genre:</span>
              <button
                onClick={() => setSelectedGenre(null)}
                className={`px-2.5 py-1 rounded-full text-xs transition-colors cursor-pointer ${selectedGenre === null ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
              >
                All
              </button>
              {genresLoading
                ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-6 w-16 rounded-full" />)
                : genres.map((g) => (
                    <button
                      key={g.id}
                      onClick={() => setSelectedGenre(selectedGenre === g.id ? null : g.id)}
                      className={`px-2.5 py-1 rounded-full text-xs transition-colors cursor-pointer ${selectedGenre === g.id ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
                    >
                      {g.name}
                    </button>
                  ))}
            </div>
          </div>
        )}

        {/* Decades */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground font-medium">Decade:</span>
          <button
            onClick={() => setSelectedDecade(null)}
            className={`px-2.5 py-1 rounded-full text-xs transition-colors cursor-pointer ${selectedDecade === null ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
          >
            All
          </button>
          {DECADES.map((d) => (
            <button
              key={d}
              onClick={() => setSelectedDecade(selectedDecade === d ? null : d)}
              className={`px-2.5 py-1 rounded-full text-xs transition-colors cursor-pointer ${selectedDecade === d ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
            >
              {d === -1 ? 'Earlier' : `${d}s`}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable grid area - plain div so virtualizer can use it as scroll element */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden">
        <div ref={containerRef} className="p-4">
          {!settings.apiKey ? (
            <EmptyState icon={Film} title="No API key" description="Configure your TMDb API key in Settings to use Discover." />
          ) : loading && results.length === 0 ? (
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, ${CARD_WIDTH}px)` }}>
              {Array.from({ length: 16 }, (_, i) => <MediaCardSkeleton key={i} />)}
            </div>
          ) : results.length === 0 ? (
            <EmptyState icon={Film} title="No results" description="Try adjusting your filters." />
          ) : (
            <div className="space-y-4">
              {/* Virtual grid: only visible rows are in the DOM */}
              <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const startIdx = virtualRow.index * colCount
                  const rowItems = results.slice(startIdx, startIdx + colCount)
                  return (
                    <div
                      key={virtualRow.key}
                      data-index={virtualRow.index}
                      ref={rowVirtualizer.measureElement}
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
                      {rowItems.map((item) => {
                        const tmdbType = mediaType === 'all'
                          ? (item.media_type as 'movie' | 'tv' | undefined) ?? 'movie'
                          : mediaType === 'anime' ? 'tv' : mediaType
                        const appType = mediaType === 'anime' ? 'anime' : tmdbType
                        return (
                          <MediaCard
                            key={`${appType}:${item.id}`}
                            item={{ ...item, media_type: tmdbType }}
                            mediaType={appType}
                            backLabel="Discover"
                            width={CARD_WIDTH}
                          />
                        )
                      })}
                    </div>
                  )
                })}
              </div>

              {page < totalPages && !loading && (
                <div className="flex justify-center">
                  <Button variant="outline" onClick={handleLoadMore}>Load More</Button>
                </div>
              )}
              {loading && (
                <div
                  className="grid"
                  style={{ gridTemplateColumns: `repeat(${colCount}, ${CARD_WIDTH}px)`, gap: GAP }}
                >
                  {Array.from({ length: 8 }, (_, i) => <MediaCardSkeleton key={i} />)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
