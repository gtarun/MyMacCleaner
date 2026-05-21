# Contributing to MacCleaner

Thank you for helping improve MacCleaner. This document covers setup, expectations, and how to submit changes.

## Getting started

1. Fork [gtarun/MyMacCleaner](https://github.com/gtarun/MyMacCleaner) on GitHub.
2. Clone your fork and install dependencies:

   ```bash
   git clone https://github.com/<your-username>/MyMacCleaner.git
   cd MyMacCleaner
   npm install
   npm run dev
   ```

3. Create a branch from `main` (or the default branch):

   ```bash
   git checkout -b fix/short-description
   ```

## Before you open a PR

- Search [open issues](https://github.com/gtarun/MyMacCleaner/issues) to avoid duplicate work.
- For new modules, scanner path changes, or safety rule updates, open an issue first so maintainers can agree on scope.
- Test on **macOS** — scans, previews, and clean flows are hard to verify on other platforms.

## Pull request checklist

- [ ] Clear title and description (what changed, why, how to test)
- [ ] Changes are focused; unrelated refactors are in a separate PR
- [ ] New cleanup paths use `src/main/safety/` and **Trash only** (`shell.trashItem`)
- [ ] Blocklist / allowlist respected — no Mail, Photos library, `/System`, Keychains, etc.
- [ ] UI changes match existing patterns in `src/renderer/`
- [ ] No secrets, `.env` files, or personal paths committed

## Safety rules (required)

MacCleaner’s core promise is **conservative-by-default**:

1. **Trash, never hard delete** — all removals go through the safety layer in `src/main/safety/`.
2. **Explicit roots** — scanners only touch paths defined in allowlists; duplicate scans require user-selected folders.
3. **Preview + confirm** — users must see what will be removed before anything moves.
4. **Protected data** — do not add paths under Mail, Messages, Photos, iCloud caches, iOS backups, or system directories.

When adding a scanner category, document which paths it touches and why they are safe to regenerate or remove.

## Project areas

| Area | Path | Notes |
|------|------|--------|
| Main process / IPC | `src/main/` | Filesystem access, scanners |
| Safety | `src/main/safety/` | Allowlist, Trash wrapper |
| UI | `src/renderer/` | React, no Node APIs |
| Bridge | `src/preload.js` | Keep the renderer API narrow |
| Architecture | [PLAN.md](./PLAN.md) | Scanner paths and roadmap |

## Build & release (maintainers)

Built artifacts live in `dist-electron/`, which is **gitignored**. Users download installers from [GitHub Releases](https://github.com/gtarun/MyMacCleaner/releases), not from the repository.

**Automated (recommended):**

```bash
npm run release:patch   # or release:minor / release:major
```

This bumps `package.json`, commits the version, tags `v{version}`, pushes `main` and the tag. The [release workflow](.github/workflows/release.yml) then builds and attaches `.dmg` / `.zip` files.

Bump only (no tag): `npm run bump patch`. Tag current version (already bumped): `npm run release`.

**Manual:**

```bash
npm run release:build
```

Upload `dist-electron/MacCleaner-<version>-arm64.dmg` and `MacCleaner-<version>.dmg` to a new [GitHub Release](https://github.com/gtarun/MyMacCleaner/releases/new). Do not commit `dist-electron/`.

## Support

Financial support is optional. Sponsorship helps fund maintenance and new features via [GitHub Sponsors](https://github.com/sponsors/gtarun).

## Code of conduct

Be respectful and constructive. Harassment or abuse is not tolerated. Report concerns via GitHub issues or by contacting the maintainers privately.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE) same as the project.
