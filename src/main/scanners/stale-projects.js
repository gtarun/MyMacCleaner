// Stale-project detector.
//
// Finds heavy, regenerable dependency/build directories (node_modules,
// target, .venv, Pods, DerivedData, …) that sit next to a project whose
// SOURCE hasn't been touched in a long time. Those directories can be
// safely trashed — they regenerate from source on the next install/build —
// and on a developer's Mac they're often the single biggest reclaimable
// win.
//
// The trick that makes this both safe and useful is staleness: we don't
// flag an active project's node_modules (you'd just have to reinstall it),
// only ones whose newest source file is older than the threshold. We
// measure "last activity" by the freshest mtime among the project's source
// files, deliberately EXCLUDING the heavy dirs themselves (a fresh
// `npm install` shouldn't make a 2-year-old project look active).

const fs = require('node:fs/promises');
const path = require('node:path');
const { measureDir } = require('../lib/walk');

// Heavy, regenerable directories worth reclaiming. Subset of the broader
// dev-noise list — these are the ones that are both large and trivially
// regenerated, so trashing them is low-risk.
const HEAVY_DIRS = new Set([
  'node_modules', '.next', '.nuxt', '.svelte-kit', '.parcel-cache', '.turbo',
  'dist', 'build', 'out', '.output',
  'target',
  '.venv', 'venv', 'env', '__pycache__', '.tox', '.pytest_cache', '.mypy_cache',
  'Pods', 'DerivedData', '.build',
  '.gradle',
  'vendor',
]);

// Files/dirs that mark a directory as a "project root" — used only for
// labeling (what kind of project it is). Detection itself keys off the
// presence of a heavy dir.
const MARKERS = [
  ['package.json', 'Node'],
  ['Cargo.toml', 'Rust'],
  ['go.mod', 'Go'],
  ['pyproject.toml', 'Python'],
  ['requirements.txt', 'Python'],
  ['Podfile', 'CocoaPods'],
  ['build.gradle', 'Gradle'],
  ['pom.xml', 'Maven'],
  ['Gemfile', 'Ruby'],
  ['composer.json', 'PHP'],
  ['.git', 'Git'],
];

const BUNDLE_EXTS = new Set([
  '.app', '.photoslibrary', '.imovielibrary', '.musiclibrary', '.tvlibrary',
  '.logicx', '.band', '.bundle', '.framework', '.kext', '.plugin', '.component',
  '.xcarchive',
]);
function isBundle(name) {
  return BUNDLE_EXTS.has(path.extname(name).toLowerCase());
}

/**
 * Freshest mtime among a project's source files, skipping heavy dirs and
 * hidden entries. Bounded by `budget` entries so a project with a huge
 * (non-heavy) asset tree can't make this run away — once the budget is
 * spent we return the freshest mtime seen so far, which is a fine proxy.
 */
async function freshestSourceMtime(dir, budget = { left: 6000 }) {
  let newest = 0;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return newest;
  }
  for (const entry of entries) {
    if (budget.left <= 0) break;
    if (entry.name.startsWith('.')) continue;
    if (HEAVY_DIRS.has(entry.name)) continue;
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    budget.left -= 1;
    try {
      if (entry.isDirectory()) {
        if (isBundle(entry.name)) continue;
        const sub = await freshestSourceMtime(full, budget);
        if (sub > newest) newest = sub;
      } else if (entry.isFile()) {
        const st = await fs.stat(full);
        if (st.mtimeMs > newest) newest = st.mtimeMs;
      }
    } catch { /* vanished / no perms */ }
  }
  return newest;
}

function detectMarkers(entryNames) {
  const set = new Set(entryNames);
  const found = [];
  for (const [file, label] of MARKERS) {
    if (set.has(file)) found.push(label);
  }
  return found;
}

/**
 * Recursively discover projects under `dir`. A directory is a "project"
 * if it directly contains one or more heavy dirs. We record those, then
 * keep recursing into non-heavy subdirectories to catch nested projects
 * (monorepos, packages/* layouts).
 */
