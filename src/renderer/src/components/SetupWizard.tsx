import React, { useRef, useState } from 'react'
import { ArrowRight, Check, Eye, EyeOff, Film, Star, Tv, Upload } from 'lucide-react'
import { Toaster } from 'sonner'
import { useStore } from '../lib/store'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { TitleBar } from './layout/TitleBar'
import { ImportDialog } from './ImportDialog'
import type { ImportSource } from '../lib/importHelpers'

type WizardStep = 'welcome' | 'profile' | 'apikey' | 'import' | 'done'
const CONTENT_STEPS: WizardStep[] = ['profile', 'apikey', 'import']

// ─── Logo ─────────────────────────────────────────────────────────────────────

function WizardLogo({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="20" height="20" rx="4" fill="hsl(262 33% 66%)" opacity="0.9" />
      <rect x="5" y="7" width="3" height="10" rx="1" fill="white" opacity="0.9" />
      <rect x="10.5" y="7" width="3" height="10" rx="1" fill="white" opacity="0.9" />
      <rect x="16" y="7" width="3" height="10" rx="1" fill="hsl(176 53% 55%)" />
    </svg>
  )
}

// ─── Decorative left panel ────────────────────────────────────────────────────

function LeftPanel() {
  const cols = [
    ['hsl(262 40% 45%)', 'hsl(176 50% 35%)', 'hsl(230 45% 42%)', 'hsl(262 35% 55%)', 'hsl(176 45% 28%)'],
    ['hsl(176 45% 28%)', 'hsl(262 40% 55%)', 'hsl(230 45% 52%)', 'hsl(176 50% 45%)', 'hsl(262 40% 38%)'],
    ['hsl(230 45% 52%)', 'hsl(262 40% 45%)', 'hsl(176 50% 35%)', 'hsl(230 45% 42%)', 'hsl(262 35% 60%)'],
  ]
  const heights = [130, 155, 110, 145, 125]

  return (
    <div className="hidden lg:flex w-72 xl:w-80 flex-shrink-0 relative overflow-hidden bg-card border-r border-border/50">
      {/* Poster grid background */}
      <div className="absolute inset-0 flex items-center justify-center gap-2.5 px-4 opacity-[0.18]">
        {cols.map((col, ci) => (
          <div
            key={ci}
            className={cn('flex flex-col gap-2.5 flex-shrink-0', ci === 1 && 'mt-12', ci === 2 && '-mt-6')}
          >
            {col.map((color, pi) => (
              <div
                key={pi}
                className="w-16 xl:w-20 rounded-lg flex-shrink-0"
                style={{ height: `${heights[pi]}px`, background: color }}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Fade overlays */}
      <div className="absolute inset-y-0 right-0 w-20 bg-gradient-to-r from-transparent to-card/90" />
      <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-card/70 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-card/70 to-transparent" />

      {/* Branding */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-10">
        <WizardLogo size={56} />
        <div className="text-center space-y-1">
          <h2 className="font-serif text-2xl font-normal text-foreground">Cinemate</h2>
        </div>
        <div className="flex items-center gap-4 mt-2 text-muted-foreground/40">
          <Film className="h-5 w-5" />
          <Tv className="h-5 w-5" />
          <Star className="h-5 w-5" />
        </div>
      </div>
    </div>
  )
}

// ─── Wizard ───────────────────────────────────────────────────────────────────

export function SetupWizard() {
  const updateSettings = useStore(s => s.updateSettings)
  const theme = useStore(s => s.settings.theme)

  const [step, setStep] = useState<WizardStep>('welcome')
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importSource, setImportSource] = useState<ImportSource | null>(null)
  const [importedOnce, setImportedOnce] = useState(false)
  const avatarRef = useRef<HTMLInputElement>(null)

  const stepIdx = CONTENT_STEPS.indexOf(step)

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setAvatar(reader.result as string)
    reader.readAsDataURL(file)
  }

  const openImport = (src: ImportSource) => {
    setImportSource(src)
    setImportOpen(true)
  }

  const handleProfileNext = async () => {
    await updateSettings({ username: name.trim() || 'Guest', avatar })
    setStep('apikey')
  }

  const handleApiKeyNext = async () => {
    await updateSettings({ apiKey: apiKey.trim() || null })
    setStep('import')
  }

  const handleComplete = async () => {
    await updateSettings({ setupComplete: true })
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <TitleBar />
      <Toaster
        position="bottom-right"
        theme={theme}
        toastOptions={{
          style: {
            background: 'hsl(var(--popover))',
            border: '1px solid hsl(var(--border))',
            color: 'hsl(var(--popover-foreground))'
          },
          actionButtonStyle: {
            background: 'hsl(var(--primary))',
            color: 'hsl(var(--primary-foreground))'
          },
          cancelButtonStyle: {
            background: 'hsl(var(--muted))',
            color: 'hsl(var(--muted-foreground))'
          }
        }}
      />

      <div className="flex flex-1 overflow-hidden">
        <LeftPanel />

        {/* Form panel */}
        <div className="flex-1 flex flex-col items-center justify-center p-8 overflow-y-auto">
          <div className="w-full max-w-sm">

            {/* Step progress dots */}
            {step !== 'welcome' && step !== 'done' && (
              <div className="flex items-center gap-1.5 mb-8 justify-center">
                {CONTENT_STEPS.map((s, i) => (
                  <div
                    key={s}
                    className={cn(
                      'rounded-full transition-all duration-300',
                      i === stepIdx
                        ? 'h-2 w-8 bg-primary'
                        : i < stepIdx
                        ? 'h-2 w-2 bg-primary/50'
                        : 'h-2 w-2 bg-border'
                    )}
                  />
                ))}
              </div>
            )}

            {step === 'welcome' && (
              <WelcomeStep onNext={() => setStep('profile')} />
            )}

            {step === 'profile' && (
              <ProfileStep
                name={name}
                avatar={avatar}
                onNameChange={setName}
                onAvatarChange={handleAvatarChange}
                avatarRef={avatarRef}
                onNext={handleProfileNext}
                onBack={() => setStep('welcome')}
              />
            )}

            {step === 'apikey' && (
              <ApiKeyStep
                apiKey={apiKey}
                showKey={showKey}
                onApiKeyChange={setApiKey}
                onToggleShow={() => setShowKey((v) => !v)}
                onNext={handleApiKeyNext}
                onBack={() => setStep('profile')}
              />
            )}

            {step === 'import' && (
              <ImportStep
                importedOnce={importedOnce}
                onImport={openImport}
                onNext={() => setStep('done')}
                onBack={() => setStep('apikey')}
              />
            )}

            {step === 'done' && (
              <DoneStep onComplete={handleComplete} />
            )}
          </div>
        </div>
      </div>

      <ImportDialog
        open={importOpen}
        initialSource={importSource ?? undefined}
        onOpenChange={(v) => {
          if (!v) { setImportOpen(false); setImportedOnce(true) }
        }}
      />
    </div>
  )
}

// ─── Step: Welcome ────────────────────────────────────────────────────────────

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="text-center space-y-8">
      <div className="flex justify-center">
        <WizardLogo size={56} />
      </div>

      <div className="space-y-3">
        <h1 className="font-serif text-3xl font-normal text-foreground">Welcome to Cinemate</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Your personal movie &amp; TV tracker. Keep a diary of everything you watch, rate and review titles, build custom lists, and explore your viewing habits.
        </p>
      </div>

      <div className="space-y-3 text-left">
        {[
          { icon: Film,  label: 'Track movies, TV shows, and anime' },
          { icon: Star,  label: 'Rate, review, and log rewatches' },
          { icon: Tv,    label: 'Track progress of your favorite TV shows' },
        ].map(({ icon: Icon, label }) => (
          <div key={label} className="flex items-center gap-3 text-sm text-muted-foreground">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Icon className="h-4 w-4 text-primary" />
            </div>
            {label}
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <Button className="w-full gap-2" size="lg" onClick={onNext}>
          Get Started <ArrowRight className="h-4 w-4" />
        </Button>
        <p className="text-xs text-muted-foreground/50">Takes about a minute to set up</p>
      </div>
    </div>
  )
}

// ─── Step: Profile ────────────────────────────────────────────────────────────

function ProfileStep({
  name, avatar, onNameChange, onAvatarChange, avatarRef, onNext, onBack,
}: {
  name: string
  avatar: string | null
  onNameChange: (v: string) => void
  onAvatarChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  avatarRef: React.RefObject<HTMLInputElement>
  onNext: () => void
  onBack: () => void
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h2 className="font-serif text-2xl font-normal">Who are you?</h2>
        <p className="text-sm text-muted-foreground">
          Set up your profile. You can change this any time in Settings.
        </p>
      </div>

      {/* Avatar */}
      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={() => avatarRef.current?.click()}
          className="group relative h-24 w-24 rounded-full bg-muted border-2 border-border hover:border-primary/60 transition-colors overflow-hidden cursor-pointer"
          aria-label="Upload profile picture"
        >
          {avatar ? (
            <img src={avatar} alt="Avatar" className="absolute inset-0 w-full h-full object-cover" />
          ) : (
            <svg className="absolute inset-0 w-full h-full text-muted-foreground/40" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
            </svg>
          )}
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <Upload className="h-5 w-5 text-white" />
          </div>
        </button>
        <p className="text-xs text-muted-foreground">Click to upload a photo (optional)</p>
        <input ref={avatarRef} type="file" accept="image/*" className="hidden" onChange={onAvatarChange} />
      </div>

      {/* Name */}
      <div className="space-y-1.5">
        <Label htmlFor="wizard-name">Your name</Label>
        <Input
          id="wizard-name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Enter your name"
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && name.trim() && onNext()}
        />
      </div>

      <div className="flex gap-2 pt-1">
        <Button variant="ghost" onClick={onBack}>Back</Button>
        <Button className="flex-1 gap-1" onClick={onNext} disabled={!name.trim()}>
          Continue <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

// ─── Step: API Key ────────────────────────────────────────────────────────────

function ApiKeyStep({
  apiKey, showKey, onApiKeyChange, onToggleShow, onNext, onBack,
}: {
  apiKey: string
  showKey: boolean
  onApiKeyChange: (v: string) => void
  onToggleShow: () => void
  onNext: () => void
  onBack: () => void
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h2 className="font-serif text-2xl font-normal">Connect to TMDb</h2>
        <p className="text-sm text-muted-foreground">
          Cinemate uses The Movie Database to fetch film &amp; TV data. A free API key is required to search and browse titles.
        </p>
      </div>

      <div className="p-3.5 rounded-lg bg-card border border-border/60 space-y-2.5">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">How to get a free key</p>
        <ol className="space-y-2">
          {[
            <>Create a free account at <span className="font-mono text-primary text-[11px]">themoviedb.org</span></>,
            <>Open <span className="font-mono text-primary text-[11px]">Settings <ArrowRight className="inline-block h-3 w-3 mx-1 align-middle" /> API</span> in your account</>,
            <>Request a Developer API key</>,
            <>Paste the <span className="font-medium">API Key</span> below</>,
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
              <span className="flex-shrink-0 h-4 w-4 rounded-full bg-primary/15 text-primary text-[10px] font-medium flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="wizard-apikey">API Key</Label>
        <div className="relative">
          <Input
            id="wizard-apikey"
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            placeholder="Paste your TMDb API key"
            className="pr-10"
            onKeyDown={(e) => e.key === 'Enter' && onNext()}
          />
          <button
            type="button"
            onClick={onToggleShow}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            aria-label={showKey ? 'Hide key' : 'Show key'}
          >
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant="ghost" onClick={onBack}>Back</Button>
        <Button className="flex-1 gap-1" onClick={onNext} disabled={!apiKey.trim()}>
          Continue <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

// ─── Step: Import ─────────────────────────────────────────────────────────────

function ImportStep({
  importedOnce, onImport, onNext, onBack,
}: {
  importedOnce: boolean
  onImport: (src: ImportSource) => void
  onNext: () => void
  onBack: () => void
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h2 className="font-serif text-2xl font-normal">Import existing data</h2>
        <p className="text-sm text-muted-foreground">
          Already tracking on Letterboxd or Trakt? Import your history, ratings, and lists in one go.
        </p>
      </div>

      <div className="space-y-2">
        <button
          onClick={() => onImport('letterboxd')}
          className="w-full flex items-center gap-4 p-4 rounded-xl border border-border/60 bg-card hover:border-[#00e054]/50 hover:bg-[#00e054]/5 transition-colors cursor-pointer text-left group"
        >
          <div className="h-10 w-10 rounded-full bg-[#00e054]/10 group-hover:bg-[#00e054]/20 flex items-center justify-center flex-shrink-0 transition-colors">
            <Film className="h-5 w-5 text-[#00e054]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Letterboxd</p>
            <p className="text-xs text-muted-foreground mt-0.5">Import movies, ratings, and diary entries</p>
          </div>
        </button>

        <button
          onClick={() => onImport('trakt')}
          className="w-full flex items-center gap-4 p-4 rounded-xl border border-border/60 bg-card hover:border-[#ed1c24]/50 hover:bg-[#ed1c24]/5 transition-colors cursor-pointer text-left group"
        >
          <div className="h-10 w-10 rounded-full bg-[#ed1c24]/10 group-hover:bg-[#ed1c24]/20 flex items-center justify-center flex-shrink-0 transition-colors">
            <Tv className="h-5 w-5 text-[#ed1c24]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Trakt</p>
            <p className="text-xs text-muted-foreground mt-0.5">Import movies, shows, episode history, and lists</p>
          </div>
        </button>
      </div>

      {importedOnce && (
        <div className="flex items-center gap-2.5 p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-sm text-green-500">
          <Check className="h-4 w-4 flex-shrink-0" />
          Import complete, your library is ready.
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="ghost" onClick={onBack}>Back</Button>
        <Button className="flex-1 gap-1" onClick={onNext}>
          {importedOnce ? 'Continue' : 'Skip for now'} <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

// ─── Step: Done ───────────────────────────────────────────────────────────────

function DoneStep({ onComplete }: { onComplete: () => void }) {
  return (
    <div className="text-center space-y-8">
      <div className="flex justify-center">
        <div className="h-24 w-24 rounded-full bg-green-500/15 flex items-center justify-center">
          <Check className="h-12 w-12 text-green-500" strokeWidth={2.5} />
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="font-serif text-3xl font-normal">You're all set!</h2>
        <p className="text-sm text-muted-foreground">
          Cinemate is ready. Start exploring, tracking, and reviewing.
        </p>
      </div>

      <div className="space-y-2.5 text-left">
        {[
          'Search for any movie or TV show to add to your library',
          'Log what you watch and leave ratings or reviews',
          'Build custom lists to organise your titles',
          'Discover trending films and personalised recommendations',
        ].map((tip) => (
          <div key={tip} className="flex items-start gap-2.5 text-sm text-muted-foreground">
            <Check className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
            {tip}
          </div>
        ))}
      </div>

      <Button className="w-full gap-2" size="lg" onClick={onComplete}>
        Open Cinemate <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  )
}
