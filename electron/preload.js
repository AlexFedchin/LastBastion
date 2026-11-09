const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bastion', {
  isElectron: true,
  quit: () => ipcRenderer.send('app:quit'),
  setFullscreen: (value) => ipcRenderer.send('app:fullscreen', value),
  isFullscreen: () => ipcRenderer.invoke('app:isFullscreen'),
  // bytes of a file under app/audio (file:// pages cannot fetch())
  readAsset: (rel) => ipcRenderer.invoke('app:readAsset', rel),
});
