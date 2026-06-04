import { NavLink, useNavigate } from 'react-router-dom'
import { Settings, ChevronLeft, ChevronRight, Heart } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useStore } from '../../lib/store'
import { visibleNavItems } from '../../lib/sidebarNav'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

export function Sidebar() {
  const settings = useStore(s => s.settings)
  const sidebarOpen = useStore(s => s.sidebarOpen)
  const setSidebarOpen = useStore(s => s.setSidebarOpen)
  const navigate = useNavigate()
  const navItems = visibleNavItems(settings.sidebarConfig)

  return (
    <aside
      className={cn(
        'flex flex-col flex-shrink-0 bg-background border-r border-border/50 transition-all duration-200 overflow-hidden',
        sidebarOpen ? 'w-[var(--sidebar-width)]' : 'w-14'
      )}
    >
      {/* User profile */}
      <div className="relative">
        <div
          className={cn(
            'flex items-center py-4 cursor-pointer hover:bg-secondary/50 transition-colors',
            sidebarOpen ? 'gap-3 px-3 pr-9' : 'justify-center px-0'
          )}
          onClick={() => navigate('/settings')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && navigate('/settings')}
          aria-label="Open settings"
        >
          <Avatar className="h-8 w-8 flex-shrink-0">
            {settings.avatar ? <AvatarImage src={settings.avatar} alt={settings.username} /> : null}
            <AvatarFallback className="text-xs bg-primary/20 text-primary">
              {settings.username.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          {sidebarOpen && (
            <div className="flex-1 min-w-0 animate-fade-in">
              <p className="text-sm font-medium truncate">{settings.username}</p>
              <p className="text-xs text-muted-foreground">Profile</p>
            </div>
          )}
        </div>
        {sidebarOpen && (
          <button
            className="absolute top-1/2 -translate-y-1/2 right-2 h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            onClick={(e) => { e.stopPropagation(); setSidebarOpen(false) }}
            aria-label="Collapse sidebar"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-2 space-y-0.5" role="navigation" aria-label="Main navigation">
        {navItems.map(({ key, to, icon: Icon, label, exact }) => (
          <NavItem key={key} to={to} icon={Icon} label={label} collapsed={!sidebarOpen} exact={exact} />
        ))}
      </nav>

      {/* Bottom */}
      <div className="px-2 pb-3 space-y-0.5">
        <NavItem to="/donate" icon={Heart} label="Support" collapsed={!sidebarOpen} />
        <NavItem to="/settings" icon={Settings} label="Settings" collapsed={!sidebarOpen} />
        {!sidebarOpen && (
          <button
            className="flex w-full items-center justify-center h-9 rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors duration-150"
            onClick={() => setSidebarOpen(true)}
            aria-label="Expand sidebar"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </aside>
  )
}

interface NavItemProps {
  to: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  collapsed: boolean
  exact?: boolean
}

function NavItem({ to, icon: Icon, label, collapsed, exact }: NavItemProps) {
  const baseClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors duration-150 cursor-pointer',
      isActive
        ? 'bg-primary/15 text-primary font-medium'
        : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
    )

  const item = (
    <NavLink to={to} end={exact} className={baseClass}>
      <Icon className="h-4 w-4 flex-shrink-0" />
      {!collapsed && <span className="truncate animate-fade-in">{label}</span>}
    </NavLink>
  )

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="w-full">
            <NavLink
              to={to}
              end={exact}
              className={({ isActive }) =>
                cn(
                  'flex w-full items-center justify-center rounded-lg py-2 transition-colors duration-150 cursor-pointer',
                  isActive
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                )
              }
            >
              <Icon className="h-4 w-4" />
            </NavLink>
          </div>
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    )
  }

  return item
}
