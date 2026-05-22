// Trash bin inspection + emptying.
//
// This is the one place in the app that PERMANENTLY deletes data. Every
// other "clean" path moves items to ~/.Trash via shell.trashItem so the
// user can recover them. Emptying the Trash is the deliberate, final step
// that actually reclaims the disk space — so it lives behind its own
// module, its own IPC channel, and a strong confirmation in the UI.
//
// We only ever touch the user's home Trash (~/.Trash). We do NOT walk the
// per-volume .Trashes directories on external/network drives — those can
// require elevated permissions and aren't what most people mean by
// "empty my Trash".

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { measurePath } = require('./lib/walk');

const TRASH_DIR = path.join(os.homedir(), '.Trash');

/**
 * Summarize the home Trash without modifying anything.
 * Returns { path, exists, bytes, fileCount, itemCount }.
 *   - itemCount: number of top-level entries (what the user sees in Finder)
 *   - fileCount: total files including those nested inside trashed folders
 */
async function getTrashInfo() {
  let entries;
  try {
    entries = await fs.readdir(TRASH_DIR, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      // No Trash dir at all (fresh account) → genuinely empty.
      return { path: TRASH_DIR, exists: false, bytes: 0, fileCount: 0, itemCount: 0 };
    }
    // Couldn't read it (e.g. permissions). We DON'T know it's empty, so
    // report itemCount: null ("unknown") rather than 0 — otherwise the UI
    // would wrongly disable Empty Trash while the bin still has files.
    return { path: TRASH_DIR, exists: true, bytes: 0, fileCount: 0, itemCount: null, error: err.code || String(err) };
  }

  let bytes = 0;
  let fileCount = 0;
  let itemCount = 0;
  for (const entry of entries) {
    // Skip the hidden .DS_Store bookkeeping file from the count, but still
    // tally its (tiny) size so the number reconciles.
    const full = path.join(TRASH_DIR, entry.name);
    const measured = await measurePath(full);
    bytes += measured.bytes;
    fileCount += measured.fileCount;
    if (entry.name !== '.DS_Store') itemCount += 1;
  }

  return { path: TRASH_DIR, exists: true, bytes, fileCount, itemCount };
}

/**
 * Empty the home Trash. Deletes each top-level entry recursively.
 *
 * @param {{ dryRun?: boolean }} opts
 * @returns {Promise<{ ok, dryRun, freedBytes, removedCount, errors }>}
 *
 * In dryRun mode nothing is deleted — we just report what *would* be freed,
 * mirroring the dry-run behavior of the Trash-move path so the user's
 * global safety toggle is honored everywhere.
 */
async function emptyTrash({ dryRun = false } = {}) {
  let entries;
  try {
    entries = await fs.readdir(TRASH_DIR, { withFileTypes: true });
  } catch (err) {
    return { ok: false, dryRun, freedBytes: 0, removedCount: 0, errors: [{ name: TRASH_DIR, error: err.code || err.message }] };
  }

  // Defense-in-depth: never operate outside ~/.Trash. If anything resolves
  // to a path that isn't strictly inside the Trash dir, skip it.
  const trashRoot = path.resolve(TRASH_DIR);

  let freedBytes = 0;
  let removedCount = 0;
  const errors = [];
  const removed = []; // { name, bytes } — for the history log

  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue;
    const full = path.join(TRASH_DIR, entry.name);
    const abs = path.resolve(full);
    if (abs === trashRoot || !abs.startsWith(trashRoot + path.sep)) {
      errors.push({ name: entry.name, error: 'refused: outside Trash' });
      continue;
    }

    // Measure first so we can report freed bytes even after deletion.
    const measured = await measurePath(full);

    if (dryRun) {
      freedBytes += measured.bytes;
      removedCount += 1;
      removed.push({ name: entry.name, bytes: measured.bytes });
      continue;
    }

    try {
      await fs.rm(full, { recursive: true, force: true });
      freedBytes += measured.bytes;
      removedCount += 1;
      removed.push({ name: entry.name, bytes: measured.bytes });
    } catch (err) {
      errors.push({ name: entry.name, error: err.code || err.message });
    }
  }

  return { ok: errors.length === 0, dryRun, freedBytes, removedCount, removed, errors };
}

module.exports = { getTrashInfo, emptyTrash, TRASH_DIR };
