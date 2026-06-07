import { useState, useRef, useEffect, useMemo, KeyboardEvent } from 'react'
import { toast } from 'sonner'
import { X, Loader2, Plus, Repeat2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'
import { DateTimePicker } from '../ui/date-time-picker'
import { RatingInput } from './RatingInput'
import { useStore } from '../../lib/store'
import { uid, nowLocalDT, effectiveRating } from '../../lib/utils'
import type { WatchHistoryEntry, MediaType } from '../../types'

interface LogEntryModalProps {
  open: boolean
  onClose: () => void
  mediaId: string
  mediaTitle: string
  episodeKey?: string
  episodeTitle?: string
  existingEntry?: WatchHistoryEntry
  defaultRewatch?: boolean
  onSaved?: (entry: WatchHistoryEntry) => void | Promise<void>
}

function dtStringToDate(dt: string): Date {
  return new Date(dt)
}

function dateToDtString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function LogEntryModal({
  open, onClose, mediaId, mediaTitle, episodeKey, episodeTitle, existingEntry, defaultRewatch, onSaved
}: LogEntryModalProps) {
  const settings = useStore(s => s.settings)
  const addHistory = useStore(s => s.addHistory)
  const setLogRating = useStore(s => s.setLogRating)
  const watchHistory = useStore(s => s.watchHistory)
  const libEntry = useStore(s => s.library[mediaId])
  // The field holds the single rating for whatever's being logged: an episode's
  // rating lives in tvProgress[episodeKey]; a movie / show-level log's rating IS
  // the title's overall rating (LibraryEntry.userRating). There is no per-play
  // rating - the field reflects that one canonical rating, and editing it updates
  // that same one rating, never the individual play.
  const [rating, setRating] = useState<number | null>(effectiveRating(libEntry, episodeKey))
  const [note, setNote] = useState(existingEntry?.note ?? '')
  const [watchedDate, setWatchedDate] = useState<Date>(
    dtStringToDate(existingEntry?.watchedAtDT ?? nowLocalDT())
  )
  const [tags, setTags] = useState<string[]>(existingEntry?.tags ?? [])
  const [addingTag, setAddingTag] = useState(false)
  const [newTagInput, setNewTagInput] = useState('')
  const [isRewatch, setIsRewatch] = useState(existingEntry?.isRewatch ?? defaultRewatch ?? false)
  const [saving, setSaving] = useState(false)
  const newTagRef = useRef<HTMLInputElement>(null)

  const allKnownTags = useMemo(() => {
    const freq: Record<string, number> = {}
    for (const h of watchHistory) {
      for (const t of (h.tags ?? [])) {
        freq[t] = (freq[t] ?? 0) + 1
      }
    }
    const fromHistory = Object.keys(freq).sort((a, b) => freq[b] - freq[a])
    const customTags = settings.customTags ?? []
    return Array.from(new Set([...customTags, ...fromHistory]))
  }, [watchHistory, settings.customTags])

  const suggestions = useMemo(() => {
    const base = allKnownTags.filter((t) => !tags.includes(t))
    if (!newTagInput.trim()) return base
    const q = newTagInput.trim().toLowerCase()
    return base.filter((t) => t.includes(q))
  }, [allKnownTags, tags, newTagInput])

  useEffect(() => {
    if (addingTag) setTimeout(() => newTagRef.current?.focus(), 50)
  }, [addingTag])

  const commitTag = (raw: string) => {
    const tag = raw.trim().toLowerCase().replace(/[,;]/g, '')
    if (tag && !tags.includes(tag)) setTags((prev) => [...prev, tag])
    setNewTagInput('')
    setAddingTag(false)
  }

  const removeTag = (tag: string) => setTags((prev) => prev.filter((t) => t !== tag))

  const handleNewTagKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commitTag(newTagInput)
    } else if (e.key === 'Escape') {
      setNewTagInput('')
      setAddingTag(false)
    }
  }

  const handleSave = async () => {
    if (newTagInput.trim()) commitTag(newTagInput)
    setSaving(true)
    try {
      const watchedAtDT = dateToDtString(watchedDate)
      const entry: WatchHistoryEntry = {
        id: existingEntry?.id ?? `hist:${uid()}`,
        mediaId,
        watchedAt: watchedDate.getTime(),
        watchedAtDT,
        note,
        tags: tags.length > 0 ? tags : undefined,
        episodeKey,
        episodeTitle,
        isRewatch: isRewatch || undefined
      }
      await addHistory(entry)
      // Let the caller reconcile status / tvProgress first - logEpisode / a movie's
      // reconcile create the library entry on a first-time watch - so the rating
      // write below always lands on an existing entry. The rating is never stored on
      // the play: setLogRating routes it to the one canonical home (an episode's
      // tvProgress[episodeKey], or the title's overall userRating).
      await onSaved?.(entry)
      const [mt, tid] = mediaId.split(':')
      await setLogRating({ mediaType: mt as MediaType, tmdbId: Number(tid) }, episodeKey, rating)
      if (existingEntry) {
        toast.success('Log entry updated')
      } else if (episodeKey && episodeTitle) {
        toast.success(`Logged "${episodeTitle}" - ${mediaTitle}`)
      } else {
        toast.success(`Logged ${mediaTitle}`)
      }
      onClose()
    } catch {
      toast.error('Failed to save log entry')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{existingEntry ? 'Edit Log Entry' : 'Log Watch'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{mediaTitle}</p>
              {episodeTitle && <p className="text-xs text-muted-foreground mt-0.5">{episodeTitle}</p>}
            </div>
            <button
              type="button"
              onClick={() => setIsRewatch((v) => !v)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-colors flex-shrink-0 cursor-pointer ${
                isRewatch
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border/50 bg-transparent text-muted-foreground hover:text-foreground hover:border-border'
              }`}
              aria-pressed={isRewatch}
            >
              <Repeat2 className="h-3 w-3" />
              Rewatch
            </button>
          </div>

          <div className="space-y-1.5">
            <Label>Date & Time Watched</Label>
            <DateTimePicker value={watchedDate} onChange={setWatchedDate} allowFuture={settings.allowFutureDates} />
          </div>

          {/* One rating for whatever's being logged: the episode's own rating, or the
              movie / show overall rating. Editing it updates that single rating. */}
          <div className="space-y-1.5">
            <Label>{episodeKey ? 'Episode Rating' : 'Rating'} <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <RatingInput
              value={rating}
              onChange={setRating}
              system={settings.ratingSystem}
              size="md"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="note">Note <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Textarea
              id="note"
              placeholder="What did you think?"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Tags <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <span key={tag} className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/20 text-primary border border-primary/30 text-xs font-medium">
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    className="text-primary/60 hover:text-primary transition-colors ml-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {suggestions.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => { const t = tag.trim().toLowerCase(); if (!tags.includes(t)) setTags((p) => [...p, t]) }}
                  className="px-2.5 py-1 rounded-full bg-secondary text-muted-foreground hover:bg-primary/10 hover:text-primary text-xs transition-colors"
                >
                  {tag}
                </button>
              ))}
              {addingTag ? (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-dashed border-primary/40 bg-primary/5">
                  <input
                    ref={newTagRef}
                    value={newTagInput}
                    onChange={(e) => setNewTagInput(e.target.value)}
                    onKeyDown={handleNewTagKeyDown}
                    onBlur={() => { if (newTagInput.trim()) commitTag(newTagInput); else setAddingTag(false) }}
                    placeholder="tag name..."
                    className="w-20 text-xs bg-transparent outline-none text-foreground placeholder:text-muted-foreground/50"
                  />
                  <button type="button" onClick={() => { setNewTagInput(''); setAddingTag(false) }} className="text-muted-foreground hover:text-foreground transition-colors">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setAddingTag(true)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-primary text-xs transition-colors"
                >
                  <Plus className="h-3 w-3" /> New Tag
                </button>
              )}
            </div>
            {allKnownTags.length === 0 && !addingTag && (
              <p className="text-[11px] text-muted-foreground">No tags yet - click "New Tag" to create one</p>
            )}
            {addingTag && newTagInput.trim() && suggestions.length > 0 && (
              <p className="text-[11px] text-muted-foreground">Matching previous tags shown above - press Enter to create new</p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="gap-1.5">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {saving ? 'Saving...' : existingEntry ? 'Save Changes' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
