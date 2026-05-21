// Apps lister.
//
// Walks /Applications and ~/Applications looking for .app bundles, pulls
// metadata via `mdls` (Spotlight metadata — indexed, fast, no plist
// parsing needed). Filters out first-party Apple apps because they're
// managed by macOS and removing them via Trash mostly fails anyway.
//
// Performance note: `mdls` is roughly 5–20 ms per app on a warm Spotlight
// index. Running them in parallel keeps "list 200 apps" under a second.

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const HOME = os.homedir();

const APP_ROOTS = [
  '/Applications',
  path.join(HOME, 'Applications'),
];

// Apple bundles macOS does its own thing with — Trash will either refuse
// them or break things if it succeeds. Keep them out of the list entirely.
const APPLE_BUNDLE_PREFIXES = ['com.apple.'];

/**
 * Find every `.app` bundle in a root and one level of subfolders (so
 * /Applications/Utilities/ is covered without descending into every app's
 * internal Frameworks/ etc).
 */
async function findAppBundles(root) {
  const bundles = [];
  async function walk(dir, depth) {
    if (depth > 1) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.endsWith('.app')) {
        bundles.push(path.join(dir, entry.name));
      } else if (depth === 0 && !entry.name.startsWith('.')) {
        await walk(path.join(dir, entry.name), depth + 1);
      }
    }
  }
  await walk(root, 0);
  return bundles;
}

/**
 * Parse `mdls -name X -name Y <path>` plain-text output. Format is:
 *   kMDItemFoo                = "string value"
 *   kMDItemBar                = 12345
 *   kMDItemBaz                = 2024-05-12 14:23:11 +0000
 *   kMDItemMissing            = (null)
 */
function parseMdls(text) {
  const out = {};
  for (const rawLine of text.split('\n')) {
    const m = rawLine.match(/^(kMDItem\w+)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const raw = m[2].trim();
    if (raw === '(null)' || raw === '') {
      out[key] = null;
    } else if (raw.startsWith('"') && raw.endsWith('"')) {
      out[key] = raw.slice(1, -1);
    } else if (/^-?\d+$/.test(raw)) {
      out[key] = parseInt(raw, 10);
    } else {
      // Date or other — keep as string; renderer formats if needed.
      out[key] = raw;
    }
  }
  return out;
}

async function getAppMetadata(bundlePath) {
  try {
    const { stdout } = await execFileAsync('mdls', [
      '-name', 'kMDItemCFBundleIdentifier',
      '-name', 'kMDItemDisplayName',
      '-name', 'kMDItemVersion',
      '-name', 'kMDItemLastUsedDate',
      '-name', 'kMDItemPhysicalSize',
      bundlePath,
    ]);
    return parseMdls(stdout);
  } catch {
    return null;
  }
}

function isAppleBundle(bundleId) {
  return APPLE_BUNDLE_PREFIXES.some((p) => bundleId.startsWith(p));
}

async function listApps(opts = {}) {
  const onProgress = opts.onProgress;
  const startedAt = Date.now();
  const allBundles = [];
  for (const root of APP_ROOTS) {
    const found = await findAppBundles(root);
    for (const b of found) allBundles.push(b);
  }
  onProgress?.({
    phase: 'starting',
    bundleCount: allBundles.length,
    processed: 0,
  });

  // Parallel mdls — bounded concurrency so we don't spawn 200 processes
  // simultaneously. 16 is a sweet spot on most Macs.
  const apps = [];
  const concurrency = 16;
  let cursor = 0;
  let processed = 0;
  async function worker() {
    while (cursor < allBundles.length) {
      const i = cursor++;
      const bundlePath = allBundles[i];
      onProgress?.({
        phase: 'reading',
        currentItem: path.basename(bundlePath, '.app'),
        processed,
        bundleCount: allBundles.length,
      });
      const meta = await getAppMetadata(bundlePath);
      processed += 1;
      if (!meta || !meta.kMDItemCFBundleIdentifier) continue;
      const bundleId = meta.kMDItemCFBundleIdentifier;
      if (isAppleBundle(bundleId)) continue;

      const baseName = path.basename(bundlePath, '.app');
      const displayName = meta.kMDItemDisplayName
        ? String(meta.kMDItemDisplayName).replace(/\.app$/, '')
        : baseName;

      apps.push({
        id: `app::${bundleId}`,
        bundleId,
        name: displayName,
        rawName: baseName,
        version: meta.kMDItemVersion ? String(meta.kMDItemVersion) : '',
        bundlePath,
        bytes: typeof meta.kMDItemPhysicalSize === 'number' ? meta.kMDItemPhysicalSize : 0,
        lastUsed: meta.kMDItemLastUsedDate || null,
      });
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  apps.sort((a, b) => b.bytes - a.bytes);
  onProgress?.({ phase: 'done', processed, bundleCount: allBundles.length });

  return {
    scannedAt: startedAt,
    durationMs: Date.now() - startedAt,
    count: apps.length,
    apps,
  };
}

module.exports = { listApps };
