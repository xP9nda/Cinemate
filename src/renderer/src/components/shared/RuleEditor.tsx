import React, { useEffect, useMemo, useState } from 'react'
import { Film, Plus, Trash2, Tv, Zap } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Switch } from '../ui/switch'
import { Label } from '../ui/label'
import { Badge } from '../ui/badge'
import {
  FIELD_META,
  OPERATOR_LABEL,
  defaultRule,
  normalizeScope,
} from '../../lib/rulesEngine'
import { getMovieGenres, getTVGenres } from '../../lib/tmdb'
import { useStore } from '../../lib/store'
import type {
  ListRule,
  ListRules,
  ListScope,
  RuleCombinator,
  RuleField,
  RuleOperator,
  TMDbGenre,
} from '../../types'

interface RuleEditorProps {
  value: ListRules
  onChange: (next: ListRules) => void
  ratingMax: number
}

const FIELD_KEYS = Object.keys(FIELD_META) as RuleField[]

function genId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function operatorWantsValue(op: RuleOperator): boolean {
  return op !== 'is_set' && op !== 'is_not_set' && op !== 'is_true' && op !== 'is_false'
}

function operatorWantsSecondValue(op: RuleOperator): boolean {
  return op === 'between'
}

function operatorIsMulti(op: RuleOperator): boolean {
  return op === 'in' || op === 'not_in'
}

export function RuleEditor({ value, onChange, ratingMax }: RuleEditorProps) {
  const apiKey = useStore((s) => s.settings.apiKey)
  const [genres, setGenres] = useState<TMDbGenre[]>([])

  useEffect(() => {
    let cancelled = false
    if (!apiKey) return
    const needsGenre = value.rules.some((r) => r.field === 'genreId')
    if (!needsGenre || genres.length > 0) return
    ;(async () => {
      try {
        const [m, t] = await Promise.all([getMovieGenres(), getTVGenres()])
        if (cancelled) return
        const merged = new Map<number, string>()
        for (const g of [...m.genres, ...t.genres]) merged.set(g.id, g.name)
        setGenres(
          Array.from(merged.entries())
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name))
        )
      } catch {
        /* TMDb unreachable - genre selector falls back to id input */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [apiKey, value.rules, genres.length])

  const update = (next: Partial<ListRules>): void => {
    onChange({ ...value, ...next })
  }

  const updateRule = (id: string, patch: Partial<ListRule>): void => {
    update({
      rules: value.rules.map((r) => {
        if (r.id !== id) return r
        const next = { ...r, ...patch }
        // When operator type changes, drop incompatible value fields.
        if (patch.operator) {
          if (!operatorWantsValue(patch.operator)) {
            next.value = undefined
            next.value2 = null
            next.values = undefined
          } else if (!operatorWantsSecondValue(patch.operator)) {
            next.value2 = null
          }
          if (!operatorIsMulti(patch.operator)) next.values = undefined
          if (operatorIsMulti(patch.operator)) next.value = undefined
        }
        // When field changes, reset operator/values to defaults for the new kind.
        if (patch.field) {
          const meta = FIELD_META[patch.field]
          const newOp = meta.operators[0]
          next.operator = newOp
          next.value = undefined
          next.value2 = null
          next.values = undefined
        }
        return next
      }),
    })
  }

  const addRule = (): void => {
    update({ rules: [...value.rules, { ...defaultRule(), id: genId() }] })
  }

  const removeRule = (id: string): void => {
    update({ rules: value.rules.filter((r) => r.id !== id) })
  }

  const ratingStep = useMemo(() => (ratingMax === 5 ? 0.5 : 1), [ratingMax])
  const currentYear = new Date().getFullYear()

  return (
    <div className="rounded-lg border border-border/50 bg-secondary/30 p-3 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Zap className="h-3.5 w-3.5 text-primary" />
        <Label htmlFor="rules-toggle" className="text-sm font-medium cursor-pointer">
          Auto-populate using rules
        </Label>
        <Switch
          id="rules-toggle"
          checked={value.enabled}
          onCheckedChange={(c) => update({ enabled: c })}
        />
        <Badge variant="secondary" className="ml-auto text-[10px]">
          {value.rules.length} rule{value.rules.length !== 1 ? 's' : ''}
        </Badge>
      </div>

      {!value.enabled ? (
        <p className="text-xs text-muted-foreground">
          When enabled, this list will be filled automatically with items that match the rules below.
          Manual adds and removes will be overwritten.
        </p>
      ) : (
        <>
          <ScopePicker
            value={normalizeScope(value.scope)}
            onChange={(scope) => update({ scope })}
          />
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <span className="text-muted-foreground">Match</span>
            <CombinatorToggle
              value={value.combinator}
              onChange={(c) => update({ combinator: c })}
            />
            <span className="text-muted-foreground">of these rules:</span>
          </div>
          {normalizeScope(value.scope).episodes && (
            <p className="text-[11px] text-muted-foreground/80 leading-snug">
              Episodes you've logged at least once are eligible. Rating, watched year, review and
              play-count rules are evaluated per episode.
            </p>
          )}

          {value.rules.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No rules yet - add one to start.</p>
          ) : (
            <div className="space-y-2">
              {value.rules.map((rule) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  genres={genres}
                  ratingMax={ratingMax}
                  ratingStep={ratingStep}
                  currentYear={currentYear}
                  onChange={(patch) => updateRule(rule.id, patch)}
                  onRemove={() => removeRule(rule.id)}
                />
              ))}
            </div>
          )}

          <Button type="button" size="sm" variant="ghost" onClick={addRule} className="gap-1.5 h-7 text-xs">
            <Plus className="h-3 w-3" /> Add rule
          </Button>
        </>
      )}
    </div>
  )
}

