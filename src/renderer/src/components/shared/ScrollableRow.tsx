import { useRef, useState, useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '../../lib/utils'

interface ScrollableRowProps {
  children: React.ReactNode
  className?: string
}

export function ScrollableRow({ children, className }: ScrollableRowProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    setCanLeft(el.scrollLeft > 4)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [update])

  const scroll = (dir: 'left' | 'right') => {
    ref.current?.scrollBy({ left: dir === 'left' ? -320 : 320, behavior: 'smooth' })
  }

  return (
    <div className="relative min-w-0">
      <div
        ref={ref}
        className={cn('flex gap-3 overflow-x-auto px-1 pt-1 pb-6', className)}
        style={{ scrollbarWidth: 'none', scrollSnapType: 'x mandatory' }}
      >
        {children}
      </div>
      {canLeft && (
        <button
          onClick={() => scroll('left')}
          className="absolute left-0 top-[calc(50%-8px)] -translate-y-1/2 -translate-x-3 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-card border border-border shadow-lg text-foreground hover:bg-secondary transition-colors"
          aria-label="Scroll left"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      )}
      {canRight && (
        <button
          onClick={() => scroll('right')}
          className="absolute right-0 top-[calc(50%-8px)] -translate-y-1/2 translate-x-3 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-card border border-border shadow-lg text-foreground hover:bg-secondary transition-colors"
          aria-label="Scroll right"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
