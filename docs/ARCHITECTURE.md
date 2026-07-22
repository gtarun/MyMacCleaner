# MacCleaner — architecture and inventory

A complete map of what's built, where it lives, and the conventions that hold it together. Read `/CLAUDE.md` first for the hard rules.

## 1. Process model

Standard Electron split. The main process owns all disk I/O and shell-outs. The renderer is sandboxed and reaches main only through `contextBridge` API exposed in `src/preload.js`. There is no remote module, no `nodeIntegration` in the renderer.

```
src/main/index.js         — app lifecycle, BrowserWindow, lifecycle hooks
src/main/ipc.js           — central IPC registry (every channel lives here)
src/preload.js            — contextBridge wrappers, the renderer's only surface
src/renderer/App.jsx      — the React shell, sidebar, module hosting
src/renderer/modules/*    — one component per feature tab
src/renderer/store/*      — ScanContext, SettingsContext
src/renderer/components/* — shared UI (Icons, ConfirmModal, SponsorCard, etc.)
src/renderer/lib/*        — pure helpers (format.js, hooks.js)
src/main/scanners/*       — every read-only scan
src/main/safety/*         — allowlist + trash wrapper
src/main/lib/walk.js      — shared `measureDir`, `measurePath`, dev-noise skip set
```

The renderer keeps every module mounted (`App.jsx` toggles `display`, not unmount), so scans survive tab switches. Effects must gate on `isActive` and, for polling, `useWindowVisible()`.

## 2. Safety model — the single most important subsystem

Everything that mutates disk passes through one gate: `checkPathSafety(p)` in `src/main/safety/allowlist.js`. It returns `{ ok, reason }`. A path passes only when all three layers agree:

**Layer 1 — Inside an allowed root.** `ALLOWED_ROOTS` is a hand-curated list of directories the app may touch: `~/Library/Caches`, `~/Library/Logs`, the Xcode dev caches, `/Applications`, `~/Applications`, `~/Library/Application Support`, the macOS app data dirs, plus user content folders (`Documents`, `Downloads`, `Desktop`, `Movies`, `Pictures`). Paths must be *strictly inside* — equal-to-root is rejected so we can never remove an allowed-root itself.

**Layer 2 — Not inside NEVER_TOUCH.** Includes Mail, Messages, Keychains, the Photos library, MobileSync iOS backups, the system `Mail` cache aliases, CloudKit, `~/Library/Caches/com.apple.bird` (iCloud Drive), and `/System`, `/private/var/db`, `/private/var/folders`.

**Layer 3 — Not in user exclusions.** Loaded from `settings.exclusions`. The user can mark any folder as "don't touch" via Settings → Safety. Refreshed live on settings change.

There is also a **runtime allowlist** for folders the user explicitly picks in the OS dialog (Duplicates, Stale Projects). Picking a folder via the system file picker is treated as consent — `validatePickedRoot()` still refuses overly broad picks (root, home, `/Users`, anything containing a never-touch).

The actual deletion happens in `src/main/safety/trash.js`'s `trashItems(paths, { dryRun })`, which loops paths, calls `checkPathSafety`, and either `shell.trashItem(p)` or simulates in dry-run mode. Returns one result per input path in input order (the renderer relies on this ordering for history correlation).

**Permanent deletions** exist in exactly two places:
- `trash:empty` (`src/main/trash-bin.js`) — `fs.rm` on each `~/.Trash` top-level entry. Refuses anything that resolves outside `~/.Trash`.
- `system-data:delete-snapshots` — `tmutil deletelocalsnapshots`. Snapshots can't be Trashed; they're permanent by nature.
Both are confirm-gated, dry-run respected, history-logged with `restorable: false`.

## 3. IPC contract

Every channel is registered in `src/main/ipc.js` and exposed in `src/preload.js`. Always keep these in sync — there's a grep cross-check helper used during verification.

Categories of channels (channel → preload wrapper):