function CombinatorToggle({
  value,
  onChange,
}: {
  value: RuleCombinator
  onChange: (c: RuleCombinator) => void
}) {
  return (
    <div className="inline-flex rounded-md border border-border overflow-hidden">
      {(['all', 'any'] as const).map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={
            'px-2 py-0.5 text-xs cursor-pointer transition-colors ' +
            (value === c ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary')
          }
        >
          {c === 'all' ? 'all' : 'any'}
        </button>
      ))}
    </div>
  )
}

type ScopeKey = keyof ListScope

function ScopePicker({
  value,
  onChange,
}: {
  value: ListScope
  onChange: (s: ListScope) => void
}) {
  const options: Array<{ key: ScopeKey; label: string; icon: React.ReactNode; hint: string }> = [
    { key: 'movies', label: 'Movies', icon: <Film className="h-3 w-3" />, hint: 'Include movie entries' },
    { key: 'shows', label: 'TV shows', icon: <Tv className="h-3 w-3" />, hint: 'Include whole TV / anime entries' },
    { key: 'episodes', label: 'TV episodes', icon: <Tv className="h-3 w-3" />, hint: 'Include individual episodes you have logged' },
  ]
  const toggle = (k: ScopeKey): void => onChange({ ...value, [k]: !value[k] })
  const noneSelected = !value.movies && !value.shows && !value.episodes
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-muted-foreground">Include:</span>
      {options.map((o) => {
        const active = value[o.key]
        return (
          <button
            key={o.key}
            type="button"
            title={o.hint}
            onClick={() => toggle(o.key)}
            className={
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs cursor-pointer transition-colors ' +
              (active
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border text-muted-foreground hover:bg-secondary')
            }
          >
            {o.icon}
            {o.label}
          </button>
        )
      })}
      {noneSelected && (
        <span className="text-[11px] text-warning">Pick at least one to see results.</span>
      )}
    </div>
  )
}

interface RuleRowProps {
  rule: ListRule
  genres: TMDbGenre[]
  ratingMax: number
  ratingStep: number
  currentYear: number
  onChange: (patch: Partial<ListRule>) => void
  onRemove: () => void
}

