import { Home, Search, BookOpen, BarChart2, List, Compass, Clock, Archive } from 'lucide-react'
import type { ComponentType } from 'react'
import type { SidebarConfig } from '../types'

export interface SidebarNavItem {
  key: string
  to: string
  icon: ComponentType<{ className?: string }>
  label: string
  exact?: boolean
}

// The configurable sidebar nav items, in their default order. Settings and
// Support live in the sidebar footer and are deliberately NOT in this list:
// they are always shown and can't be reordered or hidden.
export const SIDEBAR_NAV_ITEMS: SidebarNavItem[] = [
  { key: 'home', to: '/', icon: Home, label: 'Home', exact: true },
  { key: 'discover', to: '/discover', icon: Compass, label: 'Discover' },
  { key: 'search', to: '/search', icon: Search, label: 'Search' },
  { key: 'library', to: '/library', icon: BookOpen, label: 'Library' },
  { key: 'log', to: '/log', icon: Clock, label: 'Watch Log' },
  { key: 'stats', to: '/stats', icon: BarChart2, label: 'Stats' },
  { key: 'lists', to: '/lists', icon: List, label: 'Lists' },
  { key: 'collection', to: '/collection', icon: Archive, label: 'Collection' },
]

// Order the full item list per a saved config. Items missing from the saved
// order (e.g. a nav item added in a newer app version) keep their default spot
// by being appended in registry order, so upgrades never silently drop items.
export function orderNavItems(config?: SidebarConfig): SidebarNavItem[] {
  const order = config?.order ?? []
  const remaining = new Map(SIDEBAR_NAV_ITEMS.map((it) => [it.key, it]))
  const result: SidebarNavItem[] = []
  for (const key of order) {
    const it = remaining.get(key)
    if (it) {
      result.push(it)
      remaining.delete(key)
    }
  }
  for (const it of SIDEBAR_NAV_ITEMS) {
    if (remaining.has(it.key)) result.push(it)
  }
  return result
}

// The items actually rendered in the sidebar: saved order minus hidden keys.
export function visibleNavItems(config?: SidebarConfig): SidebarNavItem[] {
  const hidden = new Set(config?.hidden ?? [])
  return orderNavItems(config).filter((it) => !hidden.has(it.key))
}
