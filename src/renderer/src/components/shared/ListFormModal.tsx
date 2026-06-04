import { useState, useEffect, type FormEvent } from 'react'
import { useStore } from '../../lib/store'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Label } from '../ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { RuleEditor } from './RuleEditor'
import { emptyRules } from '../../lib/rulesEngine'
import type { ListRules } from '../../types'

interface ListFormModalProps {
  open: boolean
  onClose: () => void
  onSave: (name: string, description: string, rules: ListRules) => void
  title: string
  initialName?: string
  initialDescription?: string
  initialRules?: ListRules
}

export function ListFormModal({
  open,
  onClose,
  onSave,
  title,
  initialName = '',
  initialDescription = '',
  initialRules,
}: ListFormModalProps) {
  const ratingSystem = useStore((s) => s.settings.ratingSystem)
  const ratingMax = ratingSystem === '5star' ? 5 : 10
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const [rules, setRules] = useState<ListRules>(initialRules ?? emptyRules())

  useEffect(() => {
    if (open) {
      setName(initialName)
      setDescription(initialDescription)
      setRules(initialRules ?? emptyRules())
    }
  }, [open, initialName, initialDescription, initialRules])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    onSave(name.trim(), description.trim(), rules)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="list-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="list-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Favourites"
              required
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="list-desc">
                Description <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <span className="text-[10px] text-muted-foreground/60">Markdown supported</span>
            </div>
            <Textarea
              id="list-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A brief description of this list..."
              rows={3}
            />
          </div>
          <RuleEditor value={rules} onChange={setRules} ratingMax={ratingMax} />
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!name.trim()}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
