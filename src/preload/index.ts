import { contextBridge, ipcRenderer } from 'electron'

// Auto-updater event contract (mirrors src/main/updater.ts). Keep in sync.
export type UpdaterEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string; portable: boolean }
  | { type: 'not-available' }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string }

const api = {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onMaximized: (cb: (v: boolean) => void) => {
      const handler = (_: Electron.IpcRendererEvent, v: boolean) => cb(v)
      ipcRenderer.on('window:maximized', handler)
      return () => ipcRenderer.removeListener('window:maximized', handler)
    }
  },
  theme: {
    get: () => ipcRenderer.invoke('theme:get')
  },
  meta: {
    setTheme: (theme: 'dark' | 'light' | 'system') => ipcRenderer.invoke('meta:setTheme', theme)
  },
  shell: {
    openDataFolder: () => ipcRenderer.invoke('shell:openDataFolder')
  },
  app: {
    onFlushPending: (cb: () => void) => {
      const handler = (): void => cb()
      ipcRenderer.on('app:flush-pending', handler)
      return () => ipcRenderer.removeListener('app:flush-pending', handler)
    },
    flushComplete: () => ipcRenderer.send('app:flush-complete')
  },
  updater: {
    check: (): Promise<void> => ipcRenderer.invoke('updater:check'),
    install: (): Promise<void> => ipcRenderer.invoke('updater:install'),
    openReleasePage: (): Promise<void> => ipcRenderer.invoke('updater:openReleasePage'),
    onEvent: (cb: (event: UpdaterEvent) => void) => {
      const handler = (_: Electron.IpcRendererEvent, event: UpdaterEvent): void => cb(event)
      ipcRenderer.on('updater:event', handler)
      return () => ipcRenderer.removeListener('updater:event', handler)
    }
  },
  storage: {
    getDataDir: (): Promise<string> => ipcRenderer.invoke('storage:getDataDir'),
    setDataDir: (dir: string): Promise<void> => ipcRenderer.invoke('storage:setDataDir', dir),
    migrateDataDir: (dir: string): Promise<void> => ipcRenderer.invoke('storage:migrateDataDir', dir),
    readFile: (filename: string): Promise<string | null> => ipcRenderer.invoke('storage:readFile', filename),
    writeFile: (filename: string, content: string): Promise<void> => ipcRenderer.invoke('storage:writeFile', filename, content),
    listDir: (subdir: string): Promise<Array<{ name: string; isDir: boolean }>> => ipcRenderer.invoke('storage:listDir', subdir),
    deleteFile: (filename: string): Promise<void> => ipcRenderer.invoke('storage:deleteFile', filename),
    deleteDir: (subdir: string): Promise<void> => ipcRenderer.invoke('storage:deleteDir', subdir),
    deleteDataDir: (): Promise<void> => ipcRenderer.invoke('storage:deleteDataDir')
  }
}

contextBridge.exposeInMainWorld('electron', api)

export type ElectronAPI = typeof api
