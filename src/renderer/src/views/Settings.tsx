import React, { useState, useRef, useEffect, useMemo, useCallback, KeyboardEvent } from 'react'
import { toast } from 'sonner'
import { Key, User, Palette, Database, Download, Upload, Trash2, Eye, EyeOff, Camera, FolderOpen, Loader2, Check, Tag, Plus, X, Sliders, HardDrive, RefreshCw, ChevronDown, ChevronUp, ChevronRight, PanelLeft, ArrowDownToLine, CircleCheck, AlertCircle, RotateCw, ListOrdered } from 'lucide-react'
import { ImportDialog } from '../components/ImportDialog'
import { useStore } from '../lib/store'
import { useUpdater } from '../lib/updater'
import { Progress } from '../components/ui/progress'
import * as db from '../lib/db'
import type { CacheStats, CacheCategory } from '../lib/db'
import { DEFAULT_PAGINATION, PAGE_SIZE_OPTIONS } from '../lib/utils'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Separator } from '../components/ui/separator'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog'
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar'
import { ScrollArea } from '../components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import type { Theme, RatingSystem, SpoilerSettings, SeasonDisplay, TimeFormat, AccentColor, LogGroupBy, PaginationSettings } from '../types'
import { orderNavItems, type SidebarNavItem } from '../lib/sidebarNav'

