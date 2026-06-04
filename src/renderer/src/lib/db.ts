import { toast } from 'sonner'
import type { LibraryEntry, WatchHistoryEntry, CustomList, AppSettings, CollectionEntry } from '../types'

// ─── In-memory store ─────────────────────────────────────────────────────────
// All data is loaded from JSON files on init() and kept in memory.
// Mutations update the in-memory copy immediately and schedule a debounced
// flush to disk so bursts of writes (mark-season-watched, import) don't
// trigger N full-file rewrites.

let _library: Record<string, LibraryEntry> = {}
let _history: Record<string, WatchHistoryEntry> = {}
let _lists: Record<string, CustomList> = {}
let _settings: Partial<AppSettings> = {}
let _collection: Record<string, CollectionEntry> = {}

type CacheEntry = { data: unknown; fetchedAt: number; ttl: number; bytes: number }
type CacheFileEntry = { key: string; data: unknown; fetchedAt: number; ttl: number }
const _tmdbCache: Record<string, CacheEntry> = {}
const _cacheFlushTimers: Record<string, ReturnType<typeof setTimeout>> = {}

export type CacheCategory = 'search' | 'detail' | 'season' | 'genre' | 'person' | 'discovery'

export interface CacheStats {
  total: number
  totalBytes: number
  byCategory: Record<CacheCategory, { count: number; bytes: number }>
}

const AGGREGATE_FILES = new Set(['cache/searches.json', 'cache/discovery.json', 'cache/genres.json'])

const DATA_FLUSH_MS = 250
// Hard cap so a sustained burst of mutations (e.g. typing in Settings, scripted
// imports) still flushes regularly instead of indefinitely resetting the timer.
const DATA_FLUSH_MAX_MS = 2000
let _writeFailureToastedAt = 0

const _dataFlushTimers: Record<string, ReturnType<typeof setTimeout>> = {}
const _dataFlushDeadline: Record<string, number> = {}
const _dataPending: Record<string, () => Promise<void>> = {}

function scheduleDataFlush(file: string, fn: () => Promise<void>): void {
  _dataPending[file] = fn
  const now = Date.now()
  if (_dataFlushDeadline[file] == null) {
    _dataFlushDeadline[file] = now + DATA_FLUSH_MAX_MS
  }
  if (_dataFlushTimers[file]) clearTimeout(_dataFlushTimers[file])
  const delay = Math.max(0, Math.min(DATA_FLUSH_MS, _dataFlushDeadline[file] - now))
  _dataFlushTimers[file] = setTimeout(async () => {
    delete _dataFlushTimers[file]
    delete _dataFlushDeadline[file]
    const pending = _dataPending[file]
    delete _dataPending[file]
    if (!pending) return
    try {
      await pending()
    } catch (err) {
      console.error(`Flush failed for ${file}:`, err)
      // Re-queue the latest pending fn so the next mutation (or the
      // before-quit handshake) gets another attempt.
      if (!_dataPending[file]) _dataPending[file] = pending
      // Throttle the toast so a sustained failure doesn't spam the UI.
      const t = Date.now()
      if (t - _writeFailureToastedAt > 5000) {
        _writeFailureToastedAt = t
        try { toast.error('Saving changes failed - your recent edits may not be on disk yet.') } catch { /* sonner not mounted */ }
      }
    }
  }, delay)
}

export async function flushPendingWrites(): Promise<void> {
  const tasks: Promise<void>[] = []
  for (const file of Object.keys(_dataPending)) {
    if (_dataFlushTimers[file]) {
      clearTimeout(_dataFlushTimers[file])
      delete _dataFlushTimers[file]
    }
    const pending = _dataPending[file]
    delete _dataPending[file]
    if (pending) tasks.push(pending())
  }
  for (const file of Object.keys(_cacheFlushTimers)) {
    if (_cacheFlushTimers[file]) {
      clearTimeout(_cacheFlushTimers[file])
      delete _cacheFlushTimers[file]
    }
    tasks.push(flushCacheFile(file))
  }
  await Promise.all(tasks)
}

