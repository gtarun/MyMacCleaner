// Leftover-file finder.
//
// CleanMyMac's marquee uninstaller trick: when removing an app, the .app
// bundle is only ~20% of its actual footprint. The rest lives in roughly
// ten sibling directories under ~/Library, named after either the bundle
// ID (com.spotify.client) or the display name (Spotify).
//
// This scanner takes a bundle ID + display name and finds matches across
// all of those directories without recursing into them — just listing the
// top-level entries and matching by name. That's fast (one readdir per
// search root) and avoids false positives buried deep in unrelated apps.

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { measurePath } = require('../lib/walk');

const HOME = os.homedir();

// Library subdirectories to search. The label is what the UI groups them
// under so the user understands what kind of data each match represents.
const SEARCH_ROOTS = [
  { path: path.join(HOME, 'Library', 'Application Support'),    label: 'Application Support' },
  { path: path.join(HOME, 'Library', 'Preferences'),            label: 'Preferences' },
  { path: path.join(HOME, 'Library', 'Caches'),                 label: 'Caches' },
  { path: path.join(HOME, 'Library', 'Logs'),                   label: 'Logs' },
  { path: path.join(HOME, 'Library', 'Containers'),             label: 'Containers' },
  { path: path.join(HOME, 'Library', 'Group Containers'),       label: 'Group Containers' },
  { path: path.join(HOME, 'Library', 'Saved Application State'), label: 'Saved Application State' },
  { path: path.join(HOME, 'Library', 'LaunchAgents'),           label: 'LaunchAgents' },
  { path: path.join(HOME, 'Library', 'HTTPStorages'),           label: 'HTTPStorages' },
  { path: path.join(HOME, 'Library', 'WebKit'),                 label: 'WebKit' },
  { path: path.join(HOME, 'Library', 'Cookies'),                label: 'Cookies' },
];

/**
 * Does `name` look like it belongs to the app identified by bundleId+appName?
 *
 * Match rules (case-insensitive):
 *   1. Contains the bundle ID                             → match
 *   2. Starts with the app name + boundary char (./_-)    → match
 *   3. Exact match: appName, appName.plist, appName.savedState → match
 *
 * Never matches com.apple.* — even if the user is uninstalling some
 * Apple-branded third-party tool, we don't touch Apple's own data.
 *
 * Requires appName.length >= 4 to avoid matching short names ("X", "Go")
 * against everything.
 */
function matchesApp(name, bundleId, appName) {
  const nLower = name.toLowerCase();

  // Hard exclude: Apple-owned anything.
  if (nLower.startsWith('com.apple.')) return false;

  const bidLower = bundleId.toLowerCase();
  if (nLower.includes(bidLower)) return true;

  if (appName.length < 4) return false;
  const aLower = appName.toLowerCase();

  // Exact, or appName followed by a separator macOS uses for variants.
  if (nLower === aLower) return true;
  if (nLower === `${aLower}.plist`) return true;
  if (nLower === `${aLower}.savedstate`) return true;
  if (nLower.startsWith(`${aLower}.`)) return true;
  if (nLower.startsWith(`${aLower} `)) return true;
  if (nLower.startsWith(`${aLower}-`)) return true;
  if (nLower.startsWith(`${aLower}_`)) return true;

  return false;
}

async function findLeftovers(bundleId, appName, opts = {}) {
  if (typeof bundleId !== 'string' || !bundleId) {
    throw new Error('findLeftovers requires a bundleId');
  }
  if (typeof appName !== 'string' || !appName) {
    throw new Error('findLeftovers requires an appName');
  }

  const onProgress = opts.onProgress;
  const startedAt = Date.now();
  const groups = [];

  for (let r = 0; r < SEARCH_ROOTS.length; r++) {
    const root = SEARCH_ROOTS[r];
    onProgress?.({
      phase: 'searching',
      currentItem: root.label,
      rootIdx: r,
      rootCount: SEARCH_ROOTS.length,
    });
    let entries;
    try {
      entries = await fs.readdir(root.path, { withFileTypes: true });
    } catch {
      continue; // root missing or unreadable — skip silently
    }

    const items = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (!matchesApp(entry.name, bundleId, appName)) continue;

      const full = path.join(root.path, entry.name);
      const { bytes, fileCount } = await measurePath(full);
      items.push({
        id: `lo::${full}`,
        name: entry.name,
        path: full,
        bytes,
        fileCount,
      });
    }

    if (items.length > 0) {
      items.sort((a, b) => b.bytes - a.bytes);
      groups.push({
        id: `lo-group::${root.label}`,
        label: root.label,
        root: root.path,
        totalBytes: items.reduce((s, i) => s + i.bytes, 0),
        itemCount: items.length,
        items,
      });
    }
  }

  onProgress?.({ phase: 'done', rootIdx: SEARCH_ROOTS.length, rootCount: SEARCH_ROOTS.length });
  return {
    bundleId,
    appName,
    scannedAt: startedAt,
    durationMs: Date.now() - startedAt,
    totalBytes: groups.reduce((s, g) => s + g.totalBytes, 0),
    itemCount: groups.reduce((s, g) => s + g.itemCount, 0),
    groups,
  };
}

module.exports = { findLeftovers, matchesApp };
