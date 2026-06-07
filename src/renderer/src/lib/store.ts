import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { LibraryEntry, WatchHistoryEntry, CustomList, AppSettings, MediaType, CollectionEntry, AccentColor, EpisodeProgress, WatchStatus, RatingSystem, TMDbSeason } from '../types'
import * as db from './db'
import { setApiKey, setTTL, getMovieBasic, getTVBasic } from './tmdb'
import { computeRuleItemIds, arraysEqualSet } from './rulesEngine'
import { DEFAULT_PAGINATION, ratingDateProxy, parseDateMs } from './utils'
import { MediaActions, buildLibEntry, latestPlayDate, type MediaTarget, type CatalogEpisode, type ListItemRef } from './mediaActions'
import { computeEntryStats } from './mediaStats'

// Debounce + cooldown for the "aired since watched" scan. Module-scoped so the
// Home and Library mount triggers share one guard: rapid navigation coalesces
// into a single trailing run, and the cooldown stops it re-scanning on every
// visit (episodes air on an hours/days scale, not per navigation).
const AIRED_SCAN_DEBOUNCE_MS = 800
const AIRED_SCAN_COOLDOWN_MS = 5 * 60 * 1000
let airedScanTimer: ReturnType<typeof setTimeout> | null = null
let airedScanLastRun = 0
let airedScanInFlight = false

function buildCollectionMediaIds(collection: CollectionEntry[]): Set<string> {
  const set = new Set<string>()
  for (const c of collection) if (c.mediaId) set.add(c.mediaId)
  return set
}

export interface AppStore {
  // Settings
  settings: AppSettings
  settingsLoaded: boolean

  // Library
  library: Record<string, LibraryEntry>
  libraryLoaded: boolean

  // Watch History
  watchHistory: WatchHistoryEntry[]
  historyLoaded: boolean

  // Lists
  lists: CustomList[]
  listsLoaded: boolean

  // Collection
  collection: CollectionEntry[]
  collectionMediaIds: Set<string>
  collectionLoaded: boolean

  // UI state
  sidebarOpen: boolean

  // Initializer
  init: () => Promise<void>

  // Settings actions
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>

  // Library actions
  setLibraryEntry: (entry: LibraryEntry) => Promise<void>
  removeLibraryEntry: (id: string) => Promise<void>
  removeFromWatchlist: (id: string) => Promise<void>
  getEntry: (id: string) => LibraryEntry | undefined

  // History actions
  addHistory: (entry: WatchHistoryEntry) => Promise<void>
  removeHistory: (id: string) => Promise<void>
  bulkRemoveHistory: (ids: string[]) => Promise<void>
  bulkSetHistoryRating: (ids: string[], rating: number | null) => Promise<number>
  bulkSetHistoryRewatch: (ids: string[], isRewatch: boolean) => Promise<void>
  bulkUpdateHistoryTags: (ids: string[], add: string[], remove: string[]) => Promise<void>
  getMediaHistory: (mediaId: string) => WatchHistoryEntry[]
  repairOrphans: () => Promise<void>

  // List actions
  setList: (list: CustomList) => Promise<void>
  removeList: (id: string) => Promise<void>
  recomputeAutoLists: () => Promise<void>

  // Collection actions
  setCollectionEntry: (entry: CollectionEntry) => Promise<void>
  removeCollectionEntry: (id: string) => Promise<void>
  isInCollection: (mediaId: string) => boolean

  // Computed
  getLibraryByStatus: (status: string) => LibraryEntry[]
  getLibraryArray: () => LibraryEntry[]

  // UI
  setSidebarOpen: (open: boolean) => void

  // Data management
  exportData: () => Promise<string>
  importData: (json: string) => Promise<void>
  clearData: () => Promise<void>
  convertAllRatings: (from: RatingSystem, to: RatingSystem) => Promise<void>
  changeMediaType: (entryId: string, newMediaType: MediaType) => Promise<void>

  // Unified media actions - the single source of truth, delegated to MediaActions.
  // Components call these instead of hand-rolling setLibraryEntry/addHistory flows.
  setStatus: (target: MediaTarget, status: WatchStatus) => Promise<void>
  toggleWatchlist: (target: MediaTarget) => Promise<'added' | 'removed'>
  dropMedia: (target: MediaTarget) => Promise<void>
  undropMedia: (target: MediaTarget) => Promise<void>
  reconcileMovieLog: (target: MediaTarget, histEntry: WatchHistoryEntry) => Promise<void>
  logEpisode: (target: MediaTarget, histEntry: WatchHistoryEntry, episodeCatalog?: CatalogEpisode[]) => Promise<void>
  reconcileCaughtUp: (target: MediaTarget) => Promise<void>
  // Debounced + cooldown-throttled scheduler for the "revive watched shows whose
  // next episode has aired" scan. Views call it freely on mount; it coalesces.
  reconcileAiredSinceWatched: () => void
  replayEpisode: (target: MediaTarget, epKey: string, epTitle: string) => Promise<void>
  removeEpisodePlays: (target: MediaTarget, epKey: string) => Promise<void>
  logAllEpisodes: (target: MediaTarget, seasons?: TMDbSeason[]) => Promise<void>
  startRewatch: (target: MediaTarget) => Promise<void>
  undoRewatch: (target: MediaTarget) => Promise<void>
  setOverallRating: (target: MediaTarget, value: number | null) => Promise<void>
  setReview: (target: MediaTarget, review: string) => Promise<void>
  setEpisodeRating: (target: MediaTarget, epKey: string, value: number | null) => Promise<void>
  setSeasonRating: (target: MediaTarget, seasonNumber: number, value: number | null) => Promise<void>
  setLogRating: (target: MediaTarget, episodeKey: string | undefined, value: number | null) => Promise<void>
  toggleListItem: (list: CustomList, item: ListItemRef) => Promise<'added' | 'removed'>
  createListWith: (name: string, item: ListItemRef) => Promise<CustomList>
  addItemsToList: (itemIds: string[], listId: string) => Promise<number>
  removeListItem: (list: CustomList, itemId: string) => Promise<void>
}

