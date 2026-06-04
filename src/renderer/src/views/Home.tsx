import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TrendingUp, Clock, Tv, Bookmark, ArrowRight, Star } from 'lucide-react'
import { getTrending } from '../lib/tmdb'
import { useStore } from '../lib/store'
import { cn, posterUrl, fmtDate, fmtRating } from '../lib/utils'
import { MediaCard, MediaCardSkeleton } from '../components/shared/MediaCard'
import { ScrollableRow } from '../components/shared/ScrollableRow'
import { ContinueWatchingCard } from '../components/shared/ContinueWatchingCard'
import { Button } from '../components/ui/button'
import { ScrollArea } from '../components/ui/scroll-area'
import type { TMDbSearchResult } from '../types'

export function Home() {
  const navigate = useNavigate()
  const library = useStore(s => s.library)
  const watchHistory = useStore(s => s.watchHistory)
  const settings = useStore(s => s.settings)
  const getLibraryByStatus = useStore(s => s.getLibraryByStatus)
  const [trending, setTrending] = useState<TMDbSearchResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const recentLog = watchHistory
    .slice()
    .sort((a, b) => b.watchedAt - a.watchedAt)
    .slice(0, 8)

  const inProgress = getLibraryByStatus('in_progress')
  const continueWatching = useMemo(
    () => inProgress.filter((e) => e.mediaType === 'tv' || e.mediaType === 'anime').slice(0, 50),
    [inProgress]
  )
  const watchlist = getLibraryByStatus('watchlist').slice(0, 10)

  useEffect(() => {
    if (!settings.apiKey) { setLoading(false); return }
    setLoading(true)
    getTrending('all', 'week')
      .then((r) => setTrending(r.results.slice(0, 20)))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [settings.apiKey])

  const libEntries = Object.values(library)
  const stats = {
    movies: libEntries.filter((e) => e.mediaType === 'movie' && e.status === 'watched').length,
    shows: libEntries.filter((e) => e.mediaType === 'tv' && e.status === 'watched').length,
    anime: libEntries.filter((e) => e.mediaType === 'anime' && e.status === 'watched').length,
    episodes: Object.values(library).reduce((acc, e) => acc + Object.keys(e.tvProgress ?? {}).length, 0)
  }

  return (
    <ScrollArea className="h-full">
      <div className="view-container p-4 space-y-6 w-full min-w-0">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-serif text-3xl font-normal text-foreground">
              Welcome back, <span className="text-primary">{settings.username}</span>
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">Here's what's happening in your world of film & TV.</p>
          </div>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-4 gap-3">
          <StatCard icon={<TrendingUp className="h-4 w-4" />} label="Movies" value={stats.movies} color="text-primary" />
          <StatCard icon={<Tv className="h-4 w-4" />} label="TV Shows" value={stats.shows} color="text-teal" />
          <StatCard icon={<Tv className="h-4 w-4" />} label="Anime" value={stats.anime} color="text-warning" />
          <StatCard icon={<Clock className="h-4 w-4" />} label="Episodes" value={stats.episodes} color="text-info" />
        </div>

        {/* No API key banner */}
        {!settings.apiKey && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 flex items-center justify-between gap-4">
            <div>
              <p className="font-medium text-sm">Set up your TMDb API key</p>
              <p className="text-xs text-muted-foreground mt-0.5">Add your free TMDb API key in Settings to start searching and tracking movies and TV shows.</p>
            </div>
            <Button size="sm" onClick={() => navigate('/settings')}>Go to Settings</Button>
          </div>
        )}

        {/* Trending */}
        {settings.apiKey && (
          <Section
            title="Trending This Week"
            icon={<TrendingUp className="h-4 w-4" />}
            onMore={() => navigate('/discover')}
          >
            <ScrollableRow>
              {loading
                ? Array.from({ length: 8 }, (_, i) => <MediaCardSkeleton key={i} />)
                : trending.map((item) => (
                    <MediaCard key={item.id} item={item} backLabel="Home" width={160} />
                  ))}
            </ScrollableRow>
          </Section>
        )}

        {/* Continue Watching - next episode per show */}
        {continueWatching.length > 0 && (
          <Section title="Continue Watching" icon={<Tv className="h-4 w-4" />} onMore={() => navigate('/library?tab=in_progress')}>
            <ScrollableRow>
              {continueWatching.map((entry) => (
                <ContinueWatchingCard
                  key={entry.id}
                  entry={entry}
                  onNavigate={(path, extraState) => navigate(path, { state: { backLabel: 'Home', ...extraState } })}
                />
              ))}
            </ScrollableRow>
          </Section>
        )}

        {/* Watchlist */}
        {watchlist.length > 0 && (
          <Section title="Your Watchlist" icon={<Bookmark className="h-4 w-4" />} onMore={() => navigate('/library?tab=watchlist')}>
            <ScrollableRow>
              {watchlist.map((entry) => (
                <MediaCard key={entry.id} entry={entry} backLabel="Home" width={160} />
              ))}
            </ScrollableRow>
          </Section>
        )}

        {/* Recently Watched - verbose log feed */}
        {recentLog.length > 0 && (
          <Section title="Recently Watched" icon={<Clock className="h-4 w-4" />} onMore={() => navigate('/log')}>
            <div className="space-y-2">
              {recentLog.map((h) => {
                const libEntry = library[h.mediaId]
                if (!libEntry) return null
                const imgSrc = posterUrl(libEntry.posterPath, 'w92')
                const displayRating = h.episodeKey
                  ? (libEntry.tvProgress?.[h.episodeKey]?.rating ?? null)
                  : h.rating
                return (
                  <button
                    key={h.id}
                    onClick={() => navigate(`/detail/${libEntry.mediaType}/${libEntry.tmdbId}`, { state: { backLabel: 'Home' } })}
                    className="flex items-start gap-3 w-full p-2.5 rounded-lg bg-card border border-border/40 hover:border-border transition-colors text-left cursor-pointer"
                  >
                    <div className="h-14 w-10 rounded overflow-hidden flex-shrink-0 bg-secondary">
                      {imgSrc ? (
                        <img src={imgSrc} alt={libEntry.title} className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">?</div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{libEntry.title}</p>
                      {h.episodeTitle && (
                        <p className="text-xs text-muted-foreground truncate">{h.episodeTitle}</p>
                      )}
                      {h.note && (
                        <p className="text-xs text-muted-foreground italic mt-0.5 line-clamp-1">"{h.note}"</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {fmtDate(h.watchedAtDT, 'EEE, MMM d')} at {fmtDate(h.watchedAtDT, settings.timeFormat === '24h' ? 'HH:mm' : 'h:mm a')}
                      </p>
                    </div>
                    {displayRating != null && (
                      <span className="flex items-center gap-0.5 text-xs text-warning flex-shrink-0 mt-0.5">
                        <Star className="h-3 w-3 fill-warning" />
                        {fmtRating(displayRating, settings.ratingSystem as '10star' | '5star')}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </Section>
        )}

        {/* Empty state */}
        {!loading && !error && settings.apiKey && Object.keys(library).length === 0 && (
          <div className="text-center py-16">
            <p className="text-2xl font-serif text-muted-foreground mb-2">Your journey starts here</p>
            <p className="text-sm text-muted-foreground mb-6">Search for movies and TV shows to start tracking your watch history.</p>
            <Button onClick={() => navigate('/search')}>
              <TrendingUp className="h-4 w-4" />
              Browse & Search
            </Button>
          </div>
        )}
      </div>
    </ScrollArea>
  )
}

function Section({ title, icon, onMore, children }: {
  title: string
  icon: React.ReactNode
  onMore?: () => void
  children: React.ReactNode
}) {
  return (
    <section className="min-w-0">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-foreground">
          <span className="text-primary">{icon}</span>
          <h2 className="font-semibold text-base">{title}</h2>
        </div>
        {onMore && (
          <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={onMore}>
            See all <ArrowRight className="h-3 w-3" />
          </Button>
        )}
      </div>
      {children}
    </section>
  )
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div className="stat-card">
      <div className={cn('flex items-center gap-2', color)}>
        {icon}
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      </div>
      <p className="text-2xl font-bold text-foreground mt-1">{value.toLocaleString()}</p>
    </div>
  )
}
