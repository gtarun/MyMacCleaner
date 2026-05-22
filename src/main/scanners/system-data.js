// "System Data" explorer.
//
// macOS Storage lumps a huge amount of stuff into the opaque "System Data"
// bucket: dev caches, local Time Machine snapshots, iOS device backups,
// Docker/VM disk images, and more. When that bucket balloons to hundreds of
// GB the cause is almost always one or two big, specific things — not a
// thousand small caches. This module measures those known big places and
// classifies each one:
//
//   action: 'trash'  → regenerable dev artifacts that are safe to move to
//                      Trash. These all sit inside the safety allowlist, and
//                      we clear them by trashing their CHILDREN (never the
//                      root dir itself, which the safety gate refuses).
//   action: 'review' → surfaced for awareness but NOT removable from here.
//                      Either irreplaceable (iOS backups), valuable (Xcode
//                      Archives), or better cleared by their own tool
//                      (Docker → `docker system prune`). We show a copyable
//                      command instead of a delete button.
//
// Time Machine local snapshots get their own section: they aren't files we
// can Trash, so they're removed with `tmutil` and the deletion is permanent
// (but safe — snapshots regenerate and your real Time Machine backups are
// untouched).

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { measurePath } = require('../lib/walk');

const fssync = require('node:fs');

const execFileAsync = promisify(execFile);
const HOME = os.homedir();

// GUI apps launched from Finder inherit a minimal PATH, so `docker` / `xcrun`
// often aren't found by bare name. Resolve to a known absolute path when we
// can, falling back to the bare name (which works when launched from a
// terminal). We only ever resolve a fixed allowlist of binaries.
function resolveBin(name, candidates = []) {
  for (const c of candidates) {
    try { fssync.accessSync(c, fssync.constants.X_OK); return c; } catch { /* keep looking */ }
  }
  return name;
}

/**
 * The curated list of big, opaque "System Data" locations. Defined as a
 * function (not a const) so HOME is resolved fresh and the list is easy to
 * unit-test. `id` is the stable key the renderer sends back to clear a
 * bucket — paths never cross the IPC boundary from the renderer.
 */
function bucketDefs() {
  const XCODE = path.join(HOME, 'Library', 'Developer', 'Xcode');
  const DEV = path.join(HOME, 'Library', 'Developer');
  const APPSUP = path.join(HOME, 'Library', 'Application Support');
  return [
    {
      id: 'xcode-derived',
      label: 'Xcode DerivedData',
      path: path.join(XCODE, 'DerivedData'),
      action: 'trash',
      note: 'Build intermediates and indexes. Rebuilt automatically the next time you compile.',
    },
    {
      id: 'xcode-ios-devicesupport',
      label: 'Xcode iOS DeviceSupport',
      path: path.join(XCODE, 'iOS DeviceSupport'),
      action: 'trash',
      note: 'Debug symbols cached per iOS version. Re-downloaded when you next connect a device.',
    },
    {
      id: 'coresimulator-caches',
      label: 'Simulator caches',
      path: path.join(DEV, 'CoreSimulator', 'Caches'),
      action: 'trash',
      note: 'Cached simulator runtimes and assets. Safe to clear; rebuilt on demand.',
    },
    {
      id: 'coresimulator-devices',
      label: 'iOS Simulator devices',
      path: path.join(DEV, 'CoreSimulator', 'Devices'),
      action: 'review',
      note: 'Per-simulator state and installed apps.',
      // Safe, curated command the app can run for you. Fixed argv — the
      // renderer only ever sends the bucket id, never a command string.
      reclaim: {
        label: 'Delete unavailable simulators',
        display: 'xcrun simctl delete unavailable',
        bin: 'xcrun',
        candidates: ['/usr/bin/xcrun'],
        args: ['simctl', 'delete', 'unavailable'],
        safeNote: 'Removes only simulators whose runtime is no longer installed. Your active/usable simulators are kept.',
      },
    },
    {
      id: 'xcode-archives',
      label: 'Xcode Archives',
      path: path.join(XCODE, 'Archives'),
      action: 'review',
      note: 'Distributable app builds (.xcarchive). Keep these if you ship apps — review and delete individually in Xcode → Organizer.',
    },
    {
      id: 'ios-backups',
      label: 'iOS device backups',
      path: path.join(APPSUP, 'MobileSync', 'Backup'),
      action: 'review',
      note: 'Full backups of iPhones/iPads. May be the ONLY copy of a device — never auto-deleted. Manage in Finder → Manage Backups.',
    },
    {
      id: 'docker',
      label: 'Docker data',
      path: path.join(HOME, 'Library', 'Containers', 'com.docker.docker'),
      action: 'review',
      note: 'Docker VM disk image (the displayed size is "apparent" and is usually larger than real disk use). Reclaim space with Docker\'s own cleanup rather than deleting files.',
      reclaim: {
        label: 'Run docker system prune',
        display: 'docker system prune -f',
        bin: 'docker',
        candidates: [
          '/opt/homebrew/bin/docker',
          '/usr/local/bin/docker',
          '/Applications/Docker.app/Contents/Resources/bin/docker',
        ],
        args: ['system', 'prune', '-f'],
        previewArgs: ['system', 'df'],
        safeNote: 'Removes stopped containers, dangling images, unused networks, and build cache. Does NOT remove volumes, and does NOT remove images used by running containers — so no database data is touched.',
      },
      // Copy-only, never auto-run: the aggressive variant that can delete
      // data. Surfaced for power users who know their setup.
      advanced: {
        display: 'docker system prune -a --volumes',
        warn: 'Also deletes ALL unused images and ALL unused volumes. A volume for a stopped container counts as "unused", so this can erase database data. Run it yourself only after checking `docker volume ls`.',
      },
    },
    {
      id: 'user-caches',
      label: 'Application caches',
      path: path.join(HOME, 'Library', 'Caches'),
      action: 'review',
      note: 'App caches across every app. Clear these from the System Junk tab, which curates what is safe to remove for running apps.',
    },
  ];
}

