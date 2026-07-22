// Leftover installers scanner.
//
// After you install an app, the disk image or package you downloaded to do it
// just sits in ~/Downloads forever. They're some of the safest bytes to
// reclaim — you already installed (or discarded) whatever they carried — but
// the app still treats them as USER FILES: nothing is ever pre-selected, and
// everything moves to Trash (recoverable), never rm.
//
// Strategy: a bounded recursive walk of ~/Downloads (skipping the same
// dev-noise dirs and bundles as the other walkers) collecting installer-shaped
// files whose mtime is older than the cutoff. mtime ≈ "when the download
// finished", so an old mtime means "downloaded a while ago and left behind".
//
// Safety posture mirrors large-old.js: Downloads is an allowed root, but it
// can also hold real work, so we surface and let the user decide — we never
// auto-check a single row.

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { isDevNoise } = require('../lib/walk');
const { isExcluded } = require('../safety/allowlist');

const HOME = os.homedir();

const DEFAULT_ROOT = path.join(HOME, 'Downloads');

// Installer / disk-image / archive extensions. Deliberately the "you
// downloaded this to install something" set — not general archives like .tar
// or .gz which are more likely to be real work. .zip is included because app
// downloads very often ship as a zip, but (like everything here) it's never
// pre-selected.
const INSTALLER_EXTS = new Set([
  '.dmg',   // disk image — the classic macOS installer
  '.pkg',   // installer package
  '.mpkg',  // multi-package installer
  '.xip',   // signed archive (Xcode ships this way)
  '.iso',   // disk image
  '.zip',   // app downloads frequently arrive zipped
]);

const DEFAULT_MIN_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Same bundle set as large-old: directories that look like files. We never
// descend into these.
const BUNDLE_EXTS = new Set([
  '.app', '.photoslibrary', '.imovielibrary', '.musiclibrary', '.tvlibrary',
  '.logicx', '.band', '.bundle', '.framework', '.kext', '.plugin', '.component',
  '.xcarchive',
]);

function isBundle(name) { return BUNDLE_EXTS.has(path.extname(name).toLowerCase()); }
function isHidden(name) { return name.startsWith('.'); }
function isiCloudPlaceholder(name) { return name.endsWith('.icloud'); }

async function walk(dir, onFile, counters = { visited: 0 }) {
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
    if (isExcluded(entryPath)) continue;

    if (entry.isDirectory()) {
      if (isBundle(name)) continue;
      if (isDevNoise(name)) continue;
      if (isHidden(name)) continue;
      await walk(entryPath, onFile, counters);
      continue;
    }
    if (isHidden(name)) continue;
    if (!entry.isFile()) continue;
    if (isiCloudPlaceholder(name)) continue;

    const ext = path.extname(name).toLowerCase();
    if (!INSTALLER_EXTS.has(ext)) continue;

    let st;
    try {
      st = await fs.stat(entryPath);
    } catch {
      continue;
    }
    counters.visited += 1;
    onFile(entryPath, st, name, ext);
  }
  return counters;
}

/**
 * Scan for leftover installers. Options:
 *   - root:      folder to scan (default ~/Downloads)
 *   - minAgeMs:  only flag files whose mtime is older than this (default 30d)
 *   - onProgress
 * Returns { scanId, scannedAt, durationMs, root, minAgeMs, cutoffTime,
 *           visitedCount, totalBytes, items:[{ id, name, path, ext, bytes,
 *           mtimeMs, atimeMs, ageDays }] }.
 */
async function scanInstallers(opts = {}) {
  const root      = typeof opts.root === 'string' && opts.root ? opts.root : DEFAULT_ROOT;
  const minAgeMs  = typeof opts.minAgeMs === 'number' ? opts.minAgeMs : DEFAULT_MIN_AGE_MS;
  const onProgress = opts.onProgress;
  const startedAt = Date.now();
  const cutoffTime = startedAt - minAgeMs;

  const items = [];
  const counters = { visited: 0 };

  // Throttle progress the same way large-old does — Downloads is usually
  // small, but subfolders can hold thousands of files.
  let lastEmit = 0;
  let filesSinceEmit = 0;
  const maybeEmit = (name) => {
    filesSinceEmit += 1;
    const now = Date.now();
    if (filesSinceEmit < 200 && now - lastEmit < 250) return;
    lastEmit = now;
    filesSinceEmit = 0;
    onProgress?.({
      phase: 'walking',
      currentRoot: root.replace(/^.+\/Users\/[^/]+\//, '~/'),
      currentItem: name,
      visited: counters.visited,
      found: items.length,
    });
  };

  onProgress?.({ phase: 'starting', currentRoot: root.replace(/^.+\/Users\/[^/]+\//, '~/') });

  await walk(root, (full, st, name, ext) => {
    maybeEmit(name);
    const mtimeMs = st.mtimeMs || 0;
    // Age gate: only surface installers left behind for a while. A brand-new
    // download is probably about to be used.
    if (mtimeMs > 0 && mtimeMs >= cutoffTime) return;

    items.push({
      id: `inst::${full}`,
      name,
      path: full,
      ext,
      bytes: st.size,
      mtimeMs,
      atimeMs: st.atimeMs || 0,
      ageDays: mtimeMs > 0 ? Math.floor((startedAt - mtimeMs) / 86400000) : null,
    });
  }, counters);

  items.sort((a, b) => b.bytes - a.bytes);

  onProgress?.({ phase: 'done', visited: counters.visited, found: items.length });

  return {
    scanId: `inst-${startedAt}`,
    scannedAt: startedAt,
    durationMs: Date.now() - startedAt,
    root,
    minAgeMs,
    cutoffTime,
    visitedCount: counters.visited,
    totalBytes: items.reduce((s, i) => s + i.bytes, 0),
    items,
  };
}

module.exports = { scanInstallers, DEFAULT_ROOT, INSTALLER_EXTS, DEFAULT_MIN_AGE_MS };
