import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { autoUpdater } from 'electron-updater'

// Event contract shared with the renderer (see src/preload/index.ts UpdaterEvent
// and src/renderer/src/lib/updater.ts). Keep the two in sync.
type UpdaterEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string; portable: boolean }
  | { type: 'not-available' }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string }

const RELEASES_URL = 'https://github.com/xP9nda/Cinemate/releases/latest'

// The portable build is a single self-contained .exe with no install location,
// so electron-updater cannot replace it in place. For portable we only check
// and notify, linking the user to the release page for a manual download.
const isPortable = !!process.env.PORTABLE_EXECUTABLE_DIR

function broadcast(event: UpdaterEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('updater:event', event)
  }
}

let initialized = false

// Registers update event listeners and the renderer-facing IPC handlers.
// Safe to call once during app startup. Does not trigger a check by itself.
export function initUpdater(): void {
  if (initialized) return
  initialized = true

  autoUpdater.autoDownload = !isPortable
  autoUpdater.autoInstallOnAppQuit = !isPortable

  autoUpdater.on('checking-for-update', () => broadcast({ type: 'checking' }))
  autoUpdater.on('update-available', (info) =>
    broadcast({ type: 'available', version: info.version, portable: isPortable })
  )
  autoUpdater.on('update-not-available', () => broadcast({ type: 'not-available' }))
  autoUpdater.on('download-progress', (p) =>
    broadcast({ type: 'progress', percent: Math.round(p.percent) })
  )
  autoUpdater.on('update-downloaded', (info) =>
    broadcast({ type: 'downloaded', version: info.version })
  )
  autoUpdater.on('error', (err) =>
    broadcast({ type: 'error', message: err == null ? 'Unknown error' : err.message || String(err) })
  )

  ipcMain.handle('updater:check', async () => {
    // Updates only work from a packaged build; in dev there is nothing to update.
    if (!app.isPackaged) {
      broadcast({ type: 'not-available' })
      return
    }
    // The 'error' event handles failures; swallow the rejection here.
    try {
      await autoUpdater.checkForUpdates()
    } catch {
      /* reported via the 'error' event */
    }
  })

  ipcMain.handle('updater:install', () => {
    if (isPortable) return
    autoUpdater.quitAndInstall()
  })

  ipcMain.handle('updater:openReleasePage', () => shell.openExternal(RELEASES_URL))
}

// Runs a single update check shortly after launch. Delayed so the renderer has
// time to subscribe to events before the first ones fire.
export function checkForUpdatesOnStartup(): void {
  if (!app.isPackaged) return
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {
      /* reported via the 'error' event */
    })
  }, 4000)
}
