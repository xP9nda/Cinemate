import { useEffect, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, Calendar, MapPin, ExternalLink } from 'lucide-react'
import { getPerson } from '../lib/tmdb'
import { profileUrl, fmtDate } from '../lib/utils'
import { Button } from '../components/ui/button'
import { ScrollArea } from '../components/ui/scroll-area'
import { Skeleton } from '../components/ui/skeleton'
import { ScrollableRow } from '../components/shared/ScrollableRow'
import { MediaCard } from '../components/shared/MediaCard'
import type { TMDbPerson, TMDbSearchResult, TMDbExternalIds } from '../types'

type PersonData = TMDbPerson & {
  biography?: string
  birthday?: string
  place_of_birth?: string
  homepage?: string | null
  imdb_id?: string | null
  external_ids?: TMDbExternalIds
  movie_credits?: { cast: TMDbSearchResult[] }
  tv_credits?: { cast: TMDbSearchResult[] }
}

export function Person() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const rawBack = (location.state as { backLabel?: string } | null)?.backLabel
  const backLabel = rawBack ? `Back to ${rawBack}` : 'Back'

  const [person, setPerson] = useState<PersonData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getPerson(Number(id))
      .then((data) => { if (!cancelled) setPerson(data as PersonData) })
      .catch((err) => { if (!cancelled) console.error(err) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id])

  if (loading) return <PersonSkeleton />

  if (!person) return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <p className="text-muted-foreground">Person not found</p>
      <Button onClick={() => navigate(-1)} variant="outline">
        <ArrowLeft className="h-4 w-4 mr-2" /> Go Back
      </Button>
    </div>
  )

  const allMovies = Array.from(new Map((person.movie_credits?.cast ?? []).map((m) => [m.id, m])).values())
    .sort((a, b) => (b.vote_count ?? 0) - (a.vote_count ?? 0))
  const movies = allMovies.slice(0, 20)

  const allShows = Array.from(new Map((person.tv_credits?.cast ?? []).map((s) => [s.id, s])).values())
    .sort((a, b) => (b.vote_count ?? 0) - (a.vote_count ?? 0))
  const shows = allShows.slice(0, 20)

  const bio = person.biography ?? ''
  const bioShort = bio.length > 400

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
      <div className="view-container p-6 max-w-4xl mx-auto">
        <Button
          variant="ghost"
          size="sm"
          className="mb-6 gap-1.5 text-muted-foreground hover:text-foreground"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="h-4 w-4" /> {backLabel}
        </Button>

        <div className="flex gap-6">
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
            <h1 className="font-serif text-3xl font-normal">{person.name}</h1>
            <div className="flex flex-wrap gap-3 mt-2 text-sm text-muted-foreground">
              {person.birthday && (
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  {fmtDate(person.birthday, 'MMMM d, yyyy')}
                </span>
              )}
              {person.place_of_birth && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" />
                  {person.place_of_birth}
                </span>
              )}
            </div>

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
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {bioShort && !expanded ? bio.slice(0, 400) + '...' : bio}
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

        {movies.length > 0 && (
          <section className="mt-10">
            <h2 className="font-semibold text-sm mb-3">Movies <span className="text-muted-foreground font-normal">{allMovies.length}</span></h2>
            <ScrollableRow>
              {movies.map((item) => (
                <MediaCard
                  key={item.id}
                  item={{ ...item, media_type: 'movie' }}
                  mediaType="movie"
                  backLabel={person.name}
                  width={160}
                />
              ))}
            </ScrollableRow>
          </section>
        )}

        {shows.length > 0 && (
          <section className="mt-8">
            <h2 className="font-semibold text-sm mb-3">TV Shows <span className="text-muted-foreground font-normal">{allShows.length}</span></h2>
            <ScrollableRow>
              {shows.map((item) => (
                <MediaCard
                  key={item.id}
                  item={{ ...item, media_type: 'tv' }}
                  mediaType="tv"
                  backLabel={person.name}
                  width={160}
                />
              ))}
            </ScrollableRow>
          </section>
        )}
      </div>
    </ScrollArea>
  )
}

function PersonSkeleton() {
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <Skeleton className="h-8 w-20" />
      <div className="flex gap-6">
        <Skeleton className="w-36 h-52 rounded-xl flex-shrink-0" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    </div>
  )
}
