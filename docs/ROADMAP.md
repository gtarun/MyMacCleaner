# MacCleaner — roadmap

Ranked by impact for the maintainer's actual use case (personal cleanup on Apple Silicon, occasional GitHub release for others). "Without breaking anything" is the operating principle — anything potentially destructive should land as review-only first and gain a run button only once we're confident.

Items are grouped by how committed they are. The order within each group is roughly priority.

Compatibility (Intel vs Apple Silicon, macOS version floor, Gatekeeper) has its own reference now: `docs/COMPATIBILITY.md`.

## Shipped since this roadmap was first written

- **Leftover installers cleaner** ✅ — `Installers` module + `src/main/scanners/installers.js`. Flags old `.dmg`/`.pkg`/`.xip`/`.iso`/`.zip` in `~/Downloads` (age from `settings.installers.minAgeDays`, default 30). Never pre-checks. Has a Dashboard tile (pink accent) and is part of Smart Scan.
- **Accurate sparse-file sizing** ✅ — `walk.js` now measures real on-disk footprint via `st.blocks * 512` (falls back to `st.size` when blocks is 0), behind the `USE_DISK_BLOCKS` flag. Fixes the inflated Docker `.raw` number in System Data.
- **Show in Finder** ✅ — `shell:show-in-folder` IPC + `RevealButton` component wired into Large & Old, Duplicates, and System Data review buckets. Read-only reveal (`shell.showItemInFolder`), never opens/executes.
- **Homebrew cache cleaner** ✅ — new System Data review bucket with an **arch-aware** `brew cleanup` reclaim (`/opt/homebrew` ↔ `/usr/local`) and a `brew cleanup -n` preview. Excluded from the System Data total (`countInTotal: false`) because the download cache is a subset of `~/Library/Caches`.

## Cleared but parked (original task #92 carved into this list)

These were the second half of the "more cleaners" theme. The first half (Disk Space + System Data + safety net) shipped; these are the obvious follow-ups.

### Browser data cleaner
Per-browser cache + downloaded files + leftover profile data. Targets: Safari (`~/Library/Caches/com.apple.Safari`, `~/Library/Safari/Downloads.plist`), Chrome (`~/Library/Application Support/Google/Chrome/*/Cache`), Arc, Firefox, Edge. Each browser is its own scanner with a curated list of cache paths. Keep history/cookies/passwords NEVER_TOUCH. Probably extend `system-junk.js` with a "Browsers" category rather than a new top-level module.

### Localization / language file stripper
The classic CleanMyMac trick: app bundles ship dozens of `*.lproj` directories the user will never use. Walk `/Applications/*.app/Contents/Resources/*.lproj`, skip the user's preferred locales (from `defaults read -g AppleLanguages`), report the rest. **High risk** — touching `.app` bundle internals can break apps and signature verification. Land as review-only first; gain a "Trash these locales" button only after extensive testing on a throwaway Mac. Worth doing because savings can be multi-GB per Adobe-class app.

### Mail attachments review (deferred from #92)
Originally skipped because Mail is NEVER_TOUCH. Reconsider as a review-only readout: walk `~/Library/Mail/V*/MailData/Envelope*` to find attachment sizes by message, link to Mail.app for actual deletion. Never modify Mail data directly.

## Quality + correctness

### Dashboard tile for System Data
The Dashboard tile grid has no System Data tile yet. Add one (accent: blue) that summarizes "X GB across N buckets · M snapshots". Hook into `useScanScope('system-data').setResult` from the System Data module so the tile hydrates after each scan.

### Snapshot size estimation
`tmutil` doesn't report per-snapshot size. APFS doesn't expose it cheaply either. Best available: `diskutil apfs list` shows allocated snapshot storage at the volume level. Surface this as a single "snapshots are using ~X GB total" line in the System Data panel — even rough is better than the current "size unknown" message.

### Tests
There are none. The verification approach (node --check + esbuild-wasm + smoke scripts) catches syntax and obvious logic regressions but no real test suite. Worth adding: a small Vitest suite for the pure functions in `allowlist.js`, `walk.js`, `system-data.js` (bucketDefs, snapshot id regex, resolveBin). Don't try to test scanners end-to-end — fake-FS is more pain than payoff.

### Scheduled System Data check
The existing scheduler.js already runs cleaning scans on cron. Extend it to optionally include a System Data scan and push a tray notification when a bucket crosses a configurable threshold (e.g. snapshots > 50GB, Docker > 30GB). Helps catch the slow refill before it hits 300GB again.

## Distribution

