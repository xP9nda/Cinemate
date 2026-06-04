import { getCache, setCache } from './db'
import type {
  TMDbMovie, TMDbTV, TMDbSeason, TMDbSearchResult,
  TMDbGenre, TMDbPerson, TMDbExternalIds
} from '../types'

const BASE = 'https://api.themoviedb.org/3'
const TTL = {
  search: 1 * 60 * 60 * 1000,
  detail: 7 * 24 * 60 * 60 * 1000,
  genres: 30 * 24 * 60 * 60 * 1000,
}

export function setTTL(cfg: { search: number; detail: number; genres: number }): void {
  TTL.search = cfg.search * 60 * 60 * 1000
  TTL.detail = cfg.detail * 24 * 60 * 60 * 1000
  TTL.genres = cfg.genres * 24 * 60 * 60 * 1000
}

// Token bucket rate limiting
let tokens = 35
let lastRefill = Date.now()
const MAX_TOKENS = 35
const REFILL_RATE = 10_000 // ms per refill cycle
const requestQueue: Array<() => void> = []
let draining = false

function refillTokens(): void {
  const now = Date.now()
  const elapsed = now - lastRefill
  if (elapsed >= REFILL_RATE) {
    const cycles = Math.floor(elapsed / REFILL_RATE)
    tokens = Math.min(MAX_TOKENS, tokens + cycles * MAX_TOKENS)
    // Advance lastRefill by exactly the cycles consumed; keep the leftover
    // fractional time so it counts toward the next cycle.
    lastRefill += cycles * REFILL_RATE
  }
}

function drainQueue(): void {
  if (draining) return
  draining = true
  const tick = () => {
    refillTokens()
    while (requestQueue.length > 0 && tokens > 0) {
      tokens--
      const next = requestQueue.shift()!
      next()
    }
    if (requestQueue.length > 0) {
      setTimeout(tick, 100)
    } else {
      draining = false
    }
  }
  tick()
}

function acquireToken(): Promise<void> {
  return new Promise((resolve) => {
    refillTokens()
    if (tokens > 0) {
      tokens--
      resolve()
    } else {
      requestQueue.push(resolve)
      drainQueue()
    }
  })
}

let _apiKey: string | null = null

export function setApiKey(key: string | null): void {
  _apiKey = key
}

class TMDbError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'TMDbError'
  }
}

function scrubError(err: unknown): string {
  if (!_apiKey) return err instanceof Error ? err.message : String(err)
  const raw = err instanceof Error ? err.message : String(err)
  return raw.split(_apiKey).join('[redacted]')
}

async function apiFetch<T>(path: string, params: Record<string, string | number> = {}, ttl?: number): Promise<T> {
  if (!_apiKey) throw new TMDbError(401, 'No API key configured. Please add your TMDb API key in Settings.')

  const cacheKey = `tmdb:${path}:${JSON.stringify(params)}`
  if (ttl) {
    const cached = await getCache<T>(cacheKey)
    if (cached) return cached
  }

  await acquireToken()

  const url = new URL(`${BASE}${path}`)
  url.searchParams.set('api_key', _apiKey)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))

  const MAX_RETRIES = 3
  let attempt = 0
  let lastErr: unknown = null
  while (attempt < MAX_RETRIES) {
    let res: Response
    try {
      res = await fetch(url.toString())
    } catch (err) {
      // Network failure - backoff and retry. Never include the URL (contains key).
      lastErr = err
      attempt++
      if (attempt >= MAX_RETRIES) break
      await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)))
      continue
    }
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After') || 10)
      await new Promise((r) => setTimeout(r, retryAfter * 1000))
      attempt++
      continue
    }
    if (res.status >= 500 && res.status < 600) {
      // Transient server error - retry with backoff
      lastErr = new TMDbError(res.status, `TMDb server error ${res.status}`)
      attempt++
      if (attempt >= MAX_RETRIES) break
      await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)))
      continue
    }
    if (!res.ok) {
      // 4xx - surface a generic message; never leak the URL/key.
      const msg = res.status === 401 ? 'Invalid TMDb API key.'
        : res.status === 404 ? 'Not found.'
        : `TMDb error ${res.status}`
      throw new TMDbError(res.status, msg)
    }
    try {
      const data = await res.json() as T
      if (ttl) await setCache(cacheKey, data, ttl)
      return data
    } catch (err) {
      throw new TMDbError(res.status, `Failed to parse TMDb response: ${scrubError(err)}`)
    }
  }
  if (lastErr instanceof TMDbError) throw lastErr
  throw new TMDbError(503, `TMDb request failed after retries: ${scrubError(lastErr)}`)
}

