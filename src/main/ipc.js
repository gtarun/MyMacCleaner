// Central registry for IPC handlers.
//
// The renderer can ONLY reach the main process through the channels listed
// here. Every new scanner/feature should register its handlers in this file
// so the surface stays small and auditable.

const os = require('node:os');
const { ipcMain, app, dialog, BrowserWindow, shell } = require('electron');
const { scanSystemJunk } = require('./scanners/system-junk');
const { listApps } = require('./scanners/apps');
const { findLeftovers } = require('./scanners/uninstaller');
const { scanLargeOld } = require('./scanners/large-old');
const { scanDuplicates } = require('./scanners/duplicates');
const { scanStaleProjects } = require('./scanners/stale-projects');
const { scanInstallers } = require('./scanners/installers');
const { scanDiskMap } = require('./scanners/disk-map');
const systemData = require('./scanners/system-data');
const { trashItems } = require('./safety/trash');
const { validatePickedRoot, addRuntimeAllowedRoot, listRuntimeAllowedRoots, setExclusions } = require('./safety/allowlist');
const settings = require('./settings');
const { getHealth } = require('./health');
const { listProcesses, killProcess } = require('./processes');
const { getTrashInfo, emptyTrash } = require('./trash-bin');
const { getSystemReport } = require('./system-report');
const history = require('./history');
const scheduler = require('./scheduler');
const tray = require('./tray');

// On boot, replay any persisted Duplicates roots into the runtime
// allowlist so the safety gate accepts files inside them without the
// user re-picking. Each one still passes through validatePickedRoot to
// catch any that became unsafe between sessions (e.g. user moved their
// home dir).
function restorePersistedRoots() {
  const s = settings.get();
  // Load user exclusions into the safety gate up front so the very first
  // scan/clean of the session already honors them.
  setExclusions(s.exclusions);
  if (!Array.isArray(s.duplicates?.roots)) return;
  for (const root of s.duplicates.roots) {
    const check = validatePickedRoot(root);
    if (check.ok) addRuntimeAllowedRoot(root);
  }
}