const DEFAULT_SETTINGS: AppSettings = {
  apiKey: null,
  username: 'Guest',
  avatar: null,
  theme: 'dark',
  ratingSystem: '10star',
  defaultMedia: 'all',
  spoilerProtection: { episodeTitles: false, episodeDescriptions: false, mediaDescriptions: false, ratings: false, actorEpisodeCounts: false, seasonDescriptions: false, seasonDescriptionRevealAt: 'started' },
  seasonDisplay: 'start_expanded',
  showSeasonMetadata: true,
  showSeasonOverview: true,
  timeFormat: '12h',
  logGroupBy: 'month',
  accentColor: 'purple',
  customTags: [],
  autoRemoveWatchlist: true,
  allowFutureDates: false,
  autoScrollToNextEpisode: true,
  markCaughtUpAsWatched: true,
  cacheTTL: { search: 1, detail: 7, genres: 30 },
  pagination: DEFAULT_PAGINATION,
  sidebarConfig: { order: [], hidden: [] },
  setupComplete: false,
  ratingTimestampsBackfilled: false,
}

export const useStore = create<AppStore>()(
  subscribeWithSelector((set, get) => {
    const media = new MediaActions(get, set)
    return {
    settings: DEFAULT_SETTINGS,
    settingsLoaded: false,
    library: {},
    libraryLoaded: false,
    watchHistory: [],
    historyLoaded: false,
    lists: [],
    listsLoaded: false,
    collection: [],
    collectionMediaIds: new Set<string>(),
    collectionLoaded: false,
    sidebarOpen: true,

    init: async () => {
      // Re-read every JSON file from disk. We deliberately DON'T reset the
      // slices to empty / flip the *Loaded flags back to false first: on a
      // re-init (e.g. after an import) that would unmount everything gated on
      // those flags - including the setup wizard, which would lose its local
      // step state and snap back to the welcome screen. db.initStorage() drops
      // its own in-memory state and reloads from disk, and each set() below
      // fully replaces its slice, so stale entries are cleared without the
      // reset; the previous data simply stays on screen until the fresh data
      // swaps in.
      await db.initStorage()

      // Load settings
      const savedSettings = await db.getAllSettings()
      const settings = {
        ...DEFAULT_SETTINGS,
        ...savedSettings,
        // Deep-merge nested objects so settings added in newer versions get
        // their defaults instead of being dropped by the shallow spread.
        spoilerProtection: { ...DEFAULT_SETTINGS.spoilerProtection, ...savedSettings.spoilerProtection },
      }
      setApiKey(settings.apiKey)
      setTTL(settings.cacheTTL)
      set({ settings, settingsLoaded: true })

      // Apply theme and accent color
      applyTheme(settings.theme)
      applyAccentColor(settings.accentColor)
      // Persist the resolved theme to meta so main process picks a matching
      // window background on next cold start (no white/dark flash).
      try { await window.electron.meta.setTheme(settings.theme) } catch { /* ignore */ }

      // Load library
      const libArray = await db.getAllLibrary()
      const library = Object.fromEntries(libArray.map((e) => [e.id, e]))
      set({ library, libraryLoaded: true })

      // Load history
      const watchHistory = await db.getWatchHistory()
      watchHistory.sort((a, b) => b.watchedAt - a.watchedAt)
      set({ watchHistory, historyLoaded: true })

      // One-time migration: stamp rating timestamps (userRatingAt /
      // EpisodeProgress.ratedAt) onto ratings made before timestamps were tracked,
      // so the Stats "Average Rating Over Time" chart can bucket them by date rated.
      // We don't know when an old rating was actually given, so approximate it by
      // the most recent watch of that media/episode (then the entry's own watch
      // marker, then addedDate). New ratings are stamped at the write site (rating
      // actions + import), so this only needs to run once for pre-existing data; the
      // persisted flag makes every later load skip the scan entirely.
      if (!settings.ratingTimestampsBackfilled) {
        const lastWatchByMedia: Record<string, number> = {}
        const lastWatchByEp: Record<string, number> = {}
        for (const h of watchHistory) {
          if (h.watchedAt > (lastWatchByMedia[h.mediaId] ?? -Infinity)) lastWatchByMedia[h.mediaId] = h.watchedAt
          if (h.episodeKey) {
            const k = `${h.mediaId}::${h.episodeKey}`
            if (h.watchedAt > (lastWatchByEp[k] ?? -Infinity)) lastWatchByEp[k] = h.watchedAt
          }
        }
        const patched: LibraryEntry[] = []
        for (const e of Object.values(library)) {
          let next = e
          if (e.userRating != null && e.userRatingAt == null) {
            next = { ...next, userRatingAt: lastWatchByMedia[e.id] ?? ratingDateProxy(e) }
          }
          if (e.tvProgress) {
            let prog: Record<string, EpisodeProgress> | null = null
            for (const [epKey, p] of Object.entries(e.tvProgress)) {
              if (p.rating != null && p.ratedAt == null) {
                const t = lastWatchByEp[`${e.id}::${epKey}`]
                  ?? parseDateMs(p.watchedAt)
                  ?? lastWatchByMedia[e.id]
                  ?? ratingDateProxy(e)
                prog = prog ?? { ...e.tvProgress }
                prog[epKey] = { ...p, ratedAt: t }
              }
            }
            if (prog) next = { ...next, tvProgress: prog }
          }
          if (e.seasonRatings) {
            let sr: Record<number, number | null> | null = null
            for (const [snStr, v] of Object.entries(e.seasonRatings)) {
              const sn = Number(snStr)
              if (v != null && e.seasonRatedAt?.[sn] == null) {
                sr = sr ?? { ...(e.seasonRatedAt ?? {}) }
                sr[sn] = lastWatchByMedia[e.id] ?? ratingDateProxy(e)
              }
            }
            if (sr) next = { ...next, seasonRatedAt: sr }
          }
          if (next !== e) patched.push(next)
        }
        if (patched.length > 0) {
          await db.bulkSetLibraryEntries(patched)
          set((s) => {
            const lib = { ...s.library }
            for (const e of patched) lib[e.id] = e
            return { library: lib }
          })
        }
        await db.setSetting('ratingTimestampsBackfilled', true)
        set((s) => ({ settings: { ...s.settings, ratingTimestampsBackfilled: true } }))
      }

      // Load lists
      const lists = await db.getAllLists()
      set({ lists, listsLoaded: true })

      // Load collection
      const collection = await db.getAllCollection()
      set({ collection, collectionMediaIds: buildCollectionMediaIds(collection), collectionLoaded: true })

      // Recompute any rule-based lists in case underlying data changed externally
      await get().recomputeAutoLists()

      // Silently restore library entries for any orphaned history records
      repairOrphanedHistory(get, set).catch(() => { /* best-effort */ })

      // Bring caught-up shows back to in_progress once a new episode has aired, so
      // they resurface in Continue Watching rather than staying buried in Watched.
      // Goes through the debounced scheduler so the landing view's mount trigger
      // dedupes against this launch scan instead of running it twice.
      get().reconcileAiredSinceWatched()
    },

    updateSettings: async (patch) => {
      const settings = { ...get().settings, ...patch }
      set({ settings })
      for (const [key, value] of Object.entries(patch)) {
        await db.setSetting(key as keyof AppSettings, value as never)
      }
      if (patch.apiKey !== undefined) setApiKey(patch.apiKey)
      if (patch.cacheTTL !== undefined) setTTL(patch.cacheTTL)
      if (patch.theme !== undefined) {
        applyTheme(patch.theme)
        try { await window.electron.meta.setTheme(patch.theme) } catch { /* ignore */ }
      }
      if (patch.accentColor !== undefined) applyAccentColor(patch.accentColor)
    },

    setLibraryEntry: async (entry) => {
      // Maintain prevStatus centrally so every "add to watchlist" path gets it for free:
      // when an entry enters the watchlist, stamp the status it's leaving so
      // removeFromWatchlist can restore it exactly. It's only meaningful while on the
      // watchlist, so clear it on any other status. Re-saving an already-watchlisted entry
      // leaves the recorded prevStatus untouched.
      const prev = get().library[entry.id]
      let finalEntry = entry
      if (entry.status === 'watchlist') {
        if (prev && prev.status !== 'watchlist') finalEntry = { ...entry, prevStatus: prev.status }
      } else if (entry.prevStatus !== undefined) {
        finalEntry = { ...entry, prevStatus: undefined }
      }
      // Reflect the change in memory first so the UI updates instantly (e.g. the
      // rating widget can close and show the new value without waiting). The disk
      // write (debounced/atomic) and the auto-list recompute then follow in the
      // background rather than blocking the render.
      set((s) => ({ library: { ...s.library, [finalEntry.id]: finalEntry } }))
      await db.setLibraryEntry(finalEntry)
      // Refresh the denormalised runtime totals in the background so the status
      // change / episode log applies instantly and the stats fill in a beat later.
      trackRuntimeStats(finalEntry.id, prev, get, set)
      await get().recomputeAutoLists()
    },

    removeLibraryEntry: async (id) => {
      await db.removeLibraryEntry(id)
      set((s) => {
        const lib = { ...s.library }
        delete lib[id]
        return { library: lib }
      })
      await get().recomputeAutoLists()
    },

    // Remove an entry from the watchlist. Watchlist membership is just
    // `status === 'watchlist'`, so this is a status change, never a blanket delete:
    // if the entry carries any user data (plays, episode progress, rating, review,
    // season ratings, list membership) we keep it and demote to the status its data
    // implies. Only a bare watchlist item - nothing to lose - is deleted. Every
    // "remove from watchlist" entry point routes through here so they behave the same.
    removeFromWatchlist: async (id) => {
      const entry = get().library[id]
      if (!entry || entry.status !== 'watchlist') return

      const plays = get().watchHistory.filter((h) => h.mediaId === id)
      const hasProgress = !!entry.tvProgress && Object.keys(entry.tvProgress).length > 0
      const hasSeasonRatings = Object.values(entry.seasonRatings ?? {}).some((v) => v != null)
      const hasData = plays.length > 0 || hasProgress || hasSeasonRatings
        || entry.userRating != null || !!entry.review || entry.listIds.length > 0

      if (!hasData) {
        // Bare watchlist item - drop it (no plays means nothing is orphaned).
        await get().removeLibraryEntry(id)
        return
      }

      // Restore the status the entry had before it entered the watchlist (prevStatus), so
      // watched/in_progress/dropped → watchlist → remove round-trips exactly. If none was
      // recorded (imported data, or added straight to the watchlist) fall back to deriving
      // from the data: we can't verify "fully watched" for a show here - that needs the
      // TMDb episode list, which only the detail view has - so a show with episode progress
      // restores as in_progress rather than fabricating a completion that would pollute
      // stats and watched-based lists. Movies (binary) and episode-less shows go to watched.
      let status: WatchStatus
      if (entry.prevStatus && entry.prevStatus !== 'watchlist') {
        status = entry.prevStatus
      } else if (entry.mediaType !== 'movie' && hasProgress) {
        status = 'in_progress'
      } else {
        status = 'watched'
      }

      let watchedDate = entry.watchedDate
      if (status === 'watched' && !watchedDate && plays.length > 0) {
        watchedDate = plays.reduce((a, b) => (a.watchedAt > b.watchedAt ? a : b)).watchedAtDT
      }

      // setLibraryEntry clears prevStatus since the new status isn't 'watchlist'.
      await get().setLibraryEntry({ ...entry, status, watchedDate })
    },

    getEntry: (id) => get().library[id],

    addHistory: async (entry) => {
      await db.addWatchHistoryEntry(entry)
      set((s) => ({
        watchHistory: [entry, ...s.watchHistory.filter((h) => h.id !== entry.id)].sort((a, b) => b.watchedAt - a.watchedAt)
      }))
      // Mirror play data onto the library entry so the two never diverge: a
      // watched title's watchedDate tracks its most recent play, so a rewatch (or
      // an edited play date) moves the date forward. Ratings are never carried
      // from a play - a play has none; the modal writes the canonical rating
      // (userRating / tvProgress) directly.
      const lib = get().library[entry.mediaId]
      if (lib) {
        let updated = lib
        if (lib.status === 'watched') {
          const latest = latestPlayDate(get().watchHistory, entry.mediaId)
          if (latest && latest !== updated.watchedDate) updated = { ...updated, watchedDate: latest }
        }
        if (updated !== lib) {
          await db.setLibraryEntry(updated)
          set((s) => ({ library: { ...s.library, [updated.id]: updated } }))
        }
      }
      await get().recomputeAutoLists()
      // Self-heal: if this mediaId has no library entry, fetch TMDb metadata
      // and create one. Avoids the watch log rendering raw `movie:{id}` ids.
      if (!get().library[entry.mediaId]) {
        repairOrphanedHistory(get, set).catch(() => { /* best-effort */ })
      }
    },

    repairOrphans: () => repairOrphanedHistory(get, set),

    removeHistory: async (id) => {
      const entry = get().watchHistory.find((h) => h.id === id)
      await db.removeWatchHistoryEntry(id)
      set((s) => ({ watchHistory: s.watchHistory.filter((h) => h.id !== id) }))
      if (entry) {
        const removedEpKeys = entry.episodeKey ? new Set([entry.episodeKey]) : new Set<string>()
        await syncStatusAfterRemoval(entry.mediaId, removedEpKeys, get, set)
      }
      await get().recomputeAutoLists()
    },

    bulkRemoveHistory: async (ids) => {
      const idSet = new Set(ids)
      const removed = get().watchHistory.filter((h) => idSet.has(h.id))
      await db.bulkRemoveWatchHistoryEntries(ids)
      set((s) => ({ watchHistory: s.watchHistory.filter((h) => !idSet.has(h.id)) }))
      // Group the removed plays' episode keys by media so each show only re-derives
      // the markers of episodes that actually lost a play.
      const removedEpKeysByMedia = new Map<string, Set<string>>()
      for (const h of removed) {
        const set = removedEpKeysByMedia.get(h.mediaId) ?? new Set<string>()
        if (h.episodeKey) set.add(h.episodeKey)
        removedEpKeysByMedia.set(h.mediaId, set)
      }
      for (const [mediaId, epKeys] of removedEpKeysByMedia) {
        await syncStatusAfterRemoval(mediaId, epKeys, get, set)
      }
      await get().recomputeAutoLists()
    },

    // Set the canonical rating for the things a set of plays refer to. There is no
    // per-play rating: a movie/show-level play maps to the title's overall rating
    // (userRating); an episode play maps to that episode's rating
    // (tvProgress[episodeKey]). Plays themselves are never written. Returns how many
    // selected plays were actually rated (their library entry exists) so the caller
    // can report honestly rather than claiming success for plays it couldn't touch.
    bulkSetHistoryRating: async (ids, rating) => {
      const idSet = new Set(ids)
      const { watchHistory, library } = get()
      const libPatches: Record<string, LibraryEntry> = {}
      const ratedAt = rating != null ? Date.now() : null
      let applied = 0
      const orphans = new Set<string>()
      for (const h of watchHistory) {
        if (!idSet.has(h.id)) continue
        const lib = libPatches[h.mediaId] ?? library[h.mediaId]
        if (!lib) { orphans.add(h.mediaId); continue }
        if (h.episodeKey) {
          // The library entry exists; the episode may simply lack a progress record
          // (e.g. a play whose progress was cleared). Materialize it from the play so
          // the rating actually lands and the play counts as rated - it is NOT an
          // orphan, so it must not be reported as "not in your library".
          const existingProg = lib.tvProgress?.[h.episodeKey]
          const prog = existingProg ?? { watchedAt: h.watchedAtDT, note: '', rating: null }
          applied++
          if (prog.rating !== rating || (existingProg == null && rating != null)) {
            libPatches[h.mediaId] = {
              ...lib,
              tvProgress: { ...lib.tvProgress, [h.episodeKey]: { ...prog, rating, ratedAt } },
            }
          }
        } else {
          applied++
          if (lib.userRating !== rating) {
            libPatches[h.mediaId] = { ...lib, userRating: rating, userRatingAt: ratedAt }
          }
        }
      }
      const libArr = Object.values(libPatches)
      if (libArr.length > 0) {
        await db.bulkSetLibraryEntries(libArr)
        set((s) => ({ library: { ...s.library, ...libPatches } }))
        await get().recomputeAutoLists()
      }
      // Heal any orphaned titles (no library entry) at the source so they become
      // rateable next time; best-effort, runs in the background.
      if (orphans.size > 0) get().repairOrphans().catch(() => { /* best-effort */ })
      return applied
    },

    bulkSetHistoryRewatch: async (ids, isRewatch) => {
      const idSet = new Set(ids)
      const updated = get().watchHistory
        .filter((h) => idSet.has(h.id) && !!h.isRewatch !== isRewatch)
        .map((h) => ({ ...h, isRewatch: isRewatch || undefined }))
      if (updated.length === 0) return
      await db.bulkSetHistoryEntries(updated)
      set((s) => {
        const m = new Map(updated.map((h) => [h.id, h]))
        return { watchHistory: s.watchHistory.map((h) => m.get(h.id) ?? h) }
      })
    },

    // Add and/or remove tags across a set of plays. Tags are normalized (trimmed,
    // lowercased) to match how the log modal stores them.
    bulkUpdateHistoryTags: async (ids, add, remove) => {
      const idSet = new Set(ids)
      const addList = add.map((t) => t.trim().toLowerCase()).filter(Boolean)
      const removeSet = new Set(remove.map((t) => t.trim().toLowerCase()).filter(Boolean))
      if (addList.length === 0 && removeSet.size === 0) return
      const updated: WatchHistoryEntry[] = []
      for (const h of get().watchHistory) {
        if (!idSet.has(h.id)) continue
        const next = new Set(h.tags ?? [])
        const before = next.size
        for (const t of removeSet) next.delete(t)
        for (const t of addList) next.add(t)
        // Skip entries whose tag set is unchanged so their row identity is preserved.
        if (next.size === before && [...next].every((t) => (h.tags ?? []).includes(t))) continue
        const tags = Array.from(next)
        updated.push({ ...h, tags: tags.length > 0 ? tags : undefined })
      }
      if (updated.length === 0) return
      await db.bulkSetHistoryEntries(updated)
      set((s) => {
        const m = new Map(updated.map((h) => [h.id, h]))
        return { watchHistory: s.watchHistory.map((h) => m.get(h.id) ?? h) }
      })
    },

    getMediaHistory: (mediaId) => get().watchHistory.filter((h) => h.mediaId === mediaId),

    setList: async (list) => {
      // For rules-enabled lists, only recompute itemIds when the rules content
      // itself changed vs the stored list. Recomputing on every edit (rename,
      // description tweak) would wipe any items the user added manually after
      // the last recompute and clobber pins added by changeMediaType or import.
      const existing = get().lists.find((l) => l.id === list.id)
      let finalList = list
      if (list.rules?.enabled) {
        const rulesChanged = !existing
          || !existing.rules?.enabled
          || JSON.stringify(existing.rules) !== JSON.stringify(list.rules)
        if (rulesChanged) {
          finalList = { ...list, itemIds: computeRuleItemIds(get().library, get().watchHistory, list.rules) }
        }
      }
      await db.setList(finalList)
      set((s) => {
        const lists = s.lists.filter((l) => l.id !== finalList.id)
        return { lists: [...lists, finalList] }
      })
    },

    removeList: async (id) => {
      await db.removeList(id)
      set((s) => ({ lists: s.lists.filter((l) => l.id !== id) }))
    },

    recomputeAutoLists: async () => {
      const { lists, library, watchHistory } = get()
      const updates: CustomList[] = []
      for (const list of lists) {
        if (!list.rules?.enabled) continue
        const ids = computeRuleItemIds(library, watchHistory, list.rules)
        if (!arraysEqualSet(ids, list.itemIds)) {
          updates.push({ ...list, itemIds: ids })
        }
      }
      if (updates.length === 0) return
      for (const list of updates) await db.setList(list)
      set((s) => {
        const m = new Map(updates.map((u) => [u.id, u]))
        return { lists: s.lists.map((l) => m.get(l.id) ?? l) }
      })
    },

    setCollectionEntry: async (entry) => {
      await db.setCollectionEntry(entry)
      set((s) => {
        const col = s.collection.filter((c) => c.id !== entry.id)
        const collection = [...col, entry]
        return { collection, collectionMediaIds: buildCollectionMediaIds(collection) }
      })
    },

    removeCollectionEntry: async (id) => {
      await db.removeCollectionEntry(id)
      set((s) => {
        const collection = s.collection.filter((c) => c.id !== id)
        return { collection, collectionMediaIds: buildCollectionMediaIds(collection) }
      })
    },

    isInCollection: (mediaId) => get().collectionMediaIds.has(mediaId),

    getLibraryByStatus: (status) => {
      return Object.values(get().library).filter((e) => e.status === status)
    },

    getLibraryArray: () => Object.values(get().library),

    setSidebarOpen: (open) => set({ sidebarOpen: open }),

    exportData: async () => {
      const data = await db.exportAll()
      return JSON.stringify(data, null, 2)
    },

    importData: async (json) => {
      const data = JSON.parse(json)
      await db.importAll(data)
      await get().init()
    },

    clearData: async () => {
      await db.clearAllUserData()
      set({ library: {}, watchHistory: [], lists: [], collection: [], collectionMediaIds: new Set<string>() })
    },

    convertAllRatings: async (from, to) => {
      if (from === to) return
      const convert = (r: number | null): number | null => {
        if (r == null) return null
        if (from === '5star' && to === '10star') return Math.round(r * 2)
        if (from === '10star' && to === '5star') return Math.round(r / 2 * 2) / 2
        return r
      }
      // All ratings live on the library entry (overall, per-episode, per-season);
      // plays carry none, so only the library is converted.
      const { library } = get()
      const updatedLibrary = Object.values(library).map((e) => {
        const newProgress = e.tvProgress
          ? Object.fromEntries(
              Object.entries(e.tvProgress).map(([k, p]) => [k, { ...p, rating: convert(p.rating) }])
            )
          : null
        const newSeasonRatings = Object.fromEntries(
          Object.entries(e.seasonRatings ?? {}).map(([k, v]) => [k, convert(v as number | null)])
        )
        return { ...e, userRating: convert(e.userRating), tvProgress: newProgress, seasonRatings: newSeasonRatings }
      })
      await db.bulkSetLibraryEntries(updatedLibrary)
      set({ library: Object.fromEntries(updatedLibrary.map((e) => [e.id, e])) })
      await get().recomputeAutoLists()
    },

    changeMediaType: async (entryId, newMediaType) => {
      const entry = get().library[entryId]
      if (!entry || entry.mediaType === newMediaType) return

      const newId = `${newMediaType}:${entry.tmdbId}`

      // Same key: just update the mediaType field in place
      if (entryId === newId) {
        const updated = { ...entry, mediaType: newMediaType }
        await db.setLibraryEntry(updated)
        set(s => ({ library: { ...s.library, [updated.id]: updated } }))
        return
      }

      const newEntry: LibraryEntry = { ...entry, id: newId, mediaType: newMediaType }

      // Remap history entries that reference the old id
      const allHistory = get().watchHistory
      const affected = allHistory.filter(h => h.mediaId === entryId)
      const remapped = affected.map(h => ({ ...h, mediaId: newId }))

      // Remap list item references (ids + any standalone itemMeta keyed by the old id)
      const allLists = get().lists
      const prefix = entryId + '::'
      const updatedLists = allLists
        .filter(l => l.itemIds.some(id => id === entryId || id.startsWith(prefix)))
        .map(l => {
          const itemIds = l.itemIds.map(id => {
            if (id === entryId) return newId
            if (id.startsWith(prefix)) return newId + '::' + id.slice(prefix.length)
            return id
          })
          let itemMeta = l.itemMeta
          if (itemMeta?.[entryId]) {
            const { [entryId]: moved, ...rest } = itemMeta
            itemMeta = { ...rest, [newId]: { ...moved, mediaType: newMediaType } }
          }
          return { ...l, itemIds, itemMeta }
        })

      await db.setLibraryEntry(newEntry)
      await db.removeLibraryEntry(entryId)
      if (remapped.length > 0) {
        await db.bulkRemoveWatchHistoryEntries(affected.map(h => h.id))
        await db.bulkSetHistoryEntries(remapped)
      }
      for (const l of updatedLists) await db.setList(l)

      set(s => {
        const lib = { ...s.library }
        delete lib[entryId]
        lib[newId] = newEntry

        const affectedIds = new Set(affected.map(h => h.id))
        const newHistory = s.watchHistory
          .filter(h => !affectedIds.has(h.id))
          .concat(remapped)
          .sort((a, b) => b.watchedAt - a.watchedAt)

        const updatedListIds = new Set(updatedLists.map(l => l.id))
        const newLists = s.lists
          .filter(l => !updatedListIds.has(l.id))
          .concat(updatedLists)

        return { library: lib, watchHistory: newHistory, lists: newLists }
      })
      await get().recomputeAutoLists()
    },

    // ── Unified media actions (delegate to the MediaActions controller) ──────────
    setStatus: (target, status) => media.setStatus(target, status),
    toggleWatchlist: (target) => media.toggleWatchlist(target),
    dropMedia: (target) => media.drop(target),
    undropMedia: (target) => media.undrop(target),
    reconcileMovieLog: (target, histEntry) => media.reconcileMovieLog(target, histEntry),
    logEpisode: (target, histEntry, episodeCatalog) => media.logEpisode(target, histEntry, episodeCatalog),
    reconcileCaughtUp: (target) => media.reconcileCaughtUp(target),
    reconcileAiredSinceWatched: () => {
      if (airedScanTimer) clearTimeout(airedScanTimer)
      airedScanTimer = setTimeout(() => {
        airedScanTimer = null
        // Skip if one is running or one finished within the cooldown window.
        if (airedScanInFlight || Date.now() - airedScanLastRun < AIRED_SCAN_COOLDOWN_MS) return
        airedScanInFlight = true
        media.reconcileAiredSinceWatched()
          .catch(() => { /* best-effort */ })
          .finally(() => { airedScanInFlight = false; airedScanLastRun = Date.now() })
      }, AIRED_SCAN_DEBOUNCE_MS)
    },
    replayEpisode: (target, epKey, epTitle) => media.replayEpisode(target, epKey, epTitle),
    removeEpisodePlays: (target, epKey) => media.removeEpisodePlays(target, epKey),
    logAllEpisodes: (target, seasons) => media.logAllEpisodes(target, seasons),
    startRewatch: (target) => media.startRewatch(target),
    undoRewatch: (target) => media.undoRewatch(target),
    setOverallRating: (target, value) => media.setOverallRating(target, value),
    setReview: (target, review) => media.setReview(target, review),
    setEpisodeRating: (target, epKey, value) => media.setEpisodeRating(target, epKey, value),
    setSeasonRating: (target, seasonNumber, value) => media.setSeasonRating(target, seasonNumber, value),
    setLogRating: (target, episodeKey, value) => media.setLogRating(target, episodeKey, value),
    toggleListItem: (list, item) => media.toggleListItem(list, item),
    createListWith: (name, item) => media.createListWith(name, item),
    addItemsToList: (itemIds, listId) => media.addItemsToList(itemIds, listId),
    removeListItem: (list, itemId) => media.removeListItem(list, itemId),
    }
  })
)

