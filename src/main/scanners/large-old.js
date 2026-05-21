// Large & Old Files scanner.
//
// Walks the user's content folders (Documents, Downloads, Desktop, Movies,
// Pictures) looking for individual files that are either big enough to
// matter (>= 100 MB) or stale enough to be candidates for archival
// (atime older than 180 days).
//
// Safety posture (this module surfaces USER FILES, not regenerable junk):
//   - Bundle dirs (.app, .photoslibrary, .imovielibrary, etc.) are skipped
//     wholesale — we never descend into them.
//   - iCloud .icloud placeholder files are skipped. Reading their "size"
//     would lie (they're <1 KB stubs), and any attempt to touch them
//     would trigger a download.
//   - Symlinks are not followed.
//   - The renderer pre-selects nothing — the user reviews every row.

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { isDevNoise } = require('../lib/walk');
const { isExcluded } = require('../safety/allowlist');

const HOME = os.homedir();

const DEFAULT_ROOTS = [
  path.join(HOME, 'Documents'),
  path.join(HOME, 'Downloads'),
  path.join(HOME, 'Desktop'),
  path.join(HOME, 'Movies'),
  path.join(HOME, 'Pictures'),
];

// Tunable thresholds — could move to settings later.
const LARGE_BYTES = 100 * 1024 * 1024;          // 100 MB
const OLD_AGE_MS  = 180 * 24 * 60 * 60 * 1000;  // 180 days

// macOS bundles that look like directories but hold a single user-facing
// asset. We never enter these — entering an .app destroys the abstraction
// (you'd "find" frameworks and helper executables as large files), and
// entering a .photoslibrary risks surfacing individual photos.
const BUNDLE_EXTS = new Set([
  '.app',
  '.photoslibrary', '.imovielibrary', '.musiclibrary', '.tvlibrary',
  '.logicx', '.band',
  '.bundle', '.framework', '.kext', '.plugin', '.component',
  '.xcarchive', // surfaced under Xcode Archives in System Junk, not here
]);

function isBundle(name) {
  const ext = path.extname(name).toLowerCase();
  return BUNDLE_EXTS.has(ext);
}

function isHidden(name) {
  return name.startsWith('.');
}

function isiCloudPlaceholder(name) {
  // macOS names offloaded files like `.foo.txt.icloud` — leading dot plus
  // .icloud suffix on the real filename.
  return name.endsWith('.icloud');
}

/**
 * Walk `dir` recursively, calling `onFile(absPath, stat)` for every file
 * that passes the basic filters. Returns { visited, skipped } so the UI
 * can show how many dev-noise directories were deferred.
 */
async function walk(dir, onFile, counters = { visited: 0, skipped: 0 }) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return counters;
  }

  for (const entry of entries) {
    const name = entry.name;
    if (entry.isSymbolicLink()) continue;
    const entryPath = path.join(dir, name);
    // User exclusions: never descend into or surface an excluded path.
    if (isExcluded(entryPath)) continue;
    if (entry.isDirectory()) {
      // Dev-noise check FIRST so the counter reflects skipped projects
      // (.git, .next, .venv all match here). isHidden is checked after
      // so .DS_Store and ad-hoc dotfiles still get silently skipped.
      if (isBundle(name)) continue;
      if (isDevNoise(name)) {
        counters.skipped += 1;
        continue;
      }
      if (isHidden(name)) continue;
      await walk(entryPath, onFile, counters);
      continue;
    }
    if (isHidden(name)) continue;
    if (!entry.isFile()) continue;
    if (isiCloudPlaceholder(name)) continue;

    const full = entryPath;
    let st;
    try {
      st = await fs.stat(full);
    } catch {
      continue;
    }
    counters.visited += 1;
    onFile(full, st, name);
  }
  return counters;
}

async function scanLargeOld(opts = {}) {
  const roots     = Array.isArray(opts.roots) && opts.roots.length ? opts.roots : DEFAULT_ROOTS;
  const minBytes  = typeof opts.minBytes === 'number' ? opts.minBytes : LARGE_BYTES;
  const minAgeMs  = typeof opts.minAgeMs === 'number' ? opts.minAgeMs : OLD_AGE_MS;
  const onProgress = opts.onProgress;
  const startedAt = Date.now();
  const cutoffTime = startedAt - minAgeMs;

  const large = [];
  const old = [];
  const counters = { visited: 0, skipped: 0 };

  // Throttle progress: emit at most every 250ms and every 500 files,
  // whichever comes first. Walking ~/Documents can hit 100k files; we
  // don't want to fire an IPC event for each one.
  let lastEmit = 0;
  let filesSinceEmit = 0;
  const maybeEmit = (root, name) => {
    filesSinceEmit += 1;
    const now = Date.now();
    if (filesSinceEmit < 500 && now - lastEmit < 250) return;
    lastEmit = now;
    filesSinceEmit = 0;
    onProgress?.({
      phase: 'walking',
      currentRoot: root.replace(/^.+\/Users\/[^/]+\//, '~/'),
      currentItem: name,
      visited: counters.visited,
      skipped: counters.skipped,
      foundLarge: large.length,
      foundOld: old.length,
    });
  };

  for (let r = 0; r < roots.length; r++) {
    const root = roots[r];
    onProgress?.({
      phase: 'starting-root',
      currentRoot: root.replace(/^.+\/Users\/[^/]+\//, '~/'),
      rootIdx: r,
      rootCount: roots.length,
      visited: counters.visited,
      skipped: counters.skipped,
      foundLarge: large.length,
      foundOld: old.length,
    });
    await walk(root, (full, st, name) => {
      const ext = path.extname(name).toLowerCase();
      const atimeMs = st.atimeMs || 0;
      const mtimeMs = st.mtimeMs || 0;
      const isLarge = st.size >= minBytes;
      const isOld = atimeMs > 0 && atimeMs < cutoffTime;

      maybeEmit(root, name);
      if (!isLarge && !isOld) return;

      const row = {
        id: `lo::${full}`,
        name,
        path: full,
        ext: ext || '',
        bytes: st.size,
        atimeMs,
        mtimeMs,
      };

      if (isLarge) large.push(row);
      if (isOld) old.push(row);
    }, counters);
  }

  onProgress?.({
    phase: 'done',
    visited: counters.visited,
    skipped: counters.skipped,
    foundLarge: large.length,
    foundOld: old.length,
  });

  large.sort((a, b) => b.bytes - a.bytes);
  old.sort((a, b) => a.atimeMs - b.atimeMs);

  return {
    scanId: `lo-${startedAt}`,
    scannedAt: startedAt,
    durationMs: Date.now() - startedAt,
    visitedCount: counters.visited,
    skippedCount: counters.skipped,
    thresholds: { minBytes, minAgeMs, cutoffTime },
    roots,
    large,
    old,
  };
}

module.exports = { scanLargeOld, DEFAULT_ROOTS, LARGE_BYTES, OLD_AGE_MS };
