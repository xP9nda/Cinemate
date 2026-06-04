import { app, shell, BrowserWindow, ipcMain, nativeTheme, session } from 'electron'
import { join, dirname, resolve, sep, isAbsolute } from 'path'
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, copyFileSync, rmSync, renameSync, openSync, fsyncSync, closeSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initUpdater, checkForUpdatesOnStartup } from './updater'

// IPC handlers that don't depend on a specific window instance - registered once
ipcMain.handle('theme:get', () => nativeTheme.shouldUseDarkColors)

// ─── File storage ────────────────────────────────────────────────────────────
// The data directory is configurable. Its path is stored in a fixed meta.json
// inside Electron's userData so we always know where to look first.

function metaPath(): string {
  return join(app.getPath('userData'), 'meta.json')
}

function loadMeta(): { dataDir?: string; theme?: 'dark' | 'light' | 'system' } {
  try {
    return JSON.parse(readFileSync(metaPath(), 'utf-8'))
  } catch {
    return {}
  }
}

function saveMeta(meta: { dataDir?: string; theme?: 'dark' | 'light' | 'system' }): void {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  atomicWriteFile(metaPath(), JSON.stringify(meta, null, 2))
}

function getDataDir(): string {
  const meta = loadMeta()
  return meta.dataDir ?? join(app.getPath('userData'), 'data')
}

// Resolve a renderer-supplied relative path inside the data dir. Throws if the
// path escapes the data dir or is absolute. Returned path is always inside base.
function resolveInside(base: string, relative: string): string {
  if (typeof relative !== 'string' || relative.length === 0) {
    throw new Error('Invalid path')
  }
  if (isAbsolute(relative) || relative.includes('\0')) {
    throw new Error('Invalid path')
  }
  const resolvedBase = resolve(base)
  const resolved = resolve(resolvedBase, relative)
  if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + sep)) {
    throw new Error('Path escapes data directory')
  }
  return resolved
}

// Atomic write: write to a temp file, fsync, then rename over the target.
// rename(2) is atomic on the same filesystem; on Windows, MoveFileEx with
// MOVEFILE_REPLACE_EXISTING (which Node uses for rename) is also atomic.
function atomicWriteFile(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  let fd: number | null = null
  try {
    writeFileSync(tmpPath, content, 'utf-8')
    // fsync the file so contents hit disk before the rename
    fd = openSync(tmpPath, 'r+')
    fsyncSync(fd)
    closeSync(fd)
    fd = null
    renameSync(tmpPath, filePath)
  } catch (err) {
    if (fd != null) { try { closeSync(fd) } catch {} }
    try { if (existsSync(tmpPath)) rmSync(tmpPath, { force: true }) } catch {}
    throw err
  }
}

ipcMain.handle('storage:getDataDir', () => getDataDir())

ipcMain.handle('storage:setDataDir', (_, newDir: string) => {
  if (typeof newDir !== 'string' || !newDir.trim() || newDir.includes('\0')) throw new Error('Invalid directory')
  if (!isAbsolute(newDir)) throw new Error('Path must be absolute')
  saveMeta({ ...loadMeta(), dataDir: resolve(newDir) })
})

ipcMain.handle('storage:readFile', (_, filename: string) => {
  const filePath = resolveInside(getDataDir(), filename)
  if (!existsSync(filePath)) return null
  return readFileSync(filePath, 'utf-8')
})

ipcMain.handle('storage:writeFile', (_, filename: string, content: string) => {
  const filePath = resolveInside(getDataDir(), filename)
  atomicWriteFile(filePath, content)
})

ipcMain.handle('storage:listDir', (_, subdir: string) => {
  const dir = resolveInside(getDataDir(), subdir)
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir, { withFileTypes: true }).map((d) => ({ name: d.name, isDir: d.isDirectory() }))
  } catch { return [] }
})

ipcMain.handle('storage:deleteFile', (_, filename: string) => {
  const filePath = resolveInside(getDataDir(), filename)
  if (existsSync(filePath)) rmSync(filePath, { force: true })
})

ipcMain.handle('storage:deleteDir', (_, subdir: string) => {
  const dirPath = resolveInside(getDataDir(), subdir)
  // Refuse to wipe the root data dir through this entry point
  if (dirPath === resolve(getDataDir())) throw new Error('Refusing to delete data root')
  if (existsSync(dirPath)) rmSync(dirPath, { recursive: true, force: true })
})

function copyDirRecursive(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name)
    const d = join(dest, entry.name)
    if (entry.isDirectory()) copyDirRecursive(s, d)
    else copyFileSync(s, d)
  }
}

ipcMain.handle('storage:migrateDataDir', (_, newDir: string) => {
  if (typeof newDir !== 'string' || !newDir.trim() || newDir.includes('\0')) throw new Error('Invalid directory')
  if (!isAbsolute(newDir)) throw new Error('Path must be absolute')
  const oldDir = resolve(getDataDir())
  const target = resolve(newDir)
  if (oldDir === target) return
  // copyDirRecursive followed by rmSync(oldDir) would either recurse into the
  // newly-created tree (newDir inside oldDir) or wipe the destination after
  // copying (oldDir inside newDir). Refuse either configuration.
  if (target === oldDir + sep || target.startsWith(oldDir + sep)) {
    throw new Error('New data directory cannot be inside the current one')
  }
  if (oldDir.startsWith(target + sep)) {
    throw new Error('New data directory cannot be a parent of the current one')
  }
  mkdirSync(target, { recursive: true })
  if (existsSync(oldDir)) {
    copyDirRecursive(oldDir, target)
  }
  saveMeta({ ...loadMeta(), dataDir: target })
  if (existsSync(oldDir) && oldDir !== target) {
    rmSync(oldDir, { recursive: true, force: true })
  }
})

