// Preload script — bridges the sandboxed renderer to the main process.
//
// IMPORTANT: only expose function wrappers, never `ipcRenderer` itself. If we
// ever leaked `ipcRenderer.send` to the renderer, a compromised page could
// invoke any IPC channel. The contextBridge boundary is our defense.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // --- Handshake ---
  getSystemInfo: () => ipcRenderer.invoke('system:info'),
  getSystemReport: () => ipcRenderer.invoke('system:report'),

  // --- Scans (return a single result object; no streaming yet) ---
  scanSystemJunk: () => ipcRenderer.invoke('scan:system-junk'),

  // --- Uninstaller ---
  listApps: () => ipcRenderer.invoke('apps:list'),
  findLeftovers: (bundleId, appName) =>
    ipcRenderer.invoke('apps:leftovers', { bundleId, appName }),

  // --- Large & Old Files ---
  scanLargeOld: (opts) => ipcRenderer.invoke('scan:large-old', opts || {}),

  // --- Duplicates ---
  pickFolders: () => ipcRenderer.invoke('dialog:pick-folders'),
  listPickedRoots: () => ipcRenderer.invoke('dialog:list-picked-roots'),
  // Side-effect-free picker for choosing exclusion folders.
  pickPaths: () => ipcRenderer.invoke('dialog:pick-paths'),
  scanDuplicates: (roots) => ipcRenderer.invoke('scan:duplicates', { roots }),

  // --- Stale projects (reuses picked roots) ---
  scanStaleProjects: (roots) => ipcRenderer.invoke('scan:stale-projects', { roots }),

  // --- Leftover installers (~/Downloads) ---
  scanInstallers: (opts) => ipcRenderer.invoke('scan:installers', opts || {}),

  // --- Disk space visualizer ---
  scanDiskMap: (opts) => ipcRenderer.invoke('scan:disk-map', opts || {}),

  // --- System Data explorer ---
  scanSystemData: () => ipcRenderer.invoke('scan:system-data'),
  clearSystemDataBucket: (id) => ipcRenderer.invoke('system-data:clear-bucket', id),
  deleteLocalSnapshots: (ids) => ipcRenderer.invoke('system-data:delete-snapshots', ids),
  runSystemDataReclaim: (id) => ipcRenderer.invoke('system-data:reclaim-run', id),
  previewSystemDataReclaim: (id) => ipcRenderer.invoke('system-data:reclaim-preview', id),

  // --- Cleanup (the only path that mutates disk) ---
  // `meta` is optional: { scope, items:[{path,bytes}] } enables accurate
  // history logging. Falls back to a bare paths array when omitted.
  trashItems: (paths, meta) =>
    ipcRenderer.invoke('clean:trash-items',
      meta ? { paths, scope: meta.scope, items: meta.items } : paths),

  // --- Cleanup history + restore ---
  getHistory:     () => ipcRenderer.invoke('history:list'),
  restoreHistory: (id) => ipcRenderer.invoke('history:restore', id),
  clearHistory:   () => ipcRenderer.invoke('history:clear'),

  // --- Streaming progress (subscribe once, filter by payload.scope) ---
  // Returns an unsubscribe function. The renderer must call it on
  // useEffect cleanup so we don't leak listeners.
  onScanProgress: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('scan:progress', listener);
    return () => ipcRenderer.removeListener('scan:progress', listener);
  },

  // --- Mac Health ---
  getHealth: () => ipcRenderer.invoke('health:get'),

  // --- Performance / processes ---
  listProcesses: (opts) => ipcRenderer.invoke('processes:list', opts || {}),
  killProcess:   (pid, force) => ipcRenderer.invoke('processes:kill', { pid, force }),

  // --- Trash bin ---
  getTrashInfo: () => ipcRenderer.invoke('trash:info'),
  emptyTrash:   () => ipcRenderer.invoke('trash:empty'),

  // --- Settings ---
  getSettings:    ()      => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  onSettingsChanged: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('settings:changed', listener);
    return () => ipcRenderer.removeListener('settings:changed', listener);
  },

  // --- Scheduler ---
  runScheduledScan: () => ipcRenderer.invoke('scheduler:run-now'),
  onScheduledResult: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('scan:scheduled-result', listener);
    return () => ipcRenderer.removeListener('scan:scheduled-result', listener);
  },

  // --- Tray navigation (tray menu items send this) ---
  onTrayNavigate: (cb) => {
    const listener = (_e, tabId) => cb(tabId);
    ipcRenderer.on('tray:navigate', listener);
    return () => ipcRenderer.removeListener('tray:navigate', listener);
  },

  // --- Onboarding ---
  requestFolderAccess: () => ipcRenderer.invoke('onboarding:request-folder-access'),

  // --- External links (http/https only, enforced in main) ---
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),

  // --- Reveal a file/folder in Finder (read-only; selects, never opens) ---
  showInFinder: (path) => ipcRenderer.invoke('shell:show-in-folder', path),
});
