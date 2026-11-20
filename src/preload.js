const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (cfg) => ipcRenderer.invoke('config:set', cfg),
  listDevices: () => ipcRenderer.invoke('devices:list'),
  getStream: (id) => ipcRenderer.invoke('stream:get', id),
  ptz: (deviceId, dir) => ipcRenderer.invoke('ptz', { deviceId, dir }),
  startRecord: (id) => ipcRenderer.invoke('record:start', id),
  stopRecord: (id) => ipcRenderer.invoke('record:stop', id),
  isRecording: (id) => ipcRenderer.invoke('record:isOn', id),
  resumeAuto: () => ipcRenderer.invoke('record:resumeAuto'),
  openFolder: () => ipcRenderer.invoke('folder:open'),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  onUpdate: (cb) => ipcRenderer.on('update-status', (_e, text) => cb(text)),
  onRecordStatus: (cb) => ipcRenderer.on('record-status', (_e, data) => cb(data))
});
