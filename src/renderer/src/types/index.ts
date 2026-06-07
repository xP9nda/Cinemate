export type MediaType = 'movie' | 'tv' | 'anime'
export type WatchStatus = 'watched' | 'watchlist' | 'in_progress' | 'dropped'
export type RatingSystem = '10star' | '5star'
export type Theme = 'dark' | 'light' | 'system'
export type TimeFormat = '12h' | '24h'
export type AccentColor = 'purple' | 'blue' | 'green' | 'orange' | 'pink' | 'red'
export type LogGroupBy = 'day' | 'week' | 'month' | 'year' | 'none'

// TMDb types
export interface TMDbMovie {
  id: number
  title: string
  original_title: string
  overview: string
  poster_path: string | null
  backdrop_path: string | null
  release_date: string
  vote_average: number
  vote_count: number
  runtime: number | null
  genres: Array<{ id: number; name: string }>
  credits?: {
    cast: TMDbCastMember[]
    crew: TMDbCrewMember[]
  }
  videos?: { results: TMDbVideo[] }
  recommendations?: { results: TMDbMovieResult[] }
  similar?: { results: TMDbMovieResult[] }
  status?: string
  tagline?: string
  budget?: number
  revenue?: number
  homepage?: string
  imdb_id?: string | null
  external_ids?: TMDbExternalIds
  production_countries?: Array<{ iso_3166_1: string; name: string }>
  spoken_languages?: Array<{ iso_639_1: string; name: string }>
}

export interface TMDbExternalIds {
  imdb_id?: string | null
  facebook_id?: string | null
  instagram_id?: string | null
  twitter_id?: string | null
  tiktok_id?: string | null
  youtube_id?: string | null
  wikidata_id?: string | null
  tvdb_id?: number | null
}

export interface TMDbTV {
  id: number
  name: string
  original_name: string
  overview: string
  poster_path: string | null
  backdrop_path: string | null
  first_air_date: string
  last_air_date: string
  vote_average: number
  vote_count: number
  number_of_seasons: number
  number_of_episodes: number
  genres: Array<{ id: number; name: string }>
  networks?: Array<{ id: number; name: string; logo_path: string | null }>
  credits?: {
    cast: TMDbCastMember[]
    crew: TMDbCrewMember[]
  }
  aggregate_credits?: {
    cast: TMDbAggregateCastMember[]
  }
  videos?: { results: TMDbVideo[] }
  recommendations?: { results: TMDbTVResult[] }
  similar?: { results: TMDbTVResult[] }
  seasons: TMDbSeasonSummary[]
  status?: string
  tagline?: string
  homepage?: string
  external_ids?: TMDbExternalIds
  episode_run_time?: number[]
  origin_country?: string[]
}

export interface TMDbSeasonSummary {
  id: number
  season_number: number
  name: string
  overview: string
  poster_path: string | null
  air_date: string | null
  episode_count: number
}

export interface TMDbSeason {
  id: number
  season_number: number
  name: string
  overview: string
  poster_path: string | null
  air_date: string | null
  episodes: TMDbEpisode[]
}

export interface TMDbEpisode {
  id: number
  episode_number: number
  season_number: number
  name: string
  overview: string
  still_path: string | null
  air_date: string | null
  vote_average: number
  vote_count?: number
  runtime: number | null
}

export interface TMDbCastMember {
  id: number
  name: string
  character: string
  profile_path: string | null
  order: number
}

export interface TMDbAggregateCastMember {
  id: number
  name: string
  profile_path: string | null
  total_episode_count: number
  order: number
  roles: Array<{ character: string; episode_count: number }>
}

export interface TMDbCrewMember {
  id: number
  name: string
  job: string
  department: string
  profile_path: string | null
}

export interface TMDbVideo {
  id: string
  key: string
  name: string
  site: string
  type: string
  official: boolean
}

export interface TMDbMovieResult {
  id: number
  title: string
  poster_path: string | null
  release_date: string
  vote_average: number
  media_type?: string
  genre_ids?: number[]
}

export interface TMDbTVResult {
  id: number
  name: string
  poster_path: string | null
  first_air_date: string
  vote_average: number
  media_type?: string
  genre_ids?: number[]
}