// After plays are removed for a media id, sync its library status. Dispatches to the
// movie or TV/anime variant based on the entry's type. Called with watchHistory already
// updated in state so get() sees the new values.
async function syncStatusAfterRemoval(
  mediaId: string,
  removedEpKeys: Set<string>,
  get: () => AppStore,
  set: (fn: (s: AppStore) => Partial<AppStore>) => void
) {
  const libEntry = get().library[mediaId]
  if (!libEntry) return
  if (libEntry.mediaType === 'movie') {
    await syncMovieStatus(mediaId, get, set)
  } else {
    await syncTvProgress(mediaId, removedEpKeys, get, set)
  }
}

// Refresh an entry's denormalised runtime totals after a watch-state write, then
// patch it back in. Runs in the background so the originating action (status change,
// episode log, play removal) never waits on a TMDb fetch. Gated to the fields that
// affect runtime - movie status, show episode progress, or the stored runtime - so
// rating / review / list edits don't refetch. A no-op when nothing relevant changed;
// on a slow first fetch the totals simply land a moment after the action.
function trackRuntimeStats(
  entryId: string,
  prev: LibraryEntry | undefined,
  get: () => AppStore,
  set: (fn: (s: AppStore) => Partial<AppStore>) => void
): void {
  const entry = get().library[entryId]
  if (!entry) return
  const unchanged = prev?.runtimeStats != null && prev.episodeStats != null
    && prev.runtime === entry.runtime
    && (entry.mediaType === 'movie' ? prev.status === entry.status : prev.tvProgress === entry.tvProgress)
  if (unchanged) return
  void (async () => {
    const { runtime: runtimeStats, episodes: episodeStats } = await computeEntryStats(entry)
    // Bail if a newer write replaced (or removed) the entry while we were fetching -
    // that write starts its own refresh, so we'd only clobber fresher data.
    const cur = get().library[entryId]
    if (cur !== entry) return
    // A zero runtime total means the fetch failed or TMDb had no runtime data: leave the
    // entry untracked so a later write retries, rather than persisting bogus zeros that
    // would stick (the equality guard below treats {0,0} as "tracked") and sort wrong.
    if (runtimeStats.total <= 0) return
    if (cur.runtimeStats && cur.episodeStats
      && cur.runtimeStats.total === runtimeStats.total && cur.runtimeStats.watched === runtimeStats.watched
      && cur.episodeStats.total === episodeStats.total && cur.episodeStats.watched === episodeStats.watched) return
    const updated: LibraryEntry = { ...cur, runtimeStats, episodeStats }
    await db.setLibraryEntry(updated)
    set((s) => ({ library: { ...s.library, [entryId]: updated } }))
  })()
}

