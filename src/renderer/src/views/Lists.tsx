import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, List as ListIcon, Trash2, Edit2, Film, Search, ArrowUp, ArrowDown, Zap, ArrowUpDown } from 'lucide-react'
import { useStore } from '../lib/store'
import { uid, posterUrl, resolvePageSize, DEFAULT_PAGINATION } from '../lib/utils'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog'
import { EmptyState } from '../components/shared/EmptyState'
import { stripMarkdown } from '../components/shared/MarkdownContent'
import { ListFormModal } from '../components/shared/ListFormModal'
import { ScrollArea } from '../components/ui/scroll-area'
import { Badge } from '../components/ui/badge'
import { toast } from 'sonner'
import type { CustomList, ListRules } from '../types'

type ListSortKey = 'createdAt' | 'name' | 'itemCount'
type SortDir = 'asc' | 'desc'

const LS = {
  search: 'cinemate-lists-search',
  sort: 'cinemate-lists-sort',
  sortDir: 'cinemate-lists-sort-dir',
} as const

const SORT_KEYS: ListSortKey[] = ['createdAt', 'name', 'itemCount']
const SORT_DIRS: SortDir[] = ['asc', 'desc']

function readLS<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const v = localStorage.getItem(key)
  return (v && (allowed as readonly string[]).includes(v)) ? (v as T) : fallback
}

