'use strict';
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');

app.setName('HodlHunt Demo');
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }
app.on('second-instance', () => {
  const all = BrowserWindow.getAllWindows();
  if (all.length) { if (all[0].isMinimized()) all[0].restore(); all[0].focus(); }
});

let win;

function openMainWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600,
    backgroundColor: '#080b0f',
    title: 'HodlHunt Demo',
    icon: path.join(__dirname, 'renderer', 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    show: false,
  });
  win.setMenu(null);
  win.webContents.session.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com 'self'; media-src 'self';"
    ]}});
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; app.quit(); });
  win.webContents.on('before-input-event', (event, input) => {
    if ((input.control || input.meta) && input.shift && input.key === 'I') event.preventDefault();
    if (input.key === 'F12') event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(openMainWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) openMainWindow(); });

// ── IPC ───────────────────────────────────────────────────────────────────
ipcMain.handle('get-config', () => ({
  rpcUrl:     'https://api.mainnet-beta.solana.com',
  earlyStart: 5,
  hasPk:      false,
}));

ipcMain.handle('open-external', (_, url) => { shell.openExternal(url); });

const solana = require('./src/solana');
ipcMain.handle('scan-ocean',   async ()     => solana.scanOcean());
ipcMain.handle('fetch-fish',   async (_, pk) => solana.fetchFish(pk));

// Заглушки — в demo не нужны но preload их объявляет
ipcMain.handle('get-wallet-balance', async () => ({ sol: '—', addr: '—' }));
ipcMain.handle('cancel-tx',    () => {});
ipcMain.handle('place-mark',   async () => { throw new Error('Demo версия'); });
ipcMain.handle('hunt-fish',    async () => { throw new Error('Demo версия'); });

solana.onLog((msg, type) => { if (win) win.webContents.send('log', { msg, type }); });
