import { releaseYear } from './utils'
import type {
  TMDbCreatedBy, TMDbCrewMember, TMDbPersonCredit, TMDbPersonDetails, TMDbSearchResult,
} from '../types'

// ─── A person's filmography ──────────────────────────────────────────────────

export type CreditMediaType = 'movie' | 'tv'

/**
 * One title from someone's filmography with every role they held on it merged
 * in. TMDb lists a title once per credit, so a writer/director gets two crew
 * entries and a voice actor playing two parts gets two cast entries - the person
 * page wants one card per title carrying "Director, Writer" or "Woody, Buzz".
 */
export interface PersonCredit {
  key: string                    // "movie:550" - dedupe key and React key
  id: number
  mediaType: CreditMediaType
  title: string
  posterPath: string | null
  backdropPath: string | null
  date: string | null            // release_date / first_air_date
  year: number | null
  voteAverage: number
  voteCount: number
  popularity: number
  genreIds?: number[]
  originCountry?: string[]
  episodeCount: number | null    // shows only
  departments: string[]          // 'Acting' for cast credits, else the crew department
  roles: string[]                // characters for cast credits, job titles for crew
}

export const ACTING = 'Acting'

// Departments people care about first; anything else TMDb reports (Camera, Sound,
// Art, Editing, Costume & Make-Up, Visual Effects, Lighting, Crew...) keeps its
// own tab and sorts alphabetically after these.
const DEPARTMENT_ORDER = [ACTING, 'Directing', 'Writing', 'Production']

function departmentRank(department: string): number {
  const i = DEPARTMENT_ORDER.indexOf(department)
  return i === -1 ? DEPARTMENT_ORDER.length : i
}

/** Order departments for the filmography tabs: the notable ones first, rest A-Z. */
export function sortDepartments(departments: string[]): string[] {
  return [...departments].sort((a, b) => {
    const rank = departmentRank(a) - departmentRank(b)
    return rank !== 0 ? rank : a.localeCompare(b)
  })
}

function pushUnique(list: string[], value: string | undefined | null): void {
  const v = value?.trim()
  if (v && !list.includes(v)) list.push(v)
}

/**
 * Flatten a person's movie_credits + tv_credits (cast and crew) into one list of
 * titles. Credits with no title are dropped - TMDb occasionally returns stubs
 * for unreleased projects that would render as a blank card.
 */
export function buildPersonCredits(person: TMDbPersonDetails | null): PersonCredit[] {
  if (!person) return []
  const byKey = new Map<string, PersonCredit>()

  const add = (raw: TMDbPersonCredit, mediaType: CreditMediaType, isCast: boolean): void => {
    const title = (mediaType === 'movie' ? raw.title : raw.name)?.trim()
    if (!title) return
    const key = `${mediaType}:${raw.id}`
    const date = (mediaType === 'movie' ? raw.release_date : raw.first_air_date) || null
    let credit = byKey.get(key)
    if (!credit) {
      credit = {
        key,
        id: raw.id,
        mediaType,
        title,
        posterPath: raw.poster_path,
        backdropPath: raw.backdrop_path ?? null,
        date,
        year: releaseYear(date),
        voteAverage: raw.vote_average ?? 0,
        voteCount: raw.vote_count ?? 0,
        popularity: raw.popularity ?? 0,
        genreIds: raw.genre_ids,
        originCountry: raw.origin_country,
        episodeCount: null,
        departments: [],
        roles: [],
      }
      byKey.set(key, credit)
    }
    pushUnique(credit.departments, isCast ? ACTING : raw.department)
    pushUnique(credit.roles, isCast ? raw.character : raw.job)
    // Episode counts only come from TV credits, and a recurring player has one
    // count per role - the total across roles is what belongs on the card.
    if (raw.episode_count != null) {
      credit.episodeCount = (credit.episodeCount ?? 0) + raw.episode_count
    }
  }

  for (const c of person.movie_credits?.cast ?? []) add(c, 'movie', true)
  for (const c of person.movie_credits?.crew ?? []) add(c, 'movie', false)
  for (const c of person.tv_credits?.cast ?? []) add(c, 'tv', true)
  for (const c of person.tv_credits?.crew ?? []) add(c, 'tv', false)

  return [...byKey.values()]
}

export type CreditSort = 'newest' | 'oldest' | 'rating' | 'popularity' | 'title'

export interface CreditFilters {
  search: string
  department: string | 'all'
  mediaType: CreditMediaType | 'all'
  sort: CreditSort
}

/**
 * Apply the filmography controls. Search matches the title *and* the roles, so
 * "villain" or "director" finds work by what they did on it, not just its name.
 */
export function filterCredits(credits: PersonCredit[], filters: CreditFilters): PersonCredit[] {
  const q = filters.search.trim().toLowerCase()
  const out = credits.filter((c) => {
    if (filters.mediaType !== 'all' && c.mediaType !== filters.mediaType) return false
    if (filters.department !== 'all' && !c.departments.includes(filters.department)) return false
    if (!q) return true
    if (c.title.toLowerCase().includes(q)) return true
    if (c.roles.some((r) => r.toLowerCase().includes(q))) return true
    return c.departments.some((d) => d.toLowerCase().includes(q))
  })
  return sortCredits(out, filters.sort)
}

