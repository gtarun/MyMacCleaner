# MacCleaner — Implementation Plan

A CleanMyMac-style Mac cleanup utility, built in Electron + Node.js. Open source (MIT), unsigned, conservative-by-default safety.

---

## 1. What CleanMyMac actually does (the parts worth copying)

CleanMyMac's value comes from **knowing where the junk is** and **classifying it safely**, not from doing anything mechanically clever. Its "System Junk" module targets six categories:

1. **User cache files** — `~/Library/Caches/*`. Generally safe; apps regenerate.
2. **System log files** — `~/Library/Logs/*`, `/private/var/log/*`. Diagnostic data nobody reads.
3. **Unused language files** (`.lproj` bundles inside apps). Risky to copy — modifies app bundles, can break code signatures. **We will skip this in v1.**
4. **Old application updates** — leftover `.dmg`/`.pkg` installers in `~/Downloads`, app-specific update caches.
5. **Xcode/developer junk** — `~/Library/Developer/Xcode/DerivedData`, `CoreSimulator`, `iOS DeviceSupport`, plus `~/.npm`, `~/Library/Caches/Yarn`, `~/.pnpm-store`. Often the biggest win — 20–60 GB.
6. **Broken login items & corrupt prefs** — out of scope for v1 (high risk, low reward).

Their **Uninstaller** doesn't just delete `/Applications/Foo.app`. It walks ~10 sibling directories (`~/Library/Application Support`, `~/Library/Preferences`, `~/Library/Caches`, `~/Library/Logs`, `~/Library/Containers`, `~/Library/Saved Application State`, `~/Library/LaunchAgents`, `/Library/LaunchDaemons`, etc.) looking for matches by bundle ID (`com.vendor.AppName`) and app name. This is the "leftover files" trick.

Their safety model: nothing is ever `unlink`ed directly. Everything goes to Trash, and the user gets a categorized preview before they commit. We adopt the same posture.

---

## 2. Cleanable paths — the data that drives the engine

These are the actual filesystem locations the scanner will target. Everything is per-user (`~/...`) unless noted; we deliberately avoid `/System/Library` because Apple Silicon manages it itself and touching it breaks SIP/snapshotting.

### System Junk
| Category | Paths | Notes |
|---|---|---|
| User caches | `~/Library/Caches/*` | Skip Mail, Photos, anything with an active lock (`lsof` check) |
| User logs | `~/Library/Logs/*` | Safe |
| Crash reports | `~/Library/Logs/DiagnosticReports/*` | Safe |
| App-specific caches | `~/Library/Containers/*/Data/Library/Caches/*` | Safe but slow to walk |
| Trash | `~/.Trash/*` | Optional — explicit user confirmation |
| Old downloads | `~/Downloads/*.dmg`, `*.pkg`, `*.zip` older than 30 days | Heuristic — show, don't auto-clean |

### Developer Junk (separate tab — biggest disk wins)
| Category | Path | Typical size |
|---|---|---|
| Xcode DerivedData | `~/Library/Developer/Xcode/DerivedData` | 5–60 GB |
| Xcode Archives | `~/Library/Developer/Xcode/Archives` | Variable — **ask before deleting**, these are release artifacts |
| iOS Simulator runtimes | `~/Library/Developer/CoreSimulator/Caches` | 10–30 GB |
| Unavailable simulators | `xcrun simctl delete unavailable` | Variable |
| npm cache | `~/.npm` | 1–5 GB |
| Yarn cache | `~/Library/Caches/Yarn` | 1–5 GB |
| pnpm store | `~/.pnpm-store` | 2–10 GB |
| `node_modules` (project-scoped) | walk `~/` for `node_modules` dirs | Optional, deep scan |