export function Lists() {
  const navigate = useNavigate()
  const lists = useStore(s => s.lists)
  const library = useStore(s => s.library)
  const listsPageSize = useStore(s => s.settings.pagination?.lists)
  const setList = useStore(s => s.setList)
  const removeList = useStore(s => s.removeList)
  const PAGE_SIZE = resolvePageSize(listsPageSize, DEFAULT_PAGINATION.lists)
  const [createOpen, setCreateOpen] = useState(false)
  const [editList, setEditList] = useState<CustomList | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const [search, setSearch] = useState(() => localStorage.getItem(LS.search) ?? '')
  const [sort, setSort] = useState<ListSortKey>(() => readLS<ListSortKey>(LS.sort, SORT_KEYS, 'createdAt'))
  const [sortDir, setSortDir] = useState<SortDir>(() => readLS<SortDir>(LS.sortDir, SORT_DIRS, 'desc'))
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  useEffect(() => { localStorage.setItem(LS.search, search) }, [search])
  useEffect(() => { localStorage.setItem(LS.sort, sort) }, [sort])
  useEffect(() => { localStorage.setItem(LS.sortDir, sortDir) }, [sortDir])
  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [search, sort, sortDir, PAGE_SIZE])

  const visibleLists = useMemo(() => {
    let l = [...lists]
    const q = search.trim().toLowerCase()
    if (q) {
      l = l.filter((list) =>
        list.name.toLowerCase().includes(q) ||
        (list.description ?? '').toLowerCase().includes(q)
      )
    }
    l.sort((a, b) => {
      let av: number | string = 0
      let bv: number | string = 0
      switch (sort) {
        case 'name': av = a.name.toLowerCase(); bv = b.name.toLowerCase(); break
        case 'createdAt': av = a.createdAt; bv = b.createdAt; break
        case 'itemCount': av = a.itemIds.length; bv = b.itemIds.length; break
      }
      if (typeof av === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av)
      }
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number)
    })
    return l
  }, [lists, search, sort, sortDir])

  const pagedLists = useMemo(() => visibleLists.slice(0, visibleCount), [visibleLists, visibleCount])
  const hasMore = pagedLists.length < visibleLists.length

  const handleCreate = async (name: string, description: string, rules: ListRules) => {
    const newList: CustomList = {
      id: `list:${uid()}`,
      name,
      description,
      createdAt: Date.now(),
      itemIds: [],
      rules,
    }
    await setList(newList)
    toast.success('List created')
    setCreateOpen(false)
  }

  const handleEdit = async (id: string, name: string, description: string, rules: ListRules) => {
    const existing = lists.find((l) => l.id === id)
    if (!existing) return
    await setList({ ...existing, name, description, rules })
    toast.success('List updated')
    setEditList(null)
  }

  const handleDelete = async (id: string) => {
    await removeList(id)
    toast.success('List deleted')
    setConfirmDelete(null)
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-serif text-xl font-normal mr-1">Lists</h1>
          <div className="relative flex-1 min-w-32">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Filter..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 w-full text-sm"
              aria-label="Filter lists"
            />
          </div>
          <Select value={sort} onValueChange={(v) => setSort(v as ListSortKey)}>
            <SelectTrigger className="h-8 w-40 text-xs">
              <ArrowUpDown className="h-3 w-3 mr-1 opacity-60" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="createdAt">Date Created</SelectItem>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="itemCount">Item Count</SelectItem>
            </SelectContent>
          </Select>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-sm"
                variant="secondary"
                onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                aria-label="Toggle sort direction"
              >
                {sortDir === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{sortDir === 'asc' ? 'Ascending' : 'Descending'}</TooltipContent>
          </Tooltip>
          <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> New List
          </Button>
        </div>

        {lists.length === 0 ? (
          <EmptyState
            icon={ListIcon}
            title="No lists yet"
            description="Create custom lists to organise your movies and TV shows."
            action={
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Create List
              </Button>
            }
          />
        ) : visibleLists.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No matching lists"
            description="Try a different search term."
          />
        ) : (
          <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pagedLists.map((list) => {
              const items = list.itemIds.slice(0, 4).map((id) => {
                const libId = id.includes('::') ? id.slice(0, id.indexOf('::')) : id
                return library[libId] ?? list.itemMeta?.[libId]
              }).filter(Boolean)
              return (
                <div
                  key={list.id}
                  className="rounded-xl bg-card border border-border/50 hover:border-border transition-colors overflow-hidden cursor-pointer"
                  onClick={() => navigate(`/lists/${list.id}`)}
                  role="article"
                  aria-label={list.name}
                >
                  <div className="grid grid-cols-4 h-24">
                    {items.length > 0
                      ? items.map((item, i) => (
                          <div key={i} className="overflow-hidden bg-secondary">
                            {item!.posterPath ? (
                              <img
                                src={posterUrl(item!.posterPath, 'w92')}
                                alt={item!.title}
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <div className="w-full h-full bg-secondary" />
                            )}
                          </div>
                        ))
                      : null}
                    {Array.from({ length: Math.max(0, 4 - items.length) }, (_, i) => (
                      <div key={`empty-${i}`} className="bg-secondary flex items-center justify-center">
                        {i === 0 && items.length === 0 && <Film className="h-6 w-6 text-muted-foreground/20" />}
                      </div>
                    ))}
                  </div>

                  <div className="p-3">
                    <div className="flex items-start gap-2">
                      <p className="font-medium text-sm flex-1">{list.name}</p>
                      {list.rules?.enabled && (
                        <Badge variant="default" className="gap-1 px-1.5 py-0 text-[10px] flex-shrink-0">
                          <Zap className="h-2.5 w-2.5" />
                          Smart
                        </Badge>
                      )}
                    </div>
                    {list.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{stripMarkdown(list.description)}</p>
                    )}
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-muted-foreground">
                        {list.itemIds.length} item{list.itemIds.length !== 1 ? 's' : ''}
                      </span>
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button size="icon-sm" variant="ghost" onClick={() => setEditList(list)} aria-label="Edit list">
                          <Edit2 className="h-3 w-3" />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => setConfirmDelete(list.id)}
                          className="text-muted-foreground hover:text-destructive"
                          aria-label="Delete list"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
                Load More ({visibleLists.length - pagedLists.length} remaining)
              </Button>
            </div>
          )}
          </>
        )}
      </div>

      <ListFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSave={handleCreate}
        title="New List"
      />

      {editList && (
        <ListFormModal
          open={!!editList}
          onClose={() => setEditList(null)}
          onSave={(name, desc, rules) => handleEdit(editList.id, name, desc, rules)}
          title="Edit List"
          initialName={editList.name}
          initialDescription={editList.description}
          initialRules={editList.rules}
        />
      )}

      <Dialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete list?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">This action cannot be undone. The list will be permanently deleted.</p>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => confirmDelete && handleDelete(confirmDelete)}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ScrollArea>
  )
}