ipcMain.handle('storage:deleteDataDir', () => {
  const dataDir = getDataDir()
  if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true })
})

ipcMain.handle('meta:setTheme', (_, theme: 'dark' | 'light' | 'system') => {
  if (theme !== 'dark' && theme !== 'light' && theme !== 'system') return
  saveMeta({ ...loadMeta(), theme })
})

// ─── Window creation ─────────────────────────────────────────────────────────

function resolveStartupBackground(): string {
  // Pick a background color that won't flash against the user's theme on
  // cold start. We read the theme persisted to meta.json (written by the
  // renderer whenever settings change); fall back to the OS preference.
  const meta = loadMeta()
  const theme = meta.theme ?? 'system'
  const isDark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors)
  return isDark ? '#1a1d27' : '#f5f5f7'
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 680,
    minHeight: 520,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    backgroundColor: resolveStartupBackground(),
    autoHideMenuBar: true,
    icon: join(__dirname, '../../resources/icon.ico'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const u = new URL(details.url)
      if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:') {
        shell.openExternal(details.url)
      }
    } catch {
      // Invalid URL — silently drop
    }
    return { action: 'deny' }
  })

  // Block navigation away from the app. We allow only navigation to the same
  // page the renderer was originally loaded from (router reloads, hash changes)
  // and route http(s) externally via the shell. File:// navigation to any other
  // path is rejected — a compromised renderer could otherwise navigate to
  // arbitrary local files and exfiltrate their contents.
  const isDev = is.dev && !!process.env['ELECTRON_RENDERER_URL']
  const initialUrl = isDev
    ? new URL(process.env['ELECTRON_RENDERER_URL']!)
    : new URL('file://' + join(__dirname, '../renderer/index.html').replace(/\\/g, '/'))

  mainWindow.webContents.on('will-navigate', (event, url) => {
    let u: URL
    try { u = new URL(url) } catch { event.preventDefault(); return }
    const samePage =
      u.protocol === initialUrl.protocol &&
      u.host === initialUrl.host &&
      u.pathname === initialUrl.pathname
    if (samePage) return
    event.preventDefault()
    if (u.protocol === 'http:' || u.protocol === 'https:') shell.openExternal(url)
  })

  if (isDev) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']!)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Window-specific IPC handlers (remove before re-registering in case of multiple windows)
  ipcMain.removeHandler('window:minimize')
  ipcMain.removeHandler('window:maximize')
  ipcMain.removeHandler('window:close')
  ipcMain.removeHandler('window:isMaximized')
  ipcMain.handle('window:minimize', () => mainWindow.minimize())
  ipcMain.handle('window:maximize', () => {
    if (mainWindow.isMaximized()) mainWindow.restore()
    else mainWindow.maximize()
  })
  ipcMain.handle('window:close', () => mainWindow.close())
  ipcMain.handle('window:isMaximized', () => mainWindow.isMaximized())

  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximized', true))
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximized', false))
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.cinemate.app')

  // Content-Security-Policy: lock the renderer down. In dev, Vite injects an
  // inline HMR preamble + websocket, so we relax script-src/connect-src for
  // localhost only. Inline styles are required by React/Radix/Tailwind runtime.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const scriptSrc = is.dev
      ? "'self' 'unsafe-inline' 'unsafe-eval' http://localhost:* http://127.0.0.1:*"
      : "'self'"
    const connectSrc = is.dev
      ? "'self' https://api.themoviedb.org ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*"
      : "'self' https://api.themoviedb.org"
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self';" +
          ` script-src ${scriptSrc};` +
          " style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;" +
          " img-src 'self' data: blob: https://image.tmdb.org;" +
          " font-src 'self' data: https://fonts.gstatic.com;" +
          ` connect-src ${connectSrc};` +
          " object-src 'none';" +
          " base-uri 'self';" +
          " form-action 'none';" +
          " frame-ancestors 'none';"
        ]
      }
    })
  })

  ipcMain.handle('shell:openDataFolder', async () => {
    const dataPath = getDataDir()
    try { mkdirSync(dataPath, { recursive: true }) } catch {}
    const err = await shell.openPath(dataPath)
    if (err) console.error('shell.openPath failed:', err)
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  initUpdater()
  createWindow()
  checkForUpdatesOnStartup()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Pause `app.quit()` until the renderer flushes pending debounced writes.
// Without this, `window-all-closed` → `app.quit()` tears down the main process
// before the renderer's beforeunload IPC round-trip can complete and the last
// mutations are lost.
let isFlushing = false
let isQuitting = false
app.on('before-quit', (e) => {
  if (isQuitting) return
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (!win) return
  if (isFlushing) return
  e.preventDefault()
  isFlushing = true
  const wc = win.webContents
  const done = (): void => {
    isQuitting = true
    isFlushing = false
    app.quit()
  }
  const timer = setTimeout(done, 3000)
  ipcMain.once('app:flush-complete', () => {
    clearTimeout(timer)
    done()
  })
  try { wc.send('app:flush-pending') } catch { clearTimeout(timer); done() }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
