# MacCleaner — compatibility

Where MacCleaner runs, and why. Covers **Intel vs Apple Silicon** and the range of **macOS versions**. Read `/CLAUDE.md` for the hard rules and `docs/ARCHITECTURE.md` for the module inventory.

## TL;DR

- **Runs natively on both Intel (`x64`) and Apple Silicon (`arm64`).** The build ships one DMG per arch today.
- **No architecture branch can mis-delete or crash.** Almost every path the app touches is `$HOME`-relative, which is identical on both chips; chip/arch is detected through portable APIs (`sysctl`, `os.arch()`) and used for *display only*.
- **The only arch-specific concern is binary prefixes** (`/opt/homebrew` on Apple Silicon vs `/usr/local` on Intel). Every external command the app resolves already checks both.
- **macOS floor is set by Electron.** Electron 33 (Chromium 130) supports **macOS 11 Big Sur and newer**. Everything the app shells out to exists on all of those.

## 1. Intel vs Apple Silicon

### What's already correct on both

| Area | Mechanism | Intel | Apple Silicon |
|---|---|---|---|
| Chip name | `sysctl machdep.cpu.brand_string` | `Intel(R) Core(TM) i7…` | `Apple M3 Pro` |
| Architecture label | `os.arch()` / `process.arch` (display only) | `x64` | `arm64` |
| Model, cores, memory | `sysctl hw.model / hw.physicalcpu / hw.memsize` | ✓ | ✓ |
| Cache / dev-junk paths | `$HOME`-relative (`~/Library/Caches`, Xcode, npm/yarn/pnpm) | ✓ identical | ✓ identical |
| `df` / `ps` / `sw_vers` / `tmutil` / `xcrun` | live in `/usr/bin` on both | ✓ | ✓ |
| Docker binary | `resolveBin` candidate list includes **both** prefixes | `/usr/local/bin/docker` | `/opt/homebrew/bin/docker` |
| Homebrew binary | `resolveBin` candidate list includes **both** prefixes | `/usr/local/bin/brew` | `/opt/homebrew/bin/brew` |

`os.arch()` and `process.arch` are used only to *show* the architecture (System Info panel, `system:info` handshake). No cleaning or safety logic ever branches on them, so there is no code path where the wrong architecture removes the wrong thing.

### The one thing that differs: binary prefixes

Homebrew and Homebrew-installed CLIs live under a different prefix per chip:

| | Apple Silicon | Intel |
|---|---|---|
| Homebrew prefix | `/opt/homebrew` | `/usr/local` |
| `brew`, `docker` (Homebrew) | `/opt/homebrew/bin/…` | `/usr/local/bin/…` |
| Homebrew Cellar (old versions) | `/opt/homebrew/Cellar` | `/usr/local/Cellar` |

**Rule for any future external command:** resolve it through `resolveBin(name, candidates)` in `src/main/scanners/system-data.js`, listing the Apple-Silicon path *first*, then the Intel path, then the bare name (which works when launched from a terminal that has the right PATH):

```js
resolveBin('brew', ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'])
```

This is the same mechanism that solves the GUI-PATH problem (Finder-launched apps inherit a minimal PATH). We never touch the Cellar directly — `brew cleanup` does — so the app doesn't need to branch on the prefix itself; it just needs to *find* `brew`.

### Rosetta 2

On Apple Silicon, Intel binaries run under Rosetta 2, which keeps an on-disk translation cache. It lives in SIP-protected space (`/var/db/oah`) and is **not** something the app should try to delete — it's already inside `NEVER_TOUCH` territory. It can be surfaced read-only in future but must never be a cleanup target.

### Cross-compat gaps (tracked in ROADMAP)

- **Homebrew is now surfaced** as a System Data review bucket with an arch-aware `brew cleanup` (and `brew cleanup -n` preview). Before that it was invisible to the app.
- No Rosetta surfacing yet (read-only only, if ever).

## 2. macOS versions

### Supported range

| Layer | Floor | Notes |
|---|---|---|
| **Electron 33 (Chromium 130)** | **macOS 11 Big Sur** | Chromium drops Big Sur at v139 (Electron 38). Bumping Electron past 37 raises the floor to macOS 12 Monterey. |
| APFS local snapshots (`tmutil listlocalsnapshots`) | macOS 10.13 | APFS is universal on every supported version. |
| `sw_vers`, `sysctl`, `df`, `ps` | all | Column layouts the app parses are stable across versions. |
| `shell.trashItem` (Electron) | all supported | The Trash-first guarantee holds everywhere. |

So on **Electron 33 today: macOS 11 → the current release all work.** The app is developed and used on the current macOS.

### Gatekeeper — the real distribution wrinkle

The app is intentionally **unsigned** (`identity: null`). First-run behavior differs by OS:

- **macOS 11–14:** right-click the app → **Open** → confirm once.
- **macOS 15 Sequoia and macOS 26:** Apple **removed** the right-click → Open bypass. The user must launch it once, get blocked, then go to **System Settings → Privacy & Security → "Open Anyway"**.

This is a documentation/onboarding concern, not a code bug — but the README and onboarding should state the newer-OS steps so users aren't stuck. Signing + notarization (deferred; needs a $99/yr Apple Developer account) would remove this entirely.

## 3. Build & distribution

- **Current:** `mac.target.arch: ["arm64", "x64"]` → two DMGs (+ two zips). `dmg.title` must keep `${arch}` or the two builds collide on `/Volumes/MacCleaner X.Y.Z` and `hdiutil detach` fails.
- **Option (ROADMAP):** switch to `["universal"]` → one DMG that runs native on both, half the release artifacts, no volume-name fight. `sharp` (the only native dep) is dev-time-only for icon building, so it doesn't block a universal app bundle.

## 4. Verification checklist for arch/version-sensitive changes

When adding anything that shells out or hardcodes a path:

1. Is the path `$HOME`-relative? → arch-independent, done.
2. Is it a Homebrew/CLI binary? → resolve via `resolveBin` with **both** prefixes.
3. Is it a system binary? → confirm it lives in `/usr/bin` (present on all supported macOS).
4. Does it exist on macOS 11? → if it's newer, gate on availability and degrade gracefully (the scanners already treat ENOENT / "not installed" as a soft, non-fatal state).
