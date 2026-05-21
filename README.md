# MacCleaner

A free, open-source macOS cleanup utility inspired by CleanMyMac. Scan for regenerable junk, large files, app leftovers, and duplicates — review everything before anything moves. **Every removal goes to the Trash** (nothing is permanently deleted from disk).

[![Latest release](https://img.shields.io/github/v/release/gtarun/MyMacCleaner?label=release)](https://github.com/gtarun/MyMacCleaner/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Sponsor](https://img.shields.io/badge/Sponsor-@gtarun-ea4aaa?logo=github-sponsors&logoColor=white)](https://github.com/sponsors/gtarun)

## Download

Pre-built installers are **not stored in git** (`dist-electron/` is in `.gitignore` on purpose — DMGs are large and belong on releases, not in the repo). Download them from [GitHub Releases](https://github.com/gtarun/MyMacCleaner/releases/latest).

| Mac | File on the release page |
|-----|--------------------------|
| Apple Silicon (M1/M2/M3/M4) | `MacCleaner-*-arm64.dmg` |
| Intel | `MacCleaner-*.dmg` (filename without `arm64`) |

1. Download the `.dmg` for your Mac from the latest release.
2. Open it and drag **MacCleaner** into **Applications**.
3. Launch from Spotlight or Applications.

**First launch (unsigned build):** macOS Gatekeeper may block the app. Right-click (or Control-click) **MacCleaner** in Finder → **Open** → confirm once. After that, it opens normally.

If no release exists yet, [build from source](#build-from-source) or publish one (see [Releases for maintainers](#releases-for-maintainers)).

## Features

| Module | What it does |
|--------|----------------|
| **Dashboard** | One-click scan across cleanup modules; see reclaimable space at a glance. |
| **Mac Health** | Storage overview and disk usage signals. |
| **Performance** | Background process visibility to spot heavy apps. |
| **System Junk** | User caches, logs, and developer leftovers (e.g. Xcode DerivedData, npm/yarn caches). |
| **Large & Old Files** | Finds oversized or stale files in Documents, Desktop, and Downloads. |
| **Duplicates** | Three-stage hash pipeline to find duplicate files in folders you choose. |
| **Uninstaller** | Lists installed apps and detects leftover support files, caches, and prefs. |
| **Menu bar** | Tray icon with quick actions; app stays running for scheduled scans when the window is closed. |

See [PLAN.md](./PLAN.md) for architecture, scanner paths, and roadmap.

## How to use

### First run

1. Complete the short onboarding (or skip it).
2. When prompted, allow access to **Documents**, **Desktop**, and **Downloads** so Large & Old Files can scan those folders.
3. Open **Dashboard** and click **Scan** (or scan individual modules from the sidebar).

### Typical workflow

1. **Scan** — Progress appears in the floating scan dock; results stay available when you switch tabs.
2. **Review** — Open a module, expand categories, and uncheck anything you want to keep.
3. **Clean** — Confirm the summary (“remove N items, X GB”); selected items move to **Trash**.
4. **Recover** — Restore from Trash if needed; empty Trash only when you are sure.

### Menu bar & scheduling

- Closing the main window hides it; use the menu bar icon to show the window again.
- **Settings** (or **⌘,**) — configure scheduled scans and preferences.
- **Quit** from the menu bar or **⌘Q** when the window is focused.

### Duplicates

1. Open **Duplicates**.
2. Choose folders via the system picker (only folders you explicitly select are scanned).
3. Review groups, pick which copies to remove, then confirm.

### Uninstaller

1. Scan **Applications** and **App leftovers**.
2. Select an app or leftover bundle, review matched paths, then remove (app bundle and/or leftovers go to Trash).

## Safety

MacCleaner is **conservative by default**:

- All deletions use `shell.trashItem()` — recoverable until you empty Trash.
- A hard-coded blocklist skips Mail, Messages, Photos library, Keychains, `/System`, iCloud Drive cache, iOS backups, and similar protected areas.
- Scanners only touch explicit allowlisted roots; duplicate scans require folders you pick in the system dialog.
- Every module shows a preview and explicit confirmation before cleaning.

## Requirements

- **macOS** (tested on recent versions; Apple Silicon and Intel builds available)
- For development: **Node.js** 18+ and **npm**

## Build from source

```bash
git clone https://github.com/gtarun/MyMacCleaner.git
cd MyMacCleaner
npm install
```

### Run in development

```bash
npm run dev
```

Starts Vite (hot reload) and Electron together.

### Build a distributable app

```bash
# One-time: generate .icns from build/icon.svg
npm run build:icon

# Produce .app, .dmg, and .zip under dist-electron/
npm run dist
```

Output example:

```
dist-electron/
├── MacCleaner-0.1.0-arm64.dmg
├── MacCleaner-0.1.0-arm64-mac.zip
├── MacCleaner-0.1.0.dmg          # Intel
├── mac-arm64/MacCleaner.app
└── mac/MacCleaner.app
```

Other scripts: `npm run build` (renderer only), `npm run pack` (unsigned `.app` in `dist-electron/` without full DMG packaging).

### Releases for maintainers

| Command | What it does |
|---------|----------------|
| `npm run bump` / `bump:patch` | Bump `package.json` + lockfile only (default: patch) |
| `npm run bump:minor` / `bump:major` | Bump minor or major |
| `npm run release` | Tag `v{version}` + push branch & tag → CI uploads DMGs |
| `npm run release:patch` | Bump patch, commit version, tag, push (full release) |
| `npm run release:minor` / `release:major` | Same with minor / major bump |
| `npm run release -- --dry-run` | Preview steps without changing git |
| `npm run release:build` | Local build only → `dist-electron/` (manual upload) |

**CI release (recommended):**

```bash
# One command: bump, commit version, tag, push — then Actions builds DMGs
npm run release:patch
```

Or bump separately, commit other changes, then tag the current version:

```bash
npm run bump minor
git add package.json package-lock.json && git commit -m "chore: bump version"
# ... other commits ...
npm run release
```

Workflow: [.github/workflows/release.yml](./.github/workflows/release.yml). If a run failed, delete the bad tag/release on GitHub, fix the workflow, then run `npm run release` again.

**Manual upload:** `npm run release:build`, then attach `dist-electron/*.dmg` on [GitHub Releases](https://github.com/gtarun/MyMacCleaner/releases/new). Do not commit `dist-electron/`.

## Project layout

```
src/
├── main/                 # Electron main process (full filesystem access)
│   ├── index.js          # App entry, window management
│   ├── ipc.js            # IPC handlers
│   ├── scanners/         # Per-module scanners
│   ├── safety/           # Allowlist + Trash wrapper
│   └── lib/              # Shared helpers
├── preload.js            # contextBridge API for the renderer
└── renderer/             # Sandboxed React UI
    ├── App.jsx
    ├── modules/          # Dashboard, SystemJunk, Duplicates, …
    └── store/            # Scan and settings state
```

## Contributing

Contributions are welcome — see **[CONTRIBUTING.md](./CONTRIBUTING.md)** for setup, safety rules, and pull request guidelines.

Report security issues privately — see **[SECURITY.md](./SECURITY.md)**.

## Support this project

MacCleaner is free and open source. If it helps you reclaim disk space or time, you can support ongoing work through **[GitHub Sponsors (@gtarun)](https://github.com/sponsors/gtarun)** — one-time or monthly.

## Permissions

Scans of `~/Documents`, `~/Desktop`, and `~/Downloads` may trigger macOS folder-access prompts — approve them for those modules.

Broader locations (not used by default scanners) would require **Full Disk Access** in **System Settings → Privacy & Security → Full Disk Access**. MacCleaner does not require Full Disk Access for its built-in v1 scanners.

## License

[MIT License](./LICENSE) — Copyright (c) 2026 Tarun. See the file for full terms.

## Disclaimer

MacCleaner is a community tool, not affiliated with Apple or CleanMyMac. You are responsible for reviewing items before cleaning. When in doubt, leave files unchecked or restore them from Trash.
