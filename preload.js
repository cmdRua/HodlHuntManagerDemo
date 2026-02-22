'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  scanOcean:    ()        => ipcRenderer.invoke('scan-ocean'),
  openExternal: (url)     => ipcRenderer.invoke('open-external', url),
  onLog:        (cb)      => ipcRenderer.on('log', (_, d) => cb(d)),
});
