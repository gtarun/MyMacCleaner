// MacCleaner — Electron main process entrypoint.
//
// Owns all filesystem access. The renderer is sandboxed and can only reach
// here via the narrow IPC surface defined in ipc.js.

const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { registerIpcHandlers } = require('./ipc');
const scheduler = require('./scheduler');
const tray = require('./tray');

const isDev = process.env.NODE_ENV === 'development';

// We hold onto the main window so the tray can show/hide it without
// recreating. The window is hidden (not destroyed) when the user closes
// it, so the scheduler keeps running with the tray icon as the only
// visible surface.
let mainWindow = null;

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0c10',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  }

  // Close button → hide to tray instead of destroying. Cmd+Q sets
  // app.isQuitting first, which lets the close through and shuts down.
  win.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });

  mainWindow = win;
  return win;
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createMainWindow();
  scheduler.start();
  // Tray needs a way to reach the window. We hand it a getter so it
  // doesn't capture a stale reference if we ever recreate the window.
  tray.create({
    windowGetter: () => mainWindow,
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

// Cmd+Q / explicit quit → shut everything down.
app.on('before-quit', () => { app.isQuitting = true; });

// On macOS we DON'T quit when the last window closes — the tray keeps
// the app alive in the menu bar. The user explicitly quits via Cmd+Q
// or the tray's Quit menu item.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
