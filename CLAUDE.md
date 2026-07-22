# MacCleaner — assistant briefing

Personal, open-source, **unsigned** macOS cleanup utility in Electron + Node + React. Conservative-by-default. If you're a future AI assistant picking this project up cold, read this file first, then the two docs it points to.

## What this is in one paragraph

A CleanMyMac-style desktop app the maintainer (Tarun) is building for personal use. Single Electron app, Vite-built React renderer, Node main process for all disk work, contextBridge preload as the only renderer→main surface. No code signing or notarization (`identity: null`) — distribution is local DMG only. The user has actually used this app to reclaim 100+ GB of real data, so safety regressions matter.

## The hard rules — break these and the app eats user data

1. **The renderer NEVER passes a raw filesystem path that leads to deletion.** Every removal goes through `clean:trash-items`, which routes through `safety/allowlist.checkPathSafety` (single gate, defense-in-depth) before calling `shell.trashItem`. The only path that *permanently* deletes is `trash:empty` (Empty Trash) and `system-data:delete-snapshots` (`tmutil`) — both explicit, behind their own confirms, and recorded non-restorable in history.
2. **The safety gate has three layers, all must pass**: (a) path must be strictly inside an `ALLOWED_ROOTS` entry or a runtime allowlist entry added via the OS folder picker; (b) must not be inside `NEVER_TOUCH` (Mail, Messages, Keychains, Photos library, MobileSync iOS backups, /System, etc.); (c) must not be in the user's exclusions list. See `src/main/safety/allowlist.js`.
3. **Move to Trash, don't `rm`.** Even "obviously safe" caches go to `~/.Trash` via `shell.trashItem` so the user can recover anything. The Trash-first rule is the entire reason this app is trusted.
4. **Dry-run is a real feature, not a debug flag.** `settings.safety.dryRun` is the user's safety net while learning — every cleaning path respects it and surfaces "Would free X" wording when on.
5. **Shell-out commands run via `execFile` with fixed argv, never a shell string.** The renderer sends an id (bucket id, pid, etc.), main resolves the curated command. The aggressive `docker system prune -a --volumes` is intentionally kept as copy-only text the app refuses to run.

## Non-obvious conventions (learned the hard way)

- **Visibility-gated polling.** The user reported real overheating. Anything that polls or animates forever MUST pause when the window is hidden or unfocused. Use `useWindowVisible()` from `src/renderer/lib/hooks.js` for polling; use the `app--idle` body class (set on blur in `App.jsx`) plus `prefers-reduced-motion` to pause CSS animations. New modules with timers MUST follow this pattern. See `docs/ARCHITECTURE.md` § Heat & power.
- **Expensive walks need a slow cadence.** Cheap snapshots (`getHealth`) can poll on 5s; recursive walks (`getTrashInfo`) refresh on 30s and on explicit events, never on the cheap-stat cadence.
- **Modules persist across tab switches.** The shell renders every module with `display: none` for non-active tabs (see `App.jsx`), so scans survive navigation. Effects must gate on `isActive` (and visibility) — don't assume "unmount = stop".
- **Streaming progress via `scan:progress`.** Every scan emits `{scope, phase, ...}` events; `ScanContext` auto-populates `activeScans[scope]` and powers the bottom scan-dock. New scanners must emit progress.
- **`trashItems(paths, {scope, items})` — pass the meta.** It enables accurate per-scope `recordCleaned` and restorable history. Bare arrays still work for back-compat but lose history fidelity.
- **The shell-out PATH problem.** GUI Electron apps launched from Finder inherit a minimal PATH. `docker`/`xcrun` are looked up via a candidate list in `system-data.js` `resolveBin()`. Add new external commands the same way.
- **Verification when you can't run Electron.** The dev sandbox can't run npm/electron. Use `node --check` for main JS (CommonJS), and `esbuild-wasm` (`npm i esbuild-wasm`, see verify commands in commit history) to parse JSX. Cross-check preload `invoke('x')` ↔ ipc `handle('x')` channels with grep after every IPC change.

## Where to find what

- `docs/ARCHITECTURE.md` — complete inventory: every module, scanner, IPC channel, what it does, what files it touches, what its safety posture is.
- `docs/ROADMAP.md` — ranked next steps with rationale.
- `package.json` — `build` field contains all electron-builder config. The DMG `title` is `${productName} ${version} ${arch}` (must keep `${arch}` or both-arch DMG builds collide on `/Volumes/...` and `hdiutil detach` fails).
- `README.md` — user-facing install/usage. Keep separate from this file.

## When in doubt

The maintainer's stated value, repeatedly: "without breaking anything." If a change might delete the wrong thing, default to surfacing it as review-only with a copyable command instead of running it automatically. Pattern: the System Data module's iOS backups, Xcode Archives, and Docker `--volumes` variant are all review-only for exactly this reason.