function registerIpcHandlers() {
  restorePersistedRoots();

  // ── Settings ─────────────────────────────────────────────────────
  ipcMain.handle('settings:get', async () => settings.get());

  ipcMain.handle('settings:update', async (event, patch) => {
    const next = settings.update(patch);
    // If the Duplicates root list changed, refresh the runtime allowlist
    // so newly-added entries are immediately trash-able and removed ones
    // are gated again. Trade-off: we don't currently shrink the runtime
    // allowlist on remove — added roots stay valid for the session.
    if (patch && patch.duplicates && Array.isArray(patch.duplicates.roots)) {
      for (const r of next.duplicates.roots) {
        const check = validatePickedRoot(r);
        if (check.ok) addRuntimeAllowedRoot(r);
      }
    }
    // Schedule changes need to flow through to the running timer.
    if (patch && patch.schedule) scheduler.rescheduleFromSettings();
    // Exclusions changed → refresh the safety gate immediately.
    if (patch && Array.isArray(patch.exclusions)) setExclusions(next.exclusions);
    // Tray title shows reclaimable bytes — refresh whenever lastResults
    // moves. Cheap enough to call on every settings update.
    try { tray.refresh(); } catch { /* tray may not exist in test envs */ }
    // Broadcast so all renderer windows hear the change.
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('settings:changed', next);
    }
    return next;
  });

  // Manual trigger for "Run now" in the Schedule UI.
  ipcMain.handle('scheduler:run-now', async () => scheduler.runNow());

  // Open an external link in the user's default browser. We only ever
  // allow http(s) — never file:// or custom schemes — so a compromised
  // renderer can't use this to launch local apps or read local files.
  ipcMain.handle('shell:open-external', async (_event, url) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      throw new Error('shell:open-external only accepts http(s) URLs');
    }
    await shell.openExternal(url);
    return { ok: true };
  });

  // Reveal a file or folder in Finder. Read-only — this selects the item in
  // a Finder window, it never opens/executes it and never mutates anything.
  // We only accept a non-empty absolute string; the path is passed straight
  // to Finder, so there's nothing here that could delete or run code.
  ipcMain.handle('shell:show-in-folder', async (_event, p) => {
    if (typeof p !== 'string' || !p.startsWith('/')) {
      throw new Error('shell:show-in-folder expects an absolute path');
    }
    shell.showItemInFolder(p);
    return { ok: true };
  });

  // Onboarding helper: do a no-op read of each user-content folder so
  // macOS surfaces its TCC permission prompts up front. Returns the
  // per-folder accessibility result so the UI can highlight which were
  // granted vs. denied.
  ipcMain.handle('onboarding:request-folder-access', async () => {
    const os = require('node:os');
    const fs = require('node:fs/promises');
    const path = require('node:path');
    const HOME = os.homedir();
    const folders = [
      { key: 'documents', path: path.join(HOME, 'Documents') },
      { key: 'downloads', path: path.join(HOME, 'Downloads') },
      { key: 'desktop',   path: path.join(HOME, 'Desktop')   },
    ];
    const results = [];
    for (const f of folders) {
      try {
        await fs.readdir(f.path);
        results.push({ ...f, granted: true });
      } catch (err) {
        results.push({ ...f, granted: false, error: err.code || err.message });
      }
    }
    return results;
  });
  // Handshake channel — proves the IPC pipeline is wired correctly.
  // Renderer calls window.api.getSystemInfo() on mount; if this returns,
  // we know preload + contextBridge + ipcMain are all in agreement.
  ipcMain.handle('system:info', async () => {
    return {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.versions.node,
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      homeDir: os.homedir(),
      hostname: os.hostname(),
      cpuCount: os.cpus().length,
      totalMemGB: +(os.totalmem() / 1024 ** 3).toFixed(1),
      freeMemGB: +(os.freemem() / 1024 ** 3).toFixed(1),
      appVersion: app.getVersion(),
      userDataPath: app.getPath('userData'),
    };
  });

  // Helper: each scan handler emits progress events tagged with its scope
  // so the renderer can route them. Sender is captured per invocation so a
  // late event from a slow scan still goes to the right window.
  function progressEmitter(event, scope) {
    return (payload) => {
      if (event.sender.isDestroyed()) return;
      event.sender.send('scan:progress', { scope, ...payload });
    };
  }

  // Phase 2 — System Junk scan + Trash.
  ipcMain.handle('scan:system-junk', async (event) => {
    return scanSystemJunk({ onProgress: progressEmitter(event, 'system-junk') });
  });

  // Universal cleanup channel. Renderer hands a list of paths; main runs
  // each through the allowlist, then shell.trashItem. Dry-run mode is
  // read from settings — toggling it is the user's safety net while
  // learning what the app removes. Per-result items carry `dryRun: true`
  // when applicable, so the UI swaps "Freed" → "Would free" without a
  // separate API.
  ipcMain.handle('clean:trash-items', async (_event, arg) => {
    // Back-compat: accept either a bare array of paths, or a richer
    // { paths, scope, items:[{path,bytes}] } object so we can log accurate
    // history (sizes + which module ran).
    const paths = Array.isArray(arg) ? arg : (Array.isArray(arg?.paths) ? arg.paths : null);
    if (!paths) throw new Error('clean:trash-items expects paths (array or { paths })');
    const scope = Array.isArray(arg) ? null : (arg?.scope || null);
    const meta = Array.isArray(arg) ? [] : (Array.isArray(arg?.items) ? arg.items : []);

    const { safety } = settings.get();
    const dryRun = !!safety?.dryRun;
    const results = await trashItems(paths, { dryRun });

    // Log successful real removals to the history (so they can be restored)
    // and record the per-scope cleaned total for the Activity view.
    if (!dryRun) {
      const bytesByPath = new Map(meta.map((m) => [m.path, m.bytes]));
      const succeeded = results.filter((r) => r.ok).map((r) => ({ path: r.path, bytes: bytesByPath.get(r.path) }));
      if (succeeded.length > 0) {
        history.record({ scope, dryRun: false, restorable: true, items: succeeded });
        const totalBytes = succeeded.reduce((s, it) => s + (it.bytes || 0), 0);
        if (scope && totalBytes > 0) { try { settings.recordCleaned(scope, totalBytes); } catch { /* non-fatal */ } }
      }
    }
    return results;
  });

  // Phase 4 — Uninstaller.
  ipcMain.handle('apps:list', async (event) => {
    return listApps({ onProgress: progressEmitter(event, 'apps') });
  });

  ipcMain.handle('apps:leftovers', async (event, { bundleId, appName }) => {
    if (typeof bundleId !== 'string' || typeof appName !== 'string') {
      throw new Error('apps:leftovers expects { bundleId, appName }');
    }
    return findLeftovers(bundleId, appName, { onProgress: progressEmitter(event, 'leftovers') });
  });

  // Phase 5 — Large & Old Files. Settings-aware: roots/minBytes/minAgeDays
  // come from persisted settings unless the caller explicitly overrides.
  ipcMain.handle('scan:large-old', async (event, opts) => {
    const cfg = settings.get().largeOld || {};
    const merged = {
      roots: opts?.roots ?? cfg.roots,
      minBytes: opts?.minBytes ?? cfg.minBytes,
      minAgeMs: opts?.minAgeMs ?? (cfg.minAgeDays != null ? cfg.minAgeDays * 86400000 : undefined),
      onProgress: progressEmitter(event, 'large-old'),
    };
    return scanLargeOld(merged);
  });

  // Phase 6 — Duplicate finder.
  // User picks the folders to scan; we validate each (no protected
  // subtrees), add accepted ones to the runtime allowlist so the trash
  // gate later accepts files inside them.
  ipcMain.handle('dialog:pick-folders', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: 'Pick folders to scan for duplicates',
      properties: ['openDirectory', 'multiSelections', 'createDirectory', 'showHiddenFiles'],
    });
    if (result.canceled) return { canceled: true, accepted: [], rejected: [] };
    const accepted = [];
    const rejected = [];
    for (const p of result.filePaths) {
      const check = validatePickedRoot(p);
      if (check.ok) {
        addRuntimeAllowedRoot(p);
        accepted.push(p);
      } else {
        rejected.push({ path: p, reason: check.reason });
      }
    }
    return { canceled: false, accepted, rejected };
  });

  ipcMain.handle('dialog:list-picked-roots', async () => {
    return listRuntimeAllowedRoots();
  });

  // Plain folder picker with NO side effects — used for the exclusions
  // list, where the user is choosing folders to PROTECT, not to allow.
  // (Reusing dialog:pick-folders here would wrongly add them to the
  // runtime allowlist.)
  ipcMain.handle('dialog:pick-paths', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose folders to exclude from cleaning',
      properties: ['openDirectory', 'multiSelections', 'showHiddenFiles'],
    });
    if (result.canceled) return { canceled: true, paths: [] };
    return { canceled: false, paths: result.filePaths };
  });

  ipcMain.handle('scan:duplicates', async (event, opts) => {
    return scanDuplicates({
      ...(opts || {}),
      onProgress: progressEmitter(event, 'duplicates'),
    });
  });

  // Stale-project detector. Reuses the same picked-roots + runtime
  // allowlist as Duplicates, so heavy dirs inside picked folders are
  // trash-able. Thresholds merge from settings when present.
  ipcMain.handle('scan:stale-projects', async (event, opts) => {
    const cfg = settings.get().staleProjects || {};
    return scanStaleProjects({
      roots: opts?.roots,
      minAgeMs: opts?.minAgeMs ?? (cfg.minAgeDays != null ? cfg.minAgeDays * 86400000 : undefined),
      minBytes: opts?.minBytes ?? cfg.minBytes,
      onProgress: progressEmitter(event, 'stale-projects'),
    });
  });

  // Leftover installers — old .dmg/.pkg/.zip left in ~/Downloads. Settings
  // supplies the age threshold; the caller can override it.
  ipcMain.handle('scan:installers', async (event, opts) => {
    const cfg = settings.get().installers || {};
    return scanInstallers({
      root: opts?.root,
      minAgeMs: opts?.minAgeMs ?? (cfg.minAgeDays != null ? cfg.minAgeDays * 86400000 : undefined),
      onProgress: progressEmitter(event, 'installers'),
    });
  });

  // Disk space visualizer — read-only size tree for the treemap.
  ipcMain.handle('scan:disk-map', async (event, opts) => {
    return scanDiskMap({ ...(opts || {}), onProgress: progressEmitter(event, 'disk-map') });
  });

  // ── System Data explorer ─────────────────────────────────────────────
  // Read-only measurement of the big opaque "System Data" buckets + local
  // Time Machine snapshots.
  ipcMain.handle('scan:system-data', async (event) => {
    return systemData.scanSystemData({ onProgress: progressEmitter(event, 'system-data') });
  });

  // Clear ONE 'trash' bucket by id. We resolve the id to a known bucket
  // here (paths never come from the renderer), enumerate its children, and
  // move each to Trash through the same safety-gated path as every other
  // cleaner. Review-only buckets are refused inside enumerateBucketChildren.
  ipcMain.handle('system-data:clear-bucket', async (_event, id) => {
    const { def, children } = await systemData.enumerateBucketChildren(id);
    if (children.length === 0) {
      return { ok: true, bucketId: def.id, dryRun: false, freedBytes: 0, removedCount: 0, results: [] };
    }
    const { safety } = settings.get();
    const dryRun = !!safety?.dryRun;
    const paths = children.map((c) => c.path);
    const results = await trashItems(paths, { dryRun });

    const bytesByPath = new Map(children.map((c) => [c.path, c.bytes]));
    const succeeded = results.filter((r) => r.ok).map((r) => ({ path: r.path, bytes: bytesByPath.get(r.path) || 0 }));
    const freedBytes = succeeded.reduce((s, it) => s + (it.bytes || 0), 0);

    if (!dryRun && succeeded.length > 0) {
      history.record({ scope: 'system-data', dryRun: false, restorable: true, items: succeeded });
      if (freedBytes > 0) { try { settings.recordCleaned('system-data', freedBytes); } catch { /* non-fatal */ } }
    }
    return { ok: results.every((r) => r.ok), bucketId: def.id, dryRun, freedBytes, removedCount: succeeded.length, results };
  });

  // Run a bucket's curated SAFE reclaim command (docker system prune -f,
  // xcrun simctl delete unavailable). The renderer sends only a bucket id;
  // the actual command is fixed in the scanner's bucketDefs and run via
  // execFile (no shell). The aggressive docker variant is never run here.
  ipcMain.handle('system-data:reclaim-run', async (_event, id) => {
    const { safety } = settings.get();
    const dryRun = !!safety?.dryRun;
    const result = await systemData.runReclaim(id, { dryRun });
    if (result.ok && !dryRun) {
      try {
        history.record({
          scope: 'system-data-reclaim',
          dryRun: false,
          restorable: false,
          items: [{ path: result.command, bytes: 0 }],
        });
      } catch { /* non-fatal */ }
    }
    return result;
  });

  // Read-only usage preview for a reclaim command (e.g. `docker system df`).
  ipcMain.handle('system-data:reclaim-preview', async (_event, id) => {
    return systemData.reclaimPreview(id);
  });

  // Delete local Time Machine snapshots by date id. Permanent (snapshots
  // can't go to Trash), but safe — they regenerate and your real backups
  // are untouched. Honors the global dry-run toggle and logs a
  // non-restorable history entry.
  ipcMain.handle('system-data:delete-snapshots', async (_event, ids) => {
    const { safety } = settings.get();
    const dryRun = !!safety?.dryRun;
    const result = await systemData.deleteLocalSnapshots(ids, { dryRun });
    if (!dryRun) {
      const deleted = result.results.filter((r) => r.ok).map((r) => ({ path: `snapshot ${r.id}`, bytes: 0 }));
      if (deleted.length > 0) {
        try { history.record({ scope: 'system-data-snapshots', dryRun: false, restorable: false, items: deleted }); } catch { /* non-fatal */ }
      }
    }
    return result;
  });

  // Phase 10 — Mac Health snapshot.
  ipcMain.handle('health:get', async () => getHealth());

  // Full categorized system report (opened from the sidebar info card).
  ipcMain.handle('system:report', async () => getSystemReport());

  // Phase 15 — Performance: live process list + kill.
  ipcMain.handle('processes:list', async (_event, opts) => listProcesses(opts || {}));
  ipcMain.handle('processes:kill', async (_event, args) => {
    const pid = args?.pid;
    const force = !!args?.force;
    return killProcess(pid, { force });
  });

  // Phase 16 — Empty Trash. Inspecting is always free; emptying is the
  // one permanently-destructive action, gated by a confirm in the UI and
  // the global dry-run safety toggle here.
  ipcMain.handle('trash:info', async () => getTrashInfo());
  ipcMain.handle('trash:empty', async () => {
    const { safety } = settings.get();
    const result = await emptyTrash({ dryRun: !!safety?.dryRun });
    // Record reclaimed space so the tray + Mac Health history stay honest.
    if (!result.dryRun && result.freedBytes > 0) {
      try { settings.recordCleaned('trash', result.freedBytes); } catch { /* non-fatal */ }
      // Log to history as a NON-restorable entry — emptying is permanent.
      try {
        history.record({
          scope: 'trash',
          dryRun: false,
          restorable: false,
          items: (result.removed || []).map((r) => ({ path: r.name, bytes: r.bytes })),
        });
      } catch { /* non-fatal */ }
    }
    return result;
  });

  // Cleanup history + restore.
  ipcMain.handle('history:list', async () => history.list());
  ipcMain.handle('history:restore', async (_event, id) => history.restore(id));
  ipcMain.handle('history:clear', async () => history.clear());
}

module.exports = { registerIpcHandlers };