// Sync a movie's library status after its plays are removed. A movie's "watched" state is
// tied to having at least one play in history, so once the last play is gone it should no
// longer count as watched. Mirrors the zero-plays branch of syncTvProgress.
async function syncMovieStatus(
  mediaId: string,
  get: () => AppStore,
  set: (fn: (s: AppStore) => Partial<AppStore>) => void
) {
  const libEntry = get().library[mediaId]
  if (!libEntry) return

  // Plays remain: nothing to demote, but keep watchedDate pinned to the most
  // recent surviving play - removing the latest play should move the date back.
  if (get().watchHistory.some((h) => h.mediaId === mediaId)) {
    if (libEntry.status === 'watched') {
      const latest = latestPlayDate(get().watchHistory, mediaId)
      if (latest && latest !== libEntry.watchedDate) {
        const updated: LibraryEntry = { ...libEntry, watchedDate: latest }
        await db.setLibraryEntry(updated)
        set((s) => ({ library: { ...s.library, [mediaId]: updated } }))
      }
    }
    return
  }
  if (libEntry.status !== 'watched' && libEntry.status !== 'in_progress') return

  const hasUserData = !!libEntry.review || libEntry.userRating != null || libEntry.listIds.length > 0
  if (!hasUserData) {
    // No plays and no user data - drop the entry entirely
    await db.removeLibraryEntry(libEntry.id)
    set((s) => {
      const lib = { ...s.library }
      delete lib[libEntry.id]
      return { library: lib }
    })
    return
  }

  // Preserve the user's data but revert to watchlist
  const updated: LibraryEntry = { ...libEntry, status: 'watchlist' as WatchStatus, watchedDate: null }
  await db.setLibraryEntry(updated)
  set((s) => ({ library: { ...s.library, [libEntry.id]: updated } }))
  trackRuntimeStats(libEntry.id, libEntry, get, set)
}

