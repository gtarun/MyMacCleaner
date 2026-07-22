// System Junk scanner.
//
// Walks three user-level locations and groups what it finds into categories
// the UI can render. Deliberately user-level only: none of these paths
// require Full Disk Access, so the app produces real results on first run
// without any onboarding friction.
//
// Strategy: for each scan root, list the top-level entries and compute the
// recursive size of each. Each top-level entry becomes one "item" in the
// results — usually one bundle ID per app (e.g. com.google.Chrome). This
// matches how the user thinks about the data: "Chrome is using 1.2 GB of
// cache" reads better than ten thousand individual cache files.

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { measureDir, diskBytes } = require('../lib/walk');

const HOME = os.homedir();

// Subdirectory names that contain user data, not regenerable cache. We
// skip these even though they sit inside ~/Library/Caches.
const CACHE_BLOCKLIST = new Set([
  'com.apple.Mail',
  'com.apple.mail',
  'Mail',
  'com.apple.bird',         // iCloud Drive cache — deleting forces redownloads
  'CloudKit',
  'com.apple.MobileSync',
  'Messages',
  'com.apple.Music',        // Music app maintains real state here
  'Yarn',                   // Surfaced separately as a developer category
]);

const CATEGORIES = [
  // --- System ---
  {
    id: 'user-caches',
    group: 'system',
    label: 'Application Caches',
    description: '~/Library/Caches — regenerated automatically by apps as needed',
    root: path.join(HOME, 'Library', 'Caches'),
    skip: CACHE_BLOCKLIST,
    defaultChecked: true,
  },
  {
    id: 'user-logs',
    group: 'system',
    label: 'Log Files',
    description: '~/Library/Logs — diagnostic logs, rarely useful after a reboot',
    root: path.join(HOME, 'Library', 'Logs'),
    skip: new Set(['DiagnosticReports']), // handled as its own category
    defaultChecked: true,
  },
  {
    id: 'crash-reports',
    group: 'system',
    label: 'Crash Reports',
    description: '~/Library/Logs/DiagnosticReports — crash and hang logs',
    root: path.join(HOME, 'Library', 'Logs', 'DiagnosticReports'),
    skip: new Set(),
    defaultChecked: true,
  },

  // --- Developer ---
  {
    id: 'xcode-deriveddata',
    group: 'developer',
    label: 'Xcode DerivedData',
    description: 'Build artifacts per project — Xcode rebuilds these on next compile',
    root: path.join(HOME, 'Library', 'Developer', 'Xcode', 'DerivedData'),
    skip: new Set(),
    defaultChecked: true,
  },
  {
    id: 'xcode-ios-devicesupport',
    group: 'developer',
    label: 'iOS DeviceSupport',
    description: 'Debug symbols for connected devices — re-downloaded on next connect',
    root: path.join(HOME, 'Library', 'Developer', 'Xcode', 'iOS DeviceSupport'),
    skip: new Set(),
    defaultChecked: true,
  },
  {
    id: 'core-simulator-caches',
    group: 'developer',
    label: 'iOS Simulator Caches',
    description: '~/Library/Developer/CoreSimulator/Caches — simulator runtime caches',
    root: path.join(HOME, 'Library', 'Developer', 'CoreSimulator', 'Caches'),
    skip: new Set(),
    defaultChecked: true,
  },
  {
    id: 'xcode-archives',
    group: 'developer',
    label: 'Xcode Archives',
    description: '⚠ Release artifacts — only remove copies you no longer need',
    root: path.join(HOME, 'Library', 'Developer', 'Xcode', 'Archives'),
    skip: new Set(),
    defaultChecked: false, // never auto-select shipped builds
  },
  {
    id: 'npm-cache',
    group: 'developer',
    label: 'npm Cache',
    description: '~/.npm — downloaded packages, npm refetches as needed',
    root: path.join(HOME, '.npm'),
    skip: new Set(),
    defaultChecked: true,
  },
  {
    id: 'yarn-cache',
    group: 'developer',
    label: 'Yarn Cache',
    description: '~/Library/Caches/Yarn — Yarn package cache',
    root: path.join(HOME, 'Library', 'Caches', 'Yarn'),
    skip: new Set(),
    defaultChecked: true,
  },
  {
    id: 'pnpm-store',
    group: 'developer',
    label: 'pnpm Store',
    description: '~/.pnpm-store — content-addressable package store',
    root: path.join(HOME, '.pnpm-store'),
    skip: new Set(),
    defaultChecked: true,
  },
];