export interface TMDbSearchResult {
  id: number
  title?: string
  name?: string
  poster_path: string | null
  backdrop_path?: string | null
  release_date?: string
  first_air_date?: string
  vote_average: number
  vote_count?: number
  popularity?: number
  media_type: string
  genre_ids?: number[]
  origin_country?: string[]
}

export interface TMDbPerson {
  id: number
  name: string
  profile_path: string | null
  known_for_department: string
  known_for: TMDbSearchResult[]
}

export interface TMDbGenre {
  id: number
  name: string
}

// DB / App types
export interface EpisodeProgress {
  watchedAt: string | null
  rating: number | null
  // ms timestamp the `rating` was last set; null when cleared, absent until first
  // rated. Set on write (same "optional, maintained on write" convention as
  // runtimeStats / rewatchStartedAt). Drives the rated-date axis of the Stats
  // "Average Rating Over Time" chart.
  ratedAt?: number | null
  note: string
  // Real per-episode runtime (minutes), filled in from TMDb on a Detail visit.
  // null/absent means TMDb had none yet - consumers fall back to the show's
  // average episode runtime (LibraryEntry.runtime).
  runtime?: number | null
}

export interface LibraryEntry {
  id: string                           // "movie:550" | "tv:1396"
  mediaType: MediaType
  tmdbId: number
  title: string
  posterPath: string | null
  backdropPath?: string | null
  releaseYear: number | null
  status: WatchStatus
  prevStatus?: WatchStatus             // status to restore when leaving the watchlist; only meaningful while status === 'watchlist'
  userRating: number | null            // overall rating
  userRatingAt?: number | null         // ms timestamp the overall userRating was last set (null when cleared; set on write)
  review: string
  watchedDate: string | null           // ISO datetime
  addedDate: number                    // ms timestamp
  listIds: string[]
  genreIds?: number[]
  tvProgress: Record<string, EpisodeProgress> | null  // key: "s:e" e.g. "1:3"
  seasonRatings: Record<number, number | null>         // key: season number
  seasonRatedAt?: Record<number, number | null>        // key: season number -> ms timestamp the season rating was last set (set on write; backfilled for old data)
  runtime?: number | null                              // minutes: movie runtime or avg episode runtime for TV
  // Denormalised runtime totals (minutes), refreshed on write whenever watch state
  // changes, so the library/list stats read them instead of fetching season data on
  // view. Absent until an entry's first watch-state change (old data is not backfilled).
  runtimeStats?: { total: number; watched: number }
  // Denormalised episode counts, maintained on the same write path as runtimeStats.
  // Movies are always { total: 0, watched: 0 }; shows count real-season episodes
  // (specials excluded) vs. those watched. Absent until the entry's first watch-state
  // change (old data is not backfilled), same as runtimeStats.
  episodeStats?: { total: number; watched: number }
  // When the user last started a rewatch (ms timestamp). Plays logged before this
  // belong to a prior watch-through and no longer mark current episode progress, so
  // removing a current-run play can't resurrect an older play's watched marker. Absent
  // for shows that have never been rewatched; their plays all count.
  rewatchStartedAt?: number
}

export interface WatchHistoryEntry {
  id: string                           // "hist:{uid}"
  mediaId: string                      // lib entry id
  watchedAt: number                    // ms timestamp
  watchedAtDT: string                  // ISO datetime
  // No per-play rating: a rating is one value per ratable thing - a movie/show's
  // overall rating (LibraryEntry.userRating) or an episode's own rating
  // (EpisodeProgress.rating). A play records only when it was watched.
  note: string
  tags?: string[]
  episodeKey?: string                  // "1:3" for episode entries
  episodeTitle?: string
  isRewatch?: boolean
}

export type RuleField =
  | 'mediaType'
  | 'status'
  | 'userRating'
  | 'releaseYear'
  | 'addedYear'
  | 'watchedYear'
  | 'loggedYear'
  | 'genreId'
  | 'hasReview'
  | 'playCount'
  | 'runtime'

export type RuleOperator =
  | 'equals'
  | 'not_equals'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'in'
  | 'not_in'
  | 'is_set'
  | 'is_not_set'
  | 'is_true'
  | 'is_false'

export type RuleValue = string | number | boolean | null

export interface ListRule {
  id: string                           // local row id
  field: RuleField
  operator: RuleOperator
  value?: RuleValue                    // single-value operators
  value2?: number | null               // upper bound for `between`
  values?: Array<string | number>      // multi-value (`in`/`not_in`)
}