// Sync tvProgress and library status after history entries are removed for a TV/anime entry.
// Called with watchHistory already updated in state so get() sees the new values.
// `removedEpKeys` are the episode keys that actually lost a play; only those episodes
// re-derive their watched marker, so untouched episodes keep their state untouched.
async function syncTvProgress(
  mediaId: string,
  removedEpKeys: Set<string>,
  get: () => AppStore,
  set: (fn: (s: AppStore) => Partial<AppStore>) => void
) {
  const libEntry = get().library[mediaId]
  if (!libEntry?.tvProgress || Object.keys(libEntry.tvProgress).length === 0) return

  // For each affected episode, find its most recent play in the *current* watch-through.
  // Plays before the active rewatch boundary belong to a prior run and don't mark current
  // progress - this is what stops a removed rewatch play from falling back onto an older,
  // pre-rewatch play of the same episode.
  const boundary = libEntry.rewatchStartedAt ?? 0
  const latestPlayDT: Record<string, string> = {}
  const latestPlayMs: Record<string, number> = {}
  for (const h of get().watchHistory) {
    if (h.mediaId !== mediaId || !h.episodeKey || !removedEpKeys.has(h.episodeKey)) continue
    if (h.watchedAt < boundary) continue
    if (!(h.episodeKey in latestPlayMs) || h.watchedAt > latestPlayMs[h.episodeKey]) {
      latestPlayMs[h.episodeKey] = h.watchedAt
      latestPlayDT[h.episodeKey] = h.watchedAtDT
    }
  }

  // Rebuild progress: re-point each affected episode's marker at its latest current-run
  // play (or unwatched when none remains). An episode with no remaining play but a
  // surviving rating/note is kept unwatched - a rewatch preserves that record.
  const newProgress: Record<string, EpisodeProgress> = {}
  let changed = false
  for (const [key, prog] of Object.entries(libEntry.tvProgress)) {
    if (!removedEpKeys.has(key)) { newProgress[key] = prog; continue }
    const watchedAt = latestPlayDT[key] ?? null
    const hasMeta = prog.rating != null || (prog.note?.length ?? 0) > 0 || prog.runtime != null
    if (watchedAt == null && !hasMeta) { changed = true; continue }   // drop an empty key
    if (prog.watchedAt === watchedAt) { newProgress[key] = prog }
    else { newProgress[key] = { ...prog, watchedAt }; changed = true }
  }

  if (!changed) return

  const watchedCount = Object.values(newProgress).filter((p) => p.watchedAt != null).length
  const anyPlaysRemain = get().watchHistory.some((h) => h.mediaId === mediaId && h.episodeKey)

  if (watchedCount === 0 && !anyPlaysRemain) {
    // No current progress and no plays anywhere - remove entry or revert to watchlist.
    const hasUserData = !!libEntry.review || libEntry.userRating != null || libEntry.listIds.length > 0
    if (!hasUserData && (libEntry.status === 'watched' || libEntry.status === 'in_progress')) {
      await db.removeLibraryEntry(libEntry.id)
      set((s) => {
        const lib = { ...s.library }
        delete lib[libEntry.id]
        return { library: lib }
      })
      return
    }
    const updated: LibraryEntry = { ...libEntry, status: 'watchlist' as WatchStatus, tvProgress: null }
    await db.setLibraryEntry(updated)
    set((s) => ({ library: { ...s.library, [libEntry.id]: updated } }))
    trackRuntimeStats(libEntry.id, libEntry, get, set)
    return
  }

  // Demote a fully-watched show only when an episode actually became unwatched (a play
  // shifting an episode's date back keeps it watched). Mid-rewatch shows stay in_progress.
  const prevWatchedCount = Object.values(libEntry.tvProgress).filter((p) => p.watchedAt != null).length
  const newStatus: WatchStatus =
    libEntry.status === 'watched' && watchedCount < prevWatchedCount ? 'in_progress' : libEntry.status
  const updated: LibraryEntry = { ...libEntry, status: newStatus, tvProgress: newProgress }
  await db.setLibraryEntry(updated)
  set((s) => ({ library: { ...s.library, [libEntry.id]: updated } }))
  trackRuntimeStats(libEntry.id, libEntry, get, set)
}