async function discover(dir, depth, maxDepth, ctx) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  ctx.visitedDirs += 1;
  if (ctx.visitedDirs % 50 === 0) {
    ctx.onProgress?.({
      phase: 'searching',
      currentItem: dir.replace(/^\/Users\/[^/]+\//, '~/'),
      visited: ctx.visitedDirs,
      found: ctx.projects.length,
    });
  }

  const names = entries.map((e) => e.name);
  const heavyChildren = entries.filter((e) => e.isDirectory() && HEAVY_DIRS.has(e.name));

  if (heavyChildren.length > 0) {
    const markers = detectMarkers(names);
    const heavyDirs = [];
    for (const h of heavyChildren) {
      const full = path.join(dir, h.name);
      try {
        const [{ bytes, fileCount }, st] = await Promise.all([
          measureDir(full),
          fs.stat(full).catch(() => ({ mtimeMs: 0 })),
        ]);
        heavyDirs.push({ name: h.name, path: full, bytes, fileCount, mtimeMs: st.mtimeMs });
      } catch { /* skip */ }
    }
    const totalBytes = heavyDirs.reduce((s, h) => s + h.bytes, 0);
    const totalFiles = heavyDirs.reduce((s, h) => s + h.fileCount, 0);

    // "Last activity" prefers the freshest SOURCE file (excluding the heavy
    // dirs, so a fresh `npm install` can't make an old project look active).
    // If there's no readable source at all — an orphaned node_modules, or a
    // permissions failure — fall back to the newest heavy-dir mtime so we
    // still have a defensible age. Only when BOTH are unknown do we leave it
    // null, and such projects are excluded from results rather than flagged
    // blindly.
    const srcMtime = await freshestSourceMtime(dir);
    const heavyNewest = heavyDirs.reduce((m, h) => Math.max(m, h.mtimeMs || 0), 0);
    const lastActivityMs = srcMtime || heavyNewest || null;

    ctx.projects.push({
      id: `stale::${dir}`,
      path: dir,
      displayPath: dir.replace(/^\/Users\/[^/]+\//, '~/'),
      name: path.basename(dir),
      markers,
      heavyDirs,
      totalBytes,
      totalFiles,
      lastActivityMs,
    });
  }

  // Recurse into non-heavy subdirs to find nested projects.
  if (depth < maxDepth) {
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;
      if (HEAVY_DIRS.has(entry.name)) continue;
      if (isBundle(entry.name)) continue;
      if (entry.isSymbolicLink && entry.isSymbolicLink()) continue;
      await discover(path.join(dir, entry.name), depth + 1, maxDepth, ctx);
    }
  }
}

/**
 * @param {object} opts
 * @param {string[]} opts.roots         folders to search (user-picked)
 * @param {number}  [opts.minAgeMs]     only flag projects idle at least this long (default 90d)
 * @param {number}  [opts.minBytes]     only flag projects with at least this much heavy data (default 50 MB)
 * @param {number}  [opts.maxDepth]     recursion depth from each root (default 6)
 * @param {function}[opts.onProgress]
 */
async function scanStaleProjects(opts = {}) {
  const roots = Array.isArray(opts.roots) ? opts.roots : [];
  const minAgeMs = opts.minAgeMs ?? 90 * 86400000;     // 90 days
  const minBytes = opts.minBytes ?? 50 * 1024 * 1024;  // 50 MB
  const maxDepth = opts.maxDepth ?? 6;
  const onProgress = opts.onProgress;
  const startedAt = Date.now();

  if (roots.length === 0) {
    return {
      scanId: `stale-${startedAt}`, scannedAt: startedAt, durationMs: 0,
      visitedDirs: 0, projects: [], totalReclaimable: 0, projectCount: 0,
      error: 'no roots provided',
    };
  }

  const ctx = { projects: [], visitedDirs: 0, onProgress };
  for (let i = 0; i < roots.length; i++) {
    onProgress?.({ phase: 'searching', currentItem: roots[i], rootIdx: i, rootCount: roots.length, visited: ctx.visitedDirs, found: ctx.projects.length });
    await discover(roots[i], 0, maxDepth, ctx);
  }

  const now = Date.now();
  // Keep only projects that are both stale enough and large enough.
  const projects = ctx.projects
    .map((p) => ({
      ...p,
      idleMs: p.lastActivityMs ? now - p.lastActivityMs : null,
      idleDays: p.lastActivityMs ? Math.floor((now - p.lastActivityMs) / 86400000) : null,
    }))
    .filter((p) => p.totalBytes >= minBytes)
    // Require a KNOWN idle age that meets the threshold. Projects whose age
    // can't be determined at all are excluded rather than flagged blindly.
    .filter((p) => p.idleMs != null && p.idleMs >= minAgeMs)
    .sort((a, b) => b.totalBytes - a.totalBytes);

  onProgress?.({ phase: 'done' });
  return {
    scanId: `stale-${startedAt}`,
    scannedAt: startedAt,
    durationMs: Date.now() - startedAt,
    visitedDirs: ctx.visitedDirs,
    minAgeDays: Math.round(minAgeMs / 86400000),
    projects,
    projectCount: projects.length,
    totalReclaimable: projects.reduce((s, p) => s + p.totalBytes, 0),
  };
}

module.exports = { scanStaleProjects, HEAVY_DIRS };
