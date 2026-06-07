import React, { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import {
  ArrowLeft, Star, Clock, Calendar, Tv, Bookmark, Plus, Check,
  ChevronDown, ChevronRight, ChevronUp, History, Trash2, List, Repeat2, Loader2, X, Ban, Zap,
  ExternalLink, MoreHorizontal, RotateCcw, Undo2, Pencil
} from 'lucide-react'

import { getMovie, getTV, getSeason } from '../lib/tmdb'
import { useStore } from '../lib/store'
import type { MediaTarget, CatalogEpisode } from '../lib/mediaActions'
import {
  cn, backdropUrl, posterUrl, fmtRuntime, fmtDate,
  releaseYear, statusLabel, fmtRating, fmtRelative, parseImportDate, effectiveRating
} from '../lib/utils'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Skeleton } from '../components/ui/skeleton'
import { Progress } from '../components/ui/progress'
import { RatingInput } from '../components/shared/RatingInput'
import { ScrollableRow } from '../components/shared/ScrollableRow'
import { CastRow, type CastMember } from '../components/shared/CastRow'
import { SpoilerText } from '../components/shared/SpoilerText'
import { MediaCard } from '../components/shared/MediaCard'
import { LogEntryModal } from '../components/shared/LogEntryModal'
import { ScrollArea } from '../components/ui/scroll-area'
import { Separator } from '../components/ui/separator'
import { Popover, PopoverContent, PopoverAnchor, PopoverTrigger } from '../components/ui/popover'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '../components/ui/dropdown-menu'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog'
import { toast } from 'sonner'
import type {
  TMDbMovie, TMDbTV, TMDbSeason, MediaType, LibraryEntry,
  SpoilerSettings, WatchHistoryEntry, ListItemMeta
} from '../types'

// Fetch many seasons with a concurrency cap so a 30-season show doesn't
// flood the rate limiter and starve unrelated requests.
async function fetchSeasonsThrottled(tvId: number, seasonNumbers: number[], limit: number): Promise<TMDbSeason[]> {
  const results: TMDbSeason[] = new Array(seasonNumbers.length)
  let cursor = 0
  async function worker() {
    while (true) {
      const i = cursor++
      if (i >= seasonNumbers.length) return
      results[i] = await getSeason(tvId, seasonNumbers[i])
    }
  }
  const workers: Promise<void>[] = []
  for (let i = 0; i < Math.min(limit, seasonNumbers.length); i++) workers.push(worker())
  await Promise.all(workers)
  return results
}

type DetailParams = { type: string; id: string }

