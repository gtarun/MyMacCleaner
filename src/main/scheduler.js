// Scheduled scans.
//
// Runs in the main process while the app is open. The schedule is
// configured in Settings → Schedule. We use a single rolling setTimeout
// rather than setInterval so that any settings change can cleanly
// reschedule the next run.
//
// Lifecycle:
//   - start()                — call once after app.whenReady
//   - rescheduleFromSettings() — call whenever schedule settings change
//   - runNow()                — exposed for the Settings "Run now" button
//
// What "scheduled" actually does:
//   1. Runs the enabled scopes (system-junk, large-old, apps) in sequence
//   2. Writes the per-scope summary into settings.lastResults so the
//      Dashboard reflects it next launch
//   3. Broadcasts each summary as `scan:scheduled-result` so live windows
//      pick it up immediately
//   4. Shows a macOS notification if enabled
//
// Cleanup is NEVER performed automatically — scheduled scans only
// surface what could be cleaned. The user always reviews and confirms.

const { BrowserWindow, Notification } = require('electron');
const settings = require('./settings');
const { scanSystemJunk } = require('./scanners/system-junk');
const { scanLargeOld } = require('./scanners/large-old');
const { listApps } = require('./scanners/apps');

let timer = null;
let running = false;

function broadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

/**
 * Given a schedule config + a "from" time, return the next run timestamp
 * in milliseconds. Returns null if scheduling is disabled.
 */
function computeNextRun(sched, now = Date.now()) {
  if (!sched?.enabled) return null;
  const freq = sched.frequency || 'weekly';
  const hour = clampInt(sched.hourOfDay, 0, 23, 9);
  const dow  = clampInt(sched.dayOfWeek, 0, 6, 1);

  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);

  if (freq === 'daily') {
    if (next.getTime() <= now) next.setDate(next.getDate() + 1);
    return next.getTime();
  }

  // weekly
  const currentDow = next.getDay();
  let daysUntil = dow - currentDow;
  if (daysUntil < 0 || (daysUntil === 0 && next.getTime() <= now)) daysUntil += 7;
  next.setDate(next.getDate() + daysUntil);
  return next.getTime();
}

function clampInt(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function stop() {
  if (timer) clearTimeout(timer);
  timer = null;
}

function start() {
  rescheduleFromSettings();
  // Catch-up: if a scheduled run was missed while the app was closed,
  // run it shortly after launch so the user sees fresh data without
  // having to wait a week. "Missed" = lastRunAt is older than expected
  // for the current frequency.
  const sched = settings.get().schedule;
  if (sched?.enabled) {
    const interval = sched.frequency === 'daily' ? 86400000 : 7 * 86400000;
    const since = sched.lastRunAt ? Date.now() - sched.lastRunAt : Infinity;
    if (since > interval) {
      // Wait 30 seconds after launch so the app finishes settling.
      setTimeout(() => { runNow().catch(() => {}); }, 30 * 1000);
    }
  }
}

function rescheduleFromSettings() {
  stop();
  const sched = settings.get().schedule;
  const next = computeNextRun(sched);
  if (next == null) return;
  const delay = Math.max(0, next - Date.now());
  // setTimeout has a 32-bit signed integer limit (~24.8 days). Our max
  // interval is 7 days so this is safe.
  timer = setTimeout(() => {
    runNow().catch((err) => console.error('scheduled scan failed:', err));
    // Whether it succeeded or not, schedule the next one.
    rescheduleFromSettings();
  }, delay);
}

async function runScopeSystemJunk() {
  const r = await scanSystemJunk({
    onProgress: (p) => broadcast('scan:progress', { scope: 'system-junk', ...p }),
  });
  return {
    totalBytes: r.totalBytes,
    itemCount: r.categories.reduce((s, c) => s + c.itemCount, 0),
    categoryCount: r.categories.length,
    recordedAt: Date.now(),
  };
}

async function runScopeLargeOld() {
  const lo = settings.get().largeOld || {};
  const r = await scanLargeOld({
    roots: Array.isArray(lo.roots) ? lo.roots : undefined,
    minBytes: lo.minBytes,
    minAgeMs: lo.minAgeDays != null ? lo.minAgeDays * 86400000 : undefined,
    onProgress: (p) => broadcast('scan:progress', { scope: 'large-old', ...p }),
  });
  const seen = new Set();
  let bytes = 0;
  for (const arr of [r.large, r.old]) {
    for (const f of arr) { if (!seen.has(f.id)) { seen.add(f.id); bytes += f.bytes; } }
  }
  return {
    totalBytes: bytes,
    flaggedCount: seen.size,
    large: r.large.length,
    old:   r.old.length,
    visited: r.visitedCount,
    recordedAt: Date.now(),
  };
}

async function runScopeApps() {
  const r = await listApps({
    onProgress: (p) => broadcast('scan:progress', { scope: 'apps', ...p }),
  });
  return {
    count: r.apps.length,
    totalBytes: r.apps.reduce((s, a) => s + (a.bytes || 0), 0),
    recordedAt: Date.now(),
  };
}

const RUNNERS = {
  'system-junk': runScopeSystemJunk,
  'large-old':   runScopeLargeOld,
  'apps':        runScopeApps,
};

/**
 * Execute the configured scopes right now, regardless of timing. Used by
 * the scheduler timer and by the "Run now" button in Settings.
 *
 * Re-entrancy: if a scheduled run is already in flight, this call is a
 * no-op. We don't queue.
 */
async function runNow() {
  if (running) return { skipped: true, reason: 'already running' };
  running = true;
  const startedAt = Date.now();
  const sched = settings.get().schedule;
  const scopes = Array.isArray(sched?.scopes) ? sched.scopes : ['system-junk', 'large-old', 'apps'];
  const summary = {};
  try {
    for (const scope of scopes) {
      const runner = RUNNERS[scope];
      if (!runner) continue;
      broadcast('scan:progress', { scope, phase: 'starting' });
      try {
        const result = await runner();
        summary[scope] = result;
        broadcast('scan:scheduled-result', { scope, summary: result });
      } catch (err) {
        console.error(`scheduled scan: ${scope} failed`, err);
      } finally {
        broadcast('scan:progress', { scope, phase: 'done' });
      }
    }

    const totalBytes = Object.values(summary).reduce((s, x) => s + (x.totalBytes || 0), 0);
    settings.update({
      schedule: { lastRunAt: Date.now(), lastRunDurationMs: Date.now() - startedAt },
      lastResults: summary,
    });

    if (sched?.notifyOnComplete) {
      const itemTotal = Object.values(summary).reduce((s, x) => s + (x.itemCount || x.flaggedCount || x.count || 0), 0);
      try {
        new Notification({
          title: 'MacCleaner — Scan complete',
          body:  totalBytes > 0
            ? `${formatBytes(totalBytes)} reclaimable across ${itemTotal} items`
            : 'Everything looks clean right now',
          silent: false,
        }).show();
      } catch { /* notifications can be denied by the user — ignore */ }
    }

    return { ok: true, summary, durationMs: Date.now() - startedAt };
  } finally {
    running = false;
  }
}

// Tiny duplicate of the formatter so the scheduler doesn't reach across
// the main/renderer boundary for a string format.
function formatBytes(bytes) {
  if (bytes == null || isNaN(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let n = bytes / 1024, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  const fixed = n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : Math.round(n);
  return `${fixed} ${units[i]}`;
}

module.exports = { start, stop, rescheduleFromSettings, runNow, computeNextRun };