export type RuleCombinator = 'all' | 'any'

export interface ListScope {
  movies: boolean                      // include movies as items
  shows: boolean                       // include tv + anime as show-level items
  episodes: boolean                    // include individual logged episodes from tv + anime
}

export interface ListRules {
  enabled: boolean
  combinator: RuleCombinator
  rules: ListRule[]
  scope?: ListScope                    // defaults to { movies: true, shows: true, episodes: false }
}

/**
 * Lightweight metadata for a list item that is NOT in the library. A list is
 * "just a collection of references" - items don't need a library entry to live
 * in a list. Library-backed items render from live library data; everything
 * else falls back to this. Keyed by item id ("movie:550") in CustomList.itemMeta.
 * Episode items ("libId::epKey") are always library-backed and never use this.
 */
export interface ListItemMeta {
  mediaType: MediaType
  tmdbId: number
  title: string
  posterPath: string | null
  releaseYear: number | null
  addedAt?: number                     // ms timestamp when added to the list
}

export interface CustomList {
  id: string                           // "list:{uid}"
  name: string
  description: string
  createdAt: number
  itemIds: string[]
  itemMeta?: Record<string, ListItemMeta>  // metadata for items not in the library
  rules?: ListRules                    // when enabled, itemIds is auto-computed
}

export interface SpoilerSettings {
  episodeTitles: boolean
  episodeDescriptions: boolean
  mediaDescriptions: boolean
  ratings: boolean
  actorEpisodeCounts: boolean
  seasonDescriptions: boolean
  // When season descriptions are blurred, choose when they auto-reveal:
  // 'started' = after at least 1 episode watched, 'completed' = after the whole season.
  seasonDescriptionRevealAt: 'started' | 'completed'
}

/**
 * How many entries each paginated view loads per "page" (and per Load More
 * click). One setting per context so they can be tuned independently. A value
 * of 0 means "show everything" (no paging).
 */
export interface PaginationSettings {
  library: number
  log: number
  lists: number       // the Lists overview grid
  listItems: number   // items inside a single list (List detail)
  collection: number
}
export type SeasonDisplay = 'start_expanded' | 'start_collapsed'
export type CollectionFormat = 'blu-ray' | 'dvd' | '4k' | 'vhs' | 'digital' | 'other'

export interface CollectionEntry {
  id: string
  mediaId: string | null
  title: string
  posterPath: string | null
  mediaType: MediaType
  format: CollectionFormat
  purchasedDate: string | null
  addedDate: number
  notes: string
}

export interface AppSettings {
  apiKey: string | null
  username: string
  avatar: string | null
  theme: Theme
  ratingSystem: RatingSystem
  defaultMedia: 'all' | MediaType
  spoilerProtection: SpoilerSettings
  seasonDisplay: SeasonDisplay
  showSeasonMetadata: boolean           // show runtime / air span / score under each season header
  showSeasonOverview: boolean           // show the season description when a season is expanded
  timeFormat: TimeFormat
  logGroupBy: LogGroupBy                // how Watch Log entries are split into sections
  accentColor: AccentColor
  customTags: string[]
  autoRemoveWatchlist: boolean
  allowFutureDates: boolean
  autoScrollToNextEpisode: boolean
  markCaughtUpAsWatched: boolean
  cacheTTL: { search: number; detail: number; genres: number }
  pagination: PaginationSettings
  sidebarConfig?: SidebarConfig
  setupComplete?: boolean
  ratingTimestampsBackfilled?: boolean   // one-time migration guard: stamps userRatingAt/ratedAt onto pre-existing ratings, then skips the scan on later loads
}

export interface SidebarConfig {
  order: string[]   // nav item keys, in display order
  hidden: string[]  // nav item keys hidden from the sidebar
}

// Search / filter state
export interface LibraryFilters {
  mediaType: 'all' | MediaType
  minRating: number
  maxRating: number
  minYear: number
  maxYear: number
  search: string
  sort: 'title' | 'rating' | 'year' | 'addedDate' | 'watchedDate'
  sortDir: 'asc' | 'desc'
  view: 'grid' | 'list'
}

export interface SearchFilters {
  type: 'all' | 'movie' | 'tv' | 'anime' | 'person'
  page: number
}