/**
 * Humanize a bundle-ID-ish folder name. "com.google.Chrome" → "Google Chrome".
 * Falls back to the raw name when there's nothing useful to extract.
 */
function humanizeName(folderName) {
  // Reverse-DNS bundle IDs: take the last segment, decamelize.
  if (/^[a-z]+\.[a-zA-Z0-9.-]+$/.test(folderName)) {
    const last = folderName.split('.').pop();
    return last.replace(/([a-z])([A-Z])/g, '$1 $2');
  }
  return folderName;
}

async function scanCategory(category, onProgress) {
  const items = [];
  let entries;
  try {
    entries = await fs.readdir(category.root, { withFileTypes: true });
  } catch (err) {
    // Root missing or permission denied — return an empty category rather
    // than failing the whole scan. Missing roots are common (not every Mac
    // has Xcode, npm, pnpm, etc.) so we never surface ENOENT as an error.
    return {
      id: category.id,
      group: category.group,
      label: category.label,
      description: category.description,
      root: category.root,
      defaultChecked: category.defaultChecked !== false,
      totalBytes: 0,
      itemCount: 0,
      items: [],
      error: err.code === 'ENOENT' ? null : err.message,
    };
  }

  // Pre-filter to relevant entries so the progress count reflects what
  // we actually plan to measure (skipping .DS_Store, etc. would otherwise
  // make "5 of 7" jump non-linearly).
  const measurables = entries.filter((e) =>
    !category.skip.has(e.name) && !e.name.startsWith('.') && (e.isDirectory() || e.isFile())
  );
  let measuredCount = 0;

  for (const entry of measurables) {
    onProgress?.({
      phase: 'measuring',
      category: category.label,
      currentItem: humanizeName(entry.name),
      itemsDone: measuredCount,
      itemsTotal: measurables.length,
    });

    const full = path.join(category.root, entry.name);
    let bytes = 0;
    let fileCount = 0;

    try {
      if (entry.isDirectory()) {
        const m = await measureDir(full);
        bytes = m.bytes;
        fileCount = m.fileCount;
      } else if (entry.isFile()) {
        const st = await fs.stat(full);
        bytes = diskBytes(st);
        fileCount = 1;
      } else {
        continue; // skip symlinks / sockets at top level
      }
    } catch {
      continue;
    }

    measuredCount += 1;

    if (bytes === 0) continue; // nothing to clean

    items.push({
      id: `${category.id}::${entry.name}`,
      name: humanizeName(entry.name),
      rawName: entry.name,
      path: full,
      bytes,
      fileCount,
    });
  }

  items.sort((a, b) => b.bytes - a.bytes);

  return {
    id: category.id,
    group: category.group,
    label: category.label,
    description: category.description,
    root: category.root,
    defaultChecked: category.defaultChecked !== false,
    totalBytes: items.reduce((sum, i) => sum + i.bytes, 0),
    itemCount: items.length,
    items,
    error: null,
  };
}

async function scanSystemJunk(opts = {}) {
  const { onProgress } = opts;
  const startedAt = Date.now();
  const results = [];
  let runningBytes = 0;
  for (let i = 0; i < CATEGORIES.length; i++) {
    const c = CATEGORIES[i];
    onProgress?.({
      phase: 'starting-category',
      category: c.label,
      categoryIdx: i,
      categoryCount: CATEGORIES.length,
      runningBytes,
    });
    const result = await scanCategory(c, (p) =>
      onProgress?.({ ...p, categoryIdx: i, categoryCount: CATEGORIES.length, runningBytes })
    );
    results.push(result);
    runningBytes += result.totalBytes;
  }
  onProgress?.({ phase: 'done', runningBytes, categoryCount: CATEGORIES.length, categoryIdx: CATEGORIES.length });
  // Hide categories that are empty AND error-free — e.g. on a Mac without
  // Xcode, npm, or pnpm, those roots simply don't exist. No point cluttering
  // the UI with "Xcode DerivedData (0 KB)" on machines that don't have Xcode.
  const categories = results.filter((c) => c.totalBytes > 0 || c.error);
  return {
    scanId: `sj-${startedAt}`,
    scannedAt: startedAt,
    durationMs: Date.now() - startedAt,
    totalBytes: categories.reduce((sum, c) => sum + c.totalBytes, 0),
    categories,
  };
}

module.exports = { scanSystemJunk };