function cacheKeyToFile(key: string): string {
  const withoutPrefix = key.slice('tmdb:'.length)
  const pathEnd = withoutPrefix.indexOf(':')
  const path = pathEnd >= 0 ? withoutPrefix.slice(0, pathEnd) : withoutPrefix
  const m = path.match(/^\/movie\/(\d+)$/)
  if (m) return `cache/detail/movie-${m[1]}.json`
  const t = path.match(/^\/tv\/(\d+)$/)
  if (t) return `cache/detail/tv-${t[1]}.json`
  const s = path.match(/^\/tv\/(\d+)\/season\/(\d+)$/)
  if (s) return `cache/season/${s[1]}/s${s[2]}.json`
  const p = path.match(/^\/person\/(\d+)$/)
  if (p) return `cache/person/${p[1]}.json`
  if (path.startsWith('/genre/')) return 'cache/genres.json'
  if (path.startsWith('/search/')) return 'cache/searches.json'
  return 'cache/discovery.json'
}

function categorizeCacheKey(key: string): CacheCategory {
  const path = key.slice('tmdb:'.length).split(':')[0]
  if (path.startsWith('/search/')) return 'search'
  if (path.startsWith('/person/')) return 'person'
  if (/^\/tv\/\d+\/season\//.test(path)) return 'season'
  if (/^\/movie\/\d+$/.test(path) || /^\/tv\/\d+$/.test(path)) return 'detail'
  if (path.startsWith('/genre/')) return 'genre'
  return 'discovery'
}

async function flushCacheFile(file: string): Promise<void> {
  if (AGGREGATE_FILES.has(file)) {
    const entries: Record<string, CacheFileEntry> = {}
    for (const [k, v] of Object.entries(_tmdbCache)) {
      if (cacheKeyToFile(k) === file) entries[k] = { key: k, data: v.data, fetchedAt: v.fetchedAt, ttl: v.ttl }
    }
    await writeJson(file, entries)
  } else {
    const pair = Object.entries(_tmdbCache).find(([k]) => cacheKeyToFile(k) === file)
    if (pair) await writeJson(file, { key: pair[0], data: pair[1].data, fetchedAt: pair[1].fetchedAt, ttl: pair[1].ttl } satisfies CacheFileEntry)
  }
}

function scheduleCacheFileFlush(file: string): void {
  if (_cacheFlushTimers[file]) clearTimeout(_cacheFlushTimers[file])
  _cacheFlushTimers[file] = setTimeout(async () => {
    delete _cacheFlushTimers[file]
    await flushCacheFile(file)
  }, 2000)
}

// Best-effort flush on reload/window-close (beforeunload doesn't await IPC).
// The authoritative pre-quit flush is the `app:flush-pending` handshake below:
// main pauses `app.quit()` until we ack, so the IPC round-trip actually
// completes and pending writes hit disk.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => { void flushPendingWrites() })
  try {
    window.electron?.app?.onFlushPending(async () => {
      try { await flushPendingWrites() } catch { /* per-file failures already logged */ }
      try { window.electron.app.flushComplete() } catch { /* main already gone */ }
    })
  } catch { /* preload bridge unavailable (tests/SSR) */ }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function readJson<T>(filename: string, fallback: T): Promise<T> {
  try {
    const raw = await window.electron.storage.readFile(filename)
    if (raw == null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

async function writeJson(filename: string, data: unknown): Promise<void> {
  await window.electron.storage.writeFile(filename, JSON.stringify(data, null, 2))
}

const _enc = new TextEncoder()

function computeEntryBytes(k: string, data: unknown, fetchedAt: number, ttl: number): number {
  return _enc.encode(JSON.stringify({ key: k, data, fetchedAt, ttl }, null, 2)).length
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function loadIndividualCacheFiles(subdir: string): Promise<void> {
  const now = Date.now()
  let entries: Array<{ name: string; isDir: boolean }> = []
  try { entries = await window.electron.storage.listDir(subdir) } catch { return }
  // Cache hydration is best-effort: one bad file (AV lock, corruption, IPC
  // hiccup) must not abort initStorage and leave the renderer stuck on the
  // loading spinner. Wrap the whole per-entry pipeline.
  await Promise.all(entries.map(async (e) => {
    try {
      if (e.isDir) {
        await loadIndividualCacheFiles(`${subdir}/${e.name}`)
        return
      }
      if (!e.name.endsWith('.json')) return
      const raw = await window.electron.storage.readFile(`${subdir}/${e.name}`)
      if (!raw) return
      const entry = JSON.parse(raw) as CacheFileEntry
      if (entry.key && now <= entry.fetchedAt + entry.ttl) {
        _tmdbCache[entry.key] = {
          data: entry.data,
          fetchedAt: entry.fetchedAt,
          ttl: entry.ttl,
          bytes: computeEntryBytes(entry.key, entry.data, entry.fetchedAt, entry.ttl)
        }
      }
    } catch { /* ignore unreadable/corrupt cache files */ }
  }))
}

export async function initStorage(): Promise<void> {
  // Flush any pending debounced writes first - otherwise resetting the
  // in-memory state below would mean the next flush writes empty/stale data
  // back to disk, and the subsequent disk read would miss the latest values.
  await flushPendingWrites()

  // Drop any in-memory state from a previous init (e.g., after importAll)
  _library = {}
  _history = {}
  _lists = {}
  _settings = {}
  _collection = {}
  for (const k of Object.keys(_tmdbCache)) delete _tmdbCache[k]

  const [lib, hist, lists, settings, col] = await Promise.all([
    readJson<LibraryEntry[]>('library.json', []),
    readJson<WatchHistoryEntry[]>('history.json', []),
    readJson<CustomList[]>('lists.json', []),
    readJson<Partial<AppSettings>>('settings.json', {}),
    readJson<CollectionEntry[]>('collection.json', []),
  ])
  _library = Object.fromEntries(lib.map((e) => [e.id, e]))
  _history = Object.fromEntries(hist.map((h) => [h.id, h]))
  _lists = Object.fromEntries(lists.map((l) => [l.id, l]))
  _settings = settings
  _collection = Object.fromEntries(col.map((c) => [c.id, c]))

  // Load persisted cache (segmented files), pruning expired entries
  const now = Date.now()
  const [searches, discovery, genres] = await Promise.all([
    readJson<Record<string, CacheFileEntry>>('cache/searches.json', {}),
    readJson<Record<string, CacheFileEntry>>('cache/discovery.json', {}),
    readJson<Record<string, CacheFileEntry>>('cache/genres.json', {}),
    loadIndividualCacheFiles('cache/detail'),
    loadIndividualCacheFiles('cache/season'),
    loadIndividualCacheFiles('cache/person'),
  ])
  for (const map of [searches, discovery, genres]) {
    if (!map) continue
    for (const [k, v] of Object.entries(map)) {
      if (now <= v.fetchedAt + v.ttl) {
        _tmdbCache[k] = {
          data: v.data,
          fetchedAt: v.fetchedAt,
          ttl: v.ttl,
          bytes: computeEntryBytes(k, v.data, v.fetchedAt, v.ttl)
        }
      }
    }
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export async function getAllSettings(): Promise<Partial<AppSettings>> {
  return _settings
}

export async function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void> {
  _settings = { ..._settings, [key]: value }
  scheduleDataFlush('settings.json', () => writeJson('settings.json', _settings))
}

// ─── TMDb cache (persisted to cache.json, flushed with 2s debounce) ──────────

export async function getCache<T>(key: string): Promise<T | null> {
  const entry = _tmdbCache[key]
  if (!entry) return null
  if (Date.now() > entry.fetchedAt + entry.ttl) {
    delete _tmdbCache[key]
    return null
  }
  return entry.data as T
}

export async function setCache(key: string, data: unknown, ttlMs: number): Promise<void> {
  const fetchedAt = Date.now()
  _tmdbCache[key] = { data, fetchedAt, ttl: ttlMs, bytes: computeEntryBytes(key, data, fetchedAt, ttlMs) }
  scheduleCacheFileFlush(cacheKeyToFile(key))
}

export async function clearCache(): Promise<void> {
  for (const k of Object.keys(_tmdbCache)) delete _tmdbCache[k]
  await Promise.all([
    window.electron.storage.deleteDir('cache/detail'),
    window.electron.storage.deleteDir('cache/season'),
    window.electron.storage.deleteDir('cache/person'),
    writeJson('cache/searches.json', {}),
    writeJson('cache/discovery.json', {}),
    writeJson('cache/genres.json', {}),
  ])
}

export async function deleteCacheEntry(key: string): Promise<void> {
  if (!_tmdbCache[key]) return
  delete _tmdbCache[key]
  const file = cacheKeyToFile(key)
  if (AGGREGATE_FILES.has(file)) {
    // Re-flush the aggregate file without this key
    scheduleCacheFileFlush(file)
  } else {
    // Individual file - delete it outright
    await window.electron.storage.deleteFile(file)
  }
}

export async function clearCacheByCategory(category: CacheCategory): Promise<void> {
  const keysToDelete: string[] = []
  for (const k of Object.keys(_tmdbCache)) {
    if (categorizeCacheKey(k) === category) keysToDelete.push(k)
  }
  for (const k of keysToDelete) delete _tmdbCache[k]

  if (category === 'detail') {
    await window.electron.storage.deleteDir('cache/detail')
  } else if (category === 'season') {
    await window.electron.storage.deleteDir('cache/season')
  } else if (category === 'person') {
    await window.electron.storage.deleteDir('cache/person')
  } else if (category === 'search') {
    await writeJson('cache/searches.json', {})
  } else if (category === 'discovery') {
    await writeJson('cache/discovery.json', {})
  } else if (category === 'genre') {
    await writeJson('cache/genres.json', {})
  }
}

export interface CacheEntryDetail {
  key: string
  label: string
  sublabel?: string
  bytes: number
  fetchedAt: number
  expiresAt: number
}

function labelForCacheEntry(
  path: string,
  params: Record<string, unknown>,
  data: unknown
): { label: string; sublabel?: string } {
  const d = data as Record<string, unknown>

  if (path.startsWith('/search/')) {
    const type = path.split('/')[2]
    const query = String(params.query ?? '')
    const page = Number(params.page ?? 1)
    const typeLabel = type === 'multi' ? 'All' : type === 'movie' ? 'Movies' : type === 'tv' ? 'TV' : 'People'
    return { label: `"${query}"`, sublabel: `${typeLabel}${page > 1 ? `, page ${page}` : ''}` }
  }

  if (/^\/movie\/\d+$/.test(path)) {
    return { label: String(d.title ?? d.name ?? path), sublabel: 'Movie' }
  }

  if (/^\/tv\/\d+$/.test(path)) {
    return { label: String(d.name ?? d.title ?? path), sublabel: 'TV Show' }
  }

  if (/^\/tv\/(\d+)\/season\/(\d+)$/.test(path)) {
    const m = path.match(/^\/tv\/(\d+)\/season\/(\d+)$/)!
    const tvId = m[1]
    const seasonNum = m[2]
    const detailKey = Object.keys(_tmdbCache).find((k) => new RegExp(`^tmdb:/tv/${tvId}:`).test(k))
    const showName = detailKey
      ? String((_tmdbCache[detailKey].data as Record<string, unknown>).name ?? `Show ${tvId}`)
      : `Show ${tvId}`
    return { label: showName, sublabel: `Season ${seasonNum}` }
  }

  if (path.startsWith('/person/')) {
    return { label: String(d.name ?? path), sublabel: 'Person' }
  }

  if (path.startsWith('/genre/')) {
    return { label: path.includes('movie') ? 'Movie Genres' : 'TV Genres' }
  }

  if (path.startsWith('/trending/')) {
    const parts = path.split('/')
    const typeMap: Record<string, string> = { all: 'All Media', movie: 'Movies', tv: 'TV Shows' }
    const type = typeMap[parts[2]] ?? parts[2]
    const window = parts[3] === 'day' ? 'Today' : 'This Week'
    return { label: `Trending ${type}`, sublabel: window }
  }

  if (path.includes('/popular')) {
    const type = path.startsWith('/movie') ? 'Movies' : 'TV Shows'
    const page = Number(params.page ?? 1)
    return { label: `Popular ${type}`, sublabel: page > 1 ? `page ${page}` : undefined }
  }

  if (path.includes('/top_rated')) {
    const type = path.startsWith('/movie') ? 'Movies' : 'TV Shows'
    const page = Number(params.page ?? 1)
    return { label: `Top Rated ${type}`, sublabel: page > 1 ? `page ${page}` : undefined }
  }

  if (path.startsWith('/discover/')) {
    const type = path.includes('movie') ? 'Movies' : 'TV Shows'
    const page = Number(params.page ?? 1)
    return { label: `Discover ${type}`, sublabel: page > 1 ? `page ${page}` : undefined }
  }

  return { label: path }
}

export function getCacheEntries(category: CacheCategory): CacheEntryDetail[] {
  const now = Date.now()
  const results: CacheEntryDetail[] = []

  for (const [k, v] of Object.entries(_tmdbCache)) {
    if (now > v.fetchedAt + v.ttl) continue
    if (categorizeCacheKey(k) !== category) continue

    const withoutPrefix = k.slice('tmdb:'.length)
    const pathEnd = withoutPrefix.indexOf(':')
    const path = pathEnd >= 0 ? withoutPrefix.slice(0, pathEnd) : withoutPrefix
    const paramsStr = pathEnd >= 0 ? withoutPrefix.slice(pathEnd + 1) : '{}'
    let params: Record<string, unknown> = {}
    try { params = JSON.parse(paramsStr) } catch { /* noop */ }

    const { label, sublabel } = labelForCacheEntry(path, params, v.data)
    results.push({
      key: k,
      label,
      sublabel,
      bytes: v.bytes,
      fetchedAt: v.fetchedAt,
      expiresAt: v.fetchedAt + v.ttl,
    })
  }

  return results.sort((a, b) => b.fetchedAt - a.fetchedAt)
}

export function getCacheStats(): CacheStats {
  const now = Date.now()
  const empty = (): { count: number; bytes: number } => ({ count: 0, bytes: 0 })
  const byCategory: CacheStats['byCategory'] = {
    search: empty(), detail: empty(), season: empty(),
    genre: empty(), person: empty(), discovery: empty(),
  }
  let total = 0
  let totalBytes = 0
  for (const [k, v] of Object.entries(_tmdbCache)) {
    if (now > v.fetchedAt + v.ttl) continue
    const cat = categorizeCacheKey(k)
    byCategory[cat].count++
    byCategory[cat].bytes += v.bytes
    total++
    totalBytes += v.bytes
  }
  return { total, totalBytes, byCategory }
}

// ─── Library ──────────────────────────────────────────────────────────────────

export async function getAllLibrary(): Promise<LibraryEntry[]> {
  return Object.values(_library)
}

export async function setLibraryEntry(entry: LibraryEntry): Promise<void> {
  _library[entry.id] = entry
  scheduleDataFlush('library.json', () => writeJson('library.json', Object.values(_library)))
}

export async function removeLibraryEntry(id: string): Promise<void> {
  delete _library[id]
  scheduleDataFlush('library.json', () => writeJson('library.json', Object.values(_library)))
}

// ─── Watch history ────────────────────────────────────────────────────────────

export async function getWatchHistory(): Promise<WatchHistoryEntry[]> {
  return Object.values(_history)
}

export async function addWatchHistoryEntry(entry: WatchHistoryEntry): Promise<void> {
  _history[entry.id] = entry
  scheduleDataFlush('history.json', () => writeJson('history.json', Object.values(_history)))
}

export async function removeWatchHistoryEntry(id: string): Promise<void> {
  delete _history[id]
  scheduleDataFlush('history.json', () => writeJson('history.json', Object.values(_history)))
}

export async function bulkRemoveWatchHistoryEntries(ids: string[]): Promise<void> {
  for (const id of ids) delete _history[id]
  scheduleDataFlush('history.json', () => writeJson('history.json', Object.values(_history)))
}

export async function bulkSetHistoryEntries(entries: WatchHistoryEntry[]): Promise<void> {
  for (const e of entries) _history[e.id] = e
  scheduleDataFlush('history.json', () => writeJson('history.json', Object.values(_history)))
}

export async function bulkSetLibraryEntries(entries: LibraryEntry[]): Promise<void> {
  for (const e of entries) _library[e.id] = e
  scheduleDataFlush('library.json', () => writeJson('library.json', Object.values(_library)))
}

// ─── Lists ────────────────────────────────────────────────────────────────────

export async function getAllLists(): Promise<CustomList[]> {
  return Object.values(_lists)
}

export async function setList(list: CustomList): Promise<void> {
  _lists[list.id] = list
  scheduleDataFlush('lists.json', () => writeJson('lists.json', Object.values(_lists)))
}

export async function removeList(id: string): Promise<void> {
  delete _lists[id]
  scheduleDataFlush('lists.json', () => writeJson('lists.json', Object.values(_lists)))
}

// ─── Collection ───────────────────────────────────────────────────────────────

export async function getAllCollection(): Promise<CollectionEntry[]> {
  return Object.values(_collection)
}

export async function setCollectionEntry(entry: CollectionEntry): Promise<void> {
  _collection[entry.id] = entry
  scheduleDataFlush('collection.json', () => writeJson('collection.json', Object.values(_collection)))
}

export async function removeCollectionEntry(id: string): Promise<void> {
  delete _collection[id]
  scheduleDataFlush('collection.json', () => writeJson('collection.json', Object.values(_collection)))
}

// ─── Backup / restore ─────────────────────────────────────────────────────────

export async function exportAll() {
  await flushPendingWrites()
  return {
    settings: _settings,
    library: Object.values(_library),
    watchHistory: Object.values(_history),
    lists: Object.values(_lists),
    collection: Object.values(_collection)
  }
}

export async function importAll(data: {
  settings?: Partial<AppSettings>
  library?: LibraryEntry[]
  watchHistory?: WatchHistoryEntry[]
  lists?: CustomList[]
  collection?: CollectionEntry[]
}): Promise<void> {
  // Drop any pending writes from the previous dataset - we're replacing it.
  for (const file of Object.keys(_dataFlushTimers)) {
    clearTimeout(_dataFlushTimers[file])
    delete _dataFlushTimers[file]
    delete _dataPending[file]
  }
  const writes: Promise<void>[] = []
  if (data.settings) {
    _settings = data.settings
    writes.push(writeJson('settings.json', _settings))
  }
  if (data.library) {
    _library = Object.fromEntries(data.library.map((e) => [e.id, e]))
    writes.push(writeJson('library.json', data.library))
  }
  if (data.watchHistory) {
    _history = Object.fromEntries(data.watchHistory.map((h) => [h.id, h]))
    writes.push(writeJson('history.json', data.watchHistory))
  }
  if (data.lists) {
    _lists = Object.fromEntries(data.lists.map((l) => [l.id, l]))
    writes.push(writeJson('lists.json', data.lists))
  }
  if (data.collection) {
    _collection = Object.fromEntries(data.collection.map((c) => [c.id, c]))
    writes.push(writeJson('collection.json', data.collection))
  }
  await Promise.all(writes)
}

export async function clearAllUserData(): Promise<void> {
  _library = {}
  _history = {}
  _lists = {}
  _collection = {}
  // Drop any pending writes for these files - they're now empty.
  for (const f of ['library.json', 'history.json', 'lists.json', 'collection.json']) {
    if (_dataFlushTimers[f]) { clearTimeout(_dataFlushTimers[f]); delete _dataFlushTimers[f] }
    delete _dataPending[f]
  }
  await Promise.all([
    writeJson('library.json', []),
    writeJson('history.json', []),
    writeJson('lists.json', []),
    writeJson('collection.json', []),
  ])
}

export async function deleteEntireDataFolder(): Promise<void> {
  await window.electron.storage.deleteDataDir()
}

// ─── Data directory ───────────────────────────────────────────────────────────

export function getDataSizeBytes(): number {
  const enc = new TextEncoder()
  return (
    enc.encode(JSON.stringify(Object.values(_library))).length +
    enc.encode(JSON.stringify(Object.values(_history))).length +
    enc.encode(JSON.stringify(Object.values(_lists))).length +
    enc.encode(JSON.stringify(Object.values(_collection))).length +
    enc.encode(JSON.stringify(_settings)).length
  )
}

export async function getDataDir(): Promise<string> {
  return window.electron.storage.getDataDir()
}

export async function setDataDir(dir: string): Promise<void> {
  await flushPendingWrites()
  await window.electron.storage.migrateDataDir(dir)
}
