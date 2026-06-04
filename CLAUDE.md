# Cinemate - Electron App

Personal movie & TV tracking app built with Electron + React + Tailwind CSS.

## Tech Stack
- **Electron** via `electron-vite` (main process + preload + renderer)
- **React 18** + TypeScript
- **Tailwind CSS** + **Radix UI** primitives (shadcn/ui pattern)
- **Zustand** for global state
- **JSON files** in the user data dir for persistence (read/written by the Electron main process via IPC; atomic writes, debounced flush)
- **React Router v6** (hash mode) for routing
- **Recharts** for statistics charts
- **Sonner** for toast notifications
- **TMDb API** (v3) for movie/TV data

## Commands
```bash
npm run dev      # Start dev server + Electron
npm run build    # Build for production
npm run dist     # Package as installer
```

## Project Structure
```
src/
  main/           Electron main process (BrowserWindow, IPC)
  preload/        Context bridge (exposes window controls)
  renderer/src/
    App.tsx         Router + init
    globals.css     Tailwind + CSS custom properties (theme tokens)
    lib/
      db.ts         JSON-file storage via IPC (settings, library, watchHistory, lists, cache)
      tmdb.ts       TMDb API client (rate-limited, cached)
      store.ts      Zustand store (all app state + actions)
      utils.ts      cn(), date/image helpers
    types/index.ts  All TypeScript interfaces
    components/
      ui/           Radix UI + Tailwind primitives (Button, Dialog, etc.)
      layout/       TitleBar, Sidebar, Layout
      shared/       PosterCard, RatingInput, LogEntryModal, MediaEditSheet
    views/          One file per route (Home, Search, Detail, Library…)
```

## Key Notes
- TMDb API key is required - enter it in Settings on first launch
- All data is local (JSON files in the user data dir; no backend)
- Theme tokens live in `globals.css` as CSS custom properties
- Window frame is hidden; TitleBar.tsx handles minimize/maximize/close via IPC
- The `cn()` utility merges Tailwind classes (clsx + tailwind-merge)
