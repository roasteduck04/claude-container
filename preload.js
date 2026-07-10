const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('containerAPI', {
  getState: () => ipcRenderer.invoke('get-state'),
  switchContainer: (id) => ipcRenderer.invoke('switch-container', id),
  addContainer: (data) => ipcRenderer.invoke('add-container', data),
  renameContainer: (data) => ipcRenderer.invoke('rename-container', data),
  removeContainer: (id) => ipcRenderer.invoke('remove-container', id),
  unloadContainer: (id) => ipcRenderer.invoke('unload-container', id),
  reloadActive: () => ipcRenderer.invoke('reload-active'),
  openOverlay: () => ipcRenderer.invoke('overlay-open'),
  closeOverlay: () => ipcRenderer.invoke('overlay-close'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (patch) => ipcRenderer.invoke('save-settings', patch),
  onStateChanged: (callback) => {
    ipcRenderer.on('state-changed', (_e, snapshot) => callback(snapshot));
  },
  onOpenSettings: (callback) => {
    ipcRenderer.on('open-settings', () => callback());
  },
});
