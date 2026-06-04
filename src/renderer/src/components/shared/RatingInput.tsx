import { useState } from 'react'
import { Star, X } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { RatingSystem } from '../../types'

interface RatingInputProps {
  value: number | null
  onChange: (v: number | null) => void
  system?: RatingSystem
  size?: 'sm' | 'md' | 'lg'
  className?: string
  readOnly?: boolean
}

export function RatingInput({ value, onChange, system = '10star', size = 'md', className, readOnly }: RatingInputProps) {
  const [hover, setHover] = useState<number | null>(null)

  const max = system === '5star' ? 5 : 10
  const halfStars = system === '5star'
  const starSizeClass = size === 'sm' ? 'h-3.5 w-3.5' : size === 'lg' ? 'h-6 w-6' : 'h-5 w-5'
  const starSizePx = size === 'sm' ? 14 : size === 'lg' ? 24 : 20

  const displayValue = hover ?? value ?? 0

  const getStarFill = (star: number): 'full' | 'half' | 'empty' => {
    if (halfStars) {
      if (star <= Math.floor(displayValue)) return 'full'
      if (star === Math.ceil(displayValue) && displayValue % 1 === 0.5) return 'half'
      return 'empty'
    }
    return star <= Math.round(displayValue) ? 'full' : 'empty'
  }

  const displayLabel = hover !== null
    ? `${hover}/${max}`
    : value !== null
      ? `${value}/${max}`
      : null

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>, star: number) => {
    if (readOnly) return
    if (halfStars) {
      const rect = e.currentTarget.getBoundingClientRect()
      const v = (e.clientX - rect.left) < rect.width / 2 ? star - 0.5 : star
      onChange(value === v ? null : v)
    } else {
      onChange(value === star ? null : star)
    }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>, star: number) => {
    if (readOnly) return
    if (halfStars) {
      const rect = e.currentTarget.getBoundingClientRect()
      setHover((e.clientX - rect.left) < rect.width / 2 ? star - 0.5 : star)
    } else {
      setHover(star)
    }
  }

  return (
    <div
      className={cn('flex items-center gap-0.5', className)}
      role="group"
      aria-label={`Rating: ${value ?? 'Not rated'} out of ${max}`}
      onMouseLeave={() => !readOnly && setHover(null)}
    >
      {Array.from({ length: max }, (_, i) => i + 1).map((star) => {
        const fill = getStarFill(star)
        return (
          <button
            key={star}
            type="button"
            className={cn(
              'relative flex-shrink-0 transition-transform duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm',
              readOnly ? 'cursor-default' : 'cursor-pointer hover:scale-110 active:scale-95'
            )}
            style={{ width: starSizePx, height: starSizePx }}
            disabled={readOnly}
            aria-label={`Rate ${halfStars ? star - 0.5 : star} to ${star} out of ${max}`}
            onClick={(e) => handleClick(e, star)}
            onMouseMove={(e) => handleMouseMove(e, star)}
            onMouseEnter={() => { if (!readOnly && !halfStars) setHover(star) }}
          >
            {fill === 'half' ? (
              <>
                <Star
                  className={cn(starSizeClass, 'absolute inset-0 fill-transparent text-muted-foreground/40')}
                />
                <Star
                  className={cn(starSizeClass, 'absolute inset-0 fill-warning text-warning')}
                  style={{ clipPath: 'inset(0 50% 0 0)' }}
                />
              </>
            ) : (
              <Star
                className={cn(
                  starSizeClass,
                  'transition-colors',
                  fill === 'full' ? 'fill-warning text-warning' : 'fill-transparent text-muted-foreground/40'
                )}
              />
            )}
          </button>
        )
      })}

      {/* Right accessory: rating label + optional clear button */}
      <div className="ml-1 flex items-center gap-1">
        {displayLabel && (
          <span className="text-xs text-muted-foreground tabular-nums leading-none">{displayLabel}</span>
        )}
        {value != null && !readOnly && hover === null && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            aria-label="Clear rating"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  )
}
