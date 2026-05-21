// Duplicate file scanner — three-stage hash pipeline.
//
//   Stage 1: walk every picked root, collecting (path, size). Cheap.
//   Stage 2: group by size. Files alone in their size class can't be
//            duplicates — drop them. For surviving groups, hash the
//            first + last 64 KB of each file as a fingerprint. Same-size
//            files with different fingerprints aren't duplicates either.
//   Stage 3: groups still alive after stage 2 get a full SHA-256. Files
//            sharing a full hash are the actual duplicate set.
//
// This pattern (fclones, rdfind, dedupr all do something similar) avoids
// reading entire files unless absolutely necessary. On a 10 GB scan it
// typically reads <100 MB.
//
// Hashing uses Node's native crypto + streams, which run their work in
// libuv worker threads — the main process event loop stays responsive
// for IPC/UI without us spinning up explicit worker_threads.

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isDevNoise } = require('../lib/walk');

const MIN_FILE_BYTES = 1024;            // <1 KB: too small to dedupe meaningfully
const PARTIAL_HEAD = 64 * 1024;          // 64 KB
const PARTIAL_TAIL = 64 * 1024;

// Same skip rules as the Large & Old walker — we never descend into
// bundles or hidden directories.
const BUNDLE_EXTS = new Set([
  '.app', '.photoslibrary', '.imovielibrary', '.musiclibrary', '.tvlibrary',
  '.logicx', '.band', '.bundle', '.framework', '.kext', '.plugin', '.component',
  '.xcarchive',
]);
function isBundle(name) {
  return BUNDLE_EXTS.has(path.extname(name).toLowerCase());
}

async function walk(dir, onFile) {
  let visited = 0;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (isBundle(entry.name)) continue;
      // Skip node_modules / .git / dist / etc — both for speed and
      // because duplicates inside dev project deps are noise, not
      // something the user wants to manually deduplicate.
      if (isDevNoise(entry.name)) continue;
      visited += await walk(path.join(dir, entry.name), onFile);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.endsWith('.icloud')) continue;
    const full = path.join(dir, entry.name);
    try {
      const st = await fs.stat(full);
      if (st.size < MIN_FILE_BYTES) continue;
      visited += 1;
      onFile(full, st);
    } catch { /* file vanished, skip */ }
  }
  return visited;
}

/**
 * Read head 64 KB + tail 64 KB and return a sha256 hex digest of both
 * concatenated. Cheap fingerprint that catches near-misses (same size,
 * different content) without reading entire files.
 */
async function partialHash(filePath, size) {
  const fd = await fs.open(filePath, 'r');
  try {
    const hash = crypto.createHash('sha256');
    const headBuf = Buffer.alloc(Math.min(PARTIAL_HEAD, size));
    await fd.read(headBuf, 0, headBuf.length, 0);
    hash.update(headBuf);
    if (size > PARTIAL_HEAD) {
      const tailLen = Math.min(PARTIAL_TAIL, size - PARTIAL_HEAD);
      const tailBuf = Buffer.alloc(tailLen);
      await fd.read(tailBuf, 0, tailLen, size - tailLen);
      hash.update(tailBuf);
    }
    return hash.digest('hex');
  } finally {
    await fd.close().catch(() => {});
  }
}

/**
 * Full SHA-256 via a read stream — libuv handles the reads on its
 * thread pool, so the main process event loop stays responsive.
 */
function fullHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fsSync.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Run a bounded-concurrency map over `items`. Returns an array of
 * `{ item, value }` or `{ item, error }` in input order.
 */
