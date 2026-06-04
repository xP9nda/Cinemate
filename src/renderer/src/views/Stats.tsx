import React, { useMemo, useState } from 'react'
import ReactDOM from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../lib/store'
import { fmtRating, posterUrl, cn } from '../lib/utils'
import { playMinutes } from '../lib/mediaStats'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, CartesianGrid, ReferenceLine,
  LineChart, Line
} from 'recharts'
import { ScrollArea } from '../components/ui/scroll-area'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { EmptyState } from '../components/shared/EmptyState'
import {
  BarChart2, BarChart3, Star, Clock, Film, Tv, ArrowRight, Repeat2,
  CalendarDays, Timer, Activity, Sparkles, TrendingUp, PieChart as PieChartIcon,
  Flame, Tag
} from 'lucide-react'
import { Button } from '../components/ui/button'
import type { LibraryEntry } from '../types'

const COLORS = {
  primary: 'hsl(262 33% 66%)',
  teal: 'hsl(176 53% 55%)',
  warning: 'hsl(44 84% 59%)',
  success: 'hsl(155 60% 60%)',
  info: 'hsl(205 60% 66%)',
  muted: 'hsl(249 11% 45%)',
  card: 'hsl(228 25% 18%)',
  border: 'hsl(228 20% 24%)',
  fg: 'hsl(250 29% 91%)'
}

const TOOLTIP_STYLE: React.CSSProperties = {
  background: COLORS.card,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 8,
  fontSize: 12,
  padding: '8px 10px',
  lineHeight: 1.4,
  boxShadow: '0 6px 16px -4px rgba(0, 0, 0, 0.35)'
}
const TOOLTIP_LABEL_STYLE: React.CSSProperties = { color: COLORS.fg, fontWeight: 600, marginBottom: 2 }
const TOOLTIP_ITEM_STYLE: React.CSSProperties = { color: COLORS.fg }
const cursorFill = (hsl: string) => ({ fill: `hsl(${hsl} / 0.12)` })

const GENRE_NAMES: Record<number, string> = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
  99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
  27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi',
  10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western',
  10759: 'Action & Adventure', 10762: 'Kids', 10763: 'News', 10764: 'Reality',
  10765: 'Sci-Fi & Fantasy', 10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics'
}

type Period = number | 'all'

