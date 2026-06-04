import { Outlet } from 'react-router-dom'
import { TitleBar } from './TitleBar'
import { Sidebar } from './Sidebar'
import { Toaster } from 'sonner'
import { useStore } from '../../lib/store'

export function Layout() {
  const theme = useStore(s => s.settings.theme)
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden min-w-0" id="main-content">
          <Outlet />
        </main>
      </div>
      <Toaster
        position="bottom-right"
        theme={theme}
        toastOptions={{
          style: {
            background: 'hsl(var(--popover))',
            border: '1px solid hsl(var(--border))',
            color: 'hsl(var(--popover-foreground))'
          },
          actionButtonStyle: {
            background: 'hsl(var(--primary))',
            color: 'hsl(var(--primary-foreground))'
          },
          cancelButtonStyle: {
            background: 'hsl(var(--muted))',
            color: 'hsl(var(--muted-foreground))'
          }
        }}
      />
    </div>
  )
}