// Search
export async function searchMulti(query: string, page = 1): Promise<{ results: TMDbSearchResult[]; total_pages: number; total_results: number }> {
  return apiFetch('/search/multi', { query, page, include_adult: 'false' }, TTL.search)
}

export async function searchMovies(query: string, page = 1): Promise<{ results: TMDbSearchResult[]; total_pages: number }> {
  return apiFetch('/search/movie', { query, page }, TTL.search)
}

export async function searchTV(query: string, page = 1): Promise<{ results: TMDbSearchResult[]; total_pages: number }> {
  return apiFetch('/search/tv', { query, page }, TTL.search)
}

export async function searchPeople(query: string, page = 1): Promise<{ results: TMDbPerson[]; total_pages: number }> {
  return apiFetch('/search/person', { query, page }, TTL.search)
}

// Details
export async function getMovie(id: number): Promise<TMDbMovie> {
  return apiFetch(`/movie/${id}`, { append_to_response: 'credits,videos,recommendations,similar,external_ids' }, TTL.detail)
}

export async function getTV(id: number): Promise<TMDbTV> {
  return apiFetch(`/tv/${id}`, { append_to_response: 'credits,videos,recommendations,similar,aggregate_credits,external_ids' }, TTL.detail)
}

export async function getSeason(tvId: number, seasonNumber: number): Promise<TMDbSeason> {
  return apiFetch(`/tv/${tvId}/season/${seasonNumber}`, {}, TTL.detail)
}

export async function getPerson(id: number): Promise<TMDbPerson & { biography?: string; birthday?: string; homepage?: string | null; imdb_id?: string | null; external_ids?: TMDbExternalIds; movie_credits?: { cast: TMDbSearchResult[] }; tv_credits?: { cast: TMDbSearchResult[] } }> {
  return apiFetch(`/person/${id}`, { append_to_response: 'movie_credits,tv_credits,external_ids' }, TTL.detail)
}

// Trending & Discovery
export async function getTrending(type: 'movie' | 'tv' | 'all' = 'all', window: 'day' | 'week' = 'week'): Promise<{ results: TMDbSearchResult[] }> {
  return apiFetch(`/trending/${type}/${window}`, {}, TTL.search)
}

export async function discoverMovies(params: Record<string, string | number>, page = 1): Promise<{ results: TMDbSearchResult[]; total_pages: number }> {
  return apiFetch('/discover/movie', { ...params, page }, TTL.search)
}

export async function discoverTV(params: Record<string, string | number>, page = 1): Promise<{ results: TMDbSearchResult[]; total_pages: number }> {
  return apiFetch('/discover/tv', { ...params, page }, TTL.search)
}

// Genres
export async function getMovieGenres(): Promise<{ genres: TMDbGenre[] }> {
  return apiFetch('/genre/movie/list', {}, TTL.genres)
}

export async function getTVGenres(): Promise<{ genres: TMDbGenre[] }> {
  return apiFetch('/genre/tv/list', {}, TTL.genres)
}

// Import helpers - lightweight fetches (no heavy append_to_response)
export interface MovieBasic {
  id: number; title: string; poster_path: string | null; backdrop_path: string | null
  release_date: string; genres: Array<{ id: number; name: string }>; runtime: number | null
}
export interface TVBasic {
  id: number; name: string; poster_path: string | null; backdrop_path: string | null
  first_air_date: string; genres: Array<{ id: number; name: string }>; episode_run_time: number[]
  origin_country?: string[]
}

export async function getMovieBasic(id: number): Promise<MovieBasic> {
  return apiFetch(`/movie/${id}`, {}, TTL.detail)
}

export async function getTVBasic(id: number): Promise<TVBasic> {
  return apiFetch(`/tv/${id}`, {}, TTL.detail)
}

export async function searchMoviesWithYear(query: string, year?: number): Promise<{ results: TMDbSearchResult[] }> {
  const params: Record<string, string | number> = { query }
  if (year) params.year = year
  return apiFetch('/search/movie', params, TTL.search)
}

// Anime helper - TV shows with genre 16 (Animation) from Japan
export function isAnime(result: TMDbSearchResult): boolean {
  return (
    (result.genre_ids?.includes(16) ?? false) &&
    (result.origin_country?.includes('JP') ?? false)
  )
}