function fmtHours(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function fmtAvgTime(minutes: number): string {
  if (minutes < 1) return '0m'
  if (minutes < 60) return `${Math.round(minutes)}m`
  return `${(minutes / 60).toFixed(1)}h`
}

function fmtAvgCount(n: number): string {
  if (n === 0) return '0'
  if (n < 10) return n.toFixed(1)
  return Math.round(n).toLocaleString()
}

function parseCellDate(dateStr: string): Date {
  return dateStr.length === 5
    ? new Date(`2024-${dateStr}T12:00:00`)
    : new Date(`${dateStr}T12:00:00`)
}

export function Stats() {
  const navigate = useNavigate()
  const library = useStore(s => s.library)
  const watchHistory = useStore(s => s.watchHistory)
  const settings = useStore(s => s.settings)
  const [period, setPeriod] = useState<Period>(() => {
    const saved = localStorage.getItem('stats-period')
    if (saved === 'all') return 'all'
    const n = Number(saved)
    return n > 1900 && n < 2200 ? n : new Date().getFullYear()
  })

  const handleSetPeriod = (p: Period) => {
    localStorage.setItem('stats-period', String(p))
    setPeriod(p)
  }

  const [showSort, setShowSort] = useState<'episodes' | 'time'>(() => {
    const saved = localStorage.getItem('stats-show-sort')
    return saved === 'time' ? 'time' : 'episodes'
  })
  const handleSetShowSort = (s: 'episodes' | 'time') => {
    localStorage.setItem('stats-show-sort', s)
    setShowSort(s)
  }

  const [movieSort, setMovieSort] = useState<'plays' | 'time'>(() => {
    const saved = localStorage.getItem('stats-movie-sort')
    return saved === 'time' ? 'time' : 'plays'
  })
  const handleSetMovieSort = (s: 'plays' | 'time') => {
    localStorage.setItem('stats-movie-sort', s)
    setMovieSort(s)
  }

  type TopRatedKind = 'all' | 'movies' | 'tv' | 'episodes'
  const [topRatedKind, setTopRatedKind] = useState<TopRatedKind>(() => {
    const saved = localStorage.getItem('stats-top-rated-kind')
    return saved === 'movies' || saved === 'tv' || saved === 'episodes' ? saved : 'all'
  })
  const handleSetTopRatedKind = (k: TopRatedKind) => {
    localStorage.setItem('stats-top-rated-kind', k)
    setTopRatedKind(k)
  }

  // Build a /log URL that scopes to the current period (year or all-time)
  // so a chart click drills down without losing the year context.
  const buildLogUrl = (extra: Record<string, string | number>) => {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(extra)) params.set(k, String(v))
    if (period !== 'all' && !('year' in extra) && !('dateFrom' in extra)) {
      params.set('year', String(period))
    }
    return `/log?${params.toString()}`
  }

  const entries = useMemo(() => Object.values(library), [library])
  const watched = useMemo(() => entries.filter(e => e.status === 'watched' || e.status === 'in_progress'), [entries])

  const yearOptions = useMemo<(number | 'all')[]>(() => {
    const years = new Set<number>()
    for (const h of watchHistory) years.add(new Date(h.watchedAt).getFullYear())
    const sorted = Array.from(years).sort((a, b) => b - a)
    return sorted.length > 0 ? [...sorted, 'all'] : ['all']
  }, [watchHistory])

  const periodHistory = useMemo(
    () => period === 'all'
      ? watchHistory
      : watchHistory.filter(h => new Date(h.watchedAt).getFullYear() === (period as number)),
    [watchHistory, period]
  )

  const moviesWatched = useMemo(
    () => period === 'all'
      ? watched.filter(e => e.mediaType === 'movie').length
      : new Set(periodHistory.filter(h => !h.episodeKey && library[h.mediaId]?.mediaType === 'movie').map(h => h.mediaId)).size,
    [watched, periodHistory, period, library]
  )

  const showsWatched = useMemo(
    () => period === 'all'
      ? watched.filter(e => e.mediaType === 'tv' || e.mediaType === 'anime').length
      : new Set(periodHistory.filter(h => h.episodeKey).map(h => h.mediaId)).size,
    [watched, periodHistory, period]
  )

  const episodesWatched = useMemo(
    () => period === 'all'
      ? entries.reduce((acc, e) => acc + Object.values(e.tvProgress ?? {}).filter(v => v.watchedAt).length, 0)
      : periodHistory.filter(h => !!h.episodeKey).length,
    [entries, periodHistory, period]
  )

  const totalLogEntries = periodHistory.length

  const totalMinutes = useMemo(
    () => periodHistory.reduce((sum, h) => sum + playMinutes(library[h.mediaId], h.episodeKey), 0),
    [periodHistory, library]
  )

  const rewatchCount = useMemo(() => periodHistory.filter(h => h.isRewatch).length, [periodHistory])

  const activeDays = useMemo(() => {
    const days = new Set<string>()
    for (const h of periodHistory) {
      const d = new Date(h.watchedAt)
      days.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`)
    }
    return days.size
  }, [periodHistory])

  const periodEpisodes = useMemo(() => periodHistory.filter(h => !!h.episodeKey).length, [periodHistory])

  const avgMinutesPerDay = activeDays > 0 ? totalMinutes / activeDays : 0
  const avgEpisodesPerDay = activeDays > 0 ? periodEpisodes / activeDays : 0

  const totalPeriodDays = useMemo(() => {
    if (period === 'all') {
      if (watchHistory.length === 0) return 0
      let earliestMs = Infinity
      for (const h of watchHistory) {
        const t = new Date(h.watchedAt).getTime()
        if (t < earliestMs) earliestMs = t
      }
      const earliest = new Date(earliestMs)
      earliest.setHours(0, 0, 0, 0)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      return Math.max(1, Math.floor((today.getTime() - earliest.getTime()) / 86400000) + 1)
    }
    const today = new Date()
    const y = period as number
    if (y === today.getFullYear()) {
      const start = new Date(y, 0, 1)
      const todayMidnight = new Date(today)
      todayMidnight.setHours(0, 0, 0, 0)
      return Math.max(1, Math.floor((todayMidnight.getTime() - start.getTime()) / 86400000) + 1)
    }
    const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
    return isLeap ? 366 : 365
  }, [period, watchHistory])

  const avgMinutesPerAllDays = totalPeriodDays > 0 ? totalMinutes / totalPeriodDays : 0
  const avgEpisodesPerAllDays = totalPeriodDays > 0 ? periodEpisodes / totalPeriodDays : 0

  const topWeekday = useMemo(() => {
    if (periodHistory.length === 0) return null
    const counts = new Array(7).fill(0)
    for (const h of periodHistory) counts[new Date(h.watchedAt).getDay()]++
    const idx = counts.indexOf(Math.max(...counts))
    return { name: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][idx], count: counts[idx] }
  }, [periodHistory])

  const maxStars = settings.ratingSystem === '5star' ? 5 : 10

  // One rating per distinct thing the user rated - never per play:
  //   • each movie            → its overall rating (userRating)
  //   • each TV / anime show  → its overall rating (userRating)
  //   • each episode          → its individual rating (tvProgress[key].rating)
  // All of these live on the library entry, so the distribution is derived from
  // the library rather than from watch history (where a title rated across N
  // plays would otherwise be counted N times, and episode plays carry no rating
  // at all). A movie/show with no overall rating falls back to its most recent
  // rated play so a title rated only from the log isn't dropped. Scoped to the
  // period by when each thing was actually watched.
  const periodRatings = useMemo(() => {
    const inYear = (when: string | number | null | undefined) =>
      period === 'all' ? true : when != null && new Date(when).getFullYear() === (period as number)

    // Most recent rated non-episode play per title - the fallback title rating
    // and a period-scoping signal. watchHistory is newest-first, so first wins.
    const latestPlayRating = new Map<string, number>()
    const playInPeriod = new Set<string>()
    for (const h of watchHistory) {
      if (h.episodeKey) continue
      if (h.rating != null && !latestPlayRating.has(h.mediaId)) latestPlayRating.set(h.mediaId, h.rating)
      if (inYear(h.watchedAt)) playInPeriod.add(h.mediaId)
    }

    const ratings: number[] = []
    for (const e of entries) {
      const isShow = e.mediaType === 'tv' || e.mediaType === 'anime'

      // Individual episode ratings, scoped by when each episode was watched.
      let showWatchedInPeriod = false
      if (isShow) {
        for (const p of Object.values(e.tvProgress ?? {})) {
          const watchedInYear = inYear(p.watchedAt)
          if (watchedInYear) showWatchedInPeriod = true
          if (p.rating != null && watchedInYear) ratings.push(p.rating)
        }
      }

      // One overall rating for the movie/show.
      if (e.mediaType === 'movie' || isShow) {
        const titleRating = e.userRating ?? latestPlayRating.get(e.id) ?? null
        const inPeriod = period === 'all'
          || playInPeriod.has(e.id)
          || inYear(e.watchedDate)
          || showWatchedInPeriod
        if (titleRating != null && inPeriod) ratings.push(titleRating)
      }
    }
    return ratings
  }, [entries, watchHistory, period])

  const ratingDist = useMemo(() => {
    const dist: Record<number, number> = {}
    for (let i = 1; i <= maxStars; i++) dist[i] = 0
    for (const rating of periodRatings) {
      const r = Math.round(rating)
      if (r >= 1 && r <= maxStars) dist[r]++
    }
    return Object.entries(dist).map(([r, count]) => ({ rating: `${r}★`, count, r: Number(r) }))
  }, [periodRatings, maxStars])

  const avgRating = periodRatings.length > 0
    ? periodRatings.reduce((a, r) => a + r, 0) / periodRatings.length
    : null

  const avgRatingBar = avgRating != null
    ? ratingDist.find(d => d.r === Math.round(avgRating))?.rating
    : null

  const timelineData = useMemo(() => {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    if (period !== 'all') {
      const counts = new Array(12).fill(0)
      for (const h of periodHistory) counts[new Date(h.watchedAt).getMonth()]++
      return counts.map((count, i) => ({ label: monthNames[i], count }))
    }
    const years: Record<number, number> = {}
    for (const h of watchHistory) {
      const y = new Date(h.watchedAt).getFullYear()
      years[y] = (years[y] ?? 0) + 1
    }
    return Object.entries(years)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([year, count]) => ({ label: year, count }))
  }, [watchHistory, periodHistory, period])

  const ratingOverTime = useMemo(() => {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    if (period !== 'all') {
      const data: { sum: number; count: number }[] = new Array(12).fill(null).map(() => ({ sum: 0, count: 0 }))
      for (const h of periodHistory) {
        if (h.rating == null) continue
        const m = new Date(h.watchedAt).getMonth()
        data[m].sum += h.rating
        data[m].count++
      }
      return data.map((d, i) => ({
        label: monthNames[i],
        avg: d.count > 0 ? Math.round((d.sum / d.count) * 10) / 10 : null
      }))
    }
    const years: Record<number, { sum: number; count: number }> = {}
    for (const h of watchHistory) {
      if (h.rating == null) continue
      const y = new Date(h.watchedAt).getFullYear()
      if (!years[y]) years[y] = { sum: 0, count: 0 }
      years[y].sum += h.rating
      years[y].count++
    }
    return Object.entries(years)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([year, { sum, count }]) => ({
        label: year,
        avg: count > 0 ? Math.round((sum / count) * 10) / 10 : null
      }))
  }, [watchHistory, periodHistory, period])

  const hasRatingOverTime = ratingOverTime.some(d => d.avg != null)

  const typeDist = useMemo(() => {
    const source = period === 'all' ? watchHistory : periodHistory
    let movies = 0
    let episodes = 0
    for (const h of source) {
      if (h.episodeKey) {
        episodes++
      } else if (library[h.mediaId]?.mediaType === 'movie') {
        movies++
      }
    }
    return [
      { name: 'Movies', value: movies, color: COLORS.primary, filter: 'movie' as const },
      { name: 'Episodes', value: episodes, color: COLORS.teal, filter: 'episode' as const }
    ].filter(d => d.value > 0)
  }, [watchHistory, periodHistory, period, library])

  const genreDist = useMemo(() => {
    const counts: Record<number, number> = {}
    const seenMedia = new Set<string>()
    for (const h of periodHistory) {
      if (seenMedia.has(h.mediaId)) continue
      seenMedia.add(h.mediaId)
      for (const gid of (library[h.mediaId]?.genreIds ?? [])) {
        counts[gid] = (counts[gid] ?? 0) + 1
      }
    }
    return Object.entries(counts)
      .filter(([id]) => GENRE_NAMES[Number(id)] != null)
      .map(([id, count]) => ({ id: Number(id), name: GENRE_NAMES[Number(id)], count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
  }, [periodHistory, library])

  const decadeDist = useMemo(() => {
    const source = period === 'all'
      ? watched
      : [...new Set(periodHistory.map(h => h.mediaId))].map(id => library[id]).filter((e): e is NonNullable<typeof e> => !!e)
    const counts: Record<number, number> = {}
    for (const e of source) {
      if (e.releaseYear) {
        const decade = Math.floor(e.releaseYear / 10) * 10
        counts[decade] = (counts[decade] ?? 0) + 1
      }
    }
    return Object.entries(counts)
      .map(([decade, count]) => ({ decade: `${decade}s`, count }))
      .sort((a, b) => parseInt(a.decade) - parseInt(b.decade))
  }, [watched, periodHistory, period, library])

  const heatmapData = useMemo(() => {
    const result: Record<string, number> = {}
    if (period === 'all') {
      for (const h of watchHistory) {
        const d = new Date(h.watchedAt)
        const key = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        result[key] = (result[key] ?? 0) + 1
      }
    } else {
      const y = period as number
      const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
      const daysInYear = isLeap ? 366 : 365
      const startDate = new Date(y, 0, 1)
      for (let i = 0; i < daysInYear; i++) {
        const d = new Date(startDate)
        d.setDate(d.getDate() + i)
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        result[key] = 0
      }
      for (const h of periodHistory) {
        const d = new Date(h.watchedAt)
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        if (key in result) result[key]++
      }
    }
    return result
  }, [watchHistory, periodHistory, period])

  const heatmapHasData = useMemo(() => Object.values(heatmapData).some(v => v > 0), [heatmapData])

  const movieStats = useMemo(() => {
    const playCounts: Record<string, number> = {}
    const source = period === 'all' ? watchHistory : periodHistory
    for (const h of source) {
      if (h.episodeKey) continue
      const entry = library[h.mediaId]
      if (!entry || entry.mediaType !== 'movie') continue
      playCounts[h.mediaId] = (playCounts[h.mediaId] ?? 0) + 1
    }
    const stats: Array<{ entry: LibraryEntry; plays: number; minutes: number }> = []
    for (const [id, plays] of Object.entries(playCounts)) {
      const entry = library[id]
      if (!entry) continue
      stats.push({ entry, plays, minutes: plays * (entry.runtime ?? 0) })
    }
    return stats
  }, [watchHistory, periodHistory, period, library])

  const mostWatchedMovies = useMemo(() => {
    return [...movieStats]
      .sort((a, b) => movieSort === 'time' ? b.minutes - a.minutes : b.plays - a.plays)
      .slice(0, 10)
  }, [movieStats, movieSort])

  const showStats = useMemo(() => {
    const stats: Array<{ entry: LibraryEntry; episodes: number; minutes: number }> = []
    if (period === 'all') {
      for (const e of entries) {
        if (e.mediaType !== 'tv' && e.mediaType !== 'anime') continue
        const watched = Object.values(e.tvProgress ?? {}).filter(v => v.watchedAt)
        if (watched.length === 0) continue
        const minutes = watched.reduce((sum, p) => sum + (p.runtime ?? e.runtime ?? 0), 0)
        stats.push({ entry: e, episodes: watched.length, minutes })
      }
      return stats
    }
    const counts: Record<string, { episodes: number; minutes: number }> = {}
    for (const h of periodHistory) {
      if (!h.episodeKey) continue
      const entry = library[h.mediaId]
      if (!entry || (entry.mediaType !== 'tv' && entry.mediaType !== 'anime')) continue
      const agg = counts[h.mediaId] ?? { episodes: 0, minutes: 0 }
      agg.episodes += 1
      agg.minutes += playMinutes(entry, h.episodeKey)
      counts[h.mediaId] = agg
    }
    for (const [id, { episodes, minutes }] of Object.entries(counts)) {
      const entry = library[id]
      if (!entry) continue
      stats.push({ entry, episodes, minutes })
    }
    return stats
  }, [entries, periodHistory, period, library])

  const mostWatchedShows = useMemo(() => {
    return [...showStats]
      .sort((a, b) => showSort === 'time' ? b.minutes - a.minutes : b.episodes - a.episodes)
      .slice(0, 10)
  }, [showStats, showSort])

  type RatedRow = {
    entry: LibraryEntry
    rating: number
    episodeKey?: string
    episodeTitle?: string
  }

  // All rated plays from the period (or all-time), dedupe by media+episode so
  // the same episode rated multiple times appears once. TV shows that the
  // user has rated overall (entry.userRating) are surfaced from the library
  // directly since there's typically no non-episode play to carry the rating.
  const topRatedByKind = useMemo(() => {
    const playSource = period === 'all' ? watchHistory : periodHistory
    const movies: RatedRow[] = []
    const episodes: RatedRow[] = []
    const tvShows: RatedRow[] = []
    const seenPlay = new Set<string>()
    for (const h of playSource) {
      if (h.rating == null) continue
      const key = `${h.mediaId}::${h.episodeKey ?? ''}`
      if (seenPlay.has(key)) continue
      seenPlay.add(key)
      const entry = library[h.mediaId]
      if (!entry) continue
      const row: RatedRow = {
        entry,
        rating: h.rating,
        episodeKey: h.episodeKey,
        episodeTitle: h.episodeTitle
      }
      if (h.episodeKey) episodes.push(row)
      else if (entry.mediaType === 'movie') movies.push(row)
      else if (entry.mediaType === 'tv' || entry.mediaType === 'anime') tvShows.push(row)
    }
    // TV shows are usually rated overall via userRating (per-play ratings are
    // rare for shows). Merge those in, deduping by mediaId so a per-play
    // rating doesn't get overwritten if both exist.
    const tvIds = new Set(tvShows.map(r => r.entry.id))
    const periodIds = period === 'all' ? null : new Set(periodHistory.map(h => h.mediaId))
    for (const e of entries) {
      if (e.userRating == null) continue
      if (e.mediaType !== 'tv' && e.mediaType !== 'anime') continue
      if (tvIds.has(e.id)) continue
      if (periodIds && !periodIds.has(e.id)) continue
      tvShows.push({ entry: e, rating: e.userRating })
    }
    const byRating = (a: RatedRow, b: RatedRow) => b.rating - a.rating
    return {
      all: [...movies, ...episodes, ...tvShows].sort(byRating).slice(0, 8),
      movies: [...movies].sort(byRating).slice(0, 8),
      tv: [...tvShows].sort(byRating).slice(0, 8),
      episodes: [...episodes].sort(byRating).slice(0, 8)
    }
  }, [watchHistory, periodHistory, period, library, entries])

  const topRated = topRatedByKind[topRatedKind]

  if (entries.length === 0 && watchHistory.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState
          icon={BarChart2}
          title="No stats yet"
          description="Add movies and TV shows to your library to see your stats."
        />
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="view-container p-6 w-full space-y-6">
        {/* Header with year filter */}
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div className="min-w-0">
            <h1 className="font-serif text-3xl font-normal leading-tight">Statistics</h1>
            <p className="text-xs text-muted-foreground mt-1">
              {period === 'all'
                ? `${watchHistory.length.toLocaleString()} log entries across all time`
                : `${periodHistory.length.toLocaleString()} log entries in ${period}`}
            </p>
          </div>
          <div className="flex overflow-x-auto bg-secondary/60 rounded-lg p-0.5 gap-0.5 max-w-full shrink-0 border border-border/40">
            {yearOptions.map(y => (
              <button
                key={String(y)}
                onClick={() => handleSetPeriod(y)}
                className={cn(
                  'px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer whitespace-nowrap flex-shrink-0',
                  period === y
                    ? 'bg-card text-foreground shadow-sm ring-1 ring-border/60'
                    : 'text-muted-foreground hover:text-foreground hover:bg-card/40'
                )}
              >
                {y === 'all' ? 'All time' : String(y)}
              </button>
            ))}
          </div>
        </div>

        {/* At a glance */}
        <section className="space-y-3">
          <CategoryHeader title="At a glance" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatBox icon={Film} label="Movies" value={moviesWatched} tone="primary" />
            <StatBox icon={Tv} label="TV Shows" value={showsWatched} tone="teal" />
            <StatBox icon={BarChart2} label="Episodes" value={episodesWatched} tone="warning" />
            <StatBox icon={Clock} label="Log entries" value={totalLogEntries} tone="success" />
          </div>
          {(totalMinutes > 0 || rewatchCount > 0) && (
            <div className={cn('grid gap-3', totalMinutes > 0 && rewatchCount > 0 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2')}>
              {totalMinutes > 0 && (
                <StatBox
                  icon={Clock}
                  label={period === 'all' ? 'Hours watched' : `Hours in ${period}`}
                  valueStr={fmtHours(totalMinutes)}
                  tone="info"
                />
              )}
              {rewatchCount > 0 && (
                <StatBox
                  icon={Repeat2}
                  label="Rewatches"
                  value={rewatchCount}
                  tone="primary"
                />
              )}
            </div>
          )}
        </section>

        {/* Watching pace */}
        {activeDays > 0 && (
          <section className="space-y-3">
            <CategoryHeader title="Watching pace" />
            <div className="space-y-1.5">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium px-0.5">On days with activity</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatBox icon={CalendarDays} label="Active days" value={activeDays} tone="teal" />
                {totalMinutes > 0 && (
                  <StatBox icon={Timer} label="Time / day" valueStr={fmtAvgTime(avgMinutesPerDay)} tone="info" />
                )}
                {periodEpisodes > 0 && (
                  <StatBox icon={Activity} label="Episodes / day" valueStr={fmtAvgCount(avgEpisodesPerDay)} tone="warning" />
                )}
                {topWeekday && (
                  <StatBox icon={Sparkles} label="Top weekday" valueStr={topWeekday.name} tone="primary" />
                )}
              </div>
            </div>
            {totalPeriodDays > 0 && (totalMinutes > 0 || periodEpisodes > 0) && (
              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium px-0.5">
                  Across all {totalPeriodDays.toLocaleString()} days
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {totalMinutes > 0 && (
                    <StatBox icon={Timer} label="Time / day" valueStr={fmtAvgTime(avgMinutesPerAllDays)} tone="info" />
                  )}
                  {periodEpisodes > 0 && (
                    <StatBox icon={Activity} label="Episodes / day" valueStr={fmtAvgCount(avgEpisodesPerAllDays)} tone="warning" />
                  )}
                  <StatBox
                    icon={CalendarDays}
                    label="Active rate"
                    valueStr={`${Math.round((activeDays / totalPeriodDays) * 100)}%`}
                    tone="success"
                  />
                </div>
              </div>
            )}
          </section>
        )}

        {/* Ratings */}
        {(periodRatings.length > 0 || ratingDist.some(d => d.count > 0) || hasRatingOverTime) && (
          <section className="space-y-3">
            <CategoryHeader title="Ratings" />
            {periodRatings.length > 0 && (
              <div className="grid grid-cols-3 gap-3">
                <StatBox
                  icon={BarChart3}
                  label="Ratings given"
                  value={periodRatings.length}
                  tone="warning"
                />
                <StatBox
                  icon={Star}
                  label="Average rating"
                  valueStr={avgRating != null ? fmtRating(round1(avgRating), settings.ratingSystem as '10star' | '5star') : 'N/A'}
                  tone="warning"
                />
                <StatBox
                  icon={Sparkles}
                  label="Most given"
                  valueStr={[...ratingDist].sort((a, b) => b.count - a.count)[0]?.rating ?? 'N/A'}
                  tone="warning"
                />
              </div>
            )}
            {(ratingDist.some(d => d.count > 0) || hasRatingOverTime) && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {ratingDist.some(d => d.count > 0) && (
                  <Card>
                    <ChartCardHeader
                      icon={BarChart3}
                      title="Rating Distribution"
                      tone="warning"
                      subtitle={avgRating != null
                        ? `Average ${fmtRating(round1(avgRating), settings.ratingSystem as '10star' | '5star')} across ${periodRatings.length} ratings`
                        : undefined}
                    />
                    <CardContent>
                      <ResponsiveContainer width="100%" height={180}>
                        <BarChart
                          data={ratingDist}
                          margin={{ top: 8, right: 4, left: -20, bottom: 0 }}
                          className="cursor-pointer"
                          onClick={(e: { activePayload?: Array<{ payload?: { r?: number; count?: number } }> }) => {
                            const data = e?.activePayload?.[0]?.payload
                            if (!data?.r || !data.count) return
                            navigate(buildLogUrl({ rating: data.r }))
                          }}
                        >
                          <defs>
                            <linearGradient id="ratingBarFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={COLORS.warning} stopOpacity={0.95} />
                              <stop offset="100%" stopColor={COLORS.warning} stopOpacity={0.55} />
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="rating" tick={{ fontSize: 10, fill: COLORS.muted }} />
                          <YAxis tick={{ fontSize: 10, fill: COLORS.muted }} allowDecimals={false} />
                          <Tooltip
                            contentStyle={TOOLTIP_STYLE}
                            labelStyle={TOOLTIP_LABEL_STYLE}
                            itemStyle={TOOLTIP_ITEM_STYLE}
                            cursor={cursorFill('44 84% 59%')}
                          />
                          {avgRatingBar && (
                            <ReferenceLine x={avgRatingBar} stroke={COLORS.warning} strokeDasharray="3 3" label={{ value: 'avg', fill: COLORS.warning, fontSize: 10 }} />
                          )}
                          <Bar dataKey="count" name="Ratings" fill="url(#ratingBarFill)" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                )}
                {hasRatingOverTime && (
                  <Card>
                    <ChartCardHeader
                      icon={TrendingUp}
                      title="Average Rating Over Time"
                      tone="warning"
                      subtitle={period === 'all' ? 'Yearly average from log entries' : 'Monthly average from log entries'}
                    />
                    <CardContent>
                      <ResponsiveContainer width="100%" height={150}>
                        <LineChart data={ratingOverTime} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
                          <XAxis dataKey="label" tick={{ fontSize: 10, fill: COLORS.muted }} />
                          <YAxis
                            tick={{ fontSize: 10, fill: COLORS.muted }}
                            domain={[1, maxStars]}
                            allowDecimals={false}
                          />
                          <Tooltip
                            contentStyle={TOOLTIP_STYLE}
                            labelStyle={TOOLTIP_LABEL_STYLE}
                            itemStyle={TOOLTIP_ITEM_STYLE}
                            formatter={(val) => val != null ? [`${val}★`, 'Avg rating'] : ['No data', 'Avg rating']}
                          />
                          <Line
                            type="monotone"
                            dataKey="avg"
                            stroke={COLORS.warning}
                            strokeWidth={2.5}
                            dot={{ fill: COLORS.warning, r: 3, strokeWidth: 0 }}
                            activeDot={{ fill: COLORS.warning, r: 5, stroke: COLORS.card, strokeWidth: 2 }}
                            connectNulls={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </section>
        )}

        {/* Library composition */}
        {(typeDist.length > 0 || decadeDist.length > 1 || genreDist.length > 0) && (
          <section className="space-y-3">
            <CategoryHeader title="Library composition" />
            {(typeDist.length > 0 || decadeDist.length > 1) && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {typeDist.length > 0 && (
                  <Card>
                    <ChartCardHeader
                      icon={PieChartIcon}
                      title={period === 'all' ? 'Watch Breakdown' : `Watched in ${period}`}
                      tone="primary"
                    />
                    <CardContent>
                      {(() => {
                        const total = typeDist.reduce((acc, d) => acc + d.value, 0)
                        return (
                          <div className="flex items-center gap-5">
                            <div className="relative shrink-0">
                              <ResponsiveContainer width={160} height={160}>
                                <PieChart>
                                  <Pie
                                    data={typeDist}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={54}
                                    outerRadius={76}
                                    dataKey="value"
                                    paddingAngle={3}
                                    cornerRadius={5}
                                    startAngle={90}
                                    endAngle={-270}
                                    stroke="none"
                                    cursor="pointer"
                                    onClick={(data: { filter?: string }) => {
                                      if (data?.filter) navigate(buildLogUrl({ mediaFilter: data.filter }))
                                    }}
                                  >
                                    {typeDist.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                                  </Pie>
                                  <Tooltip
                                    contentStyle={TOOLTIP_STYLE}
                                    labelStyle={TOOLTIP_LABEL_STYLE}
                                    itemStyle={TOOLTIP_ITEM_STYLE}
                                    formatter={(value: number, name: string) => [`${value} (${Math.round((value / total) * 100)}%)`, name]}
                                  />
                                </PieChart>
                              </ResponsiveContainer>
                              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                <p className="text-2xl font-bold leading-none tabular-nums">{total.toLocaleString()}</p>
                                <p className="text-[9px] text-muted-foreground mt-1.5 uppercase tracking-wider font-semibold">
                                  Plays
                                </p>
                              </div>
                            </div>
                            <div className="space-y-2 flex-1 min-w-0">
                              {typeDist.map(d => {
                                const pct = Math.round((d.value / total) * 100)
                                return (
                                  <button
                                    key={d.name}
                                    type="button"
                                    onClick={() => navigate(buildLogUrl({ mediaFilter: d.filter }))}
                                    className="group min-w-0 w-full text-left rounded-md p-1.5 -m-1.5 cursor-pointer hover:bg-secondary/50 transition-colors"
                                  >
                                    <div className="flex items-center justify-between gap-2 mb-1">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: d.color }} />
                                        <span className="text-xs text-muted-foreground truncate group-hover:text-foreground transition-colors">{d.name}</span>
                                      </div>
                                      <div className="flex items-baseline gap-1.5 flex-shrink-0 tabular-nums">
                                        <span className="text-sm font-semibold">{d.value}</span>
                                        <span className="text-[10px] text-muted-foreground/70">{pct}%</span>
                                      </div>
                                    </div>
                                    <div className="h-1 rounded-full bg-secondary/60 overflow-hidden">
                                      <div
                                        className="h-full rounded-full transition-all"
                                        style={{ width: `${pct}%`, background: d.color, opacity: 0.85 }}
                                      />
                                    </div>
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })()}
                    </CardContent>
                  </Card>
                )}
                {decadeDist.length > 1 && (
                  <Card>
                    <ChartCardHeader icon={CalendarDays} title="By Decade" tone="info" />
                    <CardContent>
                      <ResponsiveContainer width="100%" height={160}>
                        <BarChart
                          data={decadeDist}
                          margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
                          className="cursor-pointer"
                          onClick={(e: { activePayload?: Array<{ payload?: { decade?: string; count?: number } }> }) => {
                            const data = e?.activePayload?.[0]?.payload
                            if (!data?.decade || !data.count) return
                            const decade = parseInt(data.decade, 10)
                            if (Number.isNaN(decade)) return
                            navigate(buildLogUrl({ decade }))
                          }}
                        >
                          <defs>
                            <linearGradient id="decadeBarFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={COLORS.info} stopOpacity={0.95} />
                              <stop offset="100%" stopColor={COLORS.info} stopOpacity={0.55} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
                          <XAxis dataKey="decade" tick={{ fontSize: 10, fill: COLORS.muted }} />
                          <YAxis tick={{ fontSize: 10, fill: COLORS.muted }} allowDecimals={false} />
                          <Tooltip
                            contentStyle={TOOLTIP_STYLE}
                            labelStyle={TOOLTIP_LABEL_STYLE}
                            itemStyle={TOOLTIP_ITEM_STYLE}
                            cursor={cursorFill('205 60% 66%')}
                          />
                          <Bar dataKey="count" name="Titles" fill="url(#decadeBarFill)" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
            {genreDist.length > 0 && (
              <Card>
                <ChartCardHeader icon={Tag} title="Most Watched Genres" tone="primary" />
                <CardContent>
                  <div className="space-y-1">
                    {genreDist.map(g => (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => navigate(buildLogUrl({ genre: g.id }))}
                        className="group flex items-center gap-3 w-full text-left rounded-md px-2 py-1.5 -mx-2 cursor-pointer hover:bg-secondary/50 transition-colors"
                      >
                        <span className="text-xs text-muted-foreground w-24 flex-shrink-0 truncate group-hover:text-foreground transition-colors">{g.name}</span>
                        <div className="flex-1 h-2 rounded-full bg-secondary/70 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-primary/55 to-primary/85 transition-all group-hover:from-primary/70 group-hover:to-primary"
                            style={{ width: `${Math.max(4, Math.round((g.count / genreDist[0].count) * 100))}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground w-8 text-right tabular-nums">{g.count}</span>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </section>
        )}

        {/* Activity */}
        {watchHistory.length > 0 && (
          <section className="space-y-3">
            <CategoryHeader title="Activity" />
            <Card>
              <ChartCardHeader
                icon={Activity}
                title={period === 'all' ? 'Watch Activity by Year' : `Watch Activity ${period}`}
                tone="teal"
              />
              <CardContent>
                <ResponsiveContainer width="100%" height={150}>
                  <BarChart
                    data={timelineData}
                    margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
                    className="cursor-pointer"
                    onClick={(e: { activePayload?: Array<{ payload?: { label?: string; count?: number } }> }) => {
                      const data = e?.activePayload?.[0]?.payload
                      if (!data?.label || !data.count) return
                      if (period === 'all') {
                        const year = parseInt(data.label, 10)
                        if (Number.isNaN(year)) return
                        navigate(`/log?year=${year}`)
                      } else {
                        const monthIdx = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(data.label)
                        if (monthIdx < 0) return
                        const y = period as number
                        const mm = String(monthIdx + 1).padStart(2, '0')
                        const lastDay = new Date(y, monthIdx + 1, 0).getDate()
                        const dd = String(lastDay).padStart(2, '0')
                        navigate(`/log?dateFrom=${y}-${mm}-01&dateTo=${y}-${mm}-${dd}`)
                      }
                    }}
                  >
                    <defs>
                      <linearGradient id="activityBarFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={COLORS.teal} stopOpacity={0.95} />
                        <stop offset="100%" stopColor={COLORS.teal} stopOpacity={0.55} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: COLORS.muted }} />
                    <YAxis tick={{ fontSize: 10, fill: COLORS.muted }} allowDecimals={false} />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      labelStyle={TOOLTIP_LABEL_STYLE}
                      itemStyle={TOOLTIP_ITEM_STYLE}
                      cursor={cursorFill('176 53% 55%')}
                    />
                    <Bar dataKey="count" name="Log entries" fill="url(#activityBarFill)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            {heatmapHasData && (
              <Card>
                <ChartCardHeader
                  icon={Flame}
                  title="Watch Frequency"
                  tone="primary"
                  subtitle={period === 'all' ? 'Log entries per day, all time' : `Log entries per day in ${period}`}
                />
                <CardContent>
                  <WatchHeatmap data={heatmapData} year={period} />
                </CardContent>
              </Card>
            )}
          </section>
        )}

        {/* Top picks */}
        {(mostWatchedMovies.length > 0 || mostWatchedShows.length > 0
          || topRatedByKind.all.length > 0) && (
        <section className="space-y-3">
          <CategoryHeader title="Top picks" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          {mostWatchedMovies.length > 0 && (
            <Card>
              <ChartCardHeader
                icon={Film}
                title="Most Watched Movies"
                tone="primary"
                actions={
                  <>
                    <SortToggle
                      value={movieSort}
                      options={[{ value: 'plays', label: 'Plays' }, { value: 'time', label: 'Time' }]}
                      onChange={handleSetMovieSort}
                    />
                    <SeeMoreButton
                      onClick={() => navigate(`/log?sortOrder=${movieSort === 'time' ? 'watchtime_desc' : 'plays_desc'}&mediaFilter=movie`)}
                    />
                  </>
                }
              />
              <CardContent className="p-0">
                {mostWatchedMovies.map(({ entry: e, plays, minutes }, i) => (
                  <LeaderboardRow
                    key={e.id}
                    rank={i}
                    entry={e}
                    subtitle={e.releaseYear ? String(e.releaseYear) : undefined}
                    badge={
                      <MetricBadge tone="primary" icon={Film}>
                        {movieSort === 'time' ? fmtHours(minutes) : `${plays} ${plays === 1 ? 'play' : 'plays'}`}
                      </MetricBadge>
                    }
                    onClick={() => navigate(`/detail/${e.mediaType}/${e.tmdbId}`, { state: { backLabel: 'Stats' } })}
                  />
                ))}
              </CardContent>
            </Card>
          )}

          {mostWatchedShows.length > 0 && (
            <Card>
              <ChartCardHeader
                icon={Tv}
                title="Most Watched Shows"
                tone="teal"
                actions={
                  <>
                    <SortToggle
                      value={showSort}
                      options={[{ value: 'episodes', label: 'Episodes' }, { value: 'time', label: 'Time' }]}
                      onChange={handleSetShowSort}
                    />
                    <SeeMoreButton
                      onClick={() => navigate(`/log?sortOrder=${showSort === 'time' ? 'watchtime_desc' : 'episodes_desc'}&mediaFilter=episode`)}
                    />
                  </>
                }
              />
              <CardContent className="p-0">
                {mostWatchedShows.map(({ entry: e, episodes, minutes }, i) => (
                  <LeaderboardRow
                    key={e.id}
                    rank={i}
                    entry={e}
                    subtitle={e.releaseYear ? String(e.releaseYear) : undefined}
                    badge={
                      <MetricBadge tone="teal" icon={Tv}>
                        {showSort === 'time' ? fmtHours(minutes) : `${episodes} ep`}
                      </MetricBadge>
                    }
                    onClick={() => navigate(`/detail/${e.mediaType}/${e.tmdbId}`, { state: { backLabel: 'Stats' } })}
                  />
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Top rated */}
        {(topRatedByKind.all.length > 0 || topRatedByKind.movies.length > 0
          || topRatedByKind.tv.length > 0 || topRatedByKind.episodes.length > 0) && (
          <Card>
            <ChartCardHeader
              icon={Star}
              title="Highest Rated"
              tone="warning"
              actions={
                <>
                  <SortToggle
                    value={topRatedKind}
                    options={[
                      { value: 'all', label: 'All' },
                      { value: 'movies', label: 'Movies' },
                      { value: 'tv', label: 'TV' },
                      { value: 'episodes', label: 'Episodes' }
                    ]}
                    onChange={handleSetTopRatedKind}
                  />
                  <SeeMoreButton
                    onClick={() => {
                      const params = new URLSearchParams({ sortOrder: 'rating_desc' })
                      if (topRatedKind === 'movies') params.set('mediaFilter', 'movie')
                      else if (topRatedKind === 'tv') params.set('mediaFilter', 'tv')
                      else if (topRatedKind === 'episodes') params.set('mediaFilter', 'episode')
                      if (period !== 'all') params.set('year', String(period))
                      navigate(`/log?${params.toString()}`)
                    }}
                  />
                </>
              }
            />
            <CardContent className="p-0">
              {topRated.length === 0 ? (
                <p className="px-4 py-6 text-xs text-muted-foreground text-center">
                  No rated {topRatedKind === 'all' ? 'entries' : topRatedKind} yet in this period.
                </p>
              ) : (
                topRated.map((row, i) => {
                  const e = row.entry
                  const isEpisode = !!row.episodeKey
                  const epLabel = row.episodeKey
                    ? `S${row.episodeKey.split(':')[0]}E${row.episodeKey.split(':')[1]}`
                    : null
                  const epName = row.episodeTitle?.replace(/^S\d+E\d+:?\s*/, '') ?? ''
                  return (
                    <LeaderboardRow
                      key={`${e.id}::${row.episodeKey ?? ''}`}
                      rank={i}
                      entry={e}
                      subtitle={
                        isEpisode ? (
                          <>
                            <span className="font-mono text-info">{epLabel}</span>
                            {epName && <span className="truncate">{epName}</span>}
                            <MediaTypeTag mediaType={e.mediaType} />
                          </>
                        ) : (
                          <>
                            {e.releaseYear != null && <span className="tabular-nums">{e.releaseYear}</span>}
                            <MediaTypeTag mediaType={e.mediaType} />
                          </>
                        )
                      }
                      badge={
                        <MetricBadge tone="warning" icon={Star} iconFilled>
                          {fmtRating(row.rating, settings.ratingSystem as '10star' | '5star')}
                        </MetricBadge>
                      }
                      onClick={() => {
                        if (isEpisode && row.episodeKey) {
                          navigate(`/log?episodeKey=${row.episodeKey}&mediaId=${e.id}`)
                        } else {
                          navigate(`/detail/${e.mediaType}/${e.tmdbId}`, { state: { backLabel: 'Stats' } })
                        }
                      }}
                    />
                  )
                })
              )}
            </CardContent>
          </Card>
        )}
        </section>
        )}
      </div>
    </ScrollArea>
  )
}

function buildHeatmapGrid(
  startDate: Date,
  endDate: Date,
  data: Record<string, number>,
  useDayOfYearKey = false
): { weeks: Array<Array<{ date: string; count: number } | null>>; labels: Record<number, string> } {
  const startPadded = new Date(startDate)
  startPadded.setDate(startPadded.getDate() - startPadded.getDay())

  const cells: Array<{ date: string; count: number } | null> = []
  const cursor = new Date(startPadded)
  while (cursor <= endDate) {
    const key = useDayOfYearKey
      ? `${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
      : `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
    cells.push(cursor >= startDate ? { date: key, count: data[key] ?? 0 } : null)
    cursor.setDate(cursor.getDate() + 1)
  }
  while (cells.length % 7 !== 0) cells.push(null)

  const weeks: Array<Array<{ date: string; count: number } | null>> = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  return { weeks, labels: buildMonthLabels(weeks) }
}

function buildMonthLabels(
  weeks: Array<Array<{ date: string; count: number } | null>>,
  includeYear = false
): Record<number, string> {
  const labels: Record<number, string> = {}
  let lastMonth = -1
  let lastYear = -1
  let lastLabelWi = -Infinity
  weeks.forEach((week, wi) => {
    // Prefer the cell where day === 1 (true month start); fall back to first real cell.
    let labelCell: { date: string; count: number } | null = null
    for (const cell of week) {
      if (!cell) continue
      if (!labelCell) labelCell = cell
      if (parseCellDate(cell.date).getDate() === 1) {
        labelCell = cell
        break
      }
    }
    if (!labelCell) return
    const d = parseCellDate(labelCell.date)
    const m = d.getMonth()
    const y = d.getFullYear()
    if (m === lastMonth && y === lastYear) return
    // Skip labels that would crowd the previous one (e.g. partial weeks at year edges).
    if (wi - lastLabelWi < 2) {
      lastMonth = m
      lastYear = y
      return
    }
    const monthStr = d.toLocaleDateString('en-US', { month: 'short' })
    labels[wi] = includeYear && (m === 0 || y !== lastYear)
      ? `${monthStr} '${String(y).slice(2)}`
      : monthStr
    lastMonth = m
    lastYear = y
    lastLabelWi = wi
  })
  return labels
}

function HeatmapGrid({
  weeks, labels, maxCount, setTooltip, showLegend, onDayClick
}: {
  weeks: Array<Array<{ date: string; count: number } | null>>
  labels: Record<number, string>
  maxCount: number
  setTooltip: (t: { date: string; count: number; x: number; y: number } | null) => void
  showLegend?: boolean
  onDayClick?: (day: { date: string; count: number }) => void
}) {
  const navigate = useNavigate()

  const getCellClass = (count: number): string => {
    if (count === 0) return 'bg-secondary/60'
    const ratio = count / maxCount
    if (ratio < 0.25) return 'bg-primary/30'
    if (ratio < 0.5) return 'bg-primary/55'
    if (ratio < 0.75) return 'bg-primary/75'
    return 'bg-primary'
  }

  const dayLetters: Record<number, string> = { 1: 'Mon', 3: 'Wed', 5: 'Fri' }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-max">
        <div className="relative h-3.5 mb-1.5 ml-8" style={{ width: `${weeks.length * 14 - 2}px` }}>
          {weeks.map((_, wi) => labels[wi] ? (
            <span
              key={wi}
              className="absolute top-0 text-[10px] leading-none text-muted-foreground whitespace-nowrap font-medium"
              style={{ left: `${wi * 14}px` }}
            >
              {labels[wi]}
            </span>
          ) : null)}
        </div>
        <div className="flex gap-1.5">
          <div className="flex flex-col gap-0.5 mr-0.5">
            {[0, 1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="h-3 w-6 text-[9px] text-muted-foreground flex items-center justify-end pr-1 leading-none tabular-nums">
                {dayLetters[i] ?? ''}
              </div>
            ))}
          </div>
          <div className="flex gap-0.5">
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-0.5">
                {week.map((day, di) => (
                  <div
                    key={di}
                    className={cn(
                      'h-3 w-3 rounded-sm transition-opacity',
                      day ? getCellClass(day.count) : 'bg-transparent',
                      day ? 'cursor-pointer hover:ring-1 hover:ring-primary/60 hover:ring-offset-[1px] hover:ring-offset-background' : ''
                    )}
                    onMouseEnter={day ? (e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                      setTooltip({ date: day.date, count: day.count, x: rect.left + rect.width / 2, y: rect.top })
                    } : undefined}
                    onMouseLeave={() => setTooltip(null)}
                    onClick={day ? () => onDayClick ? onDayClick(day) : navigate(`/log?date=${day.date}`) : undefined}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
        {showLegend && (
          <div className="flex items-center gap-1.5 mt-2 ml-8">
            <span className="text-[9px] text-muted-foreground">Less</span>
            {(['bg-secondary/60', 'bg-primary/30', 'bg-primary/55', 'bg-primary/75', 'bg-primary'] as const).map((cls, i) => (
              <div key={i} className={cn('h-3 w-3 rounded-sm', cls)} />
            ))}
            <span className="text-[9px] text-muted-foreground">More</span>
          </div>
        )}
      </div>
    </div>
  )
}

function WatchHeatmap({
  data, year
}: {
  data: Record<string, number>
  year: number | 'all'
}) {
  const navigate = useNavigate()
  const [tooltip, setTooltip] = useState<{ date: string; count: number; x: number; y: number } | null>(null)

  const maxCount = Math.max(...Object.values(data), 1)

  const { weeks, labels } = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    if (year === 'all') {
      // Use 2024 (leap year) as reference so Feb 29 appears
      const startDate = new Date(2024, 0, 1)
      const endDate = new Date(2024, 11, 31)
      const { weeks: w } = buildHeatmapGrid(startDate, endDate, data, true)
      return { weeks: w, labels: buildMonthLabels(w, false) }
    }

    const startDate = new Date(year, 0, 1)
    const endDate = year === today.getFullYear() ? today : new Date(year, 11, 31)
    return buildHeatmapGrid(startDate, endDate, data)
  }, [data, year])

  const fmtTooltipDate = (dateStr: string) => {
    if (year === 'all') {
      const d = new Date(`2024-${dateStr}T12:00:00`)
      return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
    }
    const d = new Date(dateStr + 'T12:00:00')
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  }

  const handleDayClick = (day: { date: string; count: number }) => {
    if (day.count === 0) return
    if (year === 'all') {
      navigate(`/log?monthDay=${day.date}`)
    } else {
      navigate(`/log?date=${day.date}`)
    }
  }

  return (
    <>
      <HeatmapGrid
        weeks={weeks}
        labels={labels}
        maxCount={maxCount}
        setTooltip={setTooltip}
        showLegend
        onDayClick={handleDayClick}
      />
      {tooltip && ReactDOM.createPortal(
        <div
          className="pointer-events-none fixed z-[9999] -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-card px-3 py-2 shadow-lg shadow-black/40"
          style={{ left: tooltip.x, top: tooltip.y - 8 }}
        >
          <p className="text-xs font-semibold text-foreground leading-tight">{fmtTooltipDate(tooltip.date)}</p>
          <p className="text-[11px] text-muted-foreground mt-1 leading-tight">
            {tooltip.count === 0
              ? 'No entries'
              : `${tooltip.count} entr${tooltip.count === 1 ? 'y' : 'ies'}${year === 'all' ? ' across all years' : ''}`}
          </p>
          {tooltip.count > 0 && (
            <p className="text-[10px] text-primary mt-1 leading-tight font-medium">
              {year === 'all' ? 'Click to view all watches' : 'Click to view log'}
            </p>
          )}
        </div>,
        document.body
      )}
    </>
  )
}

type StatTone = 'primary' | 'teal' | 'warning' | 'success' | 'info'

const TONE_STYLES: Record<StatTone, { text: string; bg: string; bgHover: string; ring: string }> = {
  primary: { text: 'text-primary', bg: 'bg-primary/10', bgHover: 'group-hover:bg-primary/20', ring: 'group-hover:ring-primary/20' },
  teal:    { text: 'text-teal',    bg: 'bg-teal/10',    bgHover: 'group-hover:bg-teal/20',    ring: 'group-hover:ring-teal/20' },
  warning: { text: 'text-warning', bg: 'bg-warning/15', bgHover: 'group-hover:bg-warning/25', ring: 'group-hover:ring-warning/20' },
  success: { text: 'text-success', bg: 'bg-success/10', bgHover: 'group-hover:bg-success/20', ring: 'group-hover:ring-success/20' },
  info:    { text: 'text-info',    bg: 'bg-info/10',    bgHover: 'group-hover:bg-info/20',    ring: 'group-hover:ring-info/20' },
}

function StatBox({
  icon: Icon, label, value, valueStr, tone
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value?: number
  valueStr?: string
  tone: StatTone
}) {
  const t = TONE_STYLES[tone]
  return (
    <div className="group relative flex flex-col gap-3 rounded-xl bg-card p-4 border border-border/50 transition-colors duration-200 hover:border-border hover:bg-card/60">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold truncate">{label}</p>
        <div className={cn('flex h-7 w-7 items-center justify-center rounded-lg flex-shrink-0 transition-colors duration-200', t.bg, t.bgHover)}>
          <Icon className={cn('h-3.5 w-3.5', t.text)} />
        </div>
      </div>
      <p className={cn('text-2xl font-bold tabular-nums leading-none', t.text)}>
        {valueStr ?? value?.toLocaleString() ?? '0'}
      </p>
    </div>
  )
}

function ChartCardHeader({
  icon: Icon,
  title,
  subtitle,
  tone,
  actions
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  subtitle?: string
  tone: StatTone
  actions?: React.ReactNode
}) {
  const t = TONE_STYLES[tone]
  return (
    <CardHeader className="pb-2 flex flex-row items-center justify-between gap-3 space-y-0">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className={cn('flex h-7 w-7 items-center justify-center rounded-lg flex-shrink-0', t.bg)}>
          <Icon className={cn('h-3.5 w-3.5', t.text)} />
        </div>
        <div className="min-w-0">
          <CardTitle className="text-sm leading-tight truncate">{title}</CardTitle>
          {subtitle && (
            <p className="text-[11px] text-muted-foreground mt-1 leading-tight truncate">{subtitle}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </CardHeader>
  )
}

function SortToggle<T extends string>({
  value, options, onChange
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex bg-secondary/60 rounded-md p-0.5 gap-0.5 border border-border/40">
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'px-2 py-0.5 text-[10px] rounded-sm cursor-pointer transition-colors whitespace-nowrap',
            value === opt.value
              ? 'bg-card text-foreground shadow-sm ring-1 ring-border/60'
              : 'text-muted-foreground hover:text-foreground hover:bg-card/40'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function SeeMoreButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-6 text-xs px-2 text-muted-foreground gap-1"
      onClick={onClick}
    >
      See more <ArrowRight className="h-3 w-3" />
    </Button>
  )
}

function MetricBadge({
  tone, icon: Icon, iconFilled = false, children
}: {
  tone: StatTone
  icon: React.ComponentType<{ className?: string }>
  iconFilled?: boolean
  children: React.ReactNode
}) {
  const t = TONE_STYLES[tone]
  return (
    <div className={cn(
      'flex items-center gap-1 flex-shrink-0 rounded-md px-2 py-1 transition-colors',
      t.bg,
      t.bgHover
    )}>
      <Icon className={cn('h-3 w-3', t.text, iconFilled && 'fill-current')} />
      <span className={cn('text-xs font-semibold tabular-nums', t.text)}>{children}</span>
    </div>
  )
}

function RankBadge({ rank }: { rank: number }) {
  if (rank < 3) {
    return (
      <span className={cn(
        'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold flex-shrink-0 tabular-nums',
        rank === 0 ? 'bg-warning/15 text-warning ring-1 ring-warning/25'
        : rank === 1 ? 'bg-muted-foreground/15 text-foreground/80 ring-1 ring-muted-foreground/20'
        : 'bg-amber-500/10 text-amber-500/90 ring-1 ring-amber-500/20'
      )}>{rank + 1}</span>
    )
  }
  return (
    <span className="text-sm font-semibold w-6 text-center flex-shrink-0 tabular-nums text-muted-foreground/50">
      {rank + 1}
    </span>
  )
}

function LeaderboardRow({
  rank, entry, subtitle, badge, onClick
}: {
  rank: number
  entry: LibraryEntry
  subtitle?: React.ReactNode
  badge: React.ReactNode
  onClick: () => void
}) {
  const FallbackIcon = entry.mediaType === 'movie' ? Film : Tv
  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 cursor-pointer group hover:bg-secondary/40 transition-colors border-b border-border/30 last:border-0"
      onClick={onClick}
    >
      <RankBadge rank={rank} />
      <div className="h-12 w-8 rounded overflow-hidden flex-shrink-0 bg-secondary/50">
        {entry.posterPath ? (
          <img src={posterUrl(entry.posterPath, 'w92')} alt="" className="w-full h-full object-cover group-hover:opacity-80 transition-opacity" />
        ) : (
          <div className="w-full h-full flex items-center justify-center"><FallbackIcon className="h-3 w-3 text-muted-foreground/30" /></div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate group-hover:text-primary transition-colors">{entry.title}</p>
        {subtitle != null && (
          <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-2 min-w-0">
            {subtitle}
          </div>
        )}
      </div>
      {badge}
    </div>
  )
}

function MediaTypeTag({ mediaType }: { mediaType: LibraryEntry['mediaType'] }) {
  const Icon = mediaType === 'movie' ? Film : Tv
  const label = mediaType === 'movie' ? 'Movie' : mediaType === 'anime' ? 'Anime' : 'TV'
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <Icon className="h-3 w-3" />
      <span>{label}</span>
    </span>
  )
}

function CategoryHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{title}</h2>
      <div className="h-px flex-1 bg-border/40" />
      {hint && <span className="text-[10px] text-muted-foreground/70">{hint}</span>}
    </div>
  )
}