export function Detail() {
  const { type, id } = useParams<DetailParams>()
  const navigate = useNavigate()
  const location = useLocation()
  const locationState = location.state as { backLabel?: string; scrollToEpisode?: { season: number; episode: number } } | null
  const rawBack = locationState?.backLabel
  const backLabel = rawBack ? `Back to ${rawBack}` : 'Back'
  const scrollToEpisode = locationState?.scrollToEpisode
  const mediaType = type as MediaType
  const tmdbId = Number(id)
  const libId = `${mediaType}:${tmdbId}`

  const settings = useStore(s => s.settings)
  const entry = useStore(s => s.library[libId])
  const lists = useStore(s => s.lists)
  const watchHistory = useStore(s => s.watchHistory)
  const removeHistory = useStore(s => s.removeHistory)
  const toggleWatchlist = useStore(s => s.toggleWatchlist)
  const dropMedia = useStore(s => s.dropMedia)
  const undropMedia = useStore(s => s.undropMedia)
  const logEpisode = useStore(s => s.logEpisode)
  const replayEpisode = useStore(s => s.replayEpisode)
  const removeEpisodePlays = useStore(s => s.removeEpisodePlays)
  const logAllEpisodes = useStore(s => s.logAllEpisodes)
  const startRewatch = useStore(s => s.startRewatch)
  const undoRewatch = useStore(s => s.undoRewatch)
  const reconcileMovieLog = useStore(s => s.reconcileMovieLog)
  const setOverallRating = useStore(s => s.setOverallRating)
  const setReview = useStore(s => s.setReview)
  const setEpisodeRating = useStore(s => s.setEpisodeRating)
  const setSeasonRating = useStore(s => s.setSeasonRating)
  const toggleListItem = useStore(s => s.toggleListItem)
  const createListWith = useStore(s => s.createListWith)

  const [movie, setMovie] = useState<TMDbMovie | null>(null)
  const [tv, setTV] = useState<TMDbTV | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [allSeasons, setAllSeasons] = useState<TMDbSeason[]>([])
  const [seasonsLoading, setSeasonsLoading] = useState(false)
  const [expandedSeasons, setExpandedSeasons] = useState<Set<number>>(new Set())

  const [logModalOpen, setLogModalOpen] = useState(false)
  const [logEpisodeKey, setLogEpisodeKey] = useState<string | undefined>()
  const [logEpisodeTitle, setLogEpisodeTitle] = useState<string | undefined>()
  const [logFirstEpisodeWatch, setLogFirstEpisodeWatch] = useState(false)
  const [logDefaultRewatch, setLogDefaultRewatch] = useState(false)
  const [markAllConfirm, setMarkAllConfirm] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)
  const [dropConfirm, setDropConfirm] = useState(false)
  const [rewatchConfirm, setRewatchConfirm] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [editingPlay, setEditingPlay] = useState<WatchHistoryEntry | null>(null)
  const [listPickerOpen, setListPickerOpen] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [creatingList, setCreatingList] = useState(false)

  // Cast list view - TV shows split series regulars from guest stars
  const [castTab, setCastTab] = useState<'regulars' | 'guests'>('regulars')

  // Specific plays modal
  const [specificPlaysEpKey, setSpecificPlaysEpKey] = useState<string | null>(null)
  const [specificPlaysTitle, setSpecificPlaysTitle] = useState('')
  const [specificPlaysOpen, setSpecificPlaysOpen] = useState(false)

  const detailReqId = useRef(0)
  const seasonsReqId = useRef(0)
  const hasTriggeredScroll = useRef(false)

  useEffect(() => {
    const id = ++detailReqId.current
    setLoading(true); setError(null); setMovie(null); setTV(null); setAllSeasons([]); setCastTab('regulars')
    const load = mediaType === 'movie' ? getMovie(tmdbId) : getTV(tmdbId)
    load
      .then((data) => {
        if (id !== detailReqId.current) return
        if (mediaType === 'movie') setMovie(data as TMDbMovie)
        else setTV(data as TMDbTV)
      })
      .catch((e) => {
        if (id !== detailReqId.current) return
        setError(e.message)
      })
      .finally(() => {
        if (id !== detailReqId.current) return
        setLoading(false)
      })
  }, [tmdbId, mediaType])

  useEffect(() => {
    if (!tv || mediaType === 'movie') return
    const realSeasons = tv.seasons.filter((s) => s.season_number > 0)
    if (realSeasons.length === 0) return
    const id = ++seasonsReqId.current
    setSeasonsLoading(true)
    fetchSeasonsThrottled(tmdbId, realSeasons.map((s) => s.season_number), 4)
      .then((seasons) => {
        if (id !== seasonsReqId.current) return
        setAllSeasons(seasons)
        setExpandedSeasons(
          settings.seasonDisplay === 'start_collapsed'
            ? new Set()
            : new Set(seasons.map((s) => s.season_number))
        )
        // Refresh runtimes from the real episode data now that we have it:
        //  - the show's average runtime (the fallback figure), rewritten only on a
        //    >=2 min delta so we don't churn the library on cosmetic drift;
        //  - the exact per-episode runtime onto each already-tracked episode, so
        //    watch-time stats use real durations where known. Episodes TMDb still
        //    has no runtime for are left untouched (they keep using the average).
        const allEps = seasons.flatMap((s) => s.episodes)
        const epsWithRuntime = allEps.filter((e) => (e.runtime ?? 0) > 0)
        const libEntry = useStore.getState().library[`${mediaType}:${tmdbId}`]
        if (libEntry && epsWithRuntime.length > 0) {
          const avgRuntime = Math.round(epsWithRuntime.reduce((sum, e) => sum + e.runtime!, 0) / epsWithRuntime.length)
          const avgChanged = libEntry.runtime == null || Math.abs(libEntry.runtime - avgRuntime) >= 2

          let progressChanged = false
          const nextProgress = libEntry.tvProgress ? { ...libEntry.tvProgress } : null
          if (nextProgress) {
            for (const e of epsWithRuntime) {
              const key = `${e.season_number}:${e.episode_number}`
              const prog = nextProgress[key]
              if (prog && prog.runtime !== e.runtime) {
                nextProgress[key] = { ...prog, runtime: e.runtime }
                progressChanged = true
              }
            }
          }

          if (avgChanged || progressChanged) {
            useStore.getState().setLibraryEntry({
              ...libEntry,
              ...(avgChanged ? { runtime: avgRuntime } : {}),
              ...(progressChanged ? { tvProgress: nextProgress } : {}),
            })
          }
        }
      })
      .catch((err) => {
        if (id !== seasonsReqId.current) return
        console.error(err)
      })
      .finally(() => {
        if (id !== seasonsReqId.current) return
        setSeasonsLoading(false)
      })
  }, [tv, tmdbId, mediaType])

  // Scroll to target episode when navigated from "Continue Watching"
  useEffect(() => {
    if (!scrollToEpisode || !settings.autoScrollToNextEpisode || allSeasons.length === 0 || hasTriggeredScroll.current) return
    hasTriggeredScroll.current = true
    const { season, episode } = scrollToEpisode
    setExpandedSeasons(prev => {
      const next = new Set(prev)
      next.add(season)
      return next
    })
    const epKey = `${season}:${episode}`
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-ep-key="${epKey}"]`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 250)
    return () => clearTimeout(timer)
  }, [allSeasons, scrollToEpisode])

  const backdrop = backdropUrl(movie?.backdrop_path ?? tv?.backdrop_path, 'w1280')
  const poster = posterUrl(movie?.poster_path ?? tv?.poster_path, 'w500')
  const title = movie?.title ?? tv?.name ?? ''
  const overview = movie?.overview ?? tv?.overview ?? ''
  const voteAvg = movie?.vote_average ?? tv?.vote_average ?? 0
  const genres = movie?.genres ?? tv?.genres ?? []
  const year = releaseYear(movie?.release_date ?? tv?.first_air_date)
  const releaseDate = movie?.release_date ?? tv?.first_air_date
  const runtime = movie?.runtime
  const effectiveRuntime = movie?.runtime ?? tv?.episode_run_time?.find(r => r > 0) ?? null
  const status = movie?.status ?? tv?.status

  // External links surfaced from the TMDb response (homepage, IMDb, socials).
  const ext = movie?.external_ids ?? tv?.external_ids
  const homepage = movie?.homepage ?? tv?.homepage
  const imdbId = movie?.imdb_id ?? ext?.imdb_id
  const externalLinks: { label: string; href: string }[] = []
  if (homepage) externalLinks.push({ label: 'Official Site', href: homepage })
  if (imdbId) externalLinks.push({ label: 'IMDb', href: `https://www.imdb.com/title/${imdbId}/` })
  externalLinks.push({ label: 'TMDb', href: `https://www.themoviedb.org/${mediaType === 'movie' ? 'movie' : 'tv'}/${tmdbId}` })
  if (ext?.wikidata_id) externalLinks.push({ label: 'Wikidata', href: `https://www.wikidata.org/wiki/${ext.wikidata_id}` })
  if (ext?.facebook_id) externalLinks.push({ label: 'Facebook', href: `https://www.facebook.com/${ext.facebook_id}` })
  if (ext?.instagram_id) externalLinks.push({ label: 'Instagram', href: `https://www.instagram.com/${ext.instagram_id}` })
  if (ext?.twitter_id) externalLinks.push({ label: 'X', href: `https://twitter.com/${ext.twitter_id}` })

  // One reference to this title carrying full TMDb metadata, so any action that
  // has to create a library entry starts from complete data. Every media action
  // on this page funnels through a store action using this target.
  const target: MediaTarget = {
    mediaType,
    tmdbId,
    title,
    posterPath: movie?.poster_path ?? tv?.poster_path ?? null,
    backdropPath: movie?.backdrop_path ?? tv?.backdrop_path,
    releaseYear: year,
    genreIds: genres.map((g) => g.id),
    runtime: effectiveRuntime,
  }

  const handleWatchlistToggle = async () => {
    const res = await toggleWatchlist(target)
    toast.success(res === 'removed' ? `${title} removed from watchlist` : `${title} added to watchlist`)
  }

  const handleDrop = async () => {
    await dropMedia(target)
    setDropConfirm(false)
    toast.success(`${title} dropped`)
  }

  const handleUndrop = async () => {
    await undropMedia(target)
    toast.success(`${title} restored`)
  }

  const handleStartRewatch = async () => {
    await startRewatch(target)
    setRewatchConfirm(false)
    toast.success(`Rewatching ${title} from the start`)
  }

  const handleUndoRewatch = async () => {
    await undoRewatch(target)
    toast.success(`Stopped rewatching ${title}`)
  }

  // Mid-rewatch: a boundary is set and the show hasn't been fully re-watched yet.
  const isRewatching = entry?.rewatchStartedAt != null && entry.status === 'in_progress'

  // Lightweight metadata for adding this title to a list while it's not in the
  // library - a list item doesn't need a library entry, it's just a reference.
  const listItemMeta = (): ListItemMeta => ({
    mediaType,
    tmdbId,
    title,
    posterPath: movie?.poster_path ?? tv?.poster_path ?? null,
    releaseYear: year,
    addedAt: Date.now(),
  })

  const handleToggleList = async (listId: string) => {
    const list = lists.find((l) => l.id === listId)
    if (!list) return
    // toggleListItem uses `meta` only when the title isn't in the library.
    await toggleListItem(list, { itemId: libId, meta: listItemMeta() })
  }

  const handleToggleEpisodeList = async (listId: string, epKey: string) => {
    const list = lists.find((l) => l.id === listId)
    if (!list) return
    const res = await toggleListItem(list, { itemId: `${libId}::${epKey}` })
    toast.success(res === 'removed' ? 'Removed from list' : 'Added to list')
  }

  const handleCreateAndAddEpisodeList = async (name: string, epKey: string) => {
    if (!name.trim()) return
    const newList = await createListWith(name, { itemId: `${libId}::${epKey}` })
    toast.success(`Added to "${newList.name}"`)
  }

  const handleCreateAndAddList = async () => {
    if (!newListName.trim()) return
    setCreatingList(true)
    try {
      const newList = await createListWith(newListName, { itemId: libId, meta: listItemMeta() })
      toast.success(`Added to "${newList.name}"`)
      setNewListName('')
      setCreatingList(false)
    } catch {
      toast.error('Failed to create list')
      setCreatingList(false)
    }
  }

  // First-time episode watch: opens modal so user can add rating/note/date
  const handleEpisodeFirstLog = (seasonNum: number, epNum: number, epTitle: string) => {
    const key = `${seasonNum}:${epNum}`
    setLogEpisodeKey(key)
    setLogEpisodeTitle(`S${seasonNum}E${epNum}: ${epTitle}`)
    setLogFirstEpisodeWatch(true)
    setLogDefaultRewatch(false)
    setLogModalOpen(true)
  }

  // Called after LogEntryModal saves a first-time episode watch: update tvProgress
  // and recompute the show's status through the single source of truth. The loaded
  // seasons are passed as the catalogue so completion is detected without a refetch.
  const handleEpisodeModalSaved = async (histEntry: WatchHistoryEntry) => {
    if (!histEntry.episodeKey) return
    const catalog: CatalogEpisode[] = allSeasons.flatMap((s) =>
      s.episodes.map((e) => ({ key: `${e.season_number}:${e.episode_number}`, airDate: e.air_date }))
    )
    await logEpisode(target, histEntry, catalog)
  }

  // Called after LogEntryModal saves for movies - promote status per the watchlist rule
  const handleMovieSaved = async (histEntry: WatchHistoryEntry) => {
    await reconcileMovieLog(target, histEntry)
  }

  // Replay an already-watched episode at current time (no modal) - always a rewatch
  const handleEpisodeReplayNow = async (seasonNum: number, epNum: number, epTitle: string) => {
    await replayEpisode(target, `${seasonNum}:${epNum}`, `S${seasonNum}E${epNum}: ${epTitle}`)
    toast.success(`S${seasonNum}E${epNum} of ${title} logged again`)
  }

  // Open modal for logging with a custom date - rewatches auto-flag isRewatch
  const handleEpisodeLog = (seasonNum: number, epNum: number, epTitle: string) => {
    const key = `${seasonNum}:${epNum}`
    const currentEntry = useStore.getState().library[libId]
    const isFirstWatch = !currentEntry?.tvProgress?.[key]?.watchedAt
    setLogEpisodeKey(key)
    setLogEpisodeTitle(`S${seasonNum}E${epNum}: ${epTitle}`)
    setLogFirstEpisodeWatch(isFirstWatch)
    setLogDefaultRewatch(!isFirstWatch)
    setLogModalOpen(true)
  }

  // Remove all plays and unwatch the episode; store sync handles tvProgress + library status
  const handleEpisodeRemoveAllPlays = async (seasonNum: number, epNum: number) => {
    await removeEpisodePlays(target, `${seasonNum}:${epNum}`)
    toast.success(`Removed all plays of S${seasonNum}E${epNum} - ${title}`)
  }

  // Open specific plays modal for an episode
  const handleViewPlays = (seasonNum: number, epNum: number, epTitle: string) => {
    const key = `${seasonNum}:${epNum}`
    setSpecificPlaysEpKey(key)
    setSpecificPlaysTitle(`S${seasonNum}E${epNum}: ${epTitle}`)
    setSpecificPlaysOpen(true)
  }

  const handleMarkAllWatched = async () => {
    if (!allSeasons.length) return
    setMarkingAll(true)
    await logAllEpisodes(target, allSeasons)
    setMarkingAll(false)
    setMarkAllConfirm(false)
    toast.success(`All episodes of ${title} marked as watched`)
  }

  if (loading) return <DetailSkeleton />
  if (error) return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <p className="text-muted-foreground">{error}</p>
      <Button onClick={() => navigate(-1)} variant="outline"><ArrowLeft className="h-4 w-4 mr-2" /> Go Back</Button>
    </div>
  )

  const watchedEps = Object.values(entry?.tvProgress ?? {}).filter(p => p.watchedAt != null).length
  const totalEps = tv?.number_of_episodes ?? 0
  const progressPct = totalEps > 0 ? Math.round((watchedEps / totalEps) * 100) : 0
  const totalRuntime = allSeasons.length > 0
    ? allSeasons.flatMap(s => s.episodes).reduce((sum, ep) => sum + (ep.runtime ?? 0), 0)
    : (tv?.episode_run_time?.find(r => r > 0) ?? 0) * (tv?.number_of_episodes ?? 0)
  const voteCount = movie?.vote_count ?? tv?.vote_count ?? 0
  const mediaHistory = watchHistory.filter(h => h.mediaId === libId).sort((a, b) => b.watchedAt - a.watchedAt)

  // Per-episode runtime map from TMDb when available (some episodes have
  // their own runtime, others fall back to the show average).
  const fallbackEpRuntime = entry?.runtime ?? tv?.episode_run_time?.find(r => r > 0) ?? 0
  const epRuntimeFor = (epKey: string): number => {
    if (allSeasons.length > 0) {
      const [s, e] = epKey.split(':').map(Number)
      const season = allSeasons.find(sn => sn.season_number === s)
      const ep = season?.episodes.find(ep => ep.episode_number === e)
      if (ep?.runtime && ep.runtime > 0) return ep.runtime
    }
    return fallbackEpRuntime
  }
  // Runtime of unique episodes the user has watched at least once.
  const watchedEpRuntime = Object.entries(entry?.tvProgress ?? {})
    .filter(([, p]) => p.watchedAt != null)
    .reduce((sum, [key]) => sum + epRuntimeFor(key), 0)
  // Total time invested, counting every logged play (so rewatches add up).
  const totalTimeInvested = mediaHistory.reduce((sum, h) => {
    if (h.episodeKey) return sum + epRuntimeFor(h.episodeKey)
    return sum + (entry?.runtime ?? 0)
  }, 0)
  const rewatchPlays = mediaHistory.filter(h => h.isRewatch).length
  const specificEpPlays = specificPlaysEpKey
    ? mediaHistory.filter(h => h.episodeKey === specificPlaysEpKey).sort((a, b) => b.watchedAt - a.watchedAt)
    : []

  return (
    <ScrollArea className="h-full">
      <div className="view-container min-w-0">
        {/* Hero */}
        <div className="relative h-72 overflow-hidden w-full">
          <div
            className="absolute inset-0 bg-secondary bg-cover bg-top"
            style={backdrop ? { backgroundImage: `url(${backdrop})` } : undefined}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
          <Button
            variant="ghost"
            size="sm"
            className="absolute top-4 left-4 bg-black/40 backdrop-blur-sm hover:bg-black/60 text-white hover:text-white"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft className="h-4 w-4 mr-1" /> {backLabel}
          </Button>
        </div>

        {/* Content */}
        <div className="px-4 sm:px-6 pb-10 -mt-28 relative min-w-0">
          <div className="flex gap-4 sm:gap-6 min-w-0">
            {/* Poster */}
            <div className="flex-shrink-0 hidden sm:block">
              {poster ? (
                <img src={poster} alt={title} className="w-36 rounded-xl shadow-2xl ring-2 ring-border" />
              ) : (
                <div className="w-36 h-52 rounded-xl bg-secondary ring-2 ring-border flex items-center justify-center text-muted-foreground text-xs text-center p-2">{title}</div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 pt-28 sm:pt-0 min-w-0">
              <div className="flex flex-wrap gap-2 mb-2">
                <Badge variant="secondary">{mediaType === 'anime' ? 'Anime' : mediaType === 'movie' ? 'Movie' : 'TV Show'}</Badge>
                {status && <Badge variant="outline" className="bg-muted/50">{status}</Badge>}
              </div>
              <h1 className="font-serif text-2xl sm:text-3xl font-normal text-foreground break-words">{title}</h1>
              <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-muted-foreground">
                {year && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex items-center gap-1 cursor-default"><Calendar className="h-3.5 w-3.5" />{year}</span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <p className="text-xs">{movie ? 'Released' : 'First aired'} {fmtDate(releaseDate, 'MMMM d, yyyy')}</p>
                    </TooltipContent>
                  </Tooltip>
                )}
                {runtime && <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{fmtRuntime(runtime)}</span>}
                {voteAvg > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex items-center gap-1 cursor-default">
                        <Star className="h-3.5 w-3.5 fill-warning text-warning" />
                        <SpoilerText blur={settings.spoilerProtection.ratings}>
                          {settings.ratingSystem === '5star'
                            ? `${(voteAvg / 2).toFixed(1)}/5`
                            : `${voteAvg.toFixed(1)}/10`}
                        </SpoilerText>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="space-y-1">
                      <p className="font-medium text-xs">TMDb community rating</p>
                      <p className="text-xs opacity-70">{voteAvg.toFixed(1)} / 10{voteCount > 0 ? ` (${voteCount.toLocaleString()} votes)` : ''}</p>
                    </TooltipContent>
                  </Tooltip>
                )}
                {tv && (
                  <span className="flex items-center gap-1">
                    <Tv className="h-3.5 w-3.5" />
                    {tv.number_of_seasons}S / {tv.number_of_episodes}E
                  </span>
                )}
                {tv && totalRuntime > 0 && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {fmtRuntime(totalRuntime)}
                  </span>
                )}
              </div>
              {externalLinks.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-3">
                  {externalLinks.map((link) => (
                    <a
                      key={link.label}
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => { e.preventDefault(); window.open(link.href, '_blank', 'noopener,noreferrer') }}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors cursor-pointer"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {link.label}
                    </a>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-1.5 mt-2">
                {genres.map((g) => <Badge key={g.id} variant="outline" className="text-xs">{g.name}</Badge>)}
              </div>
              {/* Overview - sits directly below the genres */}
              <div className="mt-4">
                <SpoilerText
                  blur={settings.spoilerProtection.mediaDescriptions && (!entry || entry.status === 'watchlist')}
                  className="text-sm text-muted-foreground leading-relaxed break-words"
                >
                  {overview || 'No overview available.'}
                </SpoilerText>
              </div>
            </div>
          </div>

          {/* Tracking - flows straight under the top section: no card, no heading */}
          <div className="mt-6 space-y-3">
            {entry && (
              <div className="flex items-center gap-3 flex-wrap">
                <Badge variant={entry.status === 'watched' ? 'success' : entry.status === 'in_progress' ? 'warning' : 'secondary'}>
                  {statusLabel(entry.status)}
                </Badge>
                <RatingInput
                  value={entry.userRating}
                  onChange={async (v) => { await setOverallRating(target, v) }}
                  system={settings.ratingSystem}
                  size="sm"
                />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={entry?.status === 'watchlist' ? 'teal' : 'outline'}
                onClick={handleWatchlistToggle}
                className="gap-1.5"
              >
                <Bookmark className="h-3.5 w-3.5" />
                {entry?.status === 'watchlist' ? 'In Watchlist' : 'Add to Watchlist'}
              </Button>

              {/* Add to list */}
              <Popover open={listPickerOpen} onOpenChange={setListPickerOpen}>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="outline" className="gap-1.5">
                    <List className="h-3.5 w-3.5" />
                    Add to List
                    {(() => {
                      // Count manual lists containing this title (library-backed or not).
                      const n = lists.filter((l) => !l.rules?.enabled && l.itemIds.includes(libId)).length
                      return n > 0 ? (
                        <span className="ml-0.5 text-[10px] bg-primary/20 text-primary rounded-full px-1.5">{n}</span>
                      ) : null
                    })()}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-2" align="start">
                  <p className="text-xs font-medium text-muted-foreground px-1 pb-1.5 border-b border-border/50 mb-1.5">Your Lists</p>
                  {lists.length === 0 && (
                    <p className="text-xs text-muted-foreground px-1 py-2">No lists yet. Create one below.</p>
                  )}
                  <div className="space-y-0.5 mb-2">
                    {lists.map((list) => {
                      const isSmart = !!list.rules?.enabled
                      // itemIds is the membership source of truth - works whether
                      // or not the title is in the library.
                      const inList = list.itemIds.includes(libId)
                      return (
                        <button
                          key={list.id}
                          onClick={() => !isSmart && handleToggleList(list.id)}
                          disabled={isSmart}
                          title={isSmart ? 'Smart list - items determined by rules' : undefined}
                          className={cn(
                            'flex items-center gap-2 w-full px-2 py-1.5 rounded-md transition-colors text-left',
                            isSmart ? 'cursor-not-allowed opacity-60' : 'hover:bg-secondary cursor-pointer'
                          )}
                        >
                          <div className={cn('h-4 w-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors', inList ? 'bg-primary border-primary' : 'border-border')}>
                            {inList && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                          </div>
                          <span className="text-sm truncate flex-1">{list.name}</span>
                          {isSmart && (
                            <Zap className="h-2.5 w-2.5 text-primary flex-shrink-0" />
                          )}
                        </button>
                      )
                    })}
                  </div>
                  <div className="border-t border-border/50 pt-2">
                    <p className="text-xs text-muted-foreground px-1 mb-1.5">Create new list</p>
                    <div className="flex gap-1.5">
                      <Input
                        value={newListName}
                        onChange={(e) => setNewListName(e.target.value)}
                        placeholder="List name..."
                        className="h-7 text-xs"
                        onKeyDown={(e) => e.key === 'Enter' && handleCreateAndAddList()}
                      />
                      <Button size="sm" className="h-7 px-2 text-xs flex-shrink-0" onClick={handleCreateAndAddList} disabled={!newListName.trim() || creatingList}>
                        {creatingList ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Create'}
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>

              {entry?.status === 'dropped' && (
                <Button size="sm" variant="outline" onClick={handleUndrop} className="gap-1.5">
                  <Undo2 className="h-3.5 w-3.5" />
                  Undo Drop
                </Button>
              )}

              {tv ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" className="gap-1.5">
                      <MoreHorizontal className="h-3.5 w-3.5" />
                      More
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48">
                    <DropdownMenuItem onClick={() => setMarkAllConfirm(true)}>
                      <Plus className="h-3.5 w-3.5" />
                      Log All Episodes
                    </DropdownMenuItem>
                    {isRewatching ? (
                      <DropdownMenuItem onClick={handleUndoRewatch}>
                        <RotateCcw className="h-3.5 w-3.5" />
                        Undo Rewatch
                      </DropdownMenuItem>
                    ) : (entry?.status === 'watched' || entry?.status === 'in_progress') && (
                      <DropdownMenuItem onClick={() => setRewatchConfirm(true)}>
                        <Repeat2 className="h-3.5 w-3.5" />
                        Rewatch
                      </DropdownMenuItem>
                    )}
                    {entry?.status === 'in_progress' && (
                      <DropdownMenuItem
                        onClick={() => setDropConfirm(true)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Ban className="h-3.5 w-3.5" />
                        Drop Show
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Button size="sm" onClick={() => {
                  setLogEpisodeKey(undefined)
                  setLogFirstEpisodeWatch(false)
                  setLogDefaultRewatch(useStore.getState().watchHistory.filter(h => h.mediaId === libId).length > 0)
                  setLogModalOpen(true)
                }} className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  Log Watch
                </Button>
              )}
              {movie?.release_date && parseImportDate(movie.release_date) > Date.now() && (
                <p className="w-full text-xs text-warning mt-1">
                  Not yet released - you can still log it in advance.
                </p>
              )}
            </div>

            {tv && totalEps > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Progress</span>
                  <span>{watchedEps} / {totalEps} episodes ({progressPct}%)</span>
                </div>
                <Progress value={progressPct} />
                {(watchedEpRuntime > 0 || totalTimeInvested > 0) && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground/85 pt-1">
                    {watchedEpRuntime > 0 && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex items-center gap-1 cursor-default">
                            <Clock className="h-3 w-3" />
                            <span className="tabular-nums">{fmtRuntime(watchedEpRuntime)} watched</span>
                            {totalRuntime > 0 && (
                              <span className="text-muted-foreground/60">/ {fmtRuntime(totalRuntime)}</span>
                            )}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">
                          Runtime of unique episodes you&apos;ve watched
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {totalTimeInvested > watchedEpRuntime && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex items-center gap-1 cursor-default">
                            <Repeat2 className="h-3 w-3" />
                            <span className="tabular-nums">{fmtRuntime(totalTimeInvested)} total</span>
                            {rewatchPlays > 0 && (
                              <span className="text-muted-foreground/60">({rewatchPlays} rewatch{rewatchPlays === 1 ? '' : 'es'})</span>
                            )}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">
                          Time invested across every logged play
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {totalRuntime > 0 && watchedEps < totalEps && watchedEpRuntime > 0 && (
                      <span className="inline-flex items-center gap-1 text-muted-foreground/70">
                        <span>{fmtRuntime(Math.max(0, totalRuntime - watchedEpRuntime))} remaining</span>
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Note */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Note</label>
              <Textarea
                value={entry?.review ?? ''}
                onChange={async (e) => { await setReview(target, e.target.value) }}
                placeholder="Add a personal note..."
                className="min-h-[60px] text-xs"
                rows={2}
              />
            </div>
          </div>

          {/* Watch history - only shown after at least one play */}
          {mediaHistory.length > 0 && (
            <div className="mt-3 rounded-xl border border-border/50 bg-card overflow-hidden">
              <button
                onClick={() => setHistoryOpen(!historyOpen)}
                className="flex items-center gap-2 w-full text-left px-4 py-3.5 text-sm font-semibold hover:bg-secondary/30 transition-colors cursor-pointer"
              >
                <History className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                <span>Watch History</span>
                <span className="text-xs text-muted-foreground font-normal ml-1">
                  ({mediaHistory.length} {mediaHistory.length === 1 ? 'play' : 'plays'})
                </span>
                <span className="flex-1" />
                {historyOpen
                  ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                  : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
              </button>
              {historyOpen && (
                <div className="px-4 pb-4 space-y-2 border-t border-border/30 pt-3">
                  {mediaHistory.map((h) => (
                    <HistoryRow
                      key={h.id}
                      entry={h}
                      title={title}
                      ratingSystem={settings.ratingSystem}
                      timeFormat={settings.timeFormat}
                      displayRating={effectiveRating(entry, h.episodeKey)}
                      onEdit={() => setEditingPlay(h)}
                      onDelete={async () => {
                        await removeHistory(h.id)
                        toast.success('Play removed')
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Cast */}
          {(() => {
            // Movies have no regular/guest distinction (guests stays empty). For TV,
            // credits.cast is TMDb's curated main cast (the series regulars), while
            // aggregate_credits aggregates everyone who appeared across all episodes -
            // so anyone in aggregate but not in credits is a guest/recurring player.
            // Episode counts come from aggregate for both groups.
            let regulars: CastMember[] = []
            let guests: CastMember[] = []
            if (movie) {
              regulars = (movie.credits?.cast ?? []).map((c) => ({
                id: c.id, name: c.name, character: c.character, profile_path: c.profile_path,
              }))
            } else {
              const aggCast: CastMember[] = (tv?.aggregate_credits?.cast ?? []).map((c) => ({
                id: c.id, name: c.name, character: c.roles?.[0]?.character ?? '',
                profile_path: c.profile_path, episodeCount: c.total_episode_count,
              }))
              const regularIds = new Set((tv?.credits?.cast ?? []).map((c) => c.id))
              if (aggCast.length && regularIds.size) {
                regulars = aggCast.filter((c) => regularIds.has(c.id))
                guests = aggCast
                  .filter((c) => !regularIds.has(c.id))
                  .sort((a, b) => (b.episodeCount ?? 0) - (a.episodeCount ?? 0))
              } else if (aggCast.length) {
                regulars = aggCast
              } else {
                regulars = (tv?.credits?.cast ?? []).map((c) => ({
                  id: c.id, name: c.name, character: c.character, profile_path: c.profile_path,
                }))
              }
            }
            if (!regulars.length && !guests.length) return null

            const hasGuests = guests.length > 0
            const activeTab = hasGuests ? castTab : 'regulars'
            const shown = activeTab === 'guests' ? guests : regulars
            return (
              <section className="mt-8">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h2 className="font-semibold text-sm">Cast</h2>
                  {hasGuests && (
                    <div className="flex bg-secondary/60 rounded-md p-0.5 gap-0.5 border border-border/40 flex-shrink-0">
                      {([['regulars', 'Regulars', regulars.length], ['guests', 'Guest Stars', guests.length]] as const).map(([key, label, count]) => (
                        <button
                          key={key}
                          onClick={() => setCastTab(key)}
                          className={cn(
                            'px-2.5 py-1 text-xs font-medium rounded-sm cursor-pointer transition-colors whitespace-nowrap',
                            activeTab === key
                              ? 'bg-card text-foreground shadow-sm ring-1 ring-border/60'
                              : 'text-muted-foreground hover:text-foreground hover:bg-card/40'
                          )}
                        >
                          {label} ({count})
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <CastRow
                  key={activeTab}
                  members={shown}
                  blurEpisodeCounts={settings.spoilerProtection.actorEpisodeCounts}
                  onSelect={(personId) => navigate(`/person/${personId}`, { state: { backLabel: title } })}
                />
              </section>
            )
          })()}

          {/* TV: All seasons + episodes */}
          {tv && (
            <section className="mt-8">
              <h2 className="font-semibold text-sm mb-4">Episodes</h2>

              {seasonsLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
                </div>
              ) : (
                <div className="space-y-4">
                  {allSeasons.map((season) => {
                    const isExpanded = expandedSeasons.has(season.season_number)
                    const toggleExpand = () => setExpandedSeasons((prev) => {
                      const next = new Set(prev)
                      next.has(season.season_number) ? next.delete(season.season_number) : next.add(season.season_number)
                      return next
                    })

                    const isEpWatched = (ep: typeof season.episodes[number]) =>
                      !!entry?.tvProgress?.[`${ep.season_number}:${ep.episode_number}`]?.watchedAt
                    const watchedInSeason = season.episodes.filter(isEpWatched).length

                    // Per-episode runtime, falling back to the show average when an
                    // episode carries no runtime of its own.
                    const epRt = (ep: typeof season.episodes[number]) =>
                      ep.runtime && ep.runtime > 0 ? ep.runtime : fallbackEpRuntime
                    const seasonRuntime = season.episodes.reduce((sum, ep) => sum + epRt(ep), 0)
                    const seasonWatchedRuntime = season.episodes.filter(isEpWatched).reduce((sum, ep) => sum + epRt(ep), 0)

                    // Air span from the first to the last episode that has aired.
                    const airDates = season.episodes
                      .map((ep) => ep.air_date)
                      .filter((d): d is string => !!d)
                      .sort()
                    let airRangeLabel = ''
                    if (airDates.length > 0) {
                      const first = fmtDate(airDates[0], 'MMM yyyy')
                      const last = fmtDate(airDates[airDates.length - 1], 'MMM yyyy')
                      airRangeLabel = first === last ? first : `${first} to ${last}`
                    }

                    // Average TMDb community score across rated episodes.
                    const ratedEps = season.episodes.filter((ep) => ep.vote_average > 0)
                    const avgScore = ratedEps.length
                      ? ratedEps.reduce((sum, ep) => sum + ep.vote_average, 0) / ratedEps.length
                      : 0
                    const seasonVoteCount = ratedEps.reduce((sum, ep) => sum + (ep.vote_count ?? 0), 0)

                    // Blur the season description per spoiler settings, revealing once the
                    // user has watched enough of the season (their chosen threshold).
                    const seasonFullyWatched = season.episodes.length > 0 && watchedInSeason === season.episodes.length
                    const seasonDescRevealed = settings.spoilerProtection.seasonDescriptionRevealAt === 'completed'
                      ? seasonFullyWatched
                      : watchedInSeason >= 1
                    const blurSeasonOverview = settings.spoilerProtection.seasonDescriptions && !seasonDescRevealed

                    return (
                      <div key={season.season_number}>
                        <div className="mb-3">
                          <div
                            className="flex items-center gap-3 cursor-pointer select-none"
                            onClick={toggleExpand}
                          >
                            {isExpanded
                              ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                              : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            }
                            <h3 className="font-medium text-sm">Season {season.season_number}</h3>
                            {entry && isExpanded && (
                              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                <span className="text-xs text-muted-foreground">Rating:</span>
                                <RatingInput
                                  value={entry.seasonRatings?.[season.season_number] ?? null}
                                  onChange={async (v) => { await setSeasonRating(target, season.season_number, v) }}
                                  system={settings.ratingSystem}
                                  size="sm"
                                />
                              </div>
                            )}
                            {entry && !isExpanded && (entry.seasonRatings?.[season.season_number] ?? null) != null && (
                              <span className="flex items-center gap-1 text-xs text-warning font-medium flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                                <Star className="h-3 w-3 fill-warning" />
                                {fmtRating(entry.seasonRatings![season.season_number], settings.ratingSystem)}
                              </span>
                            )}
                            <Separator className="flex-1" />
                            <div className="flex items-center gap-2 flex-shrink-0 text-xs text-muted-foreground">
                              {!settings.showSeasonMetadata && (
                                <span>{season.episodes.length} episodes</span>
                              )}
                              {watchedInSeason > 0 && (
                                <span className="flex items-center gap-1 text-primary font-medium">
                                  <Check className="h-3 w-3" />
                                  {watchedInSeason}/{season.episodes.length}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Season metadata: counts, runtime, air span, score */}
                          {settings.showSeasonMetadata && (
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 ml-7 text-[11px] text-muted-foreground">
                              <span>{season.episodes.length} episode{season.episodes.length !== 1 ? 's' : ''}</span>
                              {seasonRuntime > 0 && (
                                <span className="inline-flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  <span className="tabular-nums">{fmtRuntime(seasonRuntime)}</span>
                                </span>
                              )}
                              {watchedInSeason > 0 && seasonWatchedRuntime > 0 && (
                                <span className="text-primary/80 tabular-nums">
                                  {fmtRuntime(seasonWatchedRuntime)} watched
                                </span>
                              )}
                              {airRangeLabel && (
                                <span className="inline-flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  {airRangeLabel}
                                </span>
                              )}
                              {avgScore > 0 && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="inline-flex items-center gap-1 cursor-default">
                                      <Star className="h-3 w-3 fill-warning text-warning" />
                                      <SpoilerText blur={settings.spoilerProtection.ratings}>
                                        {settings.ratingSystem === '5star'
                                          ? `${(avgScore / 2).toFixed(1)}/5`
                                          : `${avgScore.toFixed(1)}/10`}
                                      </SpoilerText>
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent side="bottom" className="space-y-1">
                                    <p className="font-medium text-xs">Average TMDb episode rating</p>
                                    <p className="text-xs opacity-70">
                                      {avgScore.toFixed(1)} / 10 across {ratedEps.length} rated episode{ratedEps.length !== 1 ? 's' : ''}
                                      {seasonVoteCount > 0 ? ` (${seasonVoteCount.toLocaleString()} votes)` : ''}
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          )}
                        </div>

                        {isExpanded && (
                          <div className="space-y-1.5">
                            {settings.showSeasonOverview && season.overview && (
                              <div className="rounded-lg border border-border/50 bg-secondary/30 p-3 mb-2.5">
                                <SpoilerText blur={blurSeasonOverview} className="text-xs text-muted-foreground leading-relaxed break-words block">
                                  {season.overview}
                                </SpoilerText>
                              </div>
                            )}
                            {season.episodes.map((ep) => {
                              const epKey = `${ep.season_number}:${ep.episode_number}`
                              const epProgress = entry?.tvProgress?.[epKey]
                              const watched = !!epProgress?.watchedAt
                              const epPlaysCount = mediaHistory.filter(h => h.episodeKey === epKey).length

                              return (
                                <EpisodeRow
                                  key={ep.id}
                                  ep={ep}
                                  epKey={epKey}
                                  libId={libId}
                                  watched={watched}
                                  playsCount={epPlaysCount}
                                  rating={epProgress?.rating ?? null}
                                  entry={entry}
                                  settings={settings}
                                  spoilerProtection={settings.spoilerProtection}
                                  lists={lists}
                                  onFirstLog={() => handleEpisodeFirstLog(ep.season_number, ep.episode_number, ep.name)}
                                  onReplayNow={() => handleEpisodeReplayNow(ep.season_number, ep.episode_number, ep.name)}
                                  onLog={() => handleEpisodeLog(ep.season_number, ep.episode_number, ep.name)}
                                  onRemoveAllPlays={() => handleEpisodeRemoveAllPlays(ep.season_number, ep.episode_number)}
                                  onViewPlays={() => handleViewPlays(ep.season_number, ep.episode_number, ep.name)}
                                  onViewAllPlays={() => navigate(`/log?mediaId=${encodeURIComponent(libId)}&episodeKey=${encodeURIComponent(epKey)}`)}
                                  onToggleList={(listId) => handleToggleEpisodeList(listId, epKey)}
                                  onCreateAndAddList={(name) => handleCreateAndAddEpisodeList(name, epKey)}
                                  onRating={async (v) => { await setEpisodeRating(target, epKey, v) }}
                                />
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          )}

          {/* Recommendations */}
          {((movie?.recommendations?.results ?? tv?.recommendations?.results) ?? []).length > 0 && (
            <section className="mt-8">
              <h2 className="font-semibold text-sm mb-3">You May Also Like</h2>
              <ScrollableRow>
                {(movie?.recommendations?.results ?? tv?.recommendations?.results ?? []).slice(0, 12).map((item) => (
                  <MediaCard
                    key={item.id}
                    item={{ ...item, media_type: mediaType === 'anime' ? 'tv' : mediaType }}
                    mediaType={mediaType}
                    backLabel={title}
                    width={144}
                  />
                ))}
              </ScrollableRow>
            </section>
          )}
        </div>
      </div>

      {/* Log watch modal */}
      {logModalOpen && (
        <LogEntryModal
          open={logModalOpen}
          onClose={() => {
            setLogModalOpen(false)
            setLogEpisodeKey(undefined)
            setLogEpisodeTitle(undefined)
            setLogFirstEpisodeWatch(false)
            setLogDefaultRewatch(false)
          }}
          mediaId={libId}
          mediaTitle={title}
          episodeKey={logEpisodeKey}
          episodeTitle={logEpisodeTitle}
          defaultRewatch={logDefaultRewatch}
          onSaved={logFirstEpisodeWatch ? handleEpisodeModalSaved : (movie ? handleMovieSaved : undefined)}
        />
      )}

      {/* Edit an existing play from the watch history */}
      {editingPlay && (
        <LogEntryModal
          open
          onClose={() => setEditingPlay(null)}
          mediaId={editingPlay.mediaId}
          mediaTitle={title}
          episodeKey={editingPlay.episodeKey}
          episodeTitle={editingPlay.episodeTitle}
          existingEntry={editingPlay}
        />
      )}

      {/* Confirm drop show */}
      <Dialog open={dropConfirm} onOpenChange={setDropConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Drop {title}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will mark the show as dropped and remove it from Up Next. Your episode progress and watch log entries will be kept.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setDropConfirm(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDrop} className="gap-1.5">
              <Ban className="h-3.5 w-3.5" />
              Drop Show
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm start rewatch */}
      <Dialog open={rewatchConfirm} onOpenChange={setRewatchConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rewatch {title}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This resets all episode progress so you can watch {title} again from the start. Your watch history ({mediaHistory.length} {mediaHistory.length === 1 ? 'play' : 'plays'}), ratings, and total watch time are kept.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setRewatchConfirm(false)}>Cancel</Button>
            <Button onClick={handleStartRewatch} className="gap-1.5">
              <Repeat2 className="h-3.5 w-3.5" />
              Start Rewatch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm log all episodes */}
      <Dialog open={markAllConfirm} onOpenChange={(v) => !markingAll && setMarkAllConfirm(v)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Log all episodes as watched?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will log all {allSeasons.reduce((n, s) => n + s.episodes.length, 0)} episode{allSeasons.reduce((n, s) => n + s.episodes.length, 0) !== 1 ? 's' : ''} across {allSeasons.length} season{allSeasons.length !== 1 ? 's' : ''} as watched right now. Previously logged episodes will get an additional play entry.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setMarkAllConfirm(false)} disabled={markingAll}>Cancel</Button>
            <Button onClick={handleMarkAllWatched} disabled={markingAll} className="gap-1.5">
              {markingAll && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {markingAll ? 'Logging' : 'Log All Episodes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Specific plays for an episode */}
      <Dialog open={specificPlaysOpen} onOpenChange={setSpecificPlaysOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Plays for {specificPlaysTitle}</DialogTitle>
            {specificEpPlays.length > 0 && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {specificEpPlays.length} {specificEpPlays.length === 1 ? 'play' : 'plays'} recorded
              </p>
            )}
          </DialogHeader>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto py-1 pr-1">
            {specificEpPlays.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No plays recorded.</p>
            ) : (
              specificEpPlays.map((h, idx) => (
                <SpecificPlayRow
                  key={h.id}
                  play={h}
                  index={idx + 1}
                  total={specificEpPlays.length}
                  ratingSystem={settings.ratingSystem}
                  timeFormat={settings.timeFormat}
                  episodeRating={specificPlaysEpKey ? effectiveRating(entry, specificPlaysEpKey) : null}
                  onRemove={async () => {
                    await removeHistory(h.id)
                    toast.success('Play removed')
                    if (specificEpPlays.length <= 1) setSpecificPlaysOpen(false)
                  }}
                />
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </ScrollArea>
  )
}

interface EpisodeRowProps {
  ep: { id: number; episode_number: number; season_number: number; name: string; overview: string; air_date: string | null; runtime: number | null; vote_average: number; vote_count?: number }
  epKey: string
  libId: string
  watched: boolean
  playsCount: number
  rating: number | null
  entry: LibraryEntry | undefined
  settings: { ratingSystem: string }
  spoilerProtection: SpoilerSettings
  lists: import('../types').CustomList[]
  onFirstLog: () => void
  onReplayNow: () => void
  onLog: () => void
  onRemoveAllPlays: () => void
  onViewPlays: () => void
  onViewAllPlays: () => void
  onToggleList: (listId: string) => void
  onCreateAndAddList: (name: string) => void
  onRating: (v: number | null) => void
}

function EpisodeRow({
  ep, epKey, libId, watched, playsCount, rating, entry, settings, spoilerProtection, lists,
  onFirstLog, onReplayNow, onLog, onRemoveAllPlays, onViewPlays, onViewAllPlays, onToggleList, onCreateAndAddList, onRating
}: EpisodeRowProps) {
  const [replayOpen, setReplayOpen] = useState(false)
  const [ratingOpen, setRatingOpen] = useState(false)
  const [listPickerOpen, setListPickerOpen] = useState(false)
  const [newEpListName, setNewEpListName] = useState('')
  const episodeItemId = `${libId}::${epKey}`
  const blurTitle = !watched && spoilerProtection.episodeTitles
  const blurDesc = !watched && spoilerProtection.episodeDescriptions

  return (
    <div data-ep-key={epKey} className={cn('group rounded-lg border transition-colors', watched ? 'border-primary/20 bg-primary/5' : 'border-border/50 bg-card')}>
      <div className="flex items-start gap-3 p-3">
        <Popover open={replayOpen} onOpenChange={setReplayOpen}>
          <PopoverAnchor asChild>
            <button
              onClick={() => watched ? setReplayOpen(true) : onFirstLog()}
              className={cn(
                'h-7 w-7 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors cursor-pointer',
                watched ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:border-primary'
              )}
              aria-label={watched ? 'Watched, click for options' : 'Log this episode'}
            >
              {watched && <Check className="h-3.5 w-3.5" />}
            </button>
          </PopoverAnchor>
          <PopoverContent align="start" sideOffset={6} className="w-60 p-1">
            <button
              className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-secondary transition-colors cursor-pointer"
              onClick={() => { onReplayNow(); setReplayOpen(false) }}
            >
              <p className="font-medium">Log again now</p>
              <p className="text-xs text-muted-foreground mt-0.5">Add another play at the current time</p>
            </button>
            <button
              className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-secondary transition-colors cursor-pointer"
              onClick={() => { onLog(); setReplayOpen(false) }}
            >
              <p className="font-medium">Log again with a different date</p>
              <p className="text-xs text-muted-foreground mt-0.5">Choose a specific date and time</p>
            </button>
            {playsCount > 0 && (
              <>
                <div className="h-px bg-border mx-2 my-1" />
                {playsCount > 1 && (
                  <button
                    className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-destructive/10 text-destructive transition-colors cursor-pointer"
                    onClick={() => { onViewPlays(); setReplayOpen(false) }}
                  >
                    <p className="font-medium">Remove a specific play</p>
                    <p className="text-xs text-destructive/70 mt-0.5">View all {playsCount} plays and remove one</p>
                  </button>
                )}
                <button
                  className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-destructive/10 text-destructive transition-colors cursor-pointer"
                  onClick={() => { onRemoveAllPlays(); setReplayOpen(false) }}
                >
                  <p className="font-medium">Remove all plays</p>
                  <p className="text-xs text-destructive/70 mt-0.5">Mark as unwatched and clear history</p>
                </button>
              </>
            )}
          </PopoverContent>
        </Popover>

        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 min-w-0">
            <span className="text-xs font-mono text-muted-foreground flex-shrink-0 mt-0.5">E{ep.episode_number}</span>
            <SpoilerText blur={blurTitle} className="text-sm font-medium break-words">
              {ep.name}
            </SpoilerText>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-0.5">
            {ep.air_date && <span className="text-xs text-muted-foreground">{fmtDate(ep.air_date, 'MMM d, yyyy')}</span>}
            {ep.runtime && <span className="text-xs text-muted-foreground">{fmtRuntime(ep.runtime)}</span>}
            {ep.vote_average > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground cursor-default">
                    <Star className="h-3 w-3 fill-muted-foreground/50 text-muted-foreground/50" />
                    <SpoilerText blur={spoilerProtection.ratings}>
                      {settings.ratingSystem === '5star'
                        ? `${(ep.vote_average / 2).toFixed(1)}`
                        : `${ep.vote_average.toFixed(1)}`}
                    </SpoilerText>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="space-y-1">
                  <p className="font-medium text-xs">TMDb community rating</p>
                  <p className="text-xs opacity-70">
                    {ep.vote_average.toFixed(1)} / 10{ep.vote_count ? ` (${ep.vote_count.toLocaleString()} votes)` : ''}
                  </p>
                </TooltipContent>
              </Tooltip>
            )}
            {watched && playsCount > 0 && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Repeat2 className="h-3 w-3" />
                {playsCount} {playsCount === 1 ? 'play' : 'plays'}
                <button
                  onClick={onViewAllPlays}
                  className="underline underline-offset-2 hover:text-foreground transition-colors cursor-pointer"
                >
                  see all
                </button>
              </span>
            )}
            {entry && (
              ratingOpen ? (
                <span className="flex items-center gap-1">
                  <RatingInput
                    value={rating}
                    onChange={(v) => { onRating(v); setRatingOpen(false) }}
                    system={settings.ratingSystem as '10star' | '5star'}
                    size="sm"
                  />
                  <button
                    onClick={() => setRatingOpen(false)}
                    className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    aria-label="Close rating"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setRatingOpen(true)}
                  className={cn(
                    'flex items-center gap-1 px-1.5 py-0.5 rounded text-xs transition-colors cursor-pointer',
                    rating != null
                      ? 'text-warning hover:bg-warning/10'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                  )}
                  aria-label="Rate this episode"
                >
                  <Star className={cn('h-3 w-3', rating != null && 'fill-warning')} />
                  {rating != null ? (
                    <SpoilerText blur={spoilerProtection.ratings}>
                      {fmtRating(rating, settings.ratingSystem as '10star' | '5star')}
                    </SpoilerText>
                  ) : 'Rate'}
                </button>
              )
            )}
          </div>
          {ep.overview && (
            <SpoilerText blur={blurDesc} className="text-xs text-muted-foreground leading-relaxed mt-1.5 break-words block">
              {ep.overview}
            </SpoilerText>
          )}
        </div>

        <Popover open={listPickerOpen} onOpenChange={setListPickerOpen}>
          <PopoverTrigger asChild>
            <button
              className={cn(
                'flex-shrink-0 h-6 w-6 rounded flex items-center justify-center transition-colors cursor-pointer mt-0.5',
                lists.some(l => l.itemIds.includes(episodeItemId))
                  ? 'text-primary bg-primary/10'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary opacity-0 group-hover:opacity-100'
              )}
              aria-label="Add to list"
              onClick={(e) => e.stopPropagation()}
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2" align="end" sideOffset={4}>
            <p className="text-xs font-medium text-muted-foreground px-1 pb-1.5 border-b border-border/50 mb-1.5">Your Lists</p>
            {lists.length === 0 && (
              <p className="text-xs text-muted-foreground px-1 py-2">No lists yet. Create one below.</p>
            )}
            <div className="space-y-0.5 mb-2">
              {lists.map((lst) => {
                const isSmart = !!lst.rules?.enabled
                const inList = lst.itemIds.includes(episodeItemId)
                return (
                  <button
                    key={lst.id}
                    onClick={(e) => { e.stopPropagation(); if (!isSmart) onToggleList(lst.id) }}
                    disabled={isSmart}
                    title={isSmart ? 'Smart list - episodes cannot be added manually' : undefined}
                    className={cn(
                      'flex items-center gap-2 w-full px-2 py-1.5 rounded-md transition-colors text-left',
                      isSmart ? 'cursor-not-allowed opacity-60' : 'hover:bg-secondary cursor-pointer'
                    )}
                  >
                    <div className={cn('h-4 w-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors', inList ? 'bg-primary border-primary' : 'border-border')}>
                      {inList && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                    </div>
                    <span className="text-sm truncate flex-1">{lst.name}</span>
                    {isSmart && <Zap className="h-2.5 w-2.5 text-primary flex-shrink-0" />}
                  </button>
                )
              })}
            </div>
            <div className="border-t border-border/50 pt-2">
              <p className="text-xs text-muted-foreground px-1 mb-1.5">Create new list</p>
              <div className="flex gap-1.5">
                <Input
                  value={newEpListName}
                  onChange={(e) => setNewEpListName(e.target.value)}
                  placeholder="List name..."
                  className="h-7 text-xs"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter' && newEpListName.trim()) {
                      onCreateAndAddList(newEpListName.trim())
                      setNewEpListName('')
                      setListPickerOpen(false)
                    }
                  }}
                />
                <Button
                  size="sm"
                  className="h-7 px-2 text-xs flex-shrink-0"
                  disabled={!newEpListName.trim()}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!newEpListName.trim()) return
                    onCreateAndAddList(newEpListName.trim())
                    setNewEpListName('')
                    setListPickerOpen(false)
                  }}
                >
                  Create
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}

function HistoryRow({ entry, title, ratingSystem, timeFormat, displayRating, onEdit, onDelete }: {
  entry: WatchHistoryEntry
  title: string
  ratingSystem: string
  timeFormat: '12h' | '24h'
  displayRating?: number | null
  onEdit: () => void
  onDelete: () => void
}) {
  const [confirmDel, setConfirmDel] = useState(false)
  return (
    <>
      <div
        className="flex items-start gap-3 p-3 rounded-lg bg-background border border-border/40 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium">{entry.episodeTitle ?? title}</p>
            {entry.isRewatch && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                <Repeat2 className="h-2.5 w-2.5" />
                Rewatch
              </span>
            )}
          </div>
          {entry.note && (
            <p className="text-xs text-muted-foreground mt-0.5 italic line-clamp-3 whitespace-pre-wrap">"{entry.note}"</p>
          )}
          {entry.tags && entry.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {entry.tags.map((tag) => (
                <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{tag}</span>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            {fmtDate(entry.watchedAtDT, 'EEE, MMM d, yyyy')} at {fmtDate(entry.watchedAtDT, timeFormat === '24h' ? 'HH:mm' : 'h:mm a')}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {displayRating != null && (
            <span className="flex items-center gap-0.5 text-xs text-warning font-medium">
              <Star className="h-3 w-3 fill-warning" />
              {fmtRating(displayRating, ratingSystem as '10star' | '5star')}
            </span>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground"
            onClick={onEdit}
            aria-label={`Edit this play of ${entry.episodeTitle ?? title}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => setConfirmDel(true)}
            aria-label="Remove play"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <Dialog open={confirmDel} onOpenChange={(open) => { if (!open) setConfirmDel(false) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove this play?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This play of <span className="font-medium text-foreground">{entry.episodeTitle ?? title}</span> will be permanently removed from your watch history.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setConfirmDel(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { onDelete(); setConfirmDel(false) }}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function SpecificPlayRow({ play, index, total, ratingSystem, timeFormat, episodeRating, onRemove }: {
  play: WatchHistoryEntry
  index: number
  total: number
  ratingSystem: string
  timeFormat: '12h' | '24h'
  episodeRating?: number | null
  onRemove: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const timeFmt = timeFormat === '24h' ? 'HH:mm' : 'h:mm a'

  return (
    <div className={cn(
      'rounded-lg border transition-colors',
      confirming ? 'border-destructive/40 bg-destructive/5' : 'border-border/50 bg-card'
    )}>
      <div className="p-3 space-y-2">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0 space-y-1.5">
            {/* Play number badge */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                Play {index} of {total}
              </span>
              {index === 1 && (
                <span className="text-[10px] font-medium text-primary">Most recent</span>
              )}
            </div>

            {/* Date + time + relative */}
            <div>
              <p className="text-sm font-medium leading-tight">
                {fmtDate(play.watchedAtDT, 'EEEE, MMMM d, yyyy')}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {fmtDate(play.watchedAtDT, timeFmt)}
                <span className="mx-1.5 opacity-40">-</span>
                {fmtRelative(play.watchedAtDT)}
              </p>
            </div>

            {/* Rating - episode-level rating shared across all plays */}
            {episodeRating != null && (
              <span className="inline-flex items-center gap-1 text-xs text-warning font-medium">
                <Star className="h-3 w-3 fill-warning" />
                {fmtRating(episodeRating, ratingSystem as '10star' | '5star')}
              </span>
            )}

            {/* Note */}
            {play.note && (
              <p className="text-xs text-muted-foreground italic leading-relaxed whitespace-pre-wrap border-l-2 border-border pl-2">
                "{play.note}"
              </p>
            )}

            {/* Tags */}
            {play.tags && play.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {play.tags.map((tag) => (
                  <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{tag}</span>
                ))}
              </div>
            )}
          </div>

          {!confirming && (
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive flex-shrink-0 mt-0.5"
              onClick={() => setConfirming(true)}
              aria-label="Remove this play"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {confirming && (
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-destructive/20">
            <p className="text-xs text-destructive font-medium">Remove this play?</p>
            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="destructive" className="h-6 text-xs px-2" onClick={onRemove}>
                Remove
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div className="h-full">
      <Skeleton className="h-72 w-full rounded-none" />
      <div className="p-6 space-y-4">
        <div className="flex gap-6">
          <Skeleton className="w-36 h-52 rounded-xl flex-shrink-0" />
          <div className="flex-1 space-y-3 pt-0">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    </div>
  )
}
