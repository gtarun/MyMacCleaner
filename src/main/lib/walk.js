// Filesystem helpers shared across scanners.
//
// Centralized so the "swallow per-file errors, don't follow symlinks"
// invariants stay consistent across every scan. Bugs in this file affect
// every scanner — change with care.

const fs = require('node:fs/promises');
const path = require('node:path');

// Directories we never descend into when walking user content. These are
// all either dev-tool noise (node_modules, .git) that regenerates from
// source, or build outputs that recreate on the next compile. Walking
// them dominates scan time on any developer Mac — a single node_modules
// can easily hit 200k files — and the contents aren't useful for "large
// file" or "duplicate" detection anyway because they're tied to the
// project lifecycle.
//
// Same pattern as macOS bundles: treat the whole directory as opaque
// and skip past it.
const DEV_NOISE_DIRS = new Set([
  // JS / TS
  'node_modules', '.next', '.nuxt', '.svelte-kit', '.parcel-cache', '.turbo',
  // Build outputs
  'dist', 'build', 'out', '.output',
  // Rust / generic
  'target',
  // VCS internals
  '.git', '.svn', '.hg',
  // Generic caches
  '.cache', '.expo', '.vercel', '.netlify', '.serverless', '.terraform',
  // Python
  '.venv', 'venv', 'env', '__pycache__', '.tox', '.pytest_cache', '.mypy_cache',
  // Ruby
  'vendor',
  // Cocoa / iOS
  'Pods', 'DerivedData', '.build',
  // JVM
  '.gradle', '.idea',
]);

function isDevNoise(name) { return DEV_NOISE_DIRS.has(name); }

/**
 * Recursive directory size. Returns { bytes, fileCount }.
 *
 * - Individual file errors (EPERM, ENOENT from mid-scan churn) are swallowed
 *   so one bad entry can't fail the whole scan.
 * - Symlinks are stat'd, not followed — counts the link's own size only,
 *   avoiding both cycles and accidentally counting data outside the root.
 */
async function measureDir(dir) {
  let bytes = 0;
  let fileCount = 0;

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return { bytes: 0, fileCount: 0 };
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isSymbolicLink()) {
        const st = await fs.lstat(full);
        bytes += st.size;
        fileCount += 1;
      } else if (entry.isDirectory()) {
        const sub = await measureDir(full);
        bytes += sub.bytes;
        fileCount += sub.fileCount;
      } else if (entry.isFile()) {
        const st = await fs.stat(full);
        bytes += st.size;
        fileCount += 1;
      }
    } catch {
      // ignore — file vanished or no permission
    }
  }

  return { bytes, fileCount };
}

/**
 * Returns { bytes, fileCount } for any path, file or directory. Returns
 * { bytes: 0, fileCount: 0 } if the path can't be stat'd.
 */
async function measurePath(p) {
  try {
    const st = await fs.lstat(p);
    if (st.isDirectory()) return measureDir(p);
    return { bytes: st.size, fileCount: 1 };
  } catch {
    return { bytes: 0, fileCount: 0 };
  }
}

module.exports = { measureDir, measurePath, DEV_NOISE_DIRS, isDevNoise };
