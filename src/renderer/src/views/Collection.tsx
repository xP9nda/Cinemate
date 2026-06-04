import React, { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Archive, Plus, Trash2, Search, Film, Tv, Package, Edit2, X, Filter } from 'lucide-react'
import { useStore } from '../lib/store'
import { cn, posterUrl, resolvePageSize, DEFAULT_PAGINATION } from '../lib/utils'
import { EmptyState } from '../components/shared/EmptyState'
import { CollectionForm, FORMAT_LABELS, FORMAT_COLORS } from '../components/shared/CollectionForm'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { ScrollArea } from '../components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../components/ui/dialog'
import { toast } from 'sonner'
import type { CollectionEntry, CollectionFormat, MediaType } from '../types'

export function Collection() {
  const navigate = useNavigate()
  const collection = useStore(s => s.collection)
  const removeCollectionEntry = useStore(s => s.removeCollectionEntry)
  const library = useStore(s => s.library)
  const collectionPageSize = useStore(s => s.settings.pagination?.collection)
  const PAGE_SIZE = resolvePageSize(collectionPageSize, DEFAULT_PAGINATION.collection)

  const [query, setQuery] = useState('')
  const [formatFilter, setFormatFilter] = useState<CollectionFormat | 'all'>('all')
  const [typeFilter, setTypeFilter] = useState<MediaType | 'all'>('all')
  const [addOpen, setAddOpen] = useState(false)
  const [editEntry, setEditEntry] = useState<CollectionEntry | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const filtered = useMemo(() => {
    let items = [...collection].sort((a, b) => b.addedDate - a.addedDate)
    if (query.trim()) {
      const q = query.toLowerCase()
      items = items.filter((c) => c.title.toLowerCase().includes(q) || c.notes.toLowerCase().includes(q))
    }
    if (formatFilter !== 'all') items = items.filter((c) => c.format === formatFilter)
    if (typeFilter !== 'all') items = items.filter((c) => c.mediaType === typeFilter)
    return items
  }, [collection, query, formatFilter, typeFilter])

  const paged = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount])
  const hasMore = paged.length < filtered.length

  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [query, formatFilter, typeFilter, PAGE_SIZE])

  const formatCounts = useMemo(() => {
    const counts: Partial<Record<CollectionFormat, number>> = {}
    for (const c of collection) {
      counts[c.format] = (counts[c.format] ?? 0) + 1
    }
    return counts
  }, [collection])

  const handleDelete = async (id: string) => {
    await removeCollectionEntry(id)
    toast.success('Removed from collection')
    setDeleteConfirm(null)
  }

  if (collection.length === 0 && !addOpen) {
    return (
      <div className="h-full flex flex-col">
        <div className="p-4 border-b border-border/50 flex items-center justify-between">
          <h1 className="font-serif text-xl font-normal">Collection</h1>
          <Button size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add Item
          </Button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={Archive}
            title="No collection yet"
            description="Track your physical media: Blu-rays, DVDs, 4K discs, VHS and more."
          />
        </div>
        <Dialog open={addOpen} onOpenChange={(v) => !v && setAddOpen(false)}>
          <DialogContent className="max-w-md" onOpenAutoFocus={(e) => e.preventDefault()}>
            <DialogHeader><DialogTitle>Add to Collection</DialogTitle></DialogHeader>
            <CollectionForm onClose={() => setAddOpen(false)} onSaved={() => setAddOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border/50">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="font-serif text-xl font-normal">Collection</h1>
            <p className="text-xs text-muted-foreground mt-0.5">{collection.length} item{collection.length !== 1 ? 's' : ''}</p>
          </div>
          <Button size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add Item
          </Button>
        </div>

        {/* Format summary pills */}
        {collection.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {(Object.keys(formatCounts) as CollectionFormat[]).map((fmt) => (
              <button
                key={fmt}
                onClick={() => setFormatFilter(formatFilter === fmt ? 'all' : fmt)}
                className={cn(
                  'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer',
                  formatFilter === fmt ? FORMAT_COLORS[fmt] : 'bg-secondary text-muted-foreground hover:text-foreground'
                )}
              >
                {FORMAT_LABELS[fmt]} <span className="opacity-60">({formatCounts[fmt]})</span>
              </button>
            ))}
          </div>
        )}

        {/* Search + type filter */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search collection..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8 h-8 text-xs"
            />
          </div>
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as MediaType | 'all')}>
            <SelectTrigger className="w-32 h-8 text-xs">
              <Filter className="h-3 w-3 mr-1 opacity-60" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="movie">Movies</SelectItem>
              <SelectItem value="tv">TV Shows</SelectItem>
              <SelectItem value="anime">Anime</SelectItem>
            </SelectContent>
          </Select>
          {(query || formatFilter !== 'all' || typeFilter !== 'all') && (
            <Button size="sm" variant="ghost" className="h-8 px-2 text-xs text-muted-foreground" onClick={() => { setQuery(''); setFormatFilter('all'); setTypeFilter('all') }}>
              <X className="h-3 w-3 mr-1" /> Clear
            </Button>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4">
          {filtered.length === 0 ? (
            <EmptyState icon={Search} title="No results" description="Try adjusting your search or filters." />
          ) : (
            <>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
              {paged.map((item) => {
                const linked = item.mediaId ? library[item.mediaId] : null
                return (
                  <div
                    key={item.id}
                    className="flex gap-3 p-3 rounded-xl bg-card border border-border/40 hover:border-border transition-colors"
                    style={{ contentVisibility: 'auto', containIntrinsicSize: '0 90px' } as React.CSSProperties}
                  >
                    {/* Poster */}
                    <div
                      className={cn(
                        'h-20 w-14 rounded-lg overflow-hidden flex-shrink-0 bg-secondary flex items-center justify-center',
                        linked && 'cursor-pointer hover:opacity-80 transition-opacity'
                      )}
                      onClick={() => linked && navigate(`/detail/${linked.mediaType}/${linked.tmdbId}`, { state: { backLabel: 'Collection' } })}
                    >
                      {item.posterPath ? (
                        <img src={posterUrl(item.posterPath, 'w92')} alt={item.title} className="w-full h-full object-cover" />
                      ) : (
                        <Package className="h-6 w-6 text-muted-foreground/40" />
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p
                            className={cn('text-sm font-medium truncate', linked && 'cursor-pointer hover:text-primary transition-colors')}
                            onClick={() => linked && navigate(`/detail/${linked.mediaType}/${linked.tmdbId}`, { state: { backLabel: 'Collection' } })}
                          >
                            {item.title}
                          </p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium', FORMAT_COLORS[item.format])}>
                              {FORMAT_LABELS[item.format]}
                            </span>
                            {item.mediaType === 'movie' ? (
                              <Film className="h-3 w-3 text-muted-foreground/50" />
                            ) : (
                              <Tv className="h-3 w-3 text-muted-foreground/50" />
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            className="h-6 w-6 text-muted-foreground hover:text-foreground"
                            onClick={() => setEditEntry(item)}
                          >
                            <Edit2 className="h-3 w-3" />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            onClick={() => setDeleteConfirm(item.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>

                      {item.purchasedDate && (
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Purchased {new Date(item.purchasedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                      )}
                      {item.notes && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate italic">{item.notes}</p>
                      )}

                    </div>
                  </div>
                )
              })}
            </div>
            {hasMore && (
              <div className="flex justify-center pt-4">
                <Button variant="outline" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
                  Load More ({filtered.length - paged.length} remaining)
                </Button>
              </div>
            )}
            </>
          )}
        </div>
      </ScrollArea>

      {/* Add dialog */}
      <Dialog open={addOpen} onOpenChange={(v) => !v && setAddOpen(false)}>
        <DialogContent className="max-w-md" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader><DialogTitle>Add to Collection</DialogTitle></DialogHeader>
          <CollectionForm onClose={() => setAddOpen(false)} onSaved={() => setAddOpen(false)} />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editEntry} onOpenChange={(v) => !v && setEditEntry(null)}>
        <DialogContent className="max-w-md" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader><DialogTitle>Edit Item</DialogTitle></DialogHeader>
          {editEntry && (
            <CollectionForm
              existing={editEntry}
              onClose={() => setEditEntry(null)}
              onSaved={() => setEditEntry(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={(v) => !v && setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove from collection?</DialogTitle>
            <DialogDescription>
              {deleteConfirm
                ? `"${collection.find((i) => i.id === deleteConfirm)?.title}" will be removed from your collection.`
                : 'This item will be removed from your collection.'} This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