```
Handshake / system
  system:info                              → getSystemInfo
  system:report                            → getSystemReport
  shell:open-external (http/https only)    → openExternal

Settings
  settings:get / settings:update           → getSettings / updateSettings
  settings:changed (push event)            → onSettingsChanged
  scheduler:run-now                        → runScheduledScan
  scan:scheduled-result (push event)       → onScheduledResult
  tray:navigate (push event)               → onTrayNavigate

Onboarding
  onboarding:request-folder-access         → requestFolderAccess

Scanners (return final result; emit scan:progress during)
  scan:system-junk                         → scanSystemJunk
  scan:large-old                           → scanLargeOld
  scan:duplicates                          → scanDuplicates
  scan:stale-projects                      → scanStaleProjects
  scan:disk-map                            → scanDiskMap
  scan:system-data                         → scanSystemData
  scan:progress (push event)               → onScanProgress

Pickers (validate + add to runtime allowlist where appropriate)
  dialog:pick-folders (Duplicates / Stale) → pickFolders
  dialog:list-picked-roots                 → listPickedRoots
  dialog:pick-paths (exclusions, no allow) → pickPaths

Cleanup — the only mutating path
  clean:trash-items                        → trashItems(paths, meta?)

System Data — review/run
  system-data:clear-bucket                 → clearSystemDataBucket
  system-data:delete-snapshots             → deleteLocalSnapshots
  system-data:reclaim-run                  → runSystemDataReclaim
  system-data:reclaim-preview              → previewSystemDataReclaim

Uninstaller
  apps:list                                → listApps
  apps:leftovers                           → findLeftovers

Trash bin
  trash:info                               → getTrashInfo
  trash:empty                              → emptyTrash

Mac Health / Performance
  health:get                               → getHealth
  processes:list                           → listProcesses
  processes:kill                           → killProcess

History
  history:list / history:restore / history:clear → getHistory / restoreHistory / clearHistory
```

`scan:progress` is the streaming channel. Payload shape: `{ scope, phase, category?, currentItem?, itemsDone?, itemsTotal?, visited?, files?, ... }`. The renderer subscribes once via `onScanProgress` and routes by `scope`. `ScanContext` automatically populates `activeScans[scope]` for any scope it sees, so adding a new scanner doesn't require touching the context.

## 4. Renderer state

Two contexts at the root:

**`SettingsContext`** (`src/renderer/store/SettingsContext.jsx`) — loads `settings:get` once, subscribes to `settings:changed`. Provides `{ settings, loading, update }`. Used by Settings UI and any module that needs e.g. `safety.dryRun`.

**`ScanContext`** (`src/renderer/store/ScanContext.jsx`) — tracks `activeScans` (live progress, by scope), `results` (last scan result per scope, also persisted via `settings.lastResults`), `requestedScans` (a Set the Dashboard uses to ask a tab to scan when clicked). Exposes `useScanScope(scope)` returning `{ progress, result, markActive, setResult, requested, requestScan, clearRequest }`. Every cleaning module calls `markActive(true/false)` around its scan so the sidebar shows the per-tab dot indicator and the global scan-dock works.

## 5. Settings + persistence

`src/main/settings.js` reads/writes `settings.json` in `app.getPath('userData')` and merges deeply (`mergeDeep` replaces arrays). `DEFAULTS` documents the shape:

- `safety.dryRun: false`
- `firstRun.completed: false`
- `largeOld.{roots, minBytes, minAgeDays}`
- `duplicates.roots: []` — persisted picked folders
- `staleProjects.{minAgeDays:90, minBytes:50MB}`
- `exclusions: []` — user-protected paths
- `schedule.{enabled, cron, scopes}` — for scheduler.js
- `lastResults.{scope: {recordedAt, totalBytes, …}}` — for Dashboard hydration
- `lastCleaned.{scope: {at, bytes}}` — for Activity rows in Settings

`recordCleaned(scope, bytes)` updates `lastCleaned` atomically. `restorePersistedRoots()` is called once in `ipc.js` on boot to (a) feed `setExclusions` and (b) re-add persisted Duplicates roots to the runtime allowlist (each re-validated).

## 6. Cleaning modules

All follow the same pattern: scanner emits progress + returns a result; the module renders results; the user picks items; `trashItems(paths, { scope, items: [{path, bytes}] })` moves them to Trash; history records the action with sizes.

### System Junk — `src/main/scanners/system-junk.js`
Curated category scanner. Each category has a list of known paths under `~/Library/Caches`, `~/Library/Logs`, the various Xcode and package-manager dev caches. Returns `{ categories: [{ id, label, items: [{path, bytes, fileCount}] }], totalBytes, itemCount }`. UI: `src/renderer/modules/SystemJunk.jsx`. Accent: green.

### Large & Old Files — `src/main/scanners/large-old.js`
Walks `largeOld.roots` (default user content folders) skipping `walk.js` dev-noise dirs and bundles. Flags files larger than `minBytes` or older than `minAgeDays`. Honors `isExcluded` per walked path. UI: `src/renderer/modules/LargeOldFiles.jsx`. Accent: blue. Never pre-checks anything — these are user content.

### Duplicates — `src/main/scanners/duplicates.js`
Multi-stage: same-size grouping → partial-hash (first MB) → full-hash on collisions. User picks roots via `dialog:pick-folders` (added to runtime allowlist on accept). Persisted in `settings.duplicates.roots`. UI: `src/renderer/modules/Duplicates.jsx`. Accent: orange.