async function repairOrphanedHistory(
  get: () => AppStore,
  set: (fn: (s: AppStore) => Partial<AppStore>) => void
): Promise<void> {
  const { library, watchHistory, settings } = get()
  if (!settings.apiKey) return

  const orphanedIds = new Set<string>()
  for (const h of watchHistory) {
    if (!library[h.mediaId]) orphanedIds.add(h.mediaId)
  }
  if (orphanedIds.size === 0) return

  const newEntries: LibraryEntry[] = []
  for (const mediaId of orphanedIds) {
    const parts = mediaId.split(':')
    if (parts.length !== 2) continue
    const [mediaType, rawId] = parts
    const tmdbId = Number(rawId)
    if (!tmdbId || (mediaType !== 'movie' && mediaType !== 'tv' && mediaType !== 'anime')) continue

    try {
      let built: LibraryEntry
      if (mediaType === 'movie') {
        const data = await getMovieBasic(tmdbId)
        const year = data.release_date ? new Date(data.release_date).getFullYear() : null
        built = buildLibEntry(
          tmdbId, 'movie', data.title, data.poster_path, data.backdrop_path,
          year, 'watched', data.genres.map(g => g.id), data.runtime
        )
      } else {
        const data = await getTVBasic(tmdbId)
        const year = data.first_air_date ? new Date(data.first_air_date).getFullYear() : null
        const avgRuntime = data.episode_run_time?.[0] ?? null
        built = buildLibEntry(
          tmdbId, mediaType as 'tv' | 'anime', data.name, data.poster_path, data.backdrop_path,
          year, 'watched', data.genres.map(g => g.id), avgRuntime
        )
      }
      // A title rated before it existed in the library kept that rating only on the
      // play (legacy data: plays no longer carry ratings). Recover it as the title's
      // overall rating, stamped at the play's watch time, so the orphan repair that
      // creates the entry doesn't silently drop a pre-upgrade rating.
      const legacyRatedPlay = watchHistory
        .filter((h) => h.mediaId === mediaId && !h.episodeKey && (h as { rating?: number | null }).rating != null)
        .sort((a, b) => b.watchedAt - a.watchedAt)[0]
      if (legacyRatedPlay) {
        built.userRating = (legacyRatedPlay as { rating?: number | null }).rating ?? null
        built.userRatingAt = legacyRatedPlay.watchedAt
      }
      newEntries.push(built)
    } catch {
      // Skip entries that can't be resolved
    }
  }

  if (newEntries.length === 0) return
  // A library entry may have been created (e.g. by logEpisode running right after
  // addHistory) while we were fetching TMDb data. That entry is authoritative and
  // already carries the play's tvProgress, so skip it - re-snapshot here so this
  // best-effort heal never clobbers a fresher write.
  const liveLib = get().library
  const toAdd = newEntries.filter((entry) => !liveLib[entry.id])
  if (toAdd.length === 0) return
  for (const entry of toAdd) await db.setLibraryEntry(entry)
  set((s) => {
    const lib = { ...s.library }
    for (const entry of toAdd) {
      if (lib[entry.id]) continue
      lib[entry.id] = entry
    }
    return { library: lib }
  })
}