function getBucket(id) {
  return bucketDefs().find((b) => b.id === id) || null;
}

/**
 * Measure one bucket. Returns the def plus { exists, bytes, fileCount }.
 * Missing paths come back exists:false with zeroed sizes (common — not
 * everyone has Docker or Xcode).
 */
async function measureBucket(def) {
  try {
    await fs.access(def.path);
  } catch {
    return { ...def, exists: false, bytes: 0, fileCount: 0 };
  }
  const measured = await measurePath(def.path);
  return { ...def, exists: true, bytes: measured.bytes, fileCount: measured.fileCount };
}

/**
 * List local APFS / Time Machine snapshots on the boot volume. These are
 * the single biggest hidden contributor to System Data on most Macs.
 * Returns { supported, items:[{ id, date }], count, error? }.
 *
 * `tmutil listlocalsnapshots /` prints lines like:
 *   com.apple.TimeMachine.2026-05-20-123456.local
 */
async function listLocalSnapshots() {
  try {
    const { stdout } = await execFileAsync('tmutil', ['listlocalsnapshots', '/']);
    const items = [];
    for (const line of stdout.split('\n').map((s) => s.trim()).filter(Boolean)) {
      const m = line.match(/(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})/);
      const id = m ? m[0] : line;
      const date = m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}` : null;
      items.push({ id, date, raw: line });
    }
    // Newest first.
    items.sort((a, b) => (a.id < b.id ? 1 : -1));
    return { supported: true, items, count: items.length };
  } catch (err) {
    return { supported: false, items: [], count: 0, error: err.code || err.message };
  }
}

/**
 * Delete the given local snapshots by date id (e.g. "2026-05-20-123456").
 * Permanent — snapshots can't be moved to Trash. Honors dryRun.
 */
async function deleteLocalSnapshots(ids, { dryRun = false } = {}) {
  const list = (Array.isArray(ids) ? ids : []).filter((s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}-\d{6}$/.test(s));
  if (dryRun) {
    return { ok: true, dryRun: true, results: list.map((id) => ({ id, ok: true })) };
  }
  const results = [];
  for (const id of list) {
    try {
      await execFileAsync('tmutil', ['deletelocalsnapshots', id]);
      results.push({ id, ok: true });
    } catch (err) {
      const msg = (err.stderr && String(err.stderr).trim()) || err.code || err.message;
      results.push({ id, ok: false, error: msg });
    }
  }
  return { ok: results.every((r) => r.ok), dryRun: false, results };
}

/**
 * Enumerate the top-level children of a 'trash' bucket, with sizes, so the
 * caller can move them to Trash and log accurate history. Throws if the
 * bucket is unknown or not a trash bucket — defense against a renderer
 * trying to clear a review-only (irreplaceable) bucket.
 */
async function enumerateBucketChildren(id) {
  const def = getBucket(id);
  if (!def) throw new Error(`unknown bucket: ${id}`);
  if (def.action !== 'trash') throw new Error(`bucket is not clearable from here: ${id}`);

  let entries;
  try {
    entries = await fs.readdir(def.path, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return { def, children: [] };
    throw err;
  }

  const children = [];
  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue;
    const full = path.join(def.path, entry.name);
    const measured = await measurePath(full);
    children.push({ path: full, name: entry.name, bytes: measured.bytes, fileCount: measured.fileCount });
  }
  return { def, children };
}

/**
 * Run a bucket's curated SAFE reclaim command (e.g. `docker system prune -f`).
 * The command is fixed in bucketDefs — the caller only passes a bucket id, so
 * there's no way to inject an arbitrary command. Runs via execFile (no shell).
 * Honors dryRun. Returns { ok, dryRun, command, stdout, stderr, notInstalled? }.
 */
async function runReclaim(id, { dryRun = false } = {}) {
  const def = getBucket(id);
  if (!def || !def.reclaim) throw new Error(`no reclaim command for bucket: ${id}`);
  const r = def.reclaim;
  if (dryRun) {
    return { ok: true, dryRun: true, command: r.display, stdout: '', stderr: '' };
  }
  const bin = resolveBin(r.bin, r.candidates);
  try {
    const { stdout, stderr } = await execFileAsync(bin, r.args, { timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
    return { ok: true, dryRun: false, command: r.display, stdout: stdout || '', stderr: stderr || '' };
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { ok: false, dryRun: false, command: r.display, notInstalled: true, error: `${r.bin} is not installed (or not found) on this Mac` };
    }
    const msg = (err && err.stderr && String(err.stderr).trim()) || (err && err.message) || 'command failed';
    return { ok: false, dryRun: false, command: r.display, error: msg, stdout: (err && err.stdout) || '' };
  }
}

/**
 * Read-only "what would I reclaim" preview (e.g. `docker system df`). Never
 * mutates anything. Returns { ok, command, stdout, stderr } or
 * { ok:false, unsupported|notInstalled }.
 */
async function reclaimPreview(id) {
  const def = getBucket(id);
  if (!def || !def.reclaim || !def.reclaim.previewArgs) {
    return { ok: false, unsupported: true };
  }
  const r = def.reclaim;
  const bin = resolveBin(r.bin, r.candidates);
  const display = `${r.bin} ${r.previewArgs.join(' ')}`;
  try {
    const { stdout, stderr } = await execFileAsync(bin, r.previewArgs, { timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
    return { ok: true, command: display, stdout: stdout || '', stderr: stderr || '' };
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: false, command: display, notInstalled: true, error: `${r.bin} is not installed on this Mac` };
    return { ok: false, command: display, error: (err && err.stderr && String(err.stderr).trim()) || (err && err.message) || 'preview failed' };
  }
}

/**
 * Full scan. Measures every bucket (emitting progress per bucket) and lists
 * local snapshots. Read-only — nothing is deleted here.
 */
async function scanSystemData({ onProgress } = {}) {
  const report = (p) => { try { if (onProgress) onProgress(p); } catch { /* progress is best-effort */ } };
  const startedAt = Date.now();
  report({ phase: 'starting' });

  const defs = bucketDefs();
  const buckets = [];
  let totalBytes = 0;
  let i = 0;
  for (const def of defs) {
    i += 1;
    report({ phase: 'measuring', category: def.label, currentItem: def.label, itemsDone: i, itemsTotal: defs.length });
    const b = await measureBucket(def);
    if (b.exists) totalBytes += b.bytes;
    buckets.push(b);
  }

  report({ phase: 'measuring', category: 'Time Machine snapshots', currentItem: 'Time Machine snapshots' });
  const snapshots = await listLocalSnapshots();

  report({ phase: 'done' });
  return {
    generatedAt: Date.now(),
    durationMs: Date.now() - startedAt,
    totalBytes,
    buckets,
    snapshots,
  };
}

module.exports = {
  scanSystemData,
  bucketDefs,
  getBucket,
  enumerateBucketChildren,
  listLocalSnapshots,
  deleteLocalSnapshots,
  runReclaim,
  reclaimPreview,
};
