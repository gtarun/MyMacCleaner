// Central registry for IPC handlers.
//
// The renderer can ONLY reach the main process through the channels listed
// here. Every new scanner/feature should register its handlers in this file
// so the surface stays small and auditable.

const os = require('node:os');
const { ipcMain, app, dialog, BrowserWindow } = require('electron');
const { scanSystemJunk } = require('./scanners/system-junk');
const { listApps } = require('./scanners/apps');
const { findLeftovers } = require('./scanners/uninstaller');
const { scanLargeOld } = require('./scanners/large-old');
const { scanDuplicates } = require('./scanners/duplicates');
const { trashItems } = require('./safety/trash');
const { validatePickedRoot, addRuntimeAllowedRoot, listRuntimeAllowedRoots } = require('./safety/allowlist');
const settings = require('./settings');
const { getHealth } = require('./health');
const { listProcesses, killProcess } = require('./processes');
const scheduler = require('./scheduler');
const tray = require('./tray');

// On boot, replay any persisted Duplicates roots into the runtime
// allowlist so the safety gate accepts files inside them without the
// user re-picking. Each one still passes through validatePickedRoot to
// catch any that became unsafe between sessions (e.g. user moved their
// home dir).
function restorePersistedRoots() {
  const { duplicates } = settings.get();
  if (!Array.isArray(duplicates?.roots)) return;
  for (const root of duplicates.roots) {
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
  ipcMain.handle('clean:trash-items', async (_event, paths) => {
    if (!Array.isArray(paths)) {
      throw new Error('clean:trash-items expects an array of paths');
    }
    const { safety } = settings.get();
    return trashItems(paths, { dryRun: !!safety?.dryRun });
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

  ipcMain.handle('scan:duplicates', async (event, opts) => {
    return scanDuplicates({
      ...(opts || {}),
      onProgress: progressEmitter(event, 'duplicates'),
    });
  });

  // Phase 10 — Mac Health snapshot.
  ipcMain.handle('health:get', async () => getHealth());

  // Phase 15 — Performance: live process list + kill.
  ipcMain.handle('processes:list', async (_event, opts) => listProcesses(opts || {}));
  ipcMain.handle('processes:kill', async (_event, args) => {
    const pid = args?.pid;
    const force = !!args?.force;
    return killProcess(pid, { force });
  });
}

module.exports = { registerIpcHandlers };
