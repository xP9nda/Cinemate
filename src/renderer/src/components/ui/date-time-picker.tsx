import { useState } from 'react'
import { format } from 'date-fns'
import { CalendarIcon, Clock } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { Calendar } from './calendar'
import { Button } from './button'
import { cn } from '../../lib/utils'

interface DateTimePickerProps {
  value: Date
  onChange: (date: Date) => void
  allowFuture?: boolean
  className?: string
}

export function DateTimePicker({ value, onChange, allowFuture = false, className }: DateTimePickerProps) {
  const [open, setOpen] = useState(false)

  const setDate = (day: Date | undefined) => {
    if (!day) return
    const next = new Date(day)
    next.setHours(value.getHours(), value.getMinutes(), 0, 0)
    onChange(next)
  }

  const setHour = (h: number) => {
    const next = new Date(value)
    next.setHours(h)
    onChange(next)
  }

  const setMinute = (m: number) => {
    const next = new Date(value)
    next.setMinutes(m)
    onChange(next)
  }

  const clampHour = (n: number) => Math.max(0, Math.min(23, n))
  const clampMinute = (n: number) => Math.max(0, Math.min(59, n))

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            'w-full justify-start text-left font-normal',
            !value && 'text-muted-foreground',
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4 opacity-60" />
          {value ? format(value, 'MMM d, yyyy') + ' at ' + format(value, 'h:mm a') : 'Pick a date and time'}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-auto">
        <Calendar
          mode="single"
          selected={value}
          onSelect={setDate}
          disabled={allowFuture ? undefined : { after: new Date() }}
          initialFocus
        />

        {/* Time row */}
        <div className="border-t border-border px-3 py-3 flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <div className="flex items-center gap-1.5 flex-1">
            <input
              type="number"
              min={0}
              max={23}
              value={value.getHours()}
              onChange={(e) => setHour(clampHour(Number(e.target.value)))}
              className="w-14 rounded-md border border-input bg-background px-2 py-1 text-sm text-center focus:outline-none focus:ring-1 focus:ring-ring"
              aria-label="Hour"
            />
            <span className="text-muted-foreground text-sm font-medium">:</span>
            <input
              type="number"
              min={0}
              max={59}
              value={value.getMinutes()}
              onChange={(e) => setMinute(clampMinute(Number(e.target.value)))}
              className="w-14 rounded-md border border-input bg-background px-2 py-1 text-sm text-center focus:outline-none focus:ring-1 focus:ring-ring"
              aria-label="Minute"
            />
          </div>
          <Button size="sm" variant="ghost" className="text-xs h-7 px-2" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
