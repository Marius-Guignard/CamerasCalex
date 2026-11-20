const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (cfg) => ipcRenderer.invoke('config:set', cfg),
  listDevices: () => ipcRenderer.invoke('devices:list'),
  getStream: (id, type) => ipcRenderer.invoke('stream:get', id, type),
  ptz: (deviceId, dir) => ipcRenderer.invoke('ptz', { deviceId, dir }),
  startRecord: (id) => ipcRenderer.invoke('record:start', id),
  stopRecord: (id) => ipcRenderer.invoke('record:stop', id),
  isRecording: (id) => ipcRenderer.invoke('record:isOn', id),
  resumeAuto: () => ipcRenderer.invoke('record:resumeAuto'),
  hideDevice: (id) => ipcRenderer.invoke('device:hide', id),
  unhideAll: () => ipcRenderer.invoke('device:unhideAll'),
  listFiles: (id) => ipcRenderer.invoke('files:list', id),
  openFolder: () => ipcRenderer.invoke('folder:open'),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  onUpdate: (cb) => ipcRenderer.on('update-status', (_e, text) => cb(text)),
  onRecordStatus: (cb) => ipcRenderer.on('record-status', (_e, data) => cb(data))
});