### App Uninstaller — leftover-file sibling directories
For an app with bundle ID `com.example.MyApp`, search for `MyApp` and `com.example.MyApp` in:
- `~/Library/Application Support`
- `~/Library/Preferences` (`.plist`)
- `~/Library/Caches`
- `~/Library/Logs`
- `~/Library/Containers`
- `~/Library/Group Containers`
- `~/Library/Saved Application State`
- `~/Library/LaunchAgents`
- `~/Library/HTTPStorages`
- `~/Library/WebKit`
- `/Library/Application Support`, `/Library/LaunchDaemons`, `/Library/PrivilegedHelperTools` (require admin)

### Large & Old Files
- Default scan roots: `~/Documents`, `~/Downloads`, `~/Desktop`, `~/Movies`, `~/Pictures`
- Surface files >100 MB OR not accessed in >180 days
- User can add custom roots

### Duplicate Finder
- User-selected roots only (never whole filesystem by default)
- Three-stage match: size → first/last 64 KB hash → full SHA-256
- Group results, let user pick which copy to keep

---

## 3. Architecture

```
mac-cleaner/
├── package.json
├── src/
│   ├── main/                      # Node.js, runs with full FS access
│   │   ├── index.js               # App entrypoint, window mgmt
│   │   ├── ipc.js                 # IPC handlers — the renderer's only door
│   │   ├── scanners/
│   │   │   ├── system-junk.js     # Caches, logs, crash reports
│   │   │   ├── dev-junk.js        # Xcode, npm, yarn, pnpm
│   │   │   ├── apps.js            # Walks /Applications, reads Info.plist
│   │   │   ├── uninstaller.js     # Finds leftovers for a given bundle ID
│   │   │   ├── large-old.js       # Walks for big/stale files
│   │   │   └── duplicates.js      # Size → partial-hash → full-hash
│   │   ├── safety/
│   │   │   ├── allowlist.js       # Paths we'll never touch (Mail DB, Photos library, Keychain…)
│   │   │   ├── lockcheck.js       # Skips files currently open (lsof)
│   │   │   └── trash.js           # Wraps shell.trashItem — never unlink
│   │   └── worker.js              # Heavy scans run in a worker_thread so UI never freezes
│   ├── preload.js                 # contextBridge — exposes a narrow, typed API
│   └── renderer/                  # The UI (no Node access)
│       ├── index.html
│       ├── app.jsx                # React, single-file router
│       ├── modules/
│       │   ├── SystemJunk.jsx
│       │   ├── LargeOldFiles.jsx
│       │   ├── Uninstaller.jsx
│       │   └── Duplicates.jsx
│       └── components/            # Shared: SizeBar, FileTree, ScanProgress, ConfirmModal
└── PLAN.md                        # this file
```

### Process model
- **Main process** owns all filesystem work. The renderer can't `fs.readdir` anything.
- **Renderer** is sandboxed (`contextIsolation: true`, `nodeIntegration: false`). It calls a narrow IPC surface — `scan(module)`, `getResults(scanId)`, `cleanItems(itemIds)`.
- **Worker thread** runs each scan so the main process stays responsive. Scans stream progress events back via IPC.

### Safety guardrails (non-negotiable)
1. **Trash, never unlink.** Every removal goes through `shell.trashItem()`. The user's safety net is macOS's own trash.
2. **Allowlist.** A hard-coded list of paths we refuse to touch regardless of category: `~/Library/Mail`, `~/Library/Messages`, `~/Pictures/Photos Library.photoslibrary`, `~/Library/Keychains`, anything under `/System`, anything under `/Library` not in our explicit dev-tool list.
3. **Lock check.** Before listing a cache file as removable, skip if `lsof` shows it's open.
4. **Preview, always.** No category cleans without an explicit "Remove N items, X GB" confirmation.
5. **Dry-run mode.** Toggle in settings — shows what *would* be moved without doing it. Useful for the first few runs.

### Permissions reality check
Some of what we want to scan needs **Full Disk Access** (`~/Library/Mail`, `~/Library/Messages`, system caches). The app will detect missing permissions and show a one-time onboarding card pointing the user to *System Settings → Privacy & Security → Full Disk Access*. Without it, the app still works — it just shows less stuff.

