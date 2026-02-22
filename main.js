'use strict';
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs   = require('fs');

app.setName('HodlHunt Demo');
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }
app.on('second-instance', () => {
  const all = BrowserWindow.getAllWindows();
  if (all.length) { if (all[0].isMinimized()) all[0].restore(); all[0].focus(); }
});

function getEnvPath() { return path.join(app.getPath('userData'), '.env.demo'); }

function ensureEnvFile() {
  const envPath = getEnvPath();
  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath,
      'RPC_URL=https://api.mainnet-beta.solana.com\n',
      'utf8'
    );
  }
  require('dotenv').config({ path: envPath, override: true });
}

let win;
const solana = require('./src/solana');

function createWindow() {
  ensureEnvFile();
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600,
    backgroundColor: '#080b0f',
    title: 'HodlHunt Manager — ДЕМО',
    icon: path.join(__dirname, 'renderer', 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    show: false,
  });
  win.setMenu(null);
  win.webContents.session.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self';"
    ]}});
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; app.quit(); });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ── IPC ───────────────────────────────────────────────────────────────────
ipcMain.handle('scan-ocean',    async () => solana.scanOcean());
ipcMain.handle('open-external', (_, url) => { shell.openExternal(url); });

solana.onLog((msg, type) => { if (win) win.webContents.send('log', { msg, type }); });
