import { Heart, Coffee, Star, Github, ExternalLink } from 'lucide-react'
import { ScrollArea } from '../components/ui/scroll-area'
import { Button } from '../components/ui/button'

const KOFI_URL = 'https://ko-fi.com/xp9nda'
const GITHUB_URL = 'https://github.com/xP9nda/Cinemate'

function openExternal(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function Donate() {
  return (
    <ScrollArea className="h-full">
      <div className="view-container p-6 max-w-xl mx-auto space-y-8">

        {/* Hero */}
        <div className="text-center space-y-3 py-4">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-primary/15 mb-2">
            <Heart className="h-8 w-8 text-primary fill-primary/40" />
          </div>
          <h1 className="font-serif text-3xl font-normal">Support Cinemate</h1>
          <p className="text-muted-foreground text-sm max-w-sm mx-auto leading-relaxed">
            Cinemate is a passion project built and maintained by one developer. If you enjoy using it,
            consider supporting its continued development.
          </p>
        </div>

        {/* About the developer */}
        <div className="rounded-xl border border-border/50 bg-card p-5 space-y-3">
          <h2 className="font-semibold text-sm text-foreground flex items-center gap-2">
            <Star className="h-4 w-4 text-primary" />
            About the Developer
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Hi! I built Cinemate because I wanted a beautiful, private, and local-first app to track the
            movies and TV shows I watch. No subscriptions, no ads, no data leaving your device.
            Everything stays local.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Cinemate is free and open-source. Your support helps cover development time, tooling costs,
            and motivates new features.
          </p>
        </div>

        {/* Support options */}
        <div className="space-y-3">
          <h2 className="font-semibold text-sm text-foreground">Ways to Support</h2>

          <button
            onClick={() => openExternal(KOFI_URL)}
            className="w-full flex items-center gap-4 p-4 rounded-xl border border-border/50 bg-card hover:border-primary/40 hover:bg-primary/5 transition-colors text-left cursor-pointer group"
          >
            <div className="h-10 w-10 rounded-lg bg-[#FF5E5B]/10 flex items-center justify-center flex-shrink-0">
              <Coffee className="h-5 w-5 text-[#FF5E5B]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">Buy me a coffee on Ko-fi</p>
              <p className="text-xs text-muted-foreground mt-0.5">One-time or recurring. Every coffee counts.</p>
            </div>
            <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
          </button>

          <button
            onClick={() => openExternal(GITHUB_URL)}
            className="w-full flex items-center gap-4 p-4 rounded-xl border border-border/50 bg-card hover:border-primary/40 hover:bg-primary/5 transition-colors text-left cursor-pointer group"
          >
            <div className="h-10 w-10 rounded-lg bg-foreground/10 flex items-center justify-center flex-shrink-0">
              <Github className="h-5 w-5 text-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">Star on GitHub</p>
              <p className="text-xs text-muted-foreground mt-0.5">Show appreciation and help others discover Cinemate</p>
            </div>
            <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
          </button>
        </div>

        {/* Other ways */}
        <div className="rounded-xl border border-border/50 bg-card p-5 space-y-3">
          <h2 className="font-semibold text-sm text-foreground">Other Ways to Help</h2>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5">•</span>
              <span>Share Cinemate with friends who track movies and TV</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5">•</span>
              <span>Report bugs and suggest features on GitHub</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5">•</span>
              <span>Leave a review or feedback. It genuinely helps.</span>
            </li>
          </ul>
        </div>

        {/* CTA buttons */}
        <div className="flex flex-col sm:flex-row gap-3 pb-4">
          <Button className="flex-1 gap-2" onClick={() => openExternal(KOFI_URL)}>
            <Coffee className="h-4 w-4" />
            Support on Ko-fi
          </Button>
          <Button variant="outline" className="flex-1 gap-2" onClick={() => openExternal(GITHUB_URL)}>
            <Github className="h-4 w-4" />
            View on GitHub
          </Button>
        </div>

        <p className="text-center text-xs text-muted-foreground pb-2">
          Thank you for using Cinemate. Made with{' '}
          <Heart className="h-3 w-3 inline text-primary fill-primary" /> for movie lovers.
        </p>
      </div>
    </ScrollArea>
  )
}