The app itself runs unsigned, so the user has to right-click → Open the first time to bypass Gatekeeper. We'll document this in the README.

---

## 4. UI flow per module

Common shell: left sidebar with the four modules + Settings; main pane shows the active module. Top of every module: a single big "Scan" button with progress, then a results view that becomes a "Review & Remove" pane.

**System Junk**
1. Scan → progress per category (caches, logs, dev junk).
2. Tree view: top-level categories with size badges, expandable to per-app/per-folder rows. Everything pre-checked.
3. Bottom bar: "Remove 4.2 GB" → confirmation modal showing the count and the destination (Trash).

**Large & Old Files**
1. Pick scan roots (sensible defaults pre-populated).
2. Results split into two tabs: **Large** (sorted by size desc) and **Old** (sorted by last-access asc). Each row: thumbnail/icon, path, size, last opened.
3. Nothing pre-checked — this is content the user owns; require deliberate selection.

**App Uninstaller**
1. Lists `/Applications` and `~/Applications` with size + last-used date.
2. Click an app → side panel shows the app bundle plus the leftover files we found (grouped by Library subdirectory). All pre-checked.
3. "Uninstall MyApp + 14 leftover items" → Trash.

**Duplicate Finder**
1. User picks roots (no defaults — this is destructive and slow).
2. Three-stage scan with visible progress: size grouping → partial hash → full hash.
3. Groups of duplicates; in each group, one copy is "keep" (oldest path by default), others are checked for removal. User can re-pick the keeper.

---

## 5. Build phases

| Phase | Deliverable | Why this slice |
|---|---|---|
| 1 — Skeleton | Electron app boots, renders an empty four-tab shell, IPC roundtrip works | Proves the process model before we sink time into scanners |
| 2 — System Junk | Caches/logs scanner, results UI, Trash flow with confirmation | The most visceral "wow" feature; small enough to ship end-to-end |
| 3 — Dev Junk | Xcode/npm/yarn scanners as a System Junk sub-section | Reuses the System Junk UI; gives biggest disk wins |
| 4 — Uninstaller | App list, leftover finder, bundle-ID search | More complex (cross-directory matching); needs the safety patterns from phase 2 |
| 5 — Large & Old | Filesystem walker with streaming results | Mostly UI work — engine is straightforward |
| 6 — Duplicates | Three-stage hash pipeline in a worker thread | Most CPU-heavy; benefits from having worker plumbing already in place |
| 7 — Polish | Dry-run toggle, FDA onboarding, settings, app icon, dock badge | Ship-worthy feel |

Each phase ends with the app being usable end-to-end for that module — no half-wired features.

---

## 6. Key libraries

- **electron** — app shell
- **react** + **vite** — renderer build
- **fast-glob** — fast filesystem traversal with ignore patterns
- **fs-extra** — saner async fs API
- **bytes** — human-readable size formatting
- Built-in **`crypto`** + **`worker_threads`** — duplicate hashing (no external dep needed)
- **electron-store** — settings persistence (scan roots, dry-run toggle)

No native modules — keeps the unsigned-distribution story simple.

---

## 7. Open risks to surface before coding

- **`~/Library` Full Disk Access prompt.** Without it, our scans return partial data and the user thinks the app is broken. The FDA onboarding card has to be unmissable.
- **iCloud Drive offloaded files.** Reading a file's size triggers a download. We need to detect `.icloud` placeholder files and skip them.
- **Time Machine local snapshots.** Sometimes account for "missing" disk space. We can't clean these (`tmutil` only), but we should mention them in a "didn't help?" footer.
- **App Translocation.** If the user opens the app from `~/Downloads` without moving it to `/Applications`, macOS runs it from a read-only random path and some flows break. README should say "move to /Applications first."

---

## Next step

If this plan looks right, the natural next move is **Phase 1**: scaffold the Electron + React + Vite skeleton and prove the IPC handshake. That's a 30-minute slice and unblocks everything else.