### Stale Projects — `src/main/scanners/stale-projects.js`
Finds heavy regenerable dirs (`node_modules`, `target`, `.venv`, `Pods`, etc.) sitting next to source whose newest source-file mtime is older than `minAgeDays`. The "freshest source" walk excludes heavy dirs and is bounded (6000 files). Critically, when no source is readable, falls back to heavy-dir mtime so missing-source projects still report an age. Honors exclusions. UI: `src/renderer/modules/StaleProjects.jsx`. Accent: teal. Reuses Duplicates' picked roots.

### Uninstaller — `src/main/scanners/apps.js` + `uninstaller.js`
`listApps()` lists `.app` bundles in `/Applications` and `~/Applications`, reads `Info.plist` for name + bundle id, measures sizes. `findLeftovers(bundleId, appName)` searches `~/Library/{Application Support, Preferences, Caches, Logs, Containers, Group Containers, Saved Application State, LaunchAgents, HTTPStorages, WebKit, Cookies}` for files whose name matches the bundle id or app name. UI: `src/renderer/modules/Uninstaller.jsx`. Accent: purple.

## 7. System modules (read-only or special)

### Mac Health — `src/main/health.js` + `src/main/trash-bin.js`
Cheap snapshot of disk (`df -k $HOME`), memory (`os.totalmem/freemem`), CPU (`os.cpus/loadavg`), uptime, host info (`sw_vers`, `sysctl -n hw.model`). All shell-outs parallel via `Promise.all`. Returns `{ disk, memory, cpu, uptime, host, verdict, reasons }`. Verdict colors the hero card.

Trash bin: `getTrashInfo()` recursively measures `~/.Trash`. **This is expensive** — the MacHealth module refreshes it on a 30s cadence (not the 5s health cadence) and gates on `useWindowVisible()`. ENOENT returns `itemCount: 0` (truly empty); other errors return `itemCount: null` so the Empty Trash button doesn't get wrongly disabled. `emptyTrash({dryRun})` is the permanent path; defense-in-depth checks every entry resolves strictly inside `~/.Trash`.

UI: `src/renderer/modules/MacHealth.jsx`. Disk and Memory cards are clickable, navigating to Disk Space and Performance respectively. Empty Trash sits behind a confirm and logs non-restorable history.

### Performance — `src/main/processes.js`
`listProcesses({ limit, sortBy })` runs `ps axo pid,ppid,user,%cpu,%mem,rss,comm,command` and parses. CPU is per-core, so the snapshot includes `cpuCount` and the UI normalizes (`totals.cpu / cpuCount`, capped at 100). `killProcess(pid, {force})` sends SIGTERM or SIGKILL with a hardcoded refuse-list (kernel_task, launchd, etc.).

Polls on a self-scheduling 3s `setTimeout` (not `setInterval`) so a slow `ps` can't stack invocations. Gated on `isActive && windowVisible`. UI: `src/renderer/modules/Performance.jsx`. Accent: amber. Only the process table is scrollable; the page itself is fixed-height.

### Disk Space — `src/main/scanners/disk-map.js`
Builds a size tree of a chosen root (default `$HOME`) to a depth, keeping the topN biggest children per dir and rolling the rest into a synthetic "Other" node. Bundles are opaque leaves. Honors exclusions, skips symlinks. UI: `src/renderer/modules/DiskMap.jsx` renders a hand-rolled squarified treemap (no library) with drill-down via a stack + breadcrumb that re-scans on click. Accent: rose.

### System Data — `src/main/scanners/system-data.js`
Curated list of the big opaque "System Data" buckets. Each bucket has `action: 'trash' | 'review'`. Trash buckets (Xcode DerivedData, iOS DeviceSupport, CoreSimulator caches) clear by enumerating top-level children and Trashing each. Review buckets (iOS Simulator devices, Xcode Archives, iOS backups, Docker data, generic user caches) are info-only.

Two review buckets have a curated **safe-run** command (`docker system prune -f`, `xcrun simctl delete unavailable`) via `runReclaim(id)` — fixed argv resolved server-side, never a shell string. Docker also has a read-only preview (`docker system df`). The aggressive variant (`docker system prune -a --volumes`) is exposed only as copy-only "Advanced" text the app refuses to execute.

Time Machine local snapshots are listed via `tmutil listlocalsnapshots /` and deleted via `tmutil deletelocalsnapshots <date>`. Permanent (no Trash), safe-by-design (snapshots regenerate, real backups untouched). Snapshot ids are regex-validated server-side before being passed to `tmutil`.

