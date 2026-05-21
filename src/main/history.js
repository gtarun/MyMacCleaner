// Cleanup history + restore-from-Trash.
//
// Every time the app moves things to Trash we append an entry here, so the
// user can see what was removed and — crucially — put it back. Restore is
// best-effort: macOS drops trashed items at ~/.Trash/<basename>, so if the
// item is still there (and nothing has reclaimed its original spot) we move
// it back to where it came from.
//
// Stored as JSON at userData/history.json. Capped to the most recent
// MAX_ENTRIES so the file can't grow without bound.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { app } = require('electron');

const MAX_ENTRIES = 200;
const TRASH_DIR = path.join(os.homedir(), '.Trash');

let cache = null;
let filePath = null;

function getPath() {
  if (filePath) return filePath;
  filePath = path.join(app.getPath('userData'), 'history.json');
  return filePath;
}

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(getPath(), 'utf8'));
    if (!Array.isArray(cache.entries)) cache = { entries: [] };
  } catch {
    cache = { entries: [] };
  }
  return cache;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(getPath()), { recursive: true });
    fs.writeFileSync(getPath(), JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error('history: write failed', err);
  }
}

/**
 * Append a cleanup entry.
 * @param {object} e
 * @param {string} e.scope          which module ran the cleanup
 * @param {boolean} e.dryRun        true if nothing was actually removed
 * @param {boolean} e.restorable    false for Empty Trash (gone for good)
 * @param {{path:string,bytes?:number}[]} e.items   removed items
 */
function record(e) {
  load();
  const items = (Array.isArray(e.items) ? e.items : []).map((it) => ({
    path: it.path,
    name: path.basename(it.path),
    bytes: typeof it.bytes === 'number' ? it.bytes : null,
    restoredAt: null,
  }));
  const entry = {
    id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    scope: e.scope || 'cleanup',
    dryRun: !!e.dryRun,
    restorable: e.restorable !== false && !e.dryRun,
    totalBytes: items.reduce((s, it) => s + (it.bytes || 0), 0),
    itemCount: items.length,
    items,
  };
  cache.entries.unshift(entry);
  if (cache.entries.length > MAX_ENTRIES) cache.entries.length = MAX_ENTRIES;
  save();
  return entry;
}

function list() {
  return load().entries;
}

function clear() {
  cache = { entries: [] };
  save();
  return cache;
}

/**
 * Best-effort restore of every not-yet-restored item in an entry. For each
 * item we look for ~/.Trash/<basename> and move it back to its original
 * path, refusing to overwrite anything that now occupies that spot.
 *
 * Returns { ok, restored, results:[{path, ok, error?}] } and persists the
 * per-item restoredAt timestamps so the UI can show what's already back.
 */
async function restore(entryId) {
  load();
  const entry = cache.entries.find((x) => x.id === entryId);
  if (!entry) return { ok: false, error: 'entry not found', results: [] };
  if (!entry.restorable) return { ok: false, error: 'this entry cannot be restored', results: [] };

  const results = [];
  let restored = 0;
  for (const item of entry.items) {
    if (item.restoredAt) { results.push({ path: item.path, ok: true, already: true }); continue; }
    const fromTrash = path.join(TRASH_DIR, item.name);
    try {
      // Don't clobber: if the original location is occupied again, skip.
      if (fs.existsSync(item.path)) {
        results.push({ path: item.path, ok: false, error: 'original location is occupied' });
        continue;
      }
      if (!fs.existsSync(fromTrash)) {
        results.push({ path: item.path, ok: false, error: 'not found in Trash (already emptied or renamed)' });
        continue;
      }
      await fsp.mkdir(path.dirname(item.path), { recursive: true });
      await fsp.rename(fromTrash, item.path);
      item.restoredAt = Date.now();
      restored += 1;
      results.push({ path: item.path, ok: true });
    } catch (err) {
      results.push({ path: item.path, ok: false, error: err.message || String(err) });
    }
  }
  save();
  return { ok: results.every((r) => r.ok), restored, results };
}

module.exports = { record, list, clear, restore };
