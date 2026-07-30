import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, Cake, Cross, MapPin, ExternalLink, Search, Film, SearchX } from 'lucide-react'
import { getPerson } from '../lib/tmdb'
import { cn, profileUrl, fmtDate, ageInYears } from '../lib/utils'
import {
  ACTING, buildPersonCredits, creditRoleLabel, creditToSearchResult, filterCredits,
  sortDepartments, type CreditMediaType, type CreditSort,
} from '../lib/credits'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Input } from '../components/ui/input'
import { ScrollArea } from '../components/ui/scroll-area'
import { Skeleton } from '../components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { EmptyState } from '../components/shared/EmptyState'
import { MediaCard } from '../components/shared/MediaCard'
import type { TMDbPersonDetails } from '../types'

// Filmography grows in chunks rather than mounting every credit at once - a
// prolific crew member can carry 500+, and each card is a live store subscriber
// with its own menus.
const CREDITS_PAGE = 60

const SORT_LABELS: Record<CreditSort, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  rating: 'Highest rated',
  popularity: 'Most popular',
  title: 'Title (A-Z)',
}

export function Person() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const rawBack = (location.state as { backLabel?: string } | null)?.backLabel
  const backLabel = rawBack ? `Back to ${rawBack}` : 'Back'

  const [person, setPerson] = useState<TMDbPersonDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  // Filmography controls
  const [search, setSearch] = useState('')
  const [department, setDepartment] = useState<string | 'all'>('all')
  const [mediaType, setMediaType] = useState<CreditMediaType | 'all'>('all')
  const [sort, setSort] = useState<CreditSort>('newest')
  const [visible, setVisible] = useState(CREDITS_PAGE)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setExpanded(false)
    setSearch(''); setDepartment('all'); setMediaType('all'); setSort('newest')
    getPerson(Number(id))
      .then((data) => { if (!cancelled) setPerson(data) })
      .catch((err) => { if (!cancelled) console.error(err) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id])

  const credits = useMemo(() => buildPersonCredits(person), [person])
  const departments = useMemo(
    () => sortDepartments([...new Set(credits.flatMap((c) => c.departments))]),
    [credits]
  )
  const shown = useMemo(
    () => filterCredits(credits, { search, department, mediaType, sort }),
    [credits, search, department, mediaType, sort]
  )

  // Any control change starts the list over from the top.
  useEffect(() => { setVisible(CREDITS_PAGE) }, [search, department, mediaType, sort])

  if (loading) return <PersonSkeleton />

  if (!person) return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <p className="text-muted-foreground">Person not found</p>
      <Button onClick={() => navigate(-1)} variant="outline">
        <ArrowLeft className="h-4 w-4 mr-2" /> Go Back
      </Button>
    </div>
  )

  const bio = person.biography ?? ''
  const bioShort = bio.length > 400

  // Age counts up to today while they're alive, and freezes at the deathday
  // once TMDb has one.
  const age = ageInYears(person.birthday, person.deathday)
  const movieCount = credits.filter((c) => c.mediaType === 'movie').length
  const showCount = credits.filter((c) => c.mediaType === 'tv').length

  // External links surfaced from the TMDb response (homepage, IMDb, socials).
  // People use /name/ on IMDb (vs. /title/ for titles) and /person/ on TMDb.
  const ext = person.external_ids
  const imdbId = person.imdb_id ?? ext?.imdb_id
  const externalLinks: { label: string; href: string }[] = []
  if (person.homepage) externalLinks.push({ label: 'Official Site', href: person.homepage })
  if (imdbId) externalLinks.push({ label: 'IMDb', href: `https://www.imdb.com/name/${imdbId}/` })
  externalLinks.push({ label: 'TMDb', href: `https://www.themoviedb.org/person/${person.id}` })
  if (ext?.instagram_id) externalLinks.push({ label: 'Instagram', href: `https://www.instagram.com/${ext.instagram_id}` })
  if (ext?.twitter_id) externalLinks.push({ label: 'X', href: `https://twitter.com/${ext.twitter_id}` })
  if (ext?.tiktok_id) externalLinks.push({ label: 'TikTok', href: `https://www.tiktok.com/@${ext.tiktok_id}` })
  if (ext?.youtube_id) externalLinks.push({ label: 'YouTube', href: ext.youtube_id.startsWith('UC') ? `https://www.youtube.com/channel/${ext.youtube_id}` : `https://www.youtube.com/${ext.youtube_id}` })
  if (ext?.facebook_id) externalLinks.push({ label: 'Facebook', href: `https://www.facebook.com/${ext.facebook_id}` })
  if (ext?.wikidata_id) externalLinks.push({ label: 'Wikidata', href: `https://www.wikidata.org/wiki/${ext.wikidata_id}` })

  return (
    <ScrollArea className="h-full">
      <div className="view-container p-6 max-w-5xl mx-auto">
        <Button
          variant="ghost"
          size="sm"
          className="mb-6 gap-1.5 text-muted-foreground hover:text-foreground"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="h-4 w-4" /> {backLabel}
        </Button>

        <div className="flex flex-col sm:flex-row gap-6">
          {/* Profile photo */}
          <div className="flex-shrink-0">
            {person.profile_path ? (
              <img
                src={profileUrl(person.profile_path)}
                alt={person.name}
                className="w-36 h-52 object-cover rounded-xl shadow-lg ring-2 ring-border"
              />
            ) : (
              <div className="w-36 h-52 rounded-xl bg-secondary ring-2 ring-border flex items-center justify-center text-muted-foreground text-lg font-medium">
                {person.name.slice(0, 2).toUpperCase()}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-serif text-3xl font-normal">{person.name}</h1>
              {person.known_for_department && (
                <Badge variant="secondary" className="text-xs">{person.known_for_department}</Badge>
              )}
              {person.deathday && <Badge variant="outline" className="text-xs">Deceased</Badge>}
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2.5 text-sm text-muted-foreground">
              {person.birthday && (
                <span className="flex items-center gap-1.5">
                  <Cake className="h-3.5 w-3.5 flex-shrink-0" />
                  {fmtDate(person.birthday, 'MMMM d, yyyy')}
                  {age != null && !person.deathday && <span className="text-muted-foreground/70">(age {age})</span>}
                </span>
              )}
              {person.deathday && (
                <span className="flex items-center gap-1.5">
                  <Cross className="h-3.5 w-3.5 flex-shrink-0" />
                  {fmtDate(person.deathday, 'MMMM d, yyyy')}
                  {age != null && <span className="text-muted-foreground/70">(aged {age})</span>}
                </span>
              )}
              {person.place_of_birth && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                  {person.place_of_birth}
                </span>
              )}
              {credits.length > 0 && (
                <span className="flex items-center gap-1.5">
                  <Film className="h-3.5 w-3.5 flex-shrink-0" />
                  {movieCount > 0 && `${movieCount} ${movieCount === 1 ? 'film' : 'films'}`}
                  {movieCount > 0 && showCount > 0 && ', '}
                  {showCount > 0 && `${showCount} ${showCount === 1 ? 'show' : 'shows'}`}
                </span>
              )}
            </div>

            {person.also_known_as && person.also_known_as.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground/80">
                <span className="text-muted-foreground">Also known as</span>{' '}
                {person.also_known_as.slice(0, 4).join(', ')}
              </p>
            )}

            {externalLinks.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-3">
                {externalLinks.map((link) => (
                  <a
                    key={link.label}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => { e.preventDefault(); window.open(link.href, '_blank', 'noopener,noreferrer') }}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors cursor-pointer"
                  >
                    <ExternalLink className="h-3 w-3" />
                    {link.label}
                  </a>
                ))}
              </div>
            )}

            {bio && (
              <div className="mt-4">
                <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                  {bioShort && !expanded ? bio.slice(0, 400).trimEnd() + '...' : bio}
                </p>
                {bioShort && (
                  <button
                    onClick={() => setExpanded(!expanded)}
                    className="text-xs text-primary mt-1 hover:underline cursor-pointer"
                  >
                    {expanded ? 'Show less' : 'Read more'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Filmography */}
        {credits.length > 0 && (
          <section className="mt-10">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <h2 className="font-semibold text-sm mr-1">
                Filmography <span className="text-muted-foreground font-normal">{credits.length}</span>
              </h2>
              <div className="relative flex-1 min-w-40">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search titles and roles..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 h-8 w-full text-sm"
                  aria-label="Search filmography"
                />
              </div>
              <Select value={mediaType} onValueChange={(v) => setMediaType(v as CreditMediaType | 'all')}>
                <SelectTrigger className="h-8 w-28 text-xs" aria-label="Filter by media type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All media</SelectItem>
                  <SelectItem value="movie">Movies</SelectItem>
                  <SelectItem value="tv">TV shows</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sort} onValueChange={(v) => setSort(v as CreditSort)}>
                <SelectTrigger className="h-8 w-36 text-xs" aria-label="Sort filmography">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SORT_LABELS) as CreditSort[]).map((key) => (
                    <SelectItem key={key} value={key}>{SORT_LABELS[key]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Department tabs - only the ones this person actually has credits in */}
            {departments.length > 1 && (
              <div className="flex flex-wrap gap-1 mb-4">
                {['all', ...departments].map((dep) => {
                  const count = dep === 'all'
                    ? credits.length
                    : credits.filter((c) => c.departments.includes(dep)).length
                  return (
                    <button
                      key={dep}
                      onClick={() => setDepartment(dep)}
                      className={cn(
                        'px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer transition-colors whitespace-nowrap border',
                        department === dep
                          ? 'bg-card text-foreground border-border/60 shadow-sm'
                          : 'text-muted-foreground border-transparent hover:text-foreground hover:bg-card/40'
                      )}
                    >
                      {dep === 'all' ? 'All' : dep === ACTING ? 'Acting' : dep}
                      <span className="ml-1 text-muted-foreground/70">{count}</span>
                    </button>
                  )
                })}
              </div>
            )}

            {shown.length === 0 ? (
              <EmptyState
                icon={SearchX}
                title="No matching credits"
                description="Try a different search term or clear the filters."
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setSearch(''); setDepartment('all'); setMediaType('all') }}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <>
                <div
                  className="grid gap-3"
                  style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}
                >
                  {shown.slice(0, visible).map((credit) => (
                    // No explicit mediaType: the credit carries genre_ids and
                    // origin_country, so MediaCard's own detection still sorts
                    // Japanese animation into 'anime' like every other grid.
                    <MediaCard
                      key={credit.key}
                      item={creditToSearchResult(credit)}
                      backLabel={person.name}
                      subtitle={creditRoleLabel(credit)}
                    />
                  ))}
                </div>
                {shown.length > visible && (
                  <div className="flex justify-center pt-5">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setVisible((v) => v + CREDITS_PAGE)}
                    >
                      Load More ({shown.length - visible} left)
                    </Button>
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </div>
    </ScrollArea>
  )
}

function PersonSkeleton() {
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <Skeleton className="h-8 w-20" />
      <div className="flex gap-6">
        <Skeleton className="w-36 h-52 rounded-xl flex-shrink-0" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
      <div className="pt-6 space-y-3">
        <Skeleton className="h-8 w-full" />
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} className="w-full aspect-[2/3] rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  )
}
