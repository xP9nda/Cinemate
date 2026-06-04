import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { LibraryEntry, WatchHistoryEntry, CustomList, AppSettings, MediaType, CollectionEntry, AccentColor, EpisodeProgress, WatchStatus, RatingSystem, TMDbSeason } from '../types'
import * as db from './db'
import { setApiKey, setTTL, getMovieBasic, getTVBasic } from './tmdb'
import { computeRuleItemIds, arraysEqualSet } from './rulesEngine'
import { DEFAULT_PAGINATION } from './utils'
import { MediaActions, buildLibEntry, latestPlayDate, type MediaTarget, type CatalogEpisode, type ListItemRef } from './mediaActions'
import { computeEntryStats } from './mediaStats'

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
  bulkSetHistoryRating: (ids: string[], rating: number | null) => Promise<void>
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
  replayEpisode: (target: MediaTarget, epKey: string, epTitle: string) => Promise<void>
  removeEpisodePlays: (target: MediaTarget, epKey: string) => Promise<void>
  logAllEpisodes: (target: MediaTarget, seasons?: TMDbSeason[]) => Promise<void>
  startRewatch: (target: MediaTarget) => Promise<void>
  undoRewatch: (target: MediaTarget) => Promise<void>
  setOverallRating: (target: MediaTarget, value: number | null) => Promise<void>
  setReview: (target: MediaTarget, review: string) => Promise<void>
  setEpisodeRating: (target: MediaTarget, epKey: string, value: number | null) => Promise<void>
  setSeasonRating: (target: MediaTarget, seasonNumber: number, value: number | null) => Promise<void>
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
      await db.setLibraryEntry(finalEntry)
      set((s) => ({ library: { ...s.library, [finalEntry.id]: finalEntry } }))
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
      // Mirror play data onto the library entry so the two never diverge:
      //  - a movie / show-level log's rating IS the title's overall rating, so
      //    copy it across (only when a rating was given - logging without one
      //    must not wipe an existing rating);
      //  - a watched title's watchedDate tracks its most recent play, so a
      //    rewatch (or an edited play date) moves the date forward.
      // (Episode ratings live in tvProgress; for an as-yet-unsaved title,
      // repairOrphanedHistory carries the rating across.)
      const lib = get().library[entry.mediaId]
      if (lib) {
        let updated = lib
        if (!entry.episodeKey && entry.rating != null && lib.userRating !== entry.rating) {
          updated = { ...updated, userRating: entry.rating }
        }
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

    // Set the same rating across a set of plays. A movie/show-level play's rating
    // is the title's overall rating, so mirror it onto the library entry (matching
    // addHistory); an episode play's rating lives in tvProgress[episodeKey].
    bulkSetHistoryRating: async (ids, rating) => {
      const idSet = new Set(ids)
      const { watchHistory, library } = get()
      const updatedHistory: WatchHistoryEntry[] = []
      const libPatches: Record<string, LibraryEntry> = {}
      for (const h of watchHistory) {
        if (!idSet.has(h.id)) continue
        if (h.episodeKey) {
          const lib = libPatches[h.mediaId] ?? library[h.mediaId]
          const prog = lib?.tvProgress?.[h.episodeKey]
          if (lib && prog && prog.rating !== rating) {
            libPatches[h.mediaId] = {
              ...lib,
              tvProgress: { ...lib.tvProgress, [h.episodeKey]: { ...prog, rating } },
            }
          }
        } else {
          updatedHistory.push({ ...h, rating })
          const lib = libPatches[h.mediaId] ?? library[h.mediaId]
          if (lib && lib.userRating !== rating) {
            libPatches[h.mediaId] = { ...lib, userRating: rating }
          }
        }
      }
      const libArr = Object.values(libPatches)
      if (updatedHistory.length > 0) await db.bulkSetHistoryEntries(updatedHistory)
      if (libArr.length > 0) await db.bulkSetLibraryEntries(libArr)
      if (updatedHistory.length === 0 && libArr.length === 0) return
      set((s) => {
        const histMap = new Map(updatedHistory.map((h) => [h.id, h]))
        return {
          watchHistory: histMap.size > 0 ? s.watchHistory.map((h) => histMap.get(h.id) ?? h) : s.watchHistory,
          library: libArr.length > 0 ? { ...s.library, ...libPatches } : s.library,
        }
      })
      await get().recomputeAutoLists()
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
      const { library, watchHistory } = get()
      const updatedHistory = watchHistory.map((h) => ({ ...h, rating: convert(h.rating) }))
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
      await db.bulkSetHistoryEntries(updatedHistory)
      await db.bulkSetLibraryEntries(updatedLibrary)
      set({
        watchHistory: updatedHistory.sort((a, b) => b.watchedAt - a.watchedAt),
        library: Object.fromEntries(updatedLibrary.map((e) => [e.id, e]))
      })
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
    replayEpisode: (target, epKey, epTitle) => media.replayEpisode(target, epKey, epTitle),
    removeEpisodePlays: (target, epKey) => media.removeEpisodePlays(target, epKey),
    logAllEpisodes: (target, seasons) => media.logAllEpisodes(target, seasons),
    startRewatch: (target) => media.startRewatch(target),
    undoRewatch: (target) => media.undoRewatch(target),
    setOverallRating: (target, value) => media.setOverallRating(target, value),
    setReview: (target, review) => media.setReview(target, review),
    setEpisodeRating: (target, epKey, value) => media.setEpisodeRating(target, epKey, value),
    setSeasonRating: (target, seasonNumber, value) => media.setSeasonRating(target, seasonNumber, value),
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

    // A title logged (with a rating) before it existed in the library keeps that
    // rating as its overall rating - the log rating is the title's rating.
    const ratedPlay = watchHistory
      .filter((h) => h.mediaId === mediaId && !h.episodeKey && h.rating != null)
      .sort((a, b) => b.watchedAt - a.watchedAt)[0]

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
      if (ratedPlay) built.userRating = ratedPlay.rating
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