### Universal binary instead of two arch builds
`mac.target.arch: ["arm64", "x64"]` produces two DMGs that already had to be made distinguishable by `${arch}` in `dmg.title`. Switching to `["universal"]` produces one DMG that runs natively on both — half the downloads on the release page, no volume-name fight at all. Trade-off: larger binary (~2x). Worth it for a tools app where size doesn't matter much. Verify all native deps support universal first (current deps: `sharp` for icon-build only at dev time, fine). See `docs/COMPATIBILITY.md` § Build & distribution.

### Gatekeeper note for macOS 15+
Apple removed the right-click → Open bypass in macOS 15 Sequoia. Unsigned first-run now requires **System Settings → Privacy & Security → "Open Anyway"**. Add this to the README install steps and onboarding so newer-OS users aren't stuck. Full detail in `docs/COMPATIBILITY.md` § Gatekeeper.

### Optional: code signing + notarization
Currently `identity: null`. Unsigned means users must right-click → Open the first time and macOS Gatekeeper complains. For wider distribution, sign with a Developer ID and notarize. Requires an Apple Developer account ($99/yr) and signing config in `electron-builder`. The maintainer has explicitly deferred this — leave parked unless distribution scope changes.

### In-app updater
Currently no auto-update. `electron-updater` integrates with electron-builder. Adding it means deciding on a hosting strategy (GitHub releases works) and accepting that updates of an unsigned app will still prompt Gatekeeper on each version. Lower priority while signing is off.

## Smaller polish

These are the kind of things to pick up between bigger features.

- The Dashboard tile for Stale Projects exists but uses the same teal accent as elsewhere; consider whether System Data deserves its own accent token rather than reusing `blue` (currently shared with Large & Old).
- The Performance "kill process" confirm could show the bytes/CPU at the moment of kill so the user knows what they targeted.
- Settings → Activity could show per-bucket cleaned bytes for the System Data scope (currently lumped as `system-data`).
- The History view groups by day but doesn't show the cleaning scope's icon — small visual win.
- Onboarding doesn't yet mention the new System Data or Leftover Installers tabs; add a sentence. Onboarding should also mention the Gatekeeper "Open Anyway" step on macOS 15+ (see `docs/COMPATIBILITY.md`).
- Wire the Installers scan into the scheduler (`scheduler.js` + Settings → Schedule scopes) — the scanner and Activity row already exist; only the scheduled runner is missing.
- The Tray icon is a template image but its menu doesn't show the System Data total separately. Worth adding once the System Data scheduled check lands.

## Investigations (not committed)

Things worth looking into but not committed to:

- **Purgeable space surfacing.** macOS shows "purgeable" in Storage; APFS sometimes won't release space until pressed. `diskutil apfs purge` is one lever. Risky to expose without strong understanding.
- **Memory pressure recommendations.** The Performance module recommends killing top-RAM processes; could add memory-pressure (vm_stat) read and pause/resume Spotlight indexing if pressure stays high. Bordering on system-tweaker territory.
- **Spotlight reindex helper.** A common "my Mac is slow" remedy. Just `sudo mdutil -E /` — small, useful, but needs sudo prompt.
- **A "what just freed space?" diff.** Snapshot disk usage before + after a Smart Scan and show the user the delta as a friendlier number than the per-module Trash counts.

## Known issues / debts

- `getSystemReport()` (system-report.js) shells out to several `sw_vers`/`sysctl`/`df` calls every time the modal opens. Cache the result for the session — opening the modal twice shouldn't re-shell.
- `measureDir` is recursive and async — fine on most trees but blows the call stack on pathological depths. Switch to an explicit stack/queue when convenient.
- The squarified treemap in `DiskMap.jsx` recomputes layout on every hover (the hover state triggers re-render). Move tiles into `useMemo` keyed on `viewNode` only — cosmetic perf win.
- `Onboarding` reuses welcome-glow CSS which I had to constrain after the "You're ready" text overlapped the glow ring. The fix works but the relationship is fragile — consider extracting onboarding-specific CSS so welcome-state changes don't break onboarding again.

## How to pick what's next

Default order if no other signal:

1. Anything that crossed back to "the user noticed it on their own Mac" — those are the credibility-defining bugs.
2. Sparse-file sizing (cheap, fixes the Docker number being a lie).
3. Leftover installers cleaner (smallest new feature with clear value).
4. Universal binary (one-line config change, simpler release artifacts).
5. Browser data cleaner (modest scope, clear demand).
6. Localization stripper (high reward, high risk — saved for when there's room to be careful).
