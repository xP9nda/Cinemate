import { useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { TooltipProvider } from './components/ui/tooltip'
import { Layout } from './components/layout/Layout'
import { Home } from './views/Home'
import { Search } from './views/Search'
import { Detail } from './views/Detail'
import { Library } from './views/Library'
import { Log } from './views/Log'
import { Stats } from './views/Stats'
import { Discover } from './views/Discover'
import { Lists } from './views/Lists'
import { ListDetail } from './views/ListDetail'
import { Settings } from './views/Settings'
import { Person } from './views/Person'
import { Collection } from './views/Collection'
import { Donate } from './views/Donate'
import { SetupWizard } from './components/SetupWizard'
import { useStore } from './lib/store'
import { initUpdaterBridge } from './lib/updater'

export function App() {
  const init = useStore(s => s.init)
  const settingsLoaded = useStore(s => s.settingsLoaded)
  const settings = useStore(s => s.settings)

  useEffect(() => {
    init()
    initUpdaterBridge()
  }, [init])

  if (!settingsLoaded) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <CinemateLogo />
          <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
        </div>
      </div>
    )
  }

  if (!settings.setupComplete) {
    return (
      <TooltipProvider delayDuration={300}>
        <SetupWizard />
      </TooltipProvider>
    )
  }

  return (
    <HashRouter>
      <TooltipProvider delayDuration={300}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />
            <Route path="/search" element={<Search />} />
            <Route path="/detail/:type/:id" element={<Detail />} />
            <Route path="/library" element={<Library />} />
            <Route path="/log" element={<Log />} />
            <Route path="/stats" element={<Stats />} />
            <Route path="/discover" element={<Discover />} />
            <Route path="/lists" element={<Lists />} />
            <Route path="/lists/:id" element={<ListDetail />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/donate" element={<Donate />} />
            <Route path="/person/:id" element={<Person />} />
            <Route path="/collection" element={<Collection />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </TooltipProvider>
    </HashRouter>
  )
}

function CinemateLogo() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="20" height="20" rx="4" fill="hsl(262 33% 66%)" opacity="0.9" />
      <rect x="5" y="7" width="3" height="10" rx="1" fill="white" opacity="0.9" />
      <rect x="10.5" y="7" width="3" height="10" rx="1" fill="white" opacity="0.9" />
      <rect x="16" y="7" width="3" height="10" rx="1" fill="hsl(176 53% 55%)" />
    </svg>
  )
}
