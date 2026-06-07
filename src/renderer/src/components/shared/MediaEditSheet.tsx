import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '../ui/dialog'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'
import { RatingInput } from './RatingInput'
import { DateTimePicker } from '../ui/date-time-picker'
import { useStore } from '../../lib/store'
import type { LibraryEntry } from '../../types'

function toLocalDTString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface MediaEditSheetProps {
  open: boolean
  onClose: () => void
  entry: LibraryEntry
}

export function MediaEditSheet({ open, onClose, entry }: MediaEditSheetProps) {
  const settings = useStore(s => s.settings)
  const setLibraryEntry = useStore(s => s.setLibraryEntry)
  const [rating, setRating] = useState<number | null>(entry.userRating)
  const [review, setReview] = useState(entry.review)
  const [watchedDate, setWatchedDate] = useState<Date | null>(entry.watchedDate ? new Date(entry.watchedDate) : null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setRating(entry.userRating)
    setReview(entry.review)
    setWatchedDate(entry.watchedDate ? new Date(entry.watchedDate) : null)
  }, [entry])

  // Status and media type are intentionally not editable here: those transitions
  // run through MediaActions on the detail page so tvProgress, watch history and
  // watchlist restore stay consistent. This sheet only edits plain metadata.
  const handleSave = async () => {
    setSaving(true)
    try {
      // Stamp userRatingAt only when the rating actually changes, so editing the
      // note/date doesn't move the rating's date on the Stats chart; preserve the
      // existing stamp otherwise. Matches the rating actions' write-time stamping.
      const ratingChanged = (entry.userRating ?? null) !== (rating ?? null)
      await setLibraryEntry({
        ...entry,
        userRating: rating,
        userRatingAt: ratingChanged
          ? (rating != null ? Date.now() : null)
          : (entry.userRatingAt ?? null),
        review,
        watchedDate: entry.status === 'watched'
          ? toLocalDTString(watchedDate ?? new Date())
          : entry.watchedDate
      })
      toast.success('Updated')
      onClose()
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="line-clamp-1">{entry.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {entry.status === 'watched' && (
            <div className="space-y-1.5">
              <Label>Date Watched</Label>
              <DateTimePicker value={watchedDate ?? new Date()} onChange={setWatchedDate} allowFuture={settings.allowFutureDates} />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Your Rating</Label>
            <RatingInput value={rating} onChange={setRating} system={settings.ratingSystem} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="review">Note <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Textarea
              id="review"
              placeholder="Add a personal note..."
              value={review}
              onChange={(e) => setReview(e.target.value)}
              rows={4}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="gap-1.5">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {saving ? 'Saving' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
