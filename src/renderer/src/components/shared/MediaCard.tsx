import { useState, useRef, memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, Bookmark, Star, Edit2, Trash2, MoreHorizontal, Archive, Loader2, Play, X, RotateCcw, Undo2 } from 'lucide-react'
import { cn, posterUrl, releaseYear, fmtRating, fmtDate } from '../../lib/utils'
import { useStore } from '../../lib/store'
import type { MediaTarget } from '../../lib/mediaActions'
import { Skeleton } from '../ui/skeleton'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator
} from '../ui/dropdown-menu'
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip'
import { LogEntryModal } from './LogEntryModal'
import { CollectionForm } from './CollectionForm'
import { toast } from 'sonner'
import type { TMDbSearchResult, MediaType, LibraryEntry, WatchHistoryEntry } from '../../types'

interface MediaCardProps {
  // Provide one of these two
  item?: TMDbSearchResult
  entry?: LibraryEntry
  // Optional overrides / context
  mediaType?: MediaType
  backLabel?: string
  // Library-only actions - pass the entry so callers can use stable callbacks
  onEdit?: (entry: LibraryEntry) => void
  onDelete?: (entry: LibraryEntry) => void
  onUndoRewatch?: (entry: LibraryEntry) => void
  onUndrop?: (entry: LibraryEntry) => void
  width?: number   // omit for fluid/grid usage; set explicitly for scroll rows
  showDates?: boolean
  className?: string
}

function detectType(item: TMDbSearchResult, override?: MediaType): MediaType {
  if (override) return override
  if (item.media_type === 'movie') return 'movie'
  if (item.media_type === 'tv') {
    const isAnime = (item.genre_ids?.includes(16) ?? false) && (item.origin_country?.includes('JP') ?? false)
    return isAnime ? 'anime' : 'tv'
  }
  return 'movie'
}