const ACCENT_COLORS: Record<string, { primary: string; foreground: string }> = {
  purple: { primary: '262 33% 66%', foreground: '228 22% 12%' },
  blue:   { primary: '210 72% 62%', foreground: '228 22% 12%' },
  green:  { primary: '152 58% 52%', foreground: '228 22% 12%' },
  orange: { primary: '27 85% 62%',  foreground: '228 22% 12%' },
  pink:   { primary: '330 62% 65%', foreground: '228 22% 12%' },
  red:    { primary: '0 60% 62%',   foreground: '228 22% 12%' },
}

function applyAccentColor(color: AccentColor): void {
  const root = document.documentElement
  const accent = ACCENT_COLORS[color] ?? ACCENT_COLORS.purple
  root.style.setProperty('--primary', accent.primary)
  root.style.setProperty('--accent', accent.primary)
  root.style.setProperty('--ring', accent.primary)
  root.style.setProperty('--primary-foreground', accent.foreground)
  root.style.setProperty('--accent-foreground', accent.foreground)
}

function applyTheme(theme: 'dark' | 'light' | 'system'): void {
  const root = document.documentElement
  if (theme === 'system') {
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
    root.classList.toggle('dark', dark)
    root.classList.toggle('light', !dark)
  } else {
    root.classList.toggle('dark', theme === 'dark')
    root.classList.toggle('light', theme === 'light')
  }
}

// Re-exported from mediaActions (where it now lives) so existing `import { buildLibEntry }
// from './store'` call sites keep working and the store ↔ actions dependency stays one-way.
export { buildLibEntry }