`resolveBin(name, candidates)` handles the GUI-PATH problem: Finder-launched apps inherit minimal PATH, so `docker`/`xcrun` get resolved against a candidate list (`/opt/homebrew/bin/docker`, `/usr/local/bin/docker`, `/Applications/Docker.app/...`, `/usr/bin/xcrun`).

UI: `src/renderer/modules/SystemData.jsx`. Accent: blue.

### History — `src/main/history.js`
Per-action log at `userData/history.json`, capped at `MAX_ENTRIES=200`. Each entry: `{ id, at, scope, dryRun, restorable, items: [{path, bytes, restoredAt?}] }`. `restore(entryId)` best-effort moves a Trashed item from `~/.Trash/<basename>` back to its original path, refusing to overwrite occupied paths, and marks `restoredAt`. UI: `src/renderer/modules/History.jsx` — timeline grouped by day, expand to see items, "Put back" buttons on restorable items, Clear with confirm.

### Settings — `src/renderer/modules/Settings.jsx`
Tabs for Safety (dry-run + exclusions picker via `pickPaths`), Scanning (thresholds for Large&Old + Stale Projects), Schedule (cron presets + scopes), Activity (per-scope `lastCleaned` rows + last scan times). System Info card opens a modal (`SystemInfoModal.jsx`) with the full categorized `getSystemReport()` and per-row + Copy All clipboard buttons.

## 8. Scheduler + tray

`src/main/scheduler.js` — rolling `setTimeout` (not `setInterval`) so settings changes can cleanly reschedule. `rescheduleFromSettings()` is called whenever settings update. On fire, runs the configured scopes and broadcasts `scan:scheduled-result`.

`src/main/tray.js` — menu-bar companion. Tray title shows total reclaimable bytes from `settings.lastResults`. Menu items send `tray:navigate` to switch tabs when the window comes forward. `tray.refresh()` is called on every settings update so the title stays honest.

## 9. Onboarding

`src/renderer/components/Onboarding.jsx` shown when `!settings.firstRun.completed`. Walks the user through: dry-run explanation, requesting folder access (`onboarding:request-folder-access` does a no-op readdir on Documents/Downloads/Desktop so macOS surfaces TCC prompts), GitHub Sponsors mention. Concluding step sets `firstRun.completed: true`.

## 10. Heat & power (added after user reported overheating)

`src/renderer/lib/hooks.js` — `useWindowVisible()` returns false when `document.visibilityState === 'hidden'` (window minimized or fully occluded). Used by Performance + MacHealth to gate polling.

`App.jsx` listens for window focus/blur/visibilitychange and toggles `body.app--idle`. CSS rules in `styles.css`:

```css
body.app--idle .welcome__glow::before,
body.app--idle .welcome__sparkle,
body.app--idle .nav-item__dot,
body.app--idle .spinner { animation-play-state: paused; }

@media (prefers-reduced-motion: reduce) { /* infinite animations off */ }
```

Rules to keep:
- Cheap snapshots (5s OK), expensive walks (≥30s), never both on the same timer.
- `setTimeout`-self-scheduling for any tick that calls a shell-out, so slow runs don't stack.
- New CSS animations: avoid `infinite` on always-visible elements unless paused by `.app--idle`.

## 11. Verification approach

The dev sandbox cannot run Electron, npm, or any GUI test. Verification uses static parsing only:

- **Main JS (CommonJS)**: `node --check src/main/...`
- **Renderer (ESM + JSX)**: `esbuild-wasm` via `esbuild.transform(src, { loader: 'jsx' })`. Install once with `npm install esbuild-wasm` in an outputs scratch dir. The native `esbuild` won't work cross-platform; the wasm build does.
- **IPC ↔ preload channel parity**: grep each new channel name in both files. Easy mismatch source.
- **Scanner smoke tests**: stub `electron`'s `Module._load` to no-op, point `process.env.HOME` at a temp dir, build a fake tree, run the scanner. Catches regressions like the stale-projects "unknown idle" bug.

For destructive paths, also smoke-test that `enumerateBucketChildren` refuses review buckets (defense against renderer mis-use) and that snapshot ids must match the date regex before reaching `tmutil`.

## 12. Build / packaging

`electron-builder` config lives in `package.json` `build` field. Targets: DMG + zip × `arm64` + `x64` (Apple Silicon + Intel). Code signing is intentionally off (`identity: null`) — distribution is local. `dmg.title` MUST include `${arch}` or both-arch builds collide on `/Volumes/MacCleaner X.Y.Z` and `hdiutil detach` fails.

`npm run dist:ci` produces signed-skipped DMGs in `dist-electron/`. Icon source is `build/icon.svg`, baked to `icon.icns` via `scripts/build-icon.js` (uses `sharp`). Bump and release helpers in `scripts/bump.js` and `scripts/release.js`.