export const MediaCard = memo(function MediaCard({
  item, entry: entryProp, mediaType: mediaTypeProp,
  backLabel, onEdit, onDelete, onUndoRewatch, onUndrop, width, showDates, className
}: MediaCardProps) {
  const navigate = useNavigate()

  // Derive stable IDs from props before any hooks so selectors can reference them
  const mediaType = entryProp ? entryProp.mediaType : detectType(item!, mediaTypeProp)
  const id = entryProp ? entryProp.tmdbId : item!.id
  const libId = entryProp ? entryProp.id : `${mediaType}:${id}`
  const title = entryProp ? entryProp.title : (item?.title || item?.name || 'Untitled')
  const year = entryProp
    ? (entryProp.releaseYear ? String(entryProp.releaseYear) : undefined)
    : releaseYear(item?.release_date || item?.first_air_date)
  const imgSrc = entryProp
    ? posterUrl(entryProp.posterPath, 'w300')
    : posterUrl(item?.poster_path, 'w300')
  const backdropPath = entryProp ? entryProp.backdropPath : item?.backdrop_path
  const posterPath = entryProp ? entryProp.posterPath : (item?.poster_path ?? null)

  // Targeted selectors - each card only re-renders when its own slice of state changes
  const entry = useStore(s => s.library[libId])
  const ratingSystem = useStore(s => s.settings.ratingSystem)
  const inCollection = useStore(s => s.collectionMediaIds.has(libId))
  const reconcileMovieLog = useStore(s => s.reconcileMovieLog)
  const logAllEpisodes = useStore(s => s.logAllEpisodes)
  const toggleWatchlist = useStore(s => s.toggleWatchlist)

  // Full media reference carrying whatever metadata this card has (genre_ids from a
  // search result, runtime from a library entry) so quick actions never create a
  // metadata-poor entry. Every action below funnels through a store action with it.
  const target: MediaTarget = {
    mediaType,
    tmdbId: id,
    title,
    posterPath,
    backdropPath: backdropPath ?? null,
    releaseYear: year ? Number(year) : (entryProp?.releaseYear ?? null),
    genreIds: entryProp?.genreIds ?? item?.genre_ids,
    runtime: entryProp?.runtime ?? null,
  }

  const [imgLoaded, setImgLoaded] = useState(false)
  const [imgError, setImgError] = useState(false)
  const [collectionFormOpen, setCollectionFormOpen] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [tvConfirmOpen, setTvConfirmOpen] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)
  // Only mount the DropdownMenu Root the first time the card is hovered. The Root
  // installs popper + portal context even when closed, which is wasted on cards
  // the user never interacts with.
  const [menuMounted, setMenuMounted] = useState(false)
  const justClosedModal = useRef(false)

  const hasLibraryActions = !!(onEdit || onDelete || onUndoRewatch || onUndrop)

  const flagModalClose = () => {
    justClosedModal.current = true
    setTimeout(() => { justClosedModal.current = false }, 100)
  }

  const handleAddToCollection = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (inCollection) { navigate('/collection'); return }
    setCollectionFormOpen(true)
  }

  const handleWatch = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (mediaType === 'movie') {
      setLogOpen(true)
    } else {
      setTvConfirmOpen(true)
    }
  }

  const handleLogSaved = async (histEntry: WatchHistoryEntry) => {
    await reconcileMovieLog(target, histEntry)
  }

  const handleTvConfirm = async () => {
    setMarkingAll(true)
    try {
      await logAllEpisodes(target)
      toast.success(`All episodes of ${title} marked as watched`)
    } catch {
      toast.error('Failed to log episodes')
    } finally {
      setMarkingAll(false)
      setTvConfirmOpen(false)
      flagModalClose()
    }
  }

  const handleWatchlist = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await toggleWatchlist(target)
  }

  const handleClick = () => {
    if (justClosedModal.current) return
    navigate(`/detail/${mediaType}/${id}`, { state: { backLabel } })
  }

  return (
    <div
      className={cn(
        'group relative rounded-lg cursor-pointer focus-within:ring-2 focus-within:ring-ring',
        width != null && 'flex-shrink-0',
        className
      )}
      style={width != null ? { width } : undefined}
      onClick={handleClick}
      onPointerEnter={hasLibraryActions && !menuMounted ? () => setMenuMounted(true) : undefined}
      onFocus={hasLibraryActions && !menuMounted ? () => setMenuMounted(true) : undefined}
      role="article"
      aria-label={`${title}${year ? ` (${year})` : ''}`}
    >
      <div className="relative w-full aspect-[2/3] rounded-lg overflow-hidden bg-secondary ring-1 ring-border/40 group-hover:ring-primary/50 transition-all duration-200">
        {!imgLoaded && !imgError && <Skeleton className="absolute inset-0 w-full h-full" />}
        {imgSrc && !imgError ? (
          <img
            src={imgSrc}
            alt={`${title} poster`}
            className={cn(
              'absolute inset-0 w-full h-full object-cover transition-all duration-300 group-hover:scale-[1.03]',
              imgLoaded ? 'opacity-100' : 'opacity-0'
            )}
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-secondary text-muted-foreground text-xs p-2 text-center">
            {title}
          </div>
        )}

        {/* Status badge - top left */}
        {entry && (
          <div className="absolute top-1.5 left-1.5 z-10">
            <StatusBadge status={entry.status} />
          </div>
        )}

        {/* Library actions menu - top right (only in library mode). Mounted lazily on first hover. */}
        {hasLibraryActions && menuMounted && (
          <div className="absolute top-1.5 right-1.5 z-20 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="h-6 w-6 bg-black/50 hover:bg-black/70 text-white rounded-md"
                >
                  <MoreHorizontal className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onEdit && entry && (
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(entry) }}>
                    <Edit2 className="h-3.5 w-3.5 mr-2" /> Edit
                  </DropdownMenuItem>
                )}
                {onUndoRewatch && entry && (
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onUndoRewatch(entry) }}>
                    <RotateCcw className="h-3.5 w-3.5 mr-2" /> Undo rewatch
                  </DropdownMenuItem>
                )}
                {onUndrop && entry && (
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onUndrop(entry) }}>
                    <Undo2 className="h-3.5 w-3.5 mr-2" /> Undo drop
                  </DropdownMenuItem>
                )}
                {(onEdit || onUndoRewatch || onUndrop) && onDelete && <DropdownMenuSeparator />}
                {onDelete && entry && (
                  <DropdownMenuItem
                    onClick={(e) => { e.stopPropagation(); onDelete(entry) }}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-2" /> Remove
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {/* Bottom gradient - always shows title/meta; hover reveals quick actions above. */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/80 to-transparent pt-12 pb-2.5 px-2.5">
          {/* Quick actions - reserved space so title position never shifts. */}
          <div className="flex items-center gap-1 mb-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-200 pointer-events-none group-hover:pointer-events-auto focus-within:pointer-events-auto">
            <HoverTooltip label="Mark as watched">
              <Button
                size="icon-sm"
                variant="ghost"
                className={cn(
                  'h-7 w-7 rounded-full backdrop-blur-sm border transition-colors',
                  entry?.status === 'watched'
                    ? 'bg-primary/80 border-primary hover:bg-primary'
                    : 'bg-black/40 border-white/20 hover:bg-primary hover:border-primary'
                )}
                onClick={handleWatch}
                aria-label="Mark as watched"
              >
                <Eye className="h-3.5 w-3.5 text-white" />
              </Button>
            </HoverTooltip>
            <HoverTooltip label={entry?.status === 'watchlist' ? 'Remove from watchlist' : 'Add to watchlist'}>
              <Button
                size="icon-sm"
                variant="ghost"
                className={cn(
                  'h-7 w-7 rounded-full backdrop-blur-sm border transition-colors',
                  entry?.status === 'watchlist'
                    ? 'bg-teal/70 border-teal hover:bg-teal'
                    : 'bg-black/40 border-white/20 hover:bg-teal hover:border-teal'
                )}
                onClick={handleWatchlist}
                aria-label={entry?.status === 'watchlist' ? 'Remove from watchlist' : 'Add to watchlist'}
              >
                <Bookmark className={cn('h-3.5 w-3.5 text-white', entry?.status === 'watchlist' && 'fill-white')} />
              </Button>
            </HoverTooltip>
            <HoverTooltip label={inCollection ? 'In collection (click to view)' : 'Add to collection'}>
              <Button
                size="icon-sm"
                variant="ghost"
                className={cn(
                  'h-7 w-7 rounded-full backdrop-blur-sm border transition-colors',
                  inCollection
                    ? 'bg-warning/60 border-warning hover:bg-warning/80'
                    : 'bg-black/40 border-white/20 hover:bg-warning/60 hover:border-warning'
                )}
                onClick={handleAddToCollection}
                aria-label={inCollection ? 'In collection' : 'Add to collection'}
              >
                <Archive className="h-3.5 w-3.5 text-white" />
              </Button>
            </HoverTooltip>
          </div>

          {/* Always-visible info */}
          {entry?.userRating != null && (
            <span className="flex items-center gap-0.5 text-[10px] text-warning font-medium ml-auto">
              <Star className="h-2.5 w-2.5 fill-warning" />
              {fmtRating(entry.userRating, ratingSystem)}
            </span>
          )}
          <p className="text-[11px] font-semibold text-white line-clamp-2 leading-tight">{title}</p>
          <div className="flex items-center justify-between mt-0.5">
            {year && <p className="text-[10px] text-white/70 leading-tight">{year}</p>}
          </div>
          {showDates && entry && (
            <div className="mt-1 space-y-0.5">
              {entry.watchedDate && (
                <p className="text-[10px] text-white/60 leading-tight">
                  Watched {fmtDate(entry.watchedDate, 'MMM d, yyyy')}
                </p>
              )}
              <p className="text-[10px] text-white/60 leading-tight">
                Added {fmtDate(entry.addedDate, 'MMM d, yyyy')}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Log watch modal (movies) */}
      {logOpen && (
        <LogEntryModal
          open={logOpen}
          onClose={() => { setLogOpen(false); flagModalClose() }}
          mediaId={libId}
          mediaTitle={title}
          onSaved={handleLogSaved}
        />
      )}

      {/* Log all episodes confirm (TV/anime) - lazy-mounted */}
      {tvConfirmOpen && (
        <Dialog open={tvConfirmOpen} onOpenChange={(v) => { if (!v && !markingAll) { setTvConfirmOpen(false); flagModalClose() } }}>
          <DialogContent className="max-w-sm" onClick={(e) => e.stopPropagation()}>
            <DialogHeader>
              <DialogTitle>Log all episodes as watched?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              This will log all episodes of <span className="font-medium text-foreground">{title}</span> as watched right now. Previously logged episodes will get an additional play entry.
            </p>
            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={() => { setTvConfirmOpen(false); flagModalClose() }} disabled={markingAll}>Cancel</Button>
              <Button onClick={handleTvConfirm} disabled={markingAll} className="gap-1.5">
                {markingAll && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {markingAll ? 'Logging...' : 'Log All Episodes'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Add to collection dialog - lazy-mounted */}
      {collectionFormOpen && (
        <Dialog open={collectionFormOpen} onOpenChange={(v) => { if (!v) { setCollectionFormOpen(false); flagModalClose() } }}>
          <DialogContent className="max-w-md" aria-describedby={undefined} onClick={(e) => e.stopPropagation()} onOpenAutoFocus={(e) => e.preventDefault()}>
            <DialogHeader>
              <DialogTitle>Add to Collection</DialogTitle>
            </DialogHeader>
            <CollectionForm
              initial={{ mediaId: libId, title, posterPath, mediaType }}
              onClose={() => { setCollectionFormOpen(false); flagModalClose() }}
              onSaved={() => { setCollectionFormOpen(false); flagModalClose() }}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
})

const STATUS_BADGES: Record<string, { label: string; Icon: React.ComponentType<{ className?: string }> }> = {
  watched: { label: 'Watched', Icon: Eye },
  watchlist: { label: 'Watchlist', Icon: Bookmark },
  in_progress: { label: 'In progress', Icon: Play },
  dropped: { label: 'Dropped', Icon: X }
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_BADGES[status]
  if (!cfg) return null
  const { label, Icon } = cfg
  return (
    <div role="status" className="inline-flex items-center gap-1 rounded-full bg-black/65 px-1.5 py-0.5">
      <Icon className="h-2.5 w-2.5 text-white/80" />
      <span className="text-[10px] font-mono text-white font-medium">{label}</span>
    </div>
  )
}

// Controlled `open` so Radix's own pointer listeners on the Trigger are the single
// source of truth. A previous lazy-mount approach (wrapper span + `defaultOpen`)
// could leave the portal content visible: when the card lost `group:hover`, the
// action row's CSS transitioned to `opacity-0 pointer-events-none` mid-hover, and
// the wrapper's `onPointerLeave` didn't reliably fire - so re-entering the card
// without crossing a button would still surface the stale tooltip.
function HoverTooltip({ label, children }: { label: string; children: React.ReactElement }) {
  const [open, setOpen] = useState(false)
  return (
    <Tooltip open={open} onOpenChange={setOpen} delayDuration={0}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function MediaCardSkeleton({ width = 160 }: { width?: number }) {
  return (
    <div className="flex-shrink-0 rounded-lg overflow-hidden bg-secondary ring-1 ring-border/40" style={{ width }}>
      <div className="relative w-full aspect-[2/3]">
        <Skeleton className="absolute inset-0 w-full h-full" />
      </div>
    </div>
  )
}
