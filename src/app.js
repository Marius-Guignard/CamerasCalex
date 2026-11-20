const $ = (id) => document.getElementById(id);
const tiles = new Map(); // deviceId -> { hls, video, recEl }

function say(text, ok = false) {
  $('msg').textContent = text || '';
  $('msg').className = 'msg' + (ok ? ' ok' : '');
}

function layout(n) {
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  $('grid').style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  $('grid').style.gridTemplateRows = `repeat(${rows}, 1fr)`;
}

function setRec(deviceId, status) {
  const t = tiles.get(deviceId);
  if (!t) return;
  const on = status === 'Enregistrement en cours';
  t.recEl.className = 'rec' + (on ? ' on' : '');
  t.recEl.innerHTML = `<i></i>${on ? 'REC' : status}`;
}

async function startPlayer(device, tile) {
  try {
    const url = await window.api.getStream(device.id);
    if (tile.hls) { tile.hls.destroy(); tile.hls = null; }
    if (window.Hls && Hls.isSupported()) {
      tile.hls = new Hls({ lowLatencyMode: true });
      tile.hls.loadSource(url);
      tile.hls.attachMedia(tile.video);
      tile.hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) setTimeout(() => startPlayer(device, tile), 5000);
      });
    } else {
      tile.video.src = url;
    }
    tile.video.play().catch(() => {});
    say('');
  } catch (e) {
    say(e.message + '\n(Vérifie que « IoT Video Live Stream » est bien autorisé sur ton projet Tuya.)');
    setTimeout(() => startPlayer(device, tile), 30000);
  }
}

async function refresh() {
  say('Chargement des caméras…', true);
  try {
    const devices = await window.api.listDevices(); // l'enregistrement démarre tout seul
    for (const t of tiles.values()) if (t.hls) t.hls.destroy();
    tiles.clear();
    $('grid').innerHTML = '';
    if (!devices.length) {
      say("Aucune caméra trouvée. Vérifie que Smart Life est bien lié à ton projet Tuya.");
      return;
    }
    layout(devices.length);
    for (const d of devices) {
      const el = document.createElement('div');
      el.className = 'tile';
      el.innerHTML = `<video muted autoplay playsinline></video><div class="name"></div><div class="rec"><i></i>…</div>`;
      el.querySelector('.name').textContent = d.name;
      $('grid').appendChild(el);
      const tile = { hls: null, video: el.querySelector('video'), recEl: el.querySelector('.rec') };
      tiles.set(d.id, tile);
      startPlayer(d, tile);
    }
    say('');
  } catch (e) {
    say(e.message);
  }
}

window.api.onUpdate((text) => say(text, true));
window.api.onRecordStatus(({ deviceId, status }) => setRec(deviceId, status));

// Réglages
async function openSettings() {
  const c = await window.api.getConfig();
  $('accessId').value = c.accessId;
  $('accessSecret').value = c.accessSecret;
  $('baseUrl').value = c.baseUrl;
  $('recordFolder').value = c.recordFolder;
  $('segmentHours').value = c.segmentHours;
  $('retentionDays').value = c.retentionDays;
  $('settings').classList.remove('hidden');
}
$('openSettings').onclick = openSettings;
$('closeSettings').onclick = () => $('settings').classList.add('hidden');
$('chooseFolder').onclick = async () => {
  const f = await window.api.chooseFolder();
  if (f) $('recordFolder').value = f;
};
$('saveSettings').onclick = async () => {
  await window.api.setConfig({
    accessId: $('accessId').value.trim(),
    accessSecret: $('accessSecret').value.trim(),
    baseUrl: $('baseUrl').value,
    recordFolder: $('recordFolder').value.trim(),
    segmentHours: Number($('segmentHours').value) || 24,
    retentionDays: Number($('retentionDays').value) || 0
  });
  $('settings').classList.add('hidden');
  refresh();
};

(async () => {
  const c = await window.api.getConfig();
  if (!c.accessId || !c.accessSecret) openSettings();
  else refresh();
})();
