# Cinemate

A personal movie & TV tracking desktop app built with Electron, React, and Tailwind CSS. Log what you watch, rate it, build lists, and explore your viewing statistics, all stored locally on your machine. Powered by [TMDb](https://www.themoviedb.org/) for movie and TV data.

> **Privacy first:** all of your data lives in local JSON files in your user data directory. There is no backend and nothing is uploaded anywhere except direct API calls to TMDb.

---

## Features

- **Track movies, TV & anime**: log plays with dates, ratings, reviews, and rewatches
- **Episode-level TV tracking**: mark individual episodes watched, rate seasons, and pick up where you left off
- **Library**: keep a watchlist and browse everything you've logged, with grid or list views, filtering, and sorting
- **Watch history**: a full chronological log of every play, including rewatches, with per-entry notes and tags
- **Smart lists**: build custom lists by hand, or define rules (by rating, year, genre, play count, runtime, and more) that populate a list automatically
- **Physical collection**: catalog the movies and shows you own across formats (Blu-ray, DVD, 4K, VHS, digital) with purchase dates and notes
- **Discover & search**: find new titles, browse by person and cast, and explore recommendations and similar titles
- **Statistics**: charts and insights into your watching habits (via Recharts)
- **Import**: bring in your history from Letterboxd exports, Trakt exports, or CSV files
- **Spoiler protection**: hide episode titles, descriptions, ratings, and cast episode counts until you're caught up
- **Customizable**: light/dark/system themes, six accent colors, 10-star or 5-star ratings, 12h/24h time, and custom tags

---

## For Users

### Requirements

- A free [TMDb API key](https://www.themoviedb.org/settings/api). You'll be prompted to enter it during first-launch setup. See [Getting a TMDb API key](#getting-a-tmdb-api-key) below.

### Getting a TMDb API key

Cinemate needs a free TMDb API key to fetch movie and TV data. It only takes a few minutes. Follow these steps:

1. **Create an account.** Go to [themoviedb.org](https://www.themoviedb.org/signup) and sign up for a free account.
2. **Verify your email and activate** your account using the link TMDb emails you.
3. **Log in** to your new account.
4. Click your **user avatar in the top-right corner** and open **Settings**.
5. In the settings sidebar, go to **API**.
6. Under **"Request an API Key"**, click to **generate a new one**.
7. When asked about the type of use, choose **Yes, Personal Use**.
8. Fill out the application form using the values below:

   | Field                   | What to enter                                                                                          |
   | ----------------------- | ------------------------------------------------------------------------------------------------------ |
   | **Application Name**    | `Cinemate`                                                                                             |
   | **Application URL**     | `https://github.com/xP9nda/Cinemate`                                                                   |
   | **Application Summary** | *"I am using the TMDb API for my local copy of Cinemate, an open-source personal desktop app for tracking the movies and TV shows I watch. Cinemate uses the TMDb API to look up titles, posters, cast, and other metadata so I can log plays, ratings, and reviews. It is non-commercial and single-user, and all of my data is stored locally on my own machine. The project lives at https://github.com/xP9nda/Cinemate."* |

9. **Fill out your contact information.** This is required by TMDb. Note that **this information is never received by Cinemate**; it is only for TMDb. If you ever wish to stop using the program or remove your TMDb data, you can request that your account be deleted at [themoviedb.org/settings/delete-account](https://www.themoviedb.org/settings/delete-account).
10. **Accept the terms of agreement** and press **Subscribe**. You should now be on the **Free Developer** plan.
11. Click to **access your API details**. Your key is shown under **"API Key"** at the bottom of the page.
12. Copy that key and paste it into Cinemate during the first-launch setup wizard.

This product uses the TMDb API but is **not endorsed or certified by TMDb.** Your use of the key is subject to the [TMDb Terms of Use](https://www.themoviedb.org/terms-of-use).

### Installation (Windows)

Download the latest release and pick one of:

- **Installer**: `Cinemate-<version>-setup.exe` (creates Start Menu & desktop shortcuts; lets you choose the install location)
- **Portable**: `Cinemate-<version>-portable.exe` (no install; run from anywhere)

> macOS (`.dmg`) and Linux (`.AppImage`) targets are configured in the build but are not regularly produced. Build them yourself from source (see below).

### First launch

A setup wizard walks you through:

1. Creating your profile
2. Entering your TMDb API key
3. Optionally importing your watch history (Letterboxd / Trakt / CSV)

You can change the API key and other options later in **Settings**.

### Customization

Most of how Cinemate looks and behaves is configurable under **Settings**:

- **Theme**: light, dark, or follow your system
- **Accent color**: purple, blue, green, orange, pink, or red
- **Rating system**: 10-star or 5-star
- **Time format**: 12-hour or 24-hour
- **Custom tags**: define your own tags to attach to watch-history entries
- **Spoiler protection**: independently hide episode titles, episode descriptions, media descriptions, ratings, and cast episode counts
- **Quality-of-life toggles**: auto-remove from watchlist when watched, allow future-dated logs, auto-scroll to the next unwatched episode from show progress, and mark a show as watched when you catch up

### Where is my data?

All data is stored as JSON files in your OS user data directory (e.g. `%APPDATA%/Cinemate` on Windows). Uninstalling does **not** delete this data by default, so your library survives upgrades.

---

## For Developers / Contributors

### Tech Stack

- **Electron** via [`electron-vite`](https://electron-vite.org/): main process + preload + renderer
- **React 18** + **TypeScript**
- **Tailwind CSS** + **Radix UI** primitives (shadcn/ui pattern)
- **Zustand** for global state
- **React Router v6** (hash mode) for routing
- **Recharts** for statistics charts
- **Sonner** for toast notifications
- **TMDb API** (v3) for movie/TV data
- Persistence via **JSON files** in the user data dir, read/written by the main process over IPC (atomic writes, debounced flush)

### Prerequisites

- Node.js 18+ and npm

### Getting started

```bash
git clone https://github.com/xP9nda/Cinemate.git
cd Cinemate
npm install
npm run dev      # start the Vite dev server + Electron
```

Enter your TMDb API key in Settings on first launch.

### Scripts

| Command              | Description                                          |
| -------------------- | ---------------------------------------------------- |
| `npm run dev`        | Start the dev server and launch Electron             |
| `npm run build`      | Type-check and build the production bundle into `out/` |
| `npm run preview`    | Preview the production build                          |
| `npm run dist`       | Build and package installers into `dist/`            |
| `npm run dist:win`   | Build and package the Windows installer + portable exe (no publish) |
| `npm run publish:win`| Build, package, and publish a release to GitHub (used by CI) |

On Windows you can also run `build.bat`, which installs dependencies if needed and runs `dist:win`.

### Project Structure

```
src/
  main/           Electron main process (BrowserWindow, IPC, file storage)
    index.ts        App entry, window creation, storage IPC
    updater.ts      Auto-update (electron-updater) wiring + IPC
  preload/        Context bridge (window controls, storage + updater IPC)
  renderer/src/
    App.tsx         Router + app init
    globals.css     Tailwind + CSS custom properties (theme tokens)
    lib/
      db.ts         JSON-file storage via IPC (settings, library, watchHistory, lists, cache)
      tmdb.ts       TMDb API client (rate-limited, cached)
      store.ts      Zustand store (all app state + actions)
      updater.ts    Auto-update store + event bridge (toasts, Settings UI)
      utils.ts      cn(), date/image helpers
    types/index.ts  All TypeScript interfaces
    components/
      ui/           Radix UI + Tailwind primitives (Button, Dialog, etc.)
      layout/       TitleBar, Sidebar, Layout
      shared/       PosterCard, RatingInput, LogEntryModal, MediaEditSheet
    views/          One file per route (Home, Search, Detail, Library, Stats, etc.)
.github/workflows/ CI: release.yml builds + publishes on a version tag
build/            NSIS installer customizations (installer.nsh)
resources/        App icons (icon.ico / icon.png / icon.svg)
```

### Architecture overview

Cinemate follows the standard Electron three-part split:

- **Main process** (`src/main`) owns the `BrowserWindow`, native window controls, and all filesystem access. Reads and writes are atomic with a debounced flush so the JSON files are never left half-written.
- **Preload** (`src/preload`) exposes a narrow, typed bridge to the renderer via `contextBridge`: window controls plus the storage IPC. The renderer has no direct Node or filesystem access.
- **Renderer** (`src/renderer/src`) is the React app. State lives in a single Zustand store (`lib/store.ts`); persistence goes through `lib/db.ts`, which talks to the main process over IPC; TMDb access goes through `lib/tmdb.ts`, which is rate-limited and cached.

### Data model

All app types are defined in `src/renderer/src/types/index.ts`. The main persisted collections are:

- **`AppSettings`**: API key, profile, theme/accent, rating system, spoiler settings, and feature toggles
- **`LibraryEntry`**: one record per title (movie / tv / anime), including status, overall rating, review, and per-episode/season progress for shows
- **`WatchHistoryEntry`**: one record per play (including rewatches and individual episodes), with notes and tags
- **`CustomList`**: hand-curated or rule-driven ("smart") lists; when rules are enabled, the item set is computed from `ListRules`
- **`CollectionEntry`**: physical media you own, keyed by format and purchase date

### Key notes for contributors

- The window frame is hidden; `TitleBar.tsx` handles minimize/maximize/close via IPC.
- Theme tokens live in `globals.css` as CSS custom properties.
- The `cn()` utility merges Tailwind classes (clsx + tailwind-merge).
- All persistence goes through the main process; the renderer never touches the filesystem directly.
- TMDb responses are cached with configurable TTLs (`AppSettings.cacheTTL`) for search, detail, and genre lookups.

### Releasing

Releases are built and published by GitHub Actions (`.github/workflows/release.yml`) when you push a version tag:

```bash
# bump "version" in package.json first, then:
git tag v1.0.1
git push origin v1.0.1
```

The workflow builds on `windows-latest` and runs `npm run publish:win`, which uploads the installer, the portable exe, and the `latest.yml` metadata file (which the auto-updater needs) to a GitHub Release. The tag version must match the `version` in `package.json`.

### Contributing

1. Fork the repo and create a feature branch off `main`.
2. Make your change; keep new code consistent with the surrounding style (naming, idioms, comment density).
3. Run `npm run build` to confirm the type-check and build pass.
4. Open a pull request with a clear description of the change and the reasoning behind it.

Bug reports and feature requests are welcome via the [issue tracker](https://github.com/xP9nda/Cinemate/issues).

---

## License

[MIT](LICENSE)
