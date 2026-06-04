import { Minus, Square, X, Maximize2 } from 'lucide-react'
import { useState, useEffect } from 'react'
import { cn } from '../../lib/utils'
import iconUrl from '../../assets/icon.svg'

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    window.electron?.window.isMaximized().then(setIsMaximized)
    const unsub = window.electron?.window.onMaximized(setIsMaximized)
    // Wrap so the effect cleanup returns void - the unsubscribe chains back the
    // IpcRenderer, which React's Destructor type rejects.
    return () => { unsub?.() }
  }, [])

  return (
    <div
      className="titlebar-drag flex h-[var(--titlebar-height)] items-center justify-between bg-background border-b border-border/50 px-4 flex-shrink-0 select-none"
      style={{ minHeight: 'var(--titlebar-height)' }}
    >
      {/* App name */}
      <div className="titlebar-no-drag flex items-center gap-2">
        <img src={iconUrl} width={18} height={18} alt="" draggable={false} />
        <span className="font-serif text-sm font-normal text-foreground tracking-wide">Cinemate</span>
      </div>

      {/* Window controls */}
      <div className="titlebar-no-drag flex items-center">
        <TitleBarButton
          aria-label="Minimize window"
          onClick={() => window.electron?.window.minimize()}
          className="hover:bg-muted-foreground/20"
        >
          <Minus className="h-3 w-3" />
        </TitleBarButton>
        <TitleBarButton
          aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
          onClick={() => window.electron?.window.maximize()}
          className="hover:bg-muted-foreground/20"
        >
          {isMaximized ? <Square className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
        </TitleBarButton>
        <TitleBarButton
          aria-label="Close window"
          onClick={() => window.electron?.window.close()}
          className="hover:bg-destructive hover:text-white"
        >
          <X className="h-3 w-3" />
        </TitleBarButton>
      </div>
    </div>
  )
}

function TitleBarButton({ className, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        'flex h-8 w-10 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-150 cursor-pointer',
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}

