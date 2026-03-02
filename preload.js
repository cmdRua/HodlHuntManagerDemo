const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  activateLicense: (key)  => ipcRenderer.invoke('activate-license', key),
  getLicenseError: ()     => ipcRenderer.invoke('get-license-error'),
  saveConfig:      (rpc, pk, early) => ipcRenderer.invoke('save-config', rpc, pk, early),
  getEnvPath:      ()     => ipcRenderer.invoke('get-env-path'),
  openEnvFolder:   ()     => ipcRenderer.invoke('open-env-folder'),
  openExternal:    (url)  => ipcRenderer.invoke('open-external', url),
  getConfig:   ()             => ipcRenderer.invoke('get-config'),
  scanOcean:   ()             => ipcRenderer.invoke('scan-ocean'),
  placeMark:   (h, p, skipWait=false) => ipcRenderer.invoke('place-mark', h, p, skipWait),
  huntFish:    (h, p, skipWait=false, singleShot=false) => ipcRenderer.invoke('hunt-fish', h, p, skipWait, singleShot),
  fetchFish:   (pk)           => ipcRenderer.invoke('fetch-fish', pk),
  getWalletBalance: ()        => ipcRenderer.invoke('get-wallet-balance'),
  cancelTx:         ()        => ipcRenderer.invoke('cancel-tx'),
  onLog:       (cb)           => ipcRenderer.on('log', (_, data) => cb(data)),
  removeLog:   ()             => ipcRenderer.removeAllListeners('log'),
});
