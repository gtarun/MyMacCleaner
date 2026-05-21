// Persistent settings.
//
// JSON file in app.getPath('userData')/settings.json. No external dep —
// the schema is small enough that hand-rolling reads/writes is simpler
// than pulling in electron-store.
//
// All reads go through `get()` which returns a deep-merged view of the
// defaults plus whatever is on disk. Writes go through `update(patch)`
// which deep-merges into the current state and rewrites the file.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { app } = require('electron');

const HOME = os.homedir();

const DEFAULTS = {
  largeOld: {
    // null → use the scanner's built-in defaults (Documents/Downloads/
    // Desktop/Movies/Pictures). An explicit array overrides that list.
    roots: null,
    minBytes: 100 * 1024 * 1024,        // 100 MB
    minAgeDays: 180,                    // 6 months
  },
  duplicates: {
    // Persisted across sessions so picked folders stick on the next
    // launch. Each entry is validated against the safety rules at boot.
    roots: [],
  },
  staleProjects: {
    // Reuses the duplicates picked-roots for scope. Only flag heavy dirs
    // when the project has been idle this long and is at least this big.
    minAgeDays: 90,                     // 3 months untouched
    minBytes: 50 * 1024 * 1024,         // 50 MB
  },
  safety: {
    dryRun: false,                      // preview mode — never call shell.trashItem
  },
  schedule: {
    enabled: false,
    frequency: 'weekly',                // 'daily' | 'weekly'
    dayOfWeek: 1,                       // 0=Sun, 1=Mon, … only used when frequency=weekly
    hourOfDay: 9,                       // 0..23 local time
    scopes: ['system-junk', 'large-old', 'apps'],
    notifyOnComplete: true,
    lastRunAt: null,
    lastRunDurationMs: null,
  },
  // Per-scope scan summaries that survive across launches. Hydrated into
  // ScanContext on app boot so the Dashboard shows last-known numbers
  // immediately, before the user re-runs anything. Updated by both
  // interactive scans (via setResult) and scheduled runs.
  // First-launch onboarding state. The renderer reads this on mount and
  // shows the onboarding overlay until `completed` flips true.
  firstRun: {
    completed: false,
    completedAt: null,
  },
  lastResults: {},
  lastCleaned: {                        // scope → { at: ms, bytes: number }
    'system-junk': null,
    'large-old':   null,
    'apps':        null,
    'duplicates':  null,
  },
};

let cache = null;
let settingsFilePath = null;

function getPath() {
  if (settingsFilePath) return settingsFilePath;
  settingsFilePath = path.join(app.getPath('userData'), 'settings.json');
  return settingsFilePath;
}

function mergeDeep(target, source) {
  if (!source || typeof source !== 'object') return target;
  const out = Array.isArray(target) ? [...target] : { ...target };
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = out[key];
    if (sv && typeof sv === 'object' && !Array.isArray(sv) && tv && typeof tv === 'object' && !Array.isArray(tv)) {
      out[key] = mergeDeep(tv, sv);
    } else {
      out[key] = sv;
    }
  }
  return out;
}

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function load() {
  if (cache) return cache;
  try {
    const text = fs.readFileSync(getPath(), 'utf8');
    cache = mergeDeep(clone(DEFAULTS), JSON.parse(text));
  } catch {
    cache = clone(DEFAULTS);
  }
  return cache;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(getPath()), { recursive: true });
    fs.writeFileSync(getPath(), JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error('settings: write failed', err);
  }
}

function get() {
  return load();
}

function update(patch) {
  load();
  cache = mergeDeep(cache, patch);
  save();
  return cache;
}

// Convenience helper: record that a scope just cleaned X bytes.
function recordCleaned(scope, bytes) {
  return update({ lastCleaned: { [scope]: { at: Date.now(), bytes } } });
}

module.exports = { get, update, recordCleaned, DEFAULTS, HOME };
