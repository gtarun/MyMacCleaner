// Disk space visualizer scan.
//
// Builds a nested size tree under a chosen root, suitable for a treemap.
// Unlike the cleaner scanners, this is read-only and INCLUDES everything
// (node_modules, build dirs, bundles) because the whole point is to show
// where space actually goes.
//
// To keep the payload sent to the renderer bounded regardless of how huge
// the tree is, we:
//   - sum sizes for the FULL subtree (accurate), but
//   - only keep child NODES down to `maxDepth`, and
//   - keep only the `topN` biggest children at each level, collapsing the
//     remainder into a synthetic "Other" node.
// Bundles (.app, .photoslibrary, …) are measured as opaque leaves — we
// never expose their internals.

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { measureDir } = require('../lib/walk');
const { isExcluded } = require('../safety/allowlist');

const BUNDLE_EXTS = new Set([
  '.app', '.photoslibrary', '.imovielibrary', '.musiclibrary', '.tvlibrary',
  '.logicx', '.band', '.bundle', '.framework', '.kext', '.plugin', '.component',
  '.xcarchive',
]);
function isBundle(name) {
  return BUNDLE_EXTS.has(path.extname(name).toLowerCase());
}

function prune(children, topN) {
  if (children.length <= topN) return children.sort((a, b) => b.bytes - a.bytes);
  const sorted = children.sort((a, b) => b.bytes - a.bytes);
  const keep = sorted.slice(0, topN);
  const rest = sorted.slice(topN);
  const restBytes = rest.reduce((s, c) => s + c.bytes, 0);
  const restFiles = rest.reduce((s, c) => s + c.fileCount, 0);
  if (restBytes > 0) {
    keep.push({
      name: `Other (${rest.length} items)`,
      path: null,
      bytes: restBytes,
      fileCount: restFiles,
      dir: true,
      children: null,    // not drillable
      aggregate: true,
    });
  }
  return keep;
}

async function walkNode(dir, depth, maxDepth, topN, ctx) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return { bytes: 0, fileCount: 0, children: [] };
  }

  let bytes = 0;
  let fileCount = 0;
  const children = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (isExcluded(full)) continue;

    if (entry.isSymbolicLink()) {
      try { const st = await fs.lstat(full); bytes += st.size; fileCount += 1; } catch { /* skip */ }
      continue;
    }

    if (entry.isDirectory()) {
      ctx.dirs += 1;
      maybeEmit(ctx, full);
      if (isBundle(entry.name)) {
        // Opaque leaf — measure but never expose internals.
        const m = await measureDir(full);
        bytes += m.bytes;
        fileCount += m.fileCount;
        children.push({ name: entry.name, path: full, bytes: m.bytes, fileCount: m.fileCount, dir: true, children: null, bundle: true });
        continue;
      }
      const sub = await walkNode(full, depth + 1, maxDepth, topN, ctx);
      bytes += sub.bytes;
      fileCount += sub.fileCount;
      children.push({
        name: entry.name,
        path: full,
        bytes: sub.bytes,
        fileCount: sub.fileCount,
        dir: true,
        // Only carry child nodes within the depth budget; deeper levels are
        // summarized by size only and become drillable on a fresh scan.
        children: depth + 1 < maxDepth ? prune(sub.children, topN) : null,
      });
      continue;
    }

    if (entry.isFile()) {
      try {
        const st = await fs.stat(full);
        bytes += st.size;
        fileCount += 1;
        ctx.files += 1;
        if (depth < maxDepth) {
          children.push({ name: entry.name, path: full, bytes: st.size, fileCount: 1, dir: false });
        }
      } catch { /* vanished */ }
    }
  }

  return { bytes, fileCount, children };
}

function maybeEmit(ctx, currentPath) {
  const now = Date.now();
  if (now - ctx.lastEmit < 200) return;
  ctx.lastEmit = now;
  ctx.onProgress?.({
    phase: 'scanning',
    currentItem: currentPath.replace(/^\/Users\/[^/]+\//, '~/'),
    dirs: ctx.dirs,
    files: ctx.files,
  });
}

/**
 * @param {object} opts
 * @param {string} [opts.root]      folder to map (default: home)
 * @param {number} [opts.maxDepth]  node-keeping depth (default 5)
 * @param {number} [opts.topN]      biggest children kept per level (default 24)
 * @param {function} [opts.onProgress]
 */
async function scanDiskMap(opts = {}) {
  const root = opts.root || os.homedir();
  const maxDepth = opts.maxDepth ?? 5;
  const topN = opts.topN ?? 24;
  const startedAt = Date.now();
  const ctx = { dirs: 0, files: 0, lastEmit: 0, onProgress: opts.onProgress };

  const tree = await walkNode(root, 0, maxDepth, topN, ctx);

  opts.onProgress?.({ phase: 'done' });
  return {
    scanId: `map-${startedAt}`,
    scannedAt: startedAt,
    durationMs: Date.now() - startedAt,
    root,
    rootName: path.basename(root) || root,
    totalBytes: tree.bytes,
    totalFiles: tree.fileCount,
    dirs: ctx.dirs,
    // The top-level node, children pruned to topN biggest.
    node: {
      name: path.basename(root) || root,
      path: root,
      bytes: tree.bytes,
      fileCount: tree.fileCount,
      dir: true,
      children: prune(tree.children, topN),
    },
  };
}

module.exports = { scanDiskMap };