async function mapWithLimit(items, limit, fn, onTick) {
  const results = new Array(items.length);
  let cursor = 0;
  let done = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = { item: items[i], value: await fn(items[i]) };
      } catch (error) {
        results[i] = { item: items[i], error };
      }
      done += 1;
      onTick?.(done, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function scanDuplicates(opts = {}) {
  const roots = Array.isArray(opts.roots) ? opts.roots : [];
  const onProgress = opts.onProgress;
  if (roots.length === 0) {
    return {
      scanId: `dup-${Date.now()}`,
      scannedAt: Date.now(),
      durationMs: 0,
      visitedCount: 0,
      groups: [],
      totalReclaimable: 0,
      totalDuplicateFiles: 0,
      error: 'no roots provided',
    };
  }

  const startedAt = Date.now();

  // --- Stage 1: walk ----------------------------------------------------
  const filesBySize = new Map();
  let visited = 0;
  for (let r = 0; r < roots.length; r++) {
    onProgress?.({
      phase: 'walking',
      currentRoot: roots[r].replace(/^\/Users\/[^/]+\//, '~/'),
      rootIdx: r,
      rootCount: roots.length,
      visited,
    });
    visited += await walk(roots[r], (full, st) => {
      const list = filesBySize.get(st.size) || [];
      list.push({ path: full, size: st.size, mtimeMs: st.mtimeMs });
      filesBySize.set(st.size, list);
      if (visited % 500 === 0) {
        onProgress?.({ phase: 'walking', visited, rootIdx: r, rootCount: roots.length });
      }
    });
  }

  // --- Stage 2: partial hash for same-size groups -----------------------
  const sizeGroupCandidates = [];
  for (const list of filesBySize.values()) {
    if (list.length > 1) sizeGroupCandidates.push(...list);
  }
  onProgress?.({
    phase: 'partial-hashing',
    totalCandidates: sizeGroupCandidates.length,
    done: 0,
  });
  const partialResults = await mapWithLimit(
    sizeGroupCandidates,
    8,
    async (f) => partialHash(f.path, f.size),
    (done, total) => {
      // Throttle: emit every 25 files OR every 250ms.
      if (done % 25 === 0 || done === total) {
        onProgress?.({ phase: 'partial-hashing', done, totalCandidates: total });
      }
    },
  );

  // Bucket by (size, partialHash). Same-size + same-fingerprint files
  // graduate to stage 3.
  const partialGroups = new Map(); // key: `${size}::${partialHash}` → [files]
  for (const r of partialResults) {
    if (r.error) continue;
    const key = `${r.item.size}::${r.value}`;
    const list = partialGroups.get(key) || [];
    list.push(r.item);
    partialGroups.set(key, list);
  }

  // --- Stage 3: full hash for surviving groups --------------------------
  const fullHashCandidates = [];
  for (const list of partialGroups.values()) {
    if (list.length > 1) fullHashCandidates.push(...list);
  }
  onProgress?.({
    phase: 'full-hashing',
    totalCandidates: fullHashCandidates.length,
    done: 0,
  });
  const fullResults = await mapWithLimit(
    fullHashCandidates,
    4, // lower concurrency — reads more bytes, hits same disk
    async (f) => fullHash(f.path),
    (done, total) => {
      if (done % 10 === 0 || done === total) {
        onProgress?.({ phase: 'full-hashing', done, totalCandidates: total });
      }
    },
  );

  // Final group: bucket by (size, fullHash). Groups with >1 file are
  // confirmed duplicate sets.
  const finalGroups = new Map();
  for (const r of fullResults) {
    if (r.error) continue;
    const key = `${r.item.size}::${r.value}`;
    const list = finalGroups.get(key) || [];
    list.push(r.item);
    finalGroups.set(key, list);
  }

  // Shape the result. For each group, sort copies by mtime ascending so
  // the UI picks the OLDEST file as the default keeper (most likely the
  // original).
  const groups = [];
  for (const [key, list] of finalGroups.entries()) {
    if (list.length < 2) continue;
    const [size, hash] = key.split('::');
    const copies = list
      .map((f) => ({ path: f.path, mtimeMs: f.mtimeMs }))
      .sort((a, b) => a.mtimeMs - b.mtimeMs);
    groups.push({
      id: `dup::${hash}`,
      hash,
      bytes: Number(size),
      copies,
      // Bytes you reclaim if you keep one copy and delete the rest.
      reclaimable: Number(size) * (copies.length - 1),
    });
  }
  // Biggest wins first.
  groups.sort((a, b) => b.reclaimable - a.reclaimable);

  onProgress?.({ phase: 'done' });
  return {
    scanId: `dup-${startedAt}`,
    scannedAt: startedAt,
    durationMs: Date.now() - startedAt,
    visitedCount: visited,
    groups,
    totalReclaimable: groups.reduce((s, g) => s + g.reclaimable, 0),
    totalDuplicateFiles: groups.reduce((s, g) => s + g.copies.length - 1, 0),
  };
}

module.exports = { scanDuplicates };