function RuleRow({ rule, genres, ratingMax, ratingStep, currentYear, onChange, onRemove }: RuleRowProps) {
  const meta = FIELD_META[rule.field]
  const showValue = operatorWantsValue(rule.operator)
  const showSecondValue = operatorWantsSecondValue(rule.operator)
  const isMulti = operatorIsMulti(rule.operator)

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md bg-card border border-border/40 p-1.5">
      <Select value={rule.field} onValueChange={(v) => onChange({ field: v as RuleField })}>
        <SelectTrigger className="h-7 w-32 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FIELD_KEYS.map((f) => (
            <SelectItem key={f} value={f}>
              {FIELD_META[f].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={rule.operator} onValueChange={(v) => onChange({ operator: v as RuleOperator })}>
        <SelectTrigger className="h-7 w-24 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {meta.operators.map((op) => (
            <SelectItem key={op} value={op}>
              {OPERATOR_LABEL[op]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {showValue && !isMulti && (
        <ValueInput
          rule={rule}
          genres={genres}
          ratingMax={ratingMax}
          ratingStep={ratingStep}
          currentYear={currentYear}
          which="value"
          onChange={onChange}
        />
      )}

      {showSecondValue && (
        <>
          <span className="text-xs text-muted-foreground">and</span>
          <ValueInput
            rule={rule}
            genres={genres}
            ratingMax={ratingMax}
            ratingStep={ratingStep}
            currentYear={currentYear}
            which="value2"
            onChange={onChange}
          />
        </>
      )}

      {isMulti && (
        <MultiValueEditor
          rule={rule}
          genres={genres}
          onChange={onChange}
        />
      )}

      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        onClick={onRemove}
        className="ml-auto h-6 w-6 text-muted-foreground hover:text-destructive"
        aria-label="Remove rule"
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  )
}

interface ValueInputProps {
  rule: ListRule
  genres: TMDbGenre[]
  ratingMax: number
  ratingStep: number
  currentYear: number
  which: 'value' | 'value2'
  onChange: (patch: Partial<ListRule>) => void
}

function ValueInput({ rule, genres, ratingMax, ratingStep, currentYear, which, onChange }: ValueInputProps) {
  const meta = FIELD_META[rule.field]
  const raw = which === 'value' ? rule.value : rule.value2
  const stringValue = raw == null ? '' : String(raw)

  const commitNumber = (v: string): void => {
    if (v === '') {
      onChange(which === 'value' ? { value: undefined } : { value2: null })
      return
    }
    const n = Number(v)
    if (!Number.isFinite(n)) return
    onChange(which === 'value' ? { value: n } : { value2: n })
  }

  if (meta.valueKind === 'select') {
    return (
      <Select value={stringValue} onValueChange={(v) => onChange(which === 'value' ? { value: v } : { value2: Number(v) })}>
        <SelectTrigger className="h-7 w-28 text-xs">
          <SelectValue placeholder="value" />
        </SelectTrigger>
        <SelectContent>
          {(meta.selectOptions ?? []).map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (meta.valueKind === 'genre') {
    if (genres.length === 0) {
      return (
        <Input
          type="number"
          value={stringValue}
          onChange={(e) => commitNumber(e.target.value)}
          placeholder="genre id"
          className="h-7 w-24 text-xs"
        />
      )
    }
    return (
      <Select
        value={stringValue}
        onValueChange={(v) => onChange(which === 'value' ? { value: Number(v) } : { value2: Number(v) })}
      >
        <SelectTrigger className="h-7 w-32 text-xs">
          <SelectValue placeholder="Genre" />
        </SelectTrigger>
        <SelectContent>
          {genres.map((g) => (
            <SelectItem key={g.id} value={String(g.id)}>
              {g.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (meta.valueKind === 'rating') {
    return (
      <Input
        type="number"
        min={0}
        max={ratingMax}
        step={ratingStep}
        value={stringValue}
        onChange={(e) => commitNumber(e.target.value)}
        className="h-7 w-20 text-xs"
        placeholder="rating"
      />
    )
  }

  if (meta.valueKind === 'year') {
    return (
      <Input
        type="number"
        min={1888}
        max={currentYear + 10}
        step={1}
        value={stringValue}
        onChange={(e) => commitNumber(e.target.value)}
        className="h-7 w-20 text-xs"
        placeholder="year"
      />
    )
  }

  if (meta.valueKind === 'number') {
    return (
      <Input
        type="number"
        min={0}
        value={stringValue}
        onChange={(e) => commitNumber(e.target.value)}
        className="h-7 w-20 text-xs"
        placeholder="0"
      />
    )
  }

  return null
}

function MultiValueEditor({
  rule,
  genres,
  onChange,
}: {
  rule: ListRule
  genres: TMDbGenre[]
  onChange: (patch: Partial<ListRule>) => void
}) {
  const meta = FIELD_META[rule.field]
  const values = rule.values ?? []

  const toggle = (raw: string): void => {
    const next = values.includes(raw) ? values.filter((v) => v !== raw) : [...values, raw]
    onChange({ values: next })
  }

  if (meta.valueKind === 'select' && meta.selectOptions) {
    return (
      <div className="flex items-center gap-1 flex-wrap">
        {meta.selectOptions.map((o) => {
          const active = values.includes(o.value)
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => toggle(o.value)}
              className={
                'text-[10px] px-1.5 py-0.5 rounded-full border cursor-pointer transition-colors ' +
                (active
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border hover:bg-secondary')
              }
            >
              {o.label}
            </button>
          )
        })}
      </div>
    )
  }

  if (meta.valueKind === 'genre' && genres.length > 0) {
    return (
      <div className="flex items-center gap-1 flex-wrap max-w-[18rem]">
        {genres.map((g) => {
          const active = values.map(String).includes(String(g.id))
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => toggle(String(g.id))}
              className={
                'text-[10px] px-1.5 py-0.5 rounded-full border cursor-pointer transition-colors ' +
                (active
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border hover:bg-secondary')
              }
            >
              {g.name}
            </button>
          )
        })}
      </div>
    )
  }

  // Fallback for year multi: comma-separated input
  return (
    <Input
      type="text"
      value={values.join(', ')}
      onChange={(e) => {
        const parts = e.target.value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        const nums = parts.map((p) => Number(p)).filter((n) => Number.isFinite(n))
        onChange({ values: nums })
      }}
      placeholder="e.g. 2023, 2024"
      className="h-7 w-40 text-xs"
    />
  )
}
