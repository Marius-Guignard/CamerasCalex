const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { Tuya } = require('./tuya');
const recorder = require('./recorder');
const { autoUpdater } = require('electron-updater');

let win;
let tuya = null;
let devices = [];

const cfgFile = () => path.join(app.getPath('userData'), 'config.json');

function defaults() {
  return {
    accessId: '',
    accessSecret: '',
    baseUrl: 'https://openapi-weaz.tuyaeu.com', // Western Europe
    recordFolder: path.join(app.getPath('videos'), 'CamerasCalex'),
    segmentHours: 24,
    retentionDays: 3,
    autoRecord: [],
    hiddenDevices: []
  };
}

function loadConfig() {
  try {
    return { ...defaults(), ...JSON.parse(fs.readFileSync(cfgFile(), 'utf8')) };
  } catch (e) {
    return defaults();
  }
}

function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(cfgFile()), { recursive: true });
  fs.writeFileSync(cfgFile(), JSON.stringify(cfg, null, 2));
}

function getTuya() {
  const cfg = loadConfig();
  if (!tuya || tuya.id !== cfg.accessId.trim() || tuya.base !== cfg.baseUrl.trim().replace(/\/$/, '')) {
    tuya = new Tuya(cfg);
  }
  return tuya;
}

function sendStatus(deviceId, status) {
  if (win && !win.isDestroyed()) win.webContents.send('record-status', { deviceId, status });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 760,
    backgroundColor: '#14161a',
    title: 'Mes caméras Calex',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false // le flux vidéo vient d'un autre serveur
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'index.html'));
}

function setupUpdates() {
  if (!app.isPackaged) return; // pas de mise à jour en mode développement
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  let firstCheck = true;
  autoUpdater.on('update-available', () => {
    if (win && !win.isDestroyed()) win.webContents.send('update-status', 'Mise à jour en cours de téléchargement…');
  });
  autoUpdater.on('update-downloaded', () => {
    // Au démarrage : on installe tout de suite. Ensuite : à la prochaine fermeture.
    if (firstCheck) {
      firstCheck = false;
      recorder.stopAll();
      autoUpdater.quitAndInstall();
    }
  });
  autoUpdater.on('error', () => { /* pas d'internet ou pas de version : on continue */ });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(() => { firstCheck = false; check(); }, 6 * 3600 * 1000);
}

app.whenReady().then(() => {
  createWindow();
  setupUpdates();
});
app.on('window-all-closed', () => {
  recorder.stopAll();
  app.quit();
});

ipcMain.handle('config:get', () => loadConfig());

ipcMain.handle('config:set', (_e, cfg) => {
  recorder.stopAll(); // les nouveaux réglages s'appliquent au prochain démarrage
  saveConfig({ ...loadConfig(), ...cfg });
  tuya = null;
  return true;
});

ipcMain.handle('devices:list', async () => {
  const all = await getTuya().listDevices();
  const cams = all.filter((d) => d.category === 'sp');
  const hidden = loadConfig().hiddenDevices || [];
  devices = (cams.length ? cams : all).filter((d) => !hidden.includes(d.id));
  // Enregistrement automatique de toutes les caméras, dans le dossier choisi
  const cfg = loadConfig();
  for (const d of devices) recorder.start(d, getTuya(), cfg, sendStatus);
  return devices;
});

ipcMain.handle('stream:get', async (_e, deviceId, type) => getTuya().getStreamUrl(deviceId, type || 'hls'));

const DIRS = { up: '0', right: '2', down: '4', left: '6' };
ipcMain.handle('ptz', async (_e, { deviceId, dir }) => {
  const t = getTuya();
  await t.sendCommands(deviceId, [{ code: 'ptz_control', value: DIRS[dir] }]);
  setTimeout(() => {
    t.sendCommands(deviceId, [{ code: 'ptz_stop', value: true }]).catch(() => {});
  }, 500);
  return true;
});

ipcMain.handle('record:start', (_e, deviceId) => {
  const device = devices.find((d) => d.id === deviceId);
  if (!device) throw new Error('Caméra inconnue : actualise la liste.');
  const cfg = loadConfig();
  recorder.start(device, getTuya(), cfg, sendStatus);
  if (!cfg.autoRecord.includes(deviceId)) {
    cfg.autoRecord.push(deviceId);
    saveConfig(cfg);
  }
  return true;
});

ipcMain.handle('record:stop', (_e, deviceId) => {
  recorder.stop(deviceId, sendStatus);
  const cfg = loadConfig();
  cfg.autoRecord = cfg.autoRecord.filter((id) => id !== deviceId);
  saveConfig(cfg);
  return true;
});

ipcMain.handle('record:isOn', (_e, deviceId) => recorder.isRecording(deviceId));

ipcMain.handle('record:resumeAuto', () => {
  const cfg = loadConfig();
  for (const id of cfg.autoRecord) {
    const device = devices.find((d) => d.id === id);
    if (device) recorder.start(device, getTuya(), cfg, sendStatus);
  }
  return true;
});

ipcMain.handle('device:hide', (_e, deviceId) => {
  // Retire la caméra de l'appli (elle reste dans Smart Life, les vidéos restent dans le dossier)
  recorder.stop(deviceId, sendStatus);
  const cfg = loadConfig();
  cfg.hiddenDevices = Array.from(new Set([...(cfg.hiddenDevices || []), deviceId]));
  cfg.autoRecord = (cfg.autoRecord || []).filter((id) => id !== deviceId);
  saveConfig(cfg);
  devices = devices.filter((d) => d.id !== deviceId);
  return true;
});

ipcMain.handle('device:unhideAll', () => {
  const cfg = loadConfig();
  cfg.hiddenDevices = [];
  saveConfig(cfg);
  return true;
});

ipcMain.handle('files:list', (_e, deviceId) => {
  const device = devices.find((d) => d.id === deviceId);
  if (!device) return [];
  const cfg = loadConfig();
  const prefix = recorder.safeName(device.name) + '_';
  try {
    return fs.readdirSync(cfg.recordFolder)
      .filter((f) => f.startsWith(prefix) && f.endsWith('.mp4'))
      .map((f) => {
        const full = path.join(cfg.recordFolder, f);
        const st = fs.statSync(full);
        return { name: f, url: pathToFileURL(full).href, size: st.size, mtime: st.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 40);
  } catch (e) {
    return [];
  }
});

ipcMain.handle('folder:open', () => {
  const cfg = loadConfig();
  fs.mkdirSync(cfg.recordFolder, { recursive: true });
  shell.openPath(cfg.recordFolder);
  return true;
});

ipcMain.handle('folder:choose', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
