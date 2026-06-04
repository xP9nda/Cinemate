import { create } from 'zustand'
import { toast } from 'sonner'
import type { UpdaterEvent } from '../../../preload'

export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'available' // portable: a newer version exists but we can't self-install
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'error'

interface UpdaterState {
  status: UpdaterStatus
  version: string | null
  percent: number
  portable: boolean
  error: string | null
  /** True while a user-initiated check is in flight, so we only toast results they asked for. */
  manualCheck: boolean
  check: () => void
  install: () => void
  openReleasePage: () => void
}

export const useUpdater = create<UpdaterState>((set) => ({
  status: 'idle',
  version: null,
  percent: 0,
  portable: false,
  error: null,
  manualCheck: false,
  check: () => {
    set({ manualCheck: true, status: 'checking', error: null })
    window.electron.updater.check()
  },
  install: () => window.electron.updater.install(),
  openReleasePage: () => window.electron.updater.openReleasePage()
}))

let bridged = false

// Subscribes the renderer to main-process update events: drives the store and
// surfaces toasts. Call once when the app mounts.
export function initUpdaterBridge(): void {
  if (bridged) return
  bridged = true

  window.electron.updater.onEvent((e: UpdaterEvent) => {
    const { manualCheck } = useUpdater.getState()
    switch (e.type) {
      case 'checking':
        useUpdater.setState({ status: 'checking', error: null })
        break

      case 'available':
        useUpdater.setState({
          status: e.portable ? 'available' : 'downloading',
          version: e.version,
          portable: e.portable,
          manualCheck: false
        })
        if (e.portable) {
          toast.info(`Cinemate ${e.version} is available`, {
            description: 'Open the release page to download it.',
            action: { label: 'Download', onClick: () => window.electron.updater.openReleasePage() },
            duration: 10000
          })
        } else {
          toast.info(`Downloading Cinemate ${e.version} in the background`)
        }
        break

      case 'not-available':
        useUpdater.setState({ status: 'up-to-date', manualCheck: false })
        if (manualCheck) toast.success('Cinemate is up to date')
        break

      case 'progress':
        useUpdater.setState({ status: 'downloading', percent: e.percent })
        break

      case 'downloaded':
        useUpdater.setState({ status: 'downloaded', version: e.version, percent: 100, manualCheck: false })
        toast.success(`Cinemate ${e.version} is ready to install`, {
          description: 'Restart the app to finish updating.',
          action: { label: 'Restart now', onClick: () => window.electron.updater.install() },
          duration: Infinity
        })
        break

      case 'error':
        useUpdater.setState({ status: 'error', error: e.message, manualCheck: false })
        if (manualCheck) toast.error('Update check failed', { description: e.message })
        break
    }
  })
}
