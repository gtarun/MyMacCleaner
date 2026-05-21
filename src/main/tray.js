// Menu bar (Tray) companion.
//
// Lets the user:
//   - See last-known reclaimable bytes at a glance (title next to icon)
//   - Open / show the main window
//   - Trigger a scheduled scan without opening the window
//   - Jump straight to a specific tab
//   - Quit the whole app (Cmd+Q in the main window still quits)
//
// Closing the main window only hides it; the tray keeps the app alive
// so the scheduler can fire even when no window is showing. Cmd+Q or
// Quit from the tray menu actually quits.

const path = require('node:path');
const fs = require('node:fs');
const { Tray, Menu, nativeImage, app } = require('electron');
const settings = require('./settings');
const scheduler = require('./scheduler');

let tray = null;
let getWindow = () => null;
let setActiveTab = () => {};

function formatBytes(bytes) {
  if (bytes == null || isNaN(bytes) || bytes < 1) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let n = bytes / 1024, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  const fixed = n < 10 ? n.toFixed(1) : Math.round(n);
  return `${fixed} ${units[i]}`;
}

function loadIcon() {
  // Try the packaged path first (next to the app), fall back to the
  // build/ folder during dev. If neither exists (user hasn't run
  // build:icon yet), use a tiny empty image — macOS will show the
  // app name as a text-only menu bar entry.
  const candidates = [
    path.join(process.resourcesPath || '', 'build', 'trayTemplate.png'),
    path.join(__dirname, '..', '..', 'build', 'trayTemplate.png'),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) {
      const img = nativeImage.createFromPath(p);
      img.setTemplateImage(true);
      return img;
    }
  }
  // Empty image fallback so Tray still constructs without throwing.
  return nativeImage.createEmpty();
}

function buildMenu() {
  const s = settings.get();
  const lastResults = s.lastResults || {};
  const totalBytes = Object.values(lastResults)
    .map((r) => r?.totalBytes || r?.reclaimable || 0)
    .reduce((a, b) => a + b, 0);
  const lastRun = s.schedule?.lastRunAt;

  return Menu.buildFromTemplate([
    {
      label: totalBytes > 0
        ? `${formatBytes(totalBytes)} reclaimable`
        : 'No scan results yet',
      enabled: false,
    },
    lastRun ? {
      label: `Last scan: ${new Date(lastRun).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`,
      enabled: false,
    } : { label: 'Last scan: never', enabled: false },
    { type: 'separator' },
    {
      label: 'Open MacCleaner',
      accelerator: 'CmdOrCtrl+Shift+M',
      click: () => showWindow(),
    },
    {
      label: 'Run scheduled scan',
      click: () => { scheduler.runNow().catch(() => {}); },
    },
    { type: 'separator' },
    { label: 'Dashboard',  click: () => showWindow('dashboard') },
    { label: 'Mac Health', click: () => showWindow('mac-health') },
    { label: 'System Junk', click: () => showWindow('system-junk') },
    { type: 'separator' },
    {
      label: 'Quit MacCleaner',
      accelerator: 'CmdOrCtrl+Q',
      click: () => { app.isQuitting = true; app.quit(); },
    },
  ]);
}

function refresh() {
  if (!tray) return;
  tray.setContextMenu(buildMenu());
  const s = settings.get();
  const totalBytes = Object.values(s.lastResults || {})
    .map((r) => r?.totalBytes || r?.reclaimable || 0)
    .reduce((a, b) => a + b, 0);
  // Compact text next to the icon. Empty = icon only.
  tray.setTitle(totalBytes > 0 ? ` ${formatBytes(totalBytes)}` : '');
  tray.setToolTip(totalBytes > 0
    ? `MacCleaner — ${formatBytes(totalBytes)} reclaimable`
    : 'MacCleaner');
}

function showWindow(tabId) {
  const win = getWindow();
  if (!win) return;
  if (!win.isVisible()) win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
  if (tabId) {
    // Renderer listens on this channel and switches activeId.
    if (!win.isDestroyed()) win.webContents.send('tray:navigate', tabId);
  }
}

function create({ windowGetter, onNavigate }) {
  if (tray) return tray;
  getWindow = windowGetter || (() => null);
  setActiveTab = onNavigate || (() => {});
  tray = new Tray(loadIcon());
  refresh();
  tray.on('click', () => showWindow());
  return tray;
}

function destroy() {
  if (tray) { tray.destroy(); tray = null; }
}

module.exports = { create, refresh, destroy, showWindow };