export function sortCredits(credits: PersonCredit[], sort: CreditSort): PersonCredit[] {
  const out = [...credits]
  switch (sort) {
    case 'newest':
    case 'oldest': {
      // -1 flips the ascending comparison below into descending, so 'newest'
      // really does put the most recent credit first.
      const dir = sort === 'newest' ? -1 : 1
      out.sort((a, b) => {
        // Undated credits (announced but unscheduled projects) sort last either
        // way rather than clustering at whichever end an empty string lands on.
        if (!a.date && !b.date) return a.title.localeCompare(b.title)
        if (!a.date) return 1
        if (!b.date) return -1
        if (a.date === b.date) return a.title.localeCompare(b.title)
        return (a.date < b.date ? -1 : 1) * dir
      })
      break
    }
    case 'rating':
      // Ignore near-unrated titles: a single 10/10 vote shouldn't top the list.
      out.sort((a, b) => {
        const av = a.voteCount >= 20 ? a.voteAverage : 0
        const bv = b.voteCount >= 20 ? b.voteAverage : 0
        return bv - av || b.voteCount - a.voteCount
      })
      break
    case 'popularity':
      out.sort((a, b) => b.popularity - a.popularity || b.voteCount - a.voteCount)
      break
    case 'title':
      out.sort((a, b) => a.title.localeCompare(b.title))
      break
  }
  return out
}

/** Roles line for a credit card, e.g. "Director, Writer" or "Ellen Ripley". */
export function creditRoleLabel(credit: PersonCredit): string {
  if (credit.roles.length > 0) return credit.roles.join(', ')
  // Cast credit with no character recorded - still worth saying they appeared.
  return credit.departments.includes(ACTING) ? 'Actor' : credit.departments.join(', ')
}

/**
 * Re-shape a credit as a search result so it can go through MediaCard, which is
 * what gives the person page the same status badge and quick actions (log,
 * watchlist, collection) as every other poster grid in the app.
 */
export function creditToSearchResult(credit: PersonCredit): TMDbSearchResult {
  return {
    id: credit.id,
    title: credit.mediaType === 'movie' ? credit.title : undefined,
    name: credit.mediaType === 'tv' ? credit.title : undefined,
    poster_path: credit.posterPath,
    backdrop_path: credit.backdropPath,
    release_date: credit.mediaType === 'movie' ? (credit.date ?? undefined) : undefined,
    first_air_date: credit.mediaType === 'tv' ? (credit.date ?? undefined) : undefined,
    vote_average: credit.voteAverage,
    vote_count: credit.voteCount,
    popularity: credit.popularity,
    media_type: credit.mediaType,
    genre_ids: credit.genreIds,
    origin_country: credit.originCountry,
  }
}

// ─── A title's key crew ──────────────────────────────────────────────────────

export interface CrewGroup {
  label: string
  people: Array<{ id: number; name: string }>
}

// Jobs worth surfacing on a media detail page, grouped under one label. TMDb job
// strings are inconsistent across titles ('Screenplay' vs 'Writer' vs 'Story'),
// so each label collects every spelling it can appear under. `plural` is only set
// for labels naming a person; the ones naming a discipline never pluralise.
const KEY_CREW: Array<{ label: string; plural?: string; jobs: string[] }> = [
  { label: 'Director', plural: 'Directors', jobs: ['Director'] },
  { label: 'Writer', plural: 'Writers', jobs: ['Screenplay', 'Writer', 'Story', 'Teleplay', 'Author', 'Novel'] },
  { label: 'Music', jobs: ['Original Music Composer', 'Music', 'Composer'] },
  { label: 'Cinematography', jobs: ['Director of Photography', 'Cinematography'] },
]

/**
 * The handful of crew credits a detail page shows, in a fixed order, each
 * de-duplicated by person - one name can hold several of the jobs behind a
 * single label (a writer-director, or someone credited for both 'Story' and
 * 'Screenplay'). Labels with nobody attached are left out entirely.
 *
 * `createdBy` is the TV-only `created_by` array; it becomes a Creator row, which
 * is the closest thing a show has to a director.
 */
export function keyCrewGroups(
  crew: TMDbCrewMember[] | undefined,
  createdBy?: TMDbCreatedBy[],
): CrewGroup[] {
  const groups: CrewGroup[] = []

  const creators = dedupePeople(createdBy ?? [])
  if (creators.length > 0) {
    groups.push({ label: creators.length > 1 ? 'Creators' : 'Creator', people: creators })
  }

  for (const { label, plural, jobs } of KEY_CREW) {
    const people = dedupePeople((crew ?? []).filter((c) => jobs.includes(c.job)))
    if (people.length === 0) continue
    groups.push({ label: people.length > 1 && plural ? plural : label, people })
  }
  return groups
}

function dedupePeople(people: Array<{ id: number; name: string }>): Array<{ id: number; name: string }> {
  const seen = new Set<number>()
  const out: Array<{ id: number; name: string }> = []
  for (const p of people) {
    if (seen.has(p.id) || !p.name) continue
    seen.add(p.id)
    out.push({ id: p.id, name: p.name })
  }
  return out
}
