import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search as SearchIcon, Film, Tv, User } from 'lucide-react'
import { searchMulti, searchMovies, searchTV, searchPeople } from '../lib/tmdb'
import { useStore } from '../lib/store'
import { Input } from '../components/ui/input'
import { useVirtualizer } from '@tanstack/react-virtual'
import { MediaCard, MediaCardSkeleton } from '../components/shared/MediaCard'
import { EmptyState } from '../components/shared/EmptyState'
import { ScrollableRow } from '../components/shared/ScrollableRow'
import { Button } from '../components/ui/button'
import type { TMDbSearchResult, TMDbPerson } from '../types'

const TABS = [
  { value: 'all', label: 'All' },
  { value: 'movie', label: 'Movies', icon: Film },
  { value: 'tv', label: 'TV Shows', icon: Tv },
  { value: 'anime', label: 'Anime', icon: Tv },
  { value: 'person', label: 'People', icon: User }
] as const

type TabValue = typeof TABS[number]['value']

export function Search() {
  const settings = useStore(s => s.settings)
  const [query, setQuery] = useState(() => sessionStorage.getItem('search:query') ?? '')
  const [tab, setTab] = useState<TabValue>(() => (sessionStorage.getItem('search:tab') as TabValue) ?? 'all')
  const [results, setResults] = useState<TMDbSearchResult[]>([])
  const [people, setPeople] = useState<TMDbPerson[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const requestId = useRef(0)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Virtual grid
  const scrollRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [colCount, setColCount] = useState(5)
  const GAP = 12
  const MIN_CARD_WIDTH = 150

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width
      setColCount(Math.max(1, Math.floor((w + GAP) / (MIN_CARD_WIDTH + GAP))))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const rowCount = Math.ceil(results.length / colCount)
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => Math.round(MIN_CARD_WIDTH * 1.5),
    gap: GAP,
    overscan: 3,
  })

  useEffect(() => { rowVirtualizer.measure() }, [colCount])
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0 }, [query, tab])

  async function runSearch(q: string, t: TabValue, p: number) {
    if (!q.trim() || !settings.apiKey) {
      setResults([]); setPeople([]); setLoading(false); return
    }
    const id = ++requestId.current
    setLoading(true); setError(null)
    try {
      if (t === 'person') {
        const data = await searchPeople(q, p)
        if (id !== requestId.current) return
        setPeople(p === 1 ? data.results : (prev) => [...prev, ...data.results])
        setTotalPages(data.total_pages)
      } else if (t === 'movie') {
        const data = await searchMovies(q, p)
        if (id !== requestId.current) return
        setResults(p === 1 ? data.results : (prev) => [...prev, ...data.results])
        setTotalPages(data.total_pages)
      } else if (t === 'tv' || t === 'anime') {
        const data = await searchTV(q, p)
        if (id !== requestId.current) return
        const filtered = t === 'anime'
          ? data.results.filter((r) => r.genre_ids?.includes(16) && r.origin_country?.includes('JP'))
          : data.results.filter((r) => !(r.genre_ids?.includes(16) && r.origin_country?.includes('JP')))
        setResults(p === 1 ? filtered : (prev) => [...prev, ...filtered])
        setTotalPages(data.total_pages)
      } else {
        const data = await searchMulti(q, p)
        if (id !== requestId.current) return
        const mediaItems = data.results.filter((r) => r.media_type !== 'person')
        const personItems = data.results.filter((r) => r.media_type === 'person') as unknown as TMDbPerson[]
        setResults(p === 1 ? mediaItems : (prev) => [...prev, ...mediaItems])
        if (p === 1) setPeople(personItems)
        setTotalPages(data.total_pages)
      }
    } catch (e: unknown) {
      if (id !== requestId.current) return
      setError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    setPage(1); setResults([]); setPeople([])
    debounceTimer.current = setTimeout(() => runSearch(query, tab, 1), 350)
    return () => { if (debounceTimer.current) clearTimeout(debounceTimer.current) }
  }, [query, tab, settings.apiKey])

  const handleLoadMore = () => {
    const next = page + 1
    setPage(next)
    runSearch(query, tab, next)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 pb-0 border-b border-border/50">
        <div className="relative max-w-2xl">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            type="search"
            placeholder="Search movies, TV shows, anime, people..."
            value={query}
            onChange={(e) => { setQuery(e.target.value); sessionStorage.setItem('search:query', e.target.value) }}
            className="pl-9 h-10 text-sm"
            autoFocus
            aria-label="Search"
          />
        </div>

        {/* Tabs */}
        <ScrollableRow className="mt-3">
          {TABS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => { setTab(value); sessionStorage.setItem('search:tab', value) }}
              className={`px-4 py-2 text-sm whitespace-nowrap border-b-2 transition-colors cursor-pointer flex-shrink-0 ${
                tab === value
                  ? 'border-primary text-primary font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
              role="tab"
              aria-selected={tab === value}
            >
              {label}
            </button>
          ))}
        </ScrollableRow>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden">
        <div ref={containerRef} className="p-6">
          {!settings.apiKey ? (
            <EmptyState
              icon={SearchIcon}
              title="No API key configured"
              description="Add your TMDb API key in Settings to search for movies and TV shows."
            />
          ) : !query.trim() ? (
            <EmptyState
              icon={SearchIcon}
              title="Search for anything"
              description="Find movies, TV shows, anime, and people by name."
            />
          ) : error ? (
            <EmptyState icon={SearchIcon} title="Something went wrong" description={error} />
          ) : loading && results.length === 0 && people.length === 0 ? (
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
              {Array.from({ length: 12 }, (_, i) => <MediaCardSkeleton key={i} />)}
            </div>
          ) : results.length === 0 && people.length === 0 && !loading ? (
            <EmptyState
              icon={SearchIcon}
              title="No results found"
              description={`No results for "${query}". Try a different search term.`}
            />
          ) : (
            <div className="space-y-8">
              {results.length > 0 && (
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
                          gridTemplateColumns: `repeat(${colCount}, 1fr)`,
                          gap: GAP,
                        }}
                      >
                        {rowItems.map((item) => (
                          <MediaCard
                            key={`${item.media_type ?? tab}:${item.id}`}
                            item={item}
                            mediaType={
                              tab === 'movie' ? 'movie'
                              : tab === 'tv' ? 'tv'
                              : tab === 'anime' ? 'anime'
                              : undefined
                            }
                            backLabel="Search"
                          />
                        ))}
                      </div>
                    )
                  })}
                </div>
              )}

              {people.length > 0 && (
                <section>
                  {tab === 'all' && (
                    <h3 className="text-sm font-semibold text-muted-foreground mb-3">People</h3>
                  )}
                  <div className="flex flex-wrap gap-3">
                    {people.map((p) => <PersonCard key={p.id} person={p} />)}
                  </div>
                </section>
              )}

              {page < totalPages && !loading && (
                <div className="flex justify-center pt-4">
                  <Button variant="outline" onClick={handleLoadMore}>Load More</Button>
                </div>
              )}

              {loading && (results.length > 0 || people.length > 0) && (
                <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${colCount}, 1fr)`, gap: GAP }}>
                  {Array.from({ length: 4 }, (_, i) => <MediaCardSkeleton key={i} />)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PersonCard({ person }: { person: TMDbPerson }) {
  const navigate = useNavigate()
  const imgSrc = person.profile_path
    ? `https://image.tmdb.org/t/p/w185${person.profile_path}`
    : null

  return (
    <button
      className="flex items-center gap-3 rounded-lg bg-card border border-border/50 p-3 w-52 text-left hover:border-border hover:bg-secondary/50 transition-colors cursor-pointer"
      onClick={() => navigate(`/person/${person.id}`)}
    >
      <div className="h-10 w-10 rounded-full overflow-hidden bg-secondary flex-shrink-0">
        {imgSrc ? (
          <img src={imgSrc} alt={person.name} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
            {person.name.slice(0, 2).toUpperCase()}
          </div>
        )}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{person.name}</p>
        <p className="text-xs text-muted-foreground truncate">{person.known_for_department}</p>
      </div>
    </button>
  )
}

