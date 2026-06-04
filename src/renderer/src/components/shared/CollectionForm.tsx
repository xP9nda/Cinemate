import { useState } from 'react'
import { X, Loader2, CalendarIcon } from 'lucide-react'
import { useStore } from '../../lib/store'
import { uid } from '../../lib/utils'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { DialogFooter } from '../ui/dialog'
import { DateTimePicker } from '../ui/date-time-picker'
import { toast } from 'sonner'
import type { CollectionEntry, CollectionFormat, MediaType } from '../../types'

export const FORMAT_LABELS: Record<CollectionFormat, string> = {
  'blu-ray': 'Blu-ray',
  '4k': '4K UHD',
  'dvd': 'DVD',
  'vhs': 'VHS',
  'digital': 'Digital',
  'other': 'Other'
}

export const FORMAT_COLORS: Record<CollectionFormat, string> = {
  '4k': 'text-info bg-info/10',
  'blu-ray': 'text-primary bg-primary/10',
  'dvd': 'text-teal bg-teal/10',
  'digital': 'text-success bg-success/10',
  'vhs': 'text-warning bg-warning/10',
  'other': 'text-muted-foreground bg-muted'
}

interface CollectionFormProps {
  existing?: CollectionEntry
  initial?: {
    mediaId?: string | null
    title?: string
    posterPath?: string | null
    mediaType?: MediaType
  }
  onClose: () => void
  onSaved: () => void
}

export function CollectionForm({ existing, initial, onClose, onSaved }: CollectionFormProps) {
  const setCollectionEntry = useStore(s => s.setCollectionEntry)
  const [title, setTitle] = useState(existing?.title ?? initial?.title ?? '')
  const [format, setFormat] = useState<CollectionFormat>(existing?.format ?? 'blu-ray')
  const [mediaType, setMediaType] = useState<MediaType>(existing?.mediaType ?? initial?.mediaType ?? 'movie')
  const [purchasedDate, setPurchasedDate] = useState<Date | null>(
    existing?.purchasedDate ? new Date(existing.purchasedDate) : null
  )
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [saving, setSaving] = useState(false)

  const isLinked = !!(existing?.mediaId ?? initial?.mediaId)

  const handleSave = async () => {
    if (!title.trim()) { toast.error('Title is required'); return }
    setSaving(true)
    try {
      const entry: CollectionEntry = {
        id: existing?.id ?? `col:${uid()}`,
        mediaId: existing?.mediaId ?? initial?.mediaId ?? null,
        title: title.trim(),
        posterPath: existing?.posterPath ?? initial?.posterPath ?? null,
        mediaType,
        format,
        purchasedDate: purchasedDate ? purchasedDate.toISOString().split('T')[0] : null,
        addedDate: existing?.addedDate ?? Date.now(),
        notes
      }
      await setCollectionEntry(entry)
      toast.success(existing ? 'Updated' : 'Added to collection')
      onSaved()
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="col-title">Title</Label>
        <Input id="col-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Movie or show title" readOnly={isLinked} className={isLinked ? 'cursor-default opacity-60' : ''} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Format</Label>
          <Select value={format} onValueChange={(v) => setFormat(v as CollectionFormat)}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(FORMAT_LABELS) as CollectionFormat[]).map((f) => (
                <SelectItem key={f} value={f}>{FORMAT_LABELS[f]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Type</Label>
          <Select value={mediaType} onValueChange={(v) => setMediaType(v as MediaType)}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="movie">Movie</SelectItem>
              <SelectItem value="tv">TV Show</SelectItem>
              <SelectItem value="anime">Anime</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Date Purchased <span className="text-muted-foreground font-normal">(optional)</span></Label>
        {purchasedDate !== null ? (
          <div className="flex gap-2 items-center">
            <DateTimePicker value={purchasedDate} onChange={setPurchasedDate} allowFuture className="flex-1 h-9 text-sm" />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="h-9 w-9 flex-shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => setPurchasedDate(null)}
              aria-label="Clear date"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="w-full justify-start text-muted-foreground font-normal gap-2 h-9"
            onClick={() => setPurchasedDate(new Date())}
          >
            <CalendarIcon className="h-4 w-4 opacity-60" />
            Pick a date
          </Button>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="col-notes">Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
        <Textarea id="col-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Edition, condition, etc." rows={2} />
      </div>

      <DialogFooter className="gap-2 pt-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving} className="gap-1.5">
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {saving ? 'Saving' : existing ? 'Save' : 'Add'}
        </Button>
      </DialogFooter>
    </div>
  )
}