export function Settings() {
  const settings = useStore(s => s.settings)
  const updateSettings = useStore(s => s.updateSettings)
  const exportData = useStore(s => s.exportData)
  const importData = useStore(s => s.importData)
  const clearData = useStore(s => s.clearData)
  const watchHistory = useStore(s => s.watchHistory)
  const library = useStore(s => s.library)
  const lists = useStore(s => s.lists)
  const convertAllRatings = useStore(s => s.convertAllRatings)

  const [apiKey, setApiKey] = useState(settings.apiKey ?? '')
  const [showKey, setShowKey] = useState(false)
  const [username, setUsername] = useState(settings.username)
  const [keySaved, setKeySaved] = useState(false)
  const [clearConfirm, setClearConfirm] = useState(false)
  const [clearEverythingConfirm, setClearEverythingConfirm] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [dataDir, setDataDir] = useState('')
  const [dataDirInput, setDataDirInput] = useState('')
  const [changingDir, setChangingDir] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const avatarRef = useRef<HTMLInputElement>(null)

  const dataSizeBytes = useMemo(
    () => db.getDataSizeBytes(),
    [library, watchHistory, lists, settings]
  )

  useEffect(() => {
    db.getDataDir().then((dir) => { setDataDir(dir); setDataDirInput(dir) })
  }, [])

  const handleSaveApiKey = async () => {
    await updateSettings({ apiKey: apiKey.trim() || null })
    setKeySaved(true)
    toast.success('API key saved')
    setTimeout(() => setKeySaved(false), 2000)
  }

  const handleSaveUsername = async () => {
    if (!username.trim()) return
    await updateSettings({ username: username.trim() })
    toast.success('Username updated')
  }

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const dataUrl = await compressAvatar(file)
      await updateSettings({ avatar: dataUrl })
      toast.success('Avatar updated')
    } catch {
      toast.error('Failed to process avatar')
    } finally {
      if (avatarRef.current) avatarRef.current.value = ''
    }
  }

  const handleExport = async () => {
    try {
      const json = await exportData()
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `cinemate-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Backup exported')
    } catch {
      toast.error('Export failed')
    }
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    try {
      const text = await file.text()
      await importData(text)
      toast.success('Data imported. Reloading...')
      setTimeout(() => window.location.reload(), 800)
    } catch {
      toast.error('Import failed: invalid backup file')
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleClearData = async () => {
    await clearData()
    setClearConfirm(false)
    toast.success('All data cleared. Reloading...')
    setTimeout(() => window.location.reload(), 800)
  }

  const handleClearEverythingAndClose = async () => {
    await db.deleteEntireDataFolder()
    window.electron.window.close()
  }

  const handleChangeDir = async () => {
    const trimmed = dataDirInput.trim()
    if (!trimmed || trimmed === dataDir) return
    setChangingDir(true)
    try {
      await db.setDataDir(trimmed)
      setDataDir(trimmed)
      await useStore.getState().init()
      toast.success('Data directory updated')
    } catch {
      toast.error('Failed to update data directory')
    } finally {
      setChangingDir(false)
    }
  }

  return (
    <ScrollArea className="h-full">
      <div className="view-container p-6 max-w-2xl mx-auto space-y-8">
        <h1 className="font-serif text-2xl font-normal">Settings</h1>

        {/* Profile */}
        <section className="space-y-4">
          <SectionHeader icon={<User className="h-4 w-4" />} title="Profile" />
          <div className="flex items-center gap-4">
            <div className="relative">
              <Avatar className="h-16 w-16">
                {settings.avatar ? (
                  <AvatarImage src={settings.avatar} alt={settings.username} />
                ) : null}
                <AvatarFallback className="text-lg bg-primary/20 text-primary">
                  {settings.username.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <button
                onClick={() => avatarRef.current?.click()}
                className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-colors cursor-pointer"
                aria-label="Change avatar"
              >
                <Camera className="h-3 w-3" />
              </button>
              <input
                ref={avatarRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarChange}
                aria-label="Upload avatar"
              />
            </div>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="username">Display Name</Label>
              <div className="flex gap-2">
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Your name"
                  className="max-w-xs"
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveUsername()}
                />
                <Button size="sm" onClick={handleSaveUsername} disabled={!username.trim()}>
                  Save
                </Button>
              </div>
            </div>
          </div>
        </section>

        <Separator />

        {/* TMDb API Key */}
        <section className="space-y-4">
          <SectionHeader icon={<Key className="h-4 w-4" />} title="TMDb API Key" />
          <p className="text-sm text-muted-foreground">
            Cinemate uses the free TMDb API to search for movies and TV shows.{' '}
            <span className="text-primary">Get your free key at themoviedb.org, then go to Settings and then API.</span>
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="api-key">API Key</Label>
            <div className="flex gap-2">
              <div className="relative flex-1 max-w-md">
                <Input
                  id="api-key"
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Enter your TMDb API key..."
                  className="pr-9"
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveApiKey()}
                />
                <button
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  aria-label={showKey ? 'Hide API key' : 'Show API key'}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button size="sm" onClick={handleSaveApiKey} variant={keySaved ? 'teal' : 'default'}>
                {keySaved ? 'Saved' : 'Save Key'}
              </Button>
            </div>
          </div>
        </section>

        <Separator />

        {/* Appearance */}
        <section className="space-y-4">
          <SectionHeader icon={<Palette className="h-4 w-4" />} title="Appearance" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="theme">Theme</Label>
              <Select
                value={settings.theme}
                onValueChange={(v) => updateSettings({ theme: v as Theme })}
              >
                <SelectTrigger id="theme"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="dark">Dark</SelectItem>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="default-media">Default Media Filter</Label>
              <Select
                value={settings.defaultMedia}
                onValueChange={(v) => updateSettings({ defaultMedia: v as 'all' | 'movie' | 'tv' | 'anime' })}
              >
                <SelectTrigger id="default-media"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="movie">Movies</SelectItem>
                  <SelectItem value="tv">TV Shows</SelectItem>
                  <SelectItem value="anime">Anime</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="time-format">Time Format</Label>
              <Select
                value={settings.timeFormat}
                onValueChange={(v) => updateSettings({ timeFormat: v as TimeFormat })}
              >
                <SelectTrigger id="time-format"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="12h">12-hour (1:30 PM)</SelectItem>
                  <SelectItem value="24h">24-hour (13:30)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2 pt-2">
            <Label>Accent Color</Label>
            <div className="flex flex-wrap gap-2">
              {ACCENT_COLOR_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => updateSettings({ accentColor: opt.value })}
                  title={opt.label}
                  className={`h-8 w-8 rounded-full border-2 transition-all cursor-pointer ${
                    settings.accentColor === opt.value
                      ? 'border-foreground scale-110'
                      : 'border-transparent hover:scale-105'
                  }`}
                  style={{ backgroundColor: opt.color }}
                  aria-label={opt.label}
                  aria-pressed={settings.accentColor === opt.value}
                />
              ))}
            </div>
          </div>

          <div className="space-y-2 pt-2">
            <Label>TV Season Layout</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {SEASON_DISPLAY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => updateSettings({ seasonDisplay: opt.value })}
                  className={`text-left p-3 rounded-lg border transition-colors cursor-pointer ${
                    settings.seasonDisplay === opt.value
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-border/50 bg-card hover:border-border hover:bg-secondary/50'
                  }`}
                >
                  <p className={`text-sm font-medium ${settings.seasonDisplay === opt.value ? 'text-primary' : ''}`}>
                    {opt.label}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{opt.description}</p>
                </button>
              ))}
            </div>
            <button
              onClick={() => updateSettings({ showSeasonMetadata: !settings.showSeasonMetadata })}
              className={`w-full text-left flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                settings.showSeasonMetadata ? 'border-primary/40 bg-primary/5' : 'border-border/50 bg-card hover:border-border hover:bg-secondary/30'
              }`}
            >
              <div className={`mt-0.5 h-4 w-4 rounded flex-shrink-0 border-2 flex items-center justify-center transition-colors ${
                settings.showSeasonMetadata ? 'bg-primary border-primary' : 'border-muted-foreground/40'
              }`}>
                {settings.showSeasonMetadata && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
              </div>
              <div>
                <p className={`text-sm font-medium ${settings.showSeasonMetadata ? 'text-primary' : ''}`}>Show season metadata</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Display total and watched runtime, air dates, and average score under each season. When off, only the episode count and watched progress are shown.
                </p>
              </div>
            </button>
            <button
              onClick={() => updateSettings({ showSeasonOverview: !settings.showSeasonOverview })}
              className={`w-full text-left flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                settings.showSeasonOverview ? 'border-primary/40 bg-primary/5' : 'border-border/50 bg-card hover:border-border hover:bg-secondary/30'
              }`}
            >
              <div className={`mt-0.5 h-4 w-4 rounded flex-shrink-0 border-2 flex items-center justify-center transition-colors ${
                settings.showSeasonOverview ? 'bg-primary border-primary' : 'border-muted-foreground/40'
              }`}>
                {settings.showSeasonOverview && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
              </div>
              <div>
                <p className={`text-sm font-medium ${settings.showSeasonOverview ? 'text-primary' : ''}`}>Show season description</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  When a season is expanded, show its description above the episode list.
                </p>
              </div>
            </button>
          </div>

          <div className="space-y-2 pt-2">
            <Label>Watch Log Grouping</Label>
            <p className="text-xs text-muted-foreground">
              How entries in the Watch Log are split into dated sections.
            </p>
            <div
              role="radiogroup"
              aria-label="Watch log grouping"
              className="inline-flex flex-wrap gap-1 rounded-lg border border-border/50 bg-card p-1"
            >
              {LOG_GROUP_OPTIONS.map((opt) => {
                const active = settings.logGroupBy === opt.value
                return (
                  <button
                    key={opt.value}
                    role="radio"
                    aria-checked={active}
                    onClick={() => updateSettings({ logGroupBy: opt.value })}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                      active
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
                    }`}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
            {(settings.logGroupBy === 'year' || settings.logGroupBy === 'none') && (
              <p className="flex items-start gap-1.5 text-xs text-warning">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-px" />
                <span>
                  Per-section stats (movies, episodes, runtime watched) aren't shown for this grouping. There's too much to collate per header, so sections fall back to a plain entry count in brackets.
                </span>
              </p>
            )}
          </div>
        </section>

        <Separator />

        {/* Sidebar */}
        <SidebarSection />

        <Separator />

        {/* Behaviour */}
        <section className="space-y-5">
          <SectionHeader icon={<Sliders className="h-4 w-4" />} title="Behaviour" />

          <div className="space-y-1.5">
            <Label htmlFor="rating-system">Rating Scale</Label>
            <Select
              value={settings.ratingSystem}
              onValueChange={async (v) => {
                const newSystem = v as RatingSystem
                const oldSystem = settings.ratingSystem
                await updateSettings({ ratingSystem: newSystem })
                await convertAllRatings(oldSystem, newSystem)
                toast.success('Rating scale updated. All existing ratings converted.')
              }}
            >
              <SelectTrigger id="rating-system" className="max-w-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="10star">10 Stars (1 to 10)</SelectItem>
                <SelectItem value="5star">5 Stars (1 to 5)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rules">Logging Rules</Label>
            <button
              onClick={() => updateSettings({ autoRemoveWatchlist: !settings.autoRemoveWatchlist })}
              className={`w-full text-left flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                settings.autoRemoveWatchlist ? 'border-primary/40 bg-primary/5' : 'border-border/50 bg-card hover:border-border hover:bg-secondary/30'
              }`}
            >
              <div className={`mt-0.5 h-4 w-4 rounded flex-shrink-0 border-2 flex items-center justify-center transition-colors ${
                settings.autoRemoveWatchlist ? 'bg-primary border-primary' : 'border-muted-foreground/40'
              }`}>
                {settings.autoRemoveWatchlist && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
              </div>
              <div>
                <p className={`text-sm font-medium ${settings.autoRemoveWatchlist ? 'text-primary' : ''}`}>Auto-remove from watchlist on log</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Logging a movie as watched moves it from your watchlist to watched. For TV shows and anime, logging any episode moves it from watchlist to in progress.
                </p>
              </div>
            </button>
            <button
              onClick={() => updateSettings({ allowFutureDates: !settings.allowFutureDates })}
              className={`w-full text-left flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                settings.allowFutureDates ? 'border-primary/40 bg-primary/5' : 'border-border/50 bg-card hover:border-border hover:bg-secondary/30'
              }`}
            >
              <div className={`mt-0.5 h-4 w-4 rounded flex-shrink-0 border-2 flex items-center justify-center transition-colors ${
                settings.allowFutureDates ? 'bg-primary border-primary' : 'border-muted-foreground/40'
              }`}>
                {settings.allowFutureDates && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
              </div>
              <div>
                <p className={`text-sm font-medium ${settings.allowFutureDates ? 'text-primary' : ''}`}>Allow future dates when logging</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Unlocks future dates in the date picker so you can log planned watches or pre-schedule entries.
                </p>
              </div>
            </button>
            <button
              onClick={() => updateSettings({ autoScrollToNextEpisode: !settings.autoScrollToNextEpisode })}
              className={`w-full text-left flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                settings.autoScrollToNextEpisode ? 'border-primary/40 bg-primary/5' : 'border-border/50 bg-card hover:border-border hover:bg-secondary/30'
              }`}
            >
              <div className={`mt-0.5 h-4 w-4 rounded flex-shrink-0 border-2 flex items-center justify-center transition-colors ${
                settings.autoScrollToNextEpisode ? 'bg-primary border-primary' : 'border-muted-foreground/40'
              }`}>
                {settings.autoScrollToNextEpisode && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
              </div>
              <div>
                <p className={`text-sm font-medium ${settings.autoScrollToNextEpisode ? 'text-primary' : ''}`}>Auto-scroll to up next episode</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  When opening a show from Continue Watching, automatically scroll to and expand the next unwatched episode.
                </p>
              </div>
            </button>
            <button
              onClick={() => updateSettings({ markCaughtUpAsWatched: !settings.markCaughtUpAsWatched })}
              className={`w-full text-left flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                settings.markCaughtUpAsWatched ? 'border-primary/40 bg-primary/5' : 'border-border/50 bg-card hover:border-border hover:bg-secondary/30'
              }`}
            >
              <div className={`mt-0.5 h-4 w-4 rounded flex-shrink-0 border-2 flex items-center justify-center transition-colors ${
                settings.markCaughtUpAsWatched ? 'bg-primary border-primary' : 'border-muted-foreground/40'
              }`}>
                {settings.markCaughtUpAsWatched && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
              </div>
              <div>
                <p className={`text-sm font-medium ${settings.markCaughtUpAsWatched ? 'text-primary' : ''}`}>Mark caught-up shows as watched</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  When every episode that has aired so far is logged, mark the show as watched even if more episodes are scheduled to air later.
                </p>
              </div>
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <p className="text-sm font-semibold">Spoiler Protection</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                Choose what to blur for content you haven't watched yet. Click blurred content to reveal it.
              </p>
            </div>
            <div className="space-y-2">
              {SPOILER_TOGGLES.map((item) => {
                const checked = settings.spoilerProtection[item.key]
                const toggle = () => updateSettings({ spoilerProtection: { ...settings.spoilerProtection, [item.key]: !checked } })

                // Season descriptions get an inline reveal-threshold switcher, so the
                // card is a div (a button can't legally nest the switcher buttons).
                if (item.key === 'seasonDescriptions') {
                  return (
                    <div
                      key={item.key}
                      className={`rounded-lg border transition-colors ${
                        checked ? 'border-primary/40 bg-primary/5' : 'border-border/50 bg-card hover:border-border hover:bg-secondary/30'
                      }`}
                    >
                      <button onClick={toggle} className="w-full text-left flex items-start gap-3 p-3 cursor-pointer">
                        <div className={`mt-0.5 h-4 w-4 rounded flex-shrink-0 border-2 flex items-center justify-center transition-colors ${
                          checked ? 'bg-primary border-primary' : 'border-muted-foreground/40'
                        }`}>
                          {checked && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                        </div>
                        <div>
                          <p className={`text-sm font-medium ${checked ? 'text-primary' : ''}`}>{item.label}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                        </div>
                      </button>
                      {checked && (
                        <div role="radiogroup" aria-label="Reveal season descriptions" className="flex flex-wrap gap-1 px-3 pb-3 pl-10">
                          {SEASON_DESC_REVEAL_OPTIONS.map((opt) => {
                            const active = settings.spoilerProtection.seasonDescriptionRevealAt === opt.value
                            return (
                              <button
                                key={opt.value}
                                role="radio"
                                aria-checked={active}
                                onClick={() => updateSettings({ spoilerProtection: { ...settings.spoilerProtection, seasonDescriptionRevealAt: opt.value } })}
                                className={`px-2.5 py-1 rounded-md border text-xs transition-colors cursor-pointer ${
                                  active
                                    ? 'border-primary/40 bg-primary/5 text-primary'
                                    : 'border-border/50 bg-card text-muted-foreground hover:text-foreground hover:bg-secondary'
                                }`}
                              >
                                {opt.label}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                }

                return (
                  <button
                    key={item.key}
                    onClick={toggle}
                    className={`w-full text-left flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                      checked ? 'border-primary/40 bg-primary/5' : 'border-border/50 bg-card hover:border-border hover:bg-secondary/30'
                    }`}
                  >
                    <div className={`mt-0.5 h-4 w-4 rounded flex-shrink-0 border-2 flex items-center justify-center transition-colors ${
                      checked ? 'bg-primary border-primary' : 'border-muted-foreground/40'
                    }`}>
                      {checked && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                    </div>
                    <div>
                      <p className={`text-sm font-medium ${checked ? 'text-primary' : ''}`}>{item.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </section>

        <Separator />

        {/* Pagination */}
        <PaginationSection />

        <Separator />

        {/* Tags */}
        <TagsSection watchHistory={watchHistory} settings={settings} updateSettings={updateSettings} />

        <Separator />

        {/* Cache */}
        <CacheSection />

        <Separator />

        {/* Updates */}
        <UpdatesSection />

        <Separator />

        {/* Data management */}
        <section className="space-y-4">
          <SectionHeader icon={<Database className="h-4 w-4" />} title="Data" />
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Library', count: Object.keys(library).length },
                { label: 'History', count: watchHistory.length },
                { label: 'Lists', count: lists.length },
              ].map(({ label, count }) => (
                <div key={label} className="flex flex-col items-center gap-0.5 p-2.5 rounded-lg bg-card border border-border/50">
                  <p className="text-base font-semibold tabular-nums">{count}</p>
                  <p className="text-[11px] text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground text-right -mt-1">
              Total on-disk size: <span className="tabular-nums font-medium text-foreground">{fmtBytes(dataSizeBytes)}</span>
            </p>
            <div className="flex items-center justify-between p-3 rounded-lg bg-card border border-border/50">
              <div>
                <p className="text-sm font-medium">Import from Letterboxd / Trakt / CSV</p>
                <p className="text-xs text-muted-foreground mt-0.5">Import your history, watchlist, lists and collection from an export or a watch-history / watchlist CSV</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setImportDialogOpen(true)} className="gap-1.5">
                <ArrowDownToLine className="h-3.5 w-3.5" /> Import
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground/50 text-center -mt-1">
              Not affiliated with or endorsed by Letterboxd or Trakt.
            </p>

            <div className="flex items-center justify-between p-3 rounded-lg bg-card border border-border/50">
              <div>
                <p className="text-sm font-medium">Export Backup</p>
                <p className="text-xs text-muted-foreground mt-0.5">Download all your data as a JSON file</p>
              </div>
              <Button size="sm" variant="outline" onClick={handleExport} className="gap-1.5">
                <Download className="h-3.5 w-3.5" /> Export
              </Button>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-card border border-border/50">
              <div>
                <p className="text-sm font-medium">Import Backup</p>
                <p className="text-xs text-muted-foreground mt-0.5">Restore from a previous JSON backup</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileRef.current?.click()}
                disabled={importing}
                className="gap-1.5"
              >
                {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {importing ? 'Importing' : 'Import'}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={handleImport}
                aria-label="Import backup file"
              />
            </div>

            <div className="p-3 rounded-lg bg-card border border-border/50 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Data Directory</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Change location to store data on a different drive or synced folder.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 flex-shrink-0 text-xs"
                  onClick={() => window.electron.shell.openDataFolder()}
                >
                  <FolderOpen className="h-3.5 w-3.5" /> Open Folder
                </Button>
              </div>
              <div className="flex gap-2">
                <Input
                  value={dataDirInput}
                  onChange={(e) => setDataDirInput(e.target.value)}
                  placeholder="Path to data directory"
                  className="flex-1 text-xs font-mono h-8"
                />
                <Button
                  size="sm"
                  className="h-8 flex-shrink-0 gap-1.5"
                  onClick={handleChangeDir}
                  disabled={!dataDirInput.trim() || dataDirInput.trim() === dataDir || changingDir}
                >
                  {changingDir && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {changingDir ? 'Saving' : 'Apply'}
                </Button>
              </div>
              {dataDirInput.trim() !== dataDir && dataDirInput.trim() && (
                <p className="text-xs text-warning">
                  All data files will be copied to the new location and removed from the old one. The app will reload after applying.
                </p>
              )}
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-destructive/5 border border-destructive/20">
              <div>
                <p className="text-sm font-medium text-destructive">Clear All Data</p>
                <p className="text-xs text-muted-foreground mt-0.5">Permanently delete your library, history, and lists</p>
              </div>
              <Button size="sm" variant="destructive" onClick={() => setClearConfirm(true)} className="gap-1.5">
                <Trash2 className="h-3.5 w-3.5" /> Clear
              </Button>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-destructive/5 border border-destructive/20">
              <div>
                <p className="text-sm font-medium text-destructive">Factory Reset</p>
                <p className="text-xs text-muted-foreground mt-0.5">Wipe everything including settings, then close the app</p>
              </div>
              <Button size="sm" variant="destructive" onClick={() => setClearEverythingConfirm(true)} className="gap-1.5">
                <Trash2 className="h-3.5 w-3.5" /> Reset
              </Button>
            </div>
          </div>
        </section>

        {/* Footer */}
        <div className="text-center pb-4 space-y-1">
          <p className="text-xs text-muted-foreground">Cinemate v{__APP_VERSION__} &nbsp;|&nbsp; Powered by TMDb</p>
          <p className="text-xs text-muted-foreground/60">Not affiliated with or endorsed by TMDb.</p>
        </div>
      </div>

      <ImportDialog open={importDialogOpen} onOpenChange={setImportDialogOpen} />

      <Dialog open={clearConfirm} onOpenChange={(v) => !v && setClearConfirm(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Clear all data?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete your entire library, watch history, and custom lists. This action cannot be undone.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setClearConfirm(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleClearData}>Yes, Clear Everything</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={clearEverythingConfirm} onOpenChange={(v) => !v && setClearEverythingConfirm(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Factory reset?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete <strong>all data including your settings, API key, and cache</strong>. The app will close immediately. This cannot be undone.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setClearEverythingConfirm(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleClearEverythingAndClose}>Yes, Reset &amp; Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ScrollArea>
  )
}

function SidebarSection() {
  const settings = useStore(s => s.settings)
  const updateSettings = useStore(s => s.updateSettings)
  const [open, setOpen] = useState(false)

  const config = settings.sidebarConfig
  const items = orderNavItems(config)
  const hidden = new Set(config?.hidden ?? [])
  const isDefault = (config?.order?.length ?? 0) === 0 && (config?.hidden?.length ?? 0) === 0

  const persist = (next: SidebarNavItem[], nextHidden: Set<string>) => {
    updateSettings({
      sidebarConfig: { order: next.map((it) => it.key), hidden: Array.from(nextHidden) }
    })
  }

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= items.length) return
    const next = [...items]
    ;[next[index], next[target]] = [next[target], next[index]]
    persist(next, hidden)
  }

  const toggle = (key: string) => {
    const next = new Set(hidden)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    persist(items, next)
  }

  const reset = () => updateSettings({ sidebarConfig: { order: [], hidden: [] } })

  return (
    <section className="space-y-4">
      <SectionHeader icon={<PanelLeft className="h-4 w-4" />} title="Sidebar" />
      <div className="flex items-center justify-between p-3 rounded-lg bg-card border border-border/50">
        <div>
          <p className="text-sm font-medium">Customize navigation</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Reorder sidebar items or hide ones you don't use. Settings and Support always stay visible.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} className="gap-1.5">
          <Sliders className="h-3.5 w-3.5" /> Customize
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Customize Sidebar</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Use the arrows to reorder items and the eye icon to show or hide them. Settings and Support are always shown.
          </p>
          <div className="space-y-1.5 max-h-[55vh] overflow-y-auto -mx-1 px-1">
            {items.map((item, index) => {
              const Icon = item.icon
              const isHidden = hidden.has(item.key)
              return (
                <div
                  key={item.key}
                  className="flex items-center gap-2 p-2 rounded-lg border border-border/50 bg-card"
                >
                  <div className="flex flex-col -my-1">
                    <button
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default"
                      aria-label={`Move ${item.label} up`}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => move(index, 1)}
                      disabled={index === items.length - 1}
                      className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default"
                      aria-label={`Move ${item.label} down`}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  </div>
                  <Icon className={`h-4 w-4 flex-shrink-0 ${isHidden ? 'text-muted-foreground/40' : 'text-primary'}`} />
                  <span className={`text-sm flex-1 ${isHidden ? 'text-muted-foreground/50 line-through' : ''}`}>
                    {item.label}
                  </span>
                  <button
                    onClick={() => toggle(item.key)}
                    className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    aria-label={isHidden ? `Show ${item.label}` : `Hide ${item.label}`}
                  >
                    {isHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              )
            })}
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="ghost" onClick={reset} disabled={isDefault}>Reset to default</Button>
            <Button onClick={() => setOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function TagsSection({
  watchHistory,
  settings,
  updateSettings
}: {
  watchHistory: import('../types').WatchHistoryEntry[]
  settings: import('../types').AppSettings
  updateSettings: (patch: Partial<import('../types').AppSettings>) => Promise<void>
}) {
  const [newTagInput, setNewTagInput] = useState('')

  const historyTagCounts: Record<string, number> = {}
  for (const h of watchHistory) {
    for (const tag of (h.tags ?? [])) {
      historyTagCounts[tag] = (historyTagCounts[tag] ?? 0) + 1
    }
  }

  const customTags: string[] = settings.customTags ?? []

  const allTags = Array.from(new Set([...customTags, ...Object.keys(historyTagCounts)])).sort()

  const addTag = () => {
    const tag = newTagInput.trim().toLowerCase().replace(/[,;]/g, '')
    if (!tag || customTags.includes(tag)) { setNewTagInput(''); return }
    updateSettings({ customTags: [...customTags, tag] })
    setNewTagInput('')
  }

  const removeCustomTag = (tag: string) => {
    updateSettings({ customTags: customTags.filter((t) => t !== tag) })
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); addTag() }
    else if (e.key === 'Escape') setNewTagInput('')
  }

  return (
    <section className="space-y-4">
      <SectionHeader icon={<Tag className="h-4 w-4" />} title="Tags" />
      <p className="text-sm text-muted-foreground">
        Manage your tag library. Saved tags appear as suggestions when logging a watch.
      </p>

      <div className="flex gap-2">
        <input
          value={newTagInput}
          onChange={(e) => setNewTagInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="New tag name..."
          className="flex-1 h-9 rounded-md border border-input bg-transparent px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
        />
        <Button size="sm" onClick={addTag} disabled={!newTagInput.trim()} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>

      {allTags.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No tags yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {allTags.map((tag) => {
            const count = historyTagCounts[tag]
            const isSaved = customTags.includes(tag)
            return (
              <div
                key={tag}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 text-sm"
              >
                <span className="text-primary font-medium">{tag}</span>
                {count != null && (
                  <span className="text-xs text-muted-foreground">{count}</span>
                )}
                {isSaved && (
                  <button
                    onClick={() => removeCustomTag(tag)}
                    className="text-primary/50 hover:text-destructive transition-colors ml-0.5 cursor-pointer"
                    aria-label={`Remove tag ${tag}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Tags with <X className="inline h-3 w-3" /> are saved tags you can remove. Tags shown without it come from your watch history.
      </p>
    </section>
  )
}

const ACCENT_COLOR_OPTIONS: { value: AccentColor; label: string; color: string }[] = [
  { value: 'purple', label: 'Purple',  color: 'hsl(262, 33%, 66%)' },
  { value: 'blue',   label: 'Blue',    color: 'hsl(210, 72%, 62%)' },
  { value: 'green',  label: 'Green',   color: 'hsl(152, 58%, 52%)' },
  { value: 'orange', label: 'Orange',  color: 'hsl(27, 85%, 62%)'  },
  { value: 'pink',   label: 'Pink',    color: 'hsl(330, 62%, 65%)' },
  { value: 'red',    label: 'Red',     color: 'hsl(0, 60%, 62%)'   },
]

const LOG_GROUP_OPTIONS: { value: LogGroupBy; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'none', label: 'None' },
]

const SEASON_DISPLAY_OPTIONS: { value: SeasonDisplay; label: string; description: string }[] = [
  {
    value: 'start_expanded',
    label: 'Start Expanded',
    description: 'Seasons open fully expanded. You can still collapse them.'
  },
  {
    value: 'start_collapsed',
    label: 'Start Collapsed',
    description: 'Seasons start collapsed. Click a season header to expand or collapse it.'
  }
]

type BoolSpoilerKey = Exclude<keyof SpoilerSettings, 'seasonDescriptionRevealAt'>

const SPOILER_TOGGLES: { key: BoolSpoilerKey; label: string; description: string }[] = [
  {
    key: 'episodeTitles',
    label: 'Unwatched episode titles',
    description: "Blur the titles of episodes you haven't watched yet."
  },
  {
    key: 'episodeDescriptions',
    label: 'Unwatched episode descriptions',
    description: "Blur the descriptions of episodes you haven't watched yet."
  },
  {
    key: 'seasonDescriptions',
    label: 'Season descriptions',
    description: 'Blur a season description until you have watched enough of it.'
  },
  {
    key: 'mediaDescriptions',
    label: 'Show & movie descriptions',
    description: 'Blur overviews for media on your watchlist or not yet tracked.'
  },
  {
    key: 'ratings',
    label: 'Ratings',
    description: 'Blur community ratings until you choose to reveal them.'
  },
  {
    key: 'actorEpisodeCounts',
    label: 'Actor episode counts',
    description: 'Blur how many episodes each cast member appears in on TV shows.'
  }
]

const SEASON_DESC_REVEAL_OPTIONS: { value: SpoilerSettings['seasonDescriptionRevealAt']; label: string }[] = [
  { value: 'started', label: 'Reveal after at least 1 episode is watched' },
  { value: 'completed', label: 'Reveal after the season is finished' }
]

const CACHE_CATEGORIES: { key: CacheCategory; label: string; color: string; textColor: string }[] = [
  { key: 'detail',    label: 'Media details',    color: 'bg-primary',             textColor: 'text-primary' },
  { key: 'season',    label: 'Season data',       color: 'bg-teal',                textColor: 'text-teal' },
  { key: 'search',    label: 'Search results',    color: 'bg-info',                textColor: 'text-info' },
  { key: 'discovery', label: 'Discovery',         color: 'bg-warning',             textColor: 'text-warning' },
  { key: 'person',    label: 'People',            color: 'bg-success',             textColor: 'text-success' },
  { key: 'genre',     label: 'Genre lists',       color: 'bg-muted-foreground/60', textColor: 'text-muted-foreground' },
]

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function fmtExpiry(expiresAt: number): string {
  const ms = expiresAt - Date.now()
  if (ms <= 0) return 'expired'
  const m = Math.floor(ms / 60000)
  if (m < 60) return `${m}m`
  const h = Math.floor(ms / 3600000)
  if (h < 24) return `${h}h`
  return `${Math.floor(ms / 86400000)}d`
}

const PAGINATION_CONTEXTS: { key: keyof PaginationSettings; label: string; desc: string }[] = [
  { key: 'library', label: 'Library', desc: 'Movies & shows per page in your library' },
  { key: 'log', label: 'Watch Log', desc: 'Plays loaded per page in the watch log' },
  { key: 'lists', label: 'Lists', desc: 'Lists shown per page on the Lists page' },
  { key: 'listItems', label: 'List items', desc: 'Items loaded per page inside a list' },
  { key: 'collection', label: 'Collection', desc: 'Discs & items per page in your collection' },
]

// Above this many items, switching a context to "All" prompts a performance
// confirmation first - rendering an unpaged list this large can be slow.
const PAGINATION_WARN_THRESHOLD = 250

function PaginationSection() {
  const settings = useStore(s => s.settings)
  const updateSettings = useStore(s => s.updateSettings)
  const library = useStore(s => s.library)
  const watchHistory = useStore(s => s.watchHistory)
  const lists = useStore(s => s.lists)
  const collection = useStore(s => s.collection)
  const pag = settings.pagination ?? DEFAULT_PAGINATION
  const [confirmAll, setConfirmAll] = useState<keyof PaginationSettings | null>(null)

  // How many items "All" would render for each context. listItems uses the
  // largest single list, since that's the worst case for the List detail view.
  const counts = useMemo<Record<keyof PaginationSettings, number>>(() => ({
    library: Object.keys(library).length,
    log: watchHistory.length,
    lists: lists.length,
    listItems: lists.reduce((max, l) => Math.max(max, l.itemIds.length), 0),
    collection: collection.length,
  }), [library, watchHistory, lists, collection])

  const apply = (key: keyof PaginationSettings, value: number) => {
    updateSettings({ pagination: { ...pag, [key]: value } })
  }

  const handleChange = (key: keyof PaginationSettings, value: number) => {
    // Only warn when "All" (0) is chosen on a sizeable data set. Otherwise apply
    // immediately. Deferring leaves the Select on its previous value (it's
    // controlled by pag[key]) until the user confirms.
    if (value === 0 && counts[key] >= PAGINATION_WARN_THRESHOLD) {
      setConfirmAll(key)
      return
    }
    apply(key, value)
  }

  const confirmCtx = confirmAll ? PAGINATION_CONTEXTS.find((c) => c.key === confirmAll) : null

  return (
    <section className="space-y-4">
      <SectionHeader icon={<ListOrdered className="h-4 w-4" />} title="Pagination" />
      <p className="text-sm text-muted-foreground">
        Choose how many items load at once in each view. Smaller pages render faster on a large library;
        pick &ldquo;All&rdquo; to load everything and hide the Load More button.
      </p>
      <div className="rounded-lg border border-border/50 bg-card divide-y divide-border/50">
        {PAGINATION_CONTEXTS.map(({ key, label, desc }) => (
          <div key={key} className="flex items-center justify-between gap-4 p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
            </div>
            <Select
              value={String(pag[key] ?? DEFAULT_PAGINATION[key])}
              onValueChange={(v) => handleChange(key, Number(v))}
            >
              <SelectTrigger className="h-8 w-24 text-xs flex-shrink-0"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>{n === 0 ? 'All' : n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>

      <Dialog open={confirmAll !== null} onOpenChange={(v) => !v && setConfirmAll(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Show all items?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Your {confirmCtx?.label.toLowerCase()} currently holds{' '}
            <span className="font-medium text-foreground tabular-nums">
              {confirmAll ? counts[confirmAll].toLocaleString() : ''}
            </span>{' '}
            items. Loading them all at once instead of in pages may result in long load times and
            worse performance. You can switch back to a paged size at any time.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setConfirmAll(null)}>Cancel</Button>
            <Button onClick={() => { if (confirmAll) apply(confirmAll, 0); setConfirmAll(null) }}>
              Show all anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function CacheSection() {
  const settings = useStore(s => s.settings)
  const updateSettings = useStore(s => s.updateSettings)
  const [stats, setStats] = useState<CacheStats | null>(null)
  const [clearing, setClearing] = useState<CacheCategory | 'all' | null>(null)
  const [expanded, setExpanded] = useState<CacheCategory | null>(null)
  const [expandedEntries, setExpandedEntries] = useState<db.CacheEntryDetail[]>([])
  const [visibleCount, setVisibleCount] = useState(50)
  const [clearCacheConfirm, setClearCacheConfirm] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const loadStats = useCallback(() => {
    setStats(db.getCacheStats())
  }, [])

  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    setStats(db.getCacheStats())
    setTimeout(() => {
      setRefreshing(false)
      toast.success('Cache stats refreshed')
    }, 600)
  }, [])

  useEffect(() => { loadStats() }, [loadStats])

  const handleToggleExpand = (cat: CacheCategory) => {
    if (expanded === cat) {
      setExpanded(null)
      setExpandedEntries([])
      setVisibleCount(50)
    } else {
      setExpanded(cat)
      setExpandedEntries(db.getCacheEntries(cat))
      setVisibleCount(50)
    }
  }

  const handleDeleteEntry = async (key: string) => {
    await db.deleteCacheEntry(key)
    setExpandedEntries((prev) => prev.filter((e) => e.key !== key))
    loadStats()
  }

  const handleClearCategory = async (cat: CacheCategory, e: React.MouseEvent) => {
    e.stopPropagation()
    setClearing(cat)
    await db.clearCacheByCategory(cat)
    if (expanded === cat) { setExpanded(null); setExpandedEntries([]) }
    loadStats()
    setClearing(null)
    toast.success('Cache cleared')
  }

  const handleClearAll = async () => {
    setClearCacheConfirm(false)
    setClearing('all')
    await db.clearCache()
    setExpanded(null)
    setExpandedEntries([])
    loadStats()
    setClearing(null)
    toast.success('Cache cleared')
  }

  const ttl = settings.cacheTTL ?? { search: 1, detail: 7, genres: 30 }
  const total = stats?.totalBytes ?? 0
  const totalEntries = stats?.total ?? 0

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionHeader icon={<HardDrive className="h-4 w-4" />} title="Cache" />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:cursor-default disabled:opacity-60"
              aria-label="Refresh cache stats"
            >
              <RefreshCw className={`h-3.5 w-3.5 transition-transform${refreshing ? ' animate-spin' : ''}`} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Refresh stats</TooltipContent>
        </Tooltip>
      </div>
      <p className="text-sm text-muted-foreground">
        TMDb responses are cached locally to reduce API calls and speed up navigation.
      </p>

      {/* TTL settings */}
      <div className="rounded-lg border border-border/50 bg-card p-4 space-y-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Retention periods</p>
        <div className="grid grid-cols-3 gap-3">
          {[
            { id: 'search', label: 'Search results', desc: 'Queries typed in the search bar', unit: 'hours', value: ttl.search, min: 1, max: 168 },
            { id: 'detail', label: 'Media details', desc: 'Cast, runtime, overview, trailers', unit: 'days', value: ttl.detail, min: 1, max: 90 },
            { id: 'genres', label: 'Genre names', desc: 'ID-to-name mapping (Action, Drama...)', unit: 'days', value: ttl.genres, min: 1, max: 365 },
          ].map(({ id, label, desc, unit, value, min, max }) => (
            <div key={id} className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">{label}</label>
              <p className="text-[10px] text-muted-foreground/70 leading-tight">{desc}</p>
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  min={min}
                  max={max}
                  value={value}
                  onChange={(e) => {
                    const v = Math.max(min, Math.min(max, Number(e.target.value)))
                    updateSettings({ cacheTTL: { ...ttl, [id]: v } })
                  }}
                  className="h-7 text-xs w-16 tabular-nums"
                />
                <span className="text-xs text-muted-foreground">{unit}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Usage */}
      <Dialog open={clearCacheConfirm} onOpenChange={(v) => !v && setClearCacheConfirm(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Clear all cache?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will delete all locally cached TMDb data. Cinemate will re-fetch from the API as you browse. This cannot be undone.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setClearCacheConfirm(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleClearAll} disabled={clearing === 'all'}>
              {clearing === 'all' ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Clear Cache
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {stats && (
        <div className="rounded-lg border border-border/50 bg-card p-4 space-y-4">
          <div className="flex items-center justify-between text-sm gap-2">
            <span className="text-muted-foreground">{totalEntries} {totalEntries === 1 ? 'entry' : 'entries'}</span>
            <div className="flex items-center gap-3">
              <span className="font-medium tabular-nums">{fmtBytes(total)}</span>
              {totalEntries > 0 && (
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-6 text-xs gap-1 px-2"
                  onClick={() => setClearCacheConfirm(true)}
                  disabled={clearing !== null}
                >
                  <Trash2 className="h-3 w-3" />
                  Clear All
                </Button>
              )}
            </div>
          </div>

          {/* Stacked bar */}
          {total > 0 ? (
            <div className="h-3 rounded-full overflow-hidden flex bg-muted gap-px">
              {CACHE_CATEGORIES.map(({ key, color }) => {
                const pct = (stats.byCategory[key].bytes / total) * 100
                if (pct < 0.5) return null
                return <div key={key} className={`h-full ${color}`} style={{ width: `${pct.toFixed(2)}%` }} />
              })}
            </div>
          ) : (
            <div className="h-3 rounded-full bg-muted" />
          )}

          {/* Category rows */}
          <div className="space-y-1">
            {CACHE_CATEGORIES.map(({ key, label, color, textColor }) => {
              const cat = stats.byCategory[key]
              if (cat.count === 0) return null
              const isExpanded = expanded === key
              return (
                <div key={key}>
                  <div
                    onClick={() => handleToggleExpand(key)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && handleToggleExpand(key)}
                    className="flex items-center gap-2 w-full py-1 px-1.5 rounded-md hover:bg-secondary/50 transition-colors cursor-pointer group"
                  >
                    {isExpanded
                      ? <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                      : <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                    }
                    <div className={`h-2 w-2 rounded-full flex-shrink-0 ${color}`} />
                    <span className={`text-xs font-medium flex-1 text-left ${textColor}`}>{label}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{cat.count} {cat.count === 1 ? 'entry' : 'entries'}</span>
                    <span className="text-xs text-muted-foreground tabular-nums ml-3 w-16 text-right">{fmtBytes(cat.bytes)}</span>
                    <button
                      onClick={(e) => handleClearCategory(key, e)}
                      disabled={clearing !== null}
                      className="text-[10px] text-muted-foreground hover:text-destructive transition-colors cursor-pointer opacity-0 group-hover:opacity-100 ml-2 flex-shrink-0 disabled:pointer-events-none"
                      aria-label={`Clear ${label} cache`}
                    >
                      {clearing === key ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Clear'}
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="ml-6 mt-1 mb-2 rounded-md border border-border/40 bg-background max-h-52 overflow-y-auto">
                      {expandedEntries.length === 0 ? (
                        <p className="text-xs text-muted-foreground p-3 italic">No entries.</p>
                      ) : (
                        <>
                          <div className="space-y-px">
                            {expandedEntries.slice(0, visibleCount).map((entry) => (
                              <div key={entry.key} className="flex items-center gap-2 px-3 py-1.5 hover:bg-secondary/30 transition-colors group/entry">
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-medium truncate">{entry.label}</p>
                                  {entry.sublabel && (
                                    <p className="text-[10px] text-muted-foreground truncate">{entry.sublabel}</p>
                                  )}
                                </div>
                                <span className="text-[10px] text-muted-foreground tabular-nums flex-shrink-0">{fmtBytes(entry.bytes)}</span>
                                <span className="text-[10px] text-muted-foreground/60 tabular-nums flex-shrink-0 w-8 text-right">{fmtExpiry(entry.expiresAt)}</span>
                                <button
                                  onClick={() => handleDeleteEntry(entry.key)}
                                  className="opacity-0 group-hover/entry:opacity-100 transition-opacity text-muted-foreground hover:text-destructive flex-shrink-0 cursor-pointer ml-1"
                                  aria-label="Delete cache entry"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                          {visibleCount < expandedEntries.length && (
                            <button
                              onClick={() => setVisibleCount((n) => n + 50)}
                              className="w-full py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-secondary/30 transition-colors border-t border-border/40 cursor-pointer"
                            >
                              Load more ({expandedEntries.length - visibleCount} remaining)
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            {totalEntries === 0 && (
              <p className="text-xs text-muted-foreground italic px-1">Cache is empty.</p>
            )}
          </div>

        </div>
      )}
    </section>
  )
}

function UpdatesSection() {
  const { status, version, percent, portable, check, install, openReleasePage } = useUpdater()
  const checking = status === 'checking'

  return (
    <section className="space-y-4">
      <SectionHeader icon={<RotateCw className="h-4 w-4" />} title="Updates" />
      <p className="text-sm text-muted-foreground">
        Cinemate checks for new versions on launch. You can also check manually below.
      </p>

      <div className="rounded-lg border border-border/50 bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">Current version</p>
            <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">v{__APP_VERSION__}</p>
          </div>

          {status === 'downloaded' ? (
            <Button size="sm" onClick={install} className="gap-1.5 flex-shrink-0">
              <RotateCw className="h-3.5 w-3.5" /> Restart &amp; Install
            </Button>
          ) : portable && status === 'available' ? (
            <Button size="sm" onClick={openReleasePage} className="gap-1.5 flex-shrink-0">
              <Download className="h-3.5 w-3.5" /> Download
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={check}
              disabled={checking || status === 'downloading'}
              className="gap-1.5 flex-shrink-0"
            >
              {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {checking ? 'Checking' : 'Check for Updates'}
            </Button>
          )}
        </div>

        {status === 'downloading' && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Downloading{version ? ` v${version}` : ''}</span>
              <span className="tabular-nums">{percent}%</span>
            </div>
            <Progress value={percent} />
          </div>
        )}

        {status === 'downloaded' && (
          <p className="text-xs text-success flex items-center gap-1.5">
            <CircleCheck className="h-3.5 w-3.5" /> Version {version} downloaded. Restart to install.
          </p>
        )}

        {portable && status === 'available' && (
          <p className="text-xs text-muted-foreground">
            Version {version} is available. The portable build can't update itself, so download the new
            version from the release page.
          </p>
        )}

        {status === 'up-to-date' && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <CircleCheck className="h-3.5 w-3.5 text-success" /> You're on the latest version.
          </p>
        )}

        {status === 'error' && (
          <p className="text-xs text-destructive flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5" /> Couldn't check for updates. Try again later.
          </p>
        )}
      </div>
    </section>
  )
}

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-primary">{icon}</span>
      <h2 className="font-semibold text-base">{title}</h2>
    </div>
  )
}

// Downscale an uploaded avatar to 256x256 and re-encode as JPEG so a 4 MB
// camera photo doesn't end up serialised into settings.json (and every export).
async function compressAvatar(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = reject
      i.src = objectUrl
    })
    const TARGET = 256
    const ratio = Math.min(1, TARGET / Math.max(img.width, img.height))
    const w = Math.max(1, Math.round(img.width * ratio))
    const h = Math.max(1, Math.round(img.height * ratio))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    ctx.drawImage(img, 0, 0, w, h)
    return canvas.toDataURL('image/jpeg', 0.85)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
