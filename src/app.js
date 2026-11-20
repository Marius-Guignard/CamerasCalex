const $ = (id) => document.getElementById(id);
let devices = [];
let current = null;
let hls = null;
let flv = null;
const recState = {};

function say(text, ok = false) {
  $('msg').textContent = text || '';
  $('msg').className = 'msg' + (ok ? ' ok' : '');
}

function recLabel(deviceId) {
  const s = recState[deviceId];
  if (!s) return { text: 'Enregistrement : démarrage…', cls: '' };
  if (s === 'Enregistrement en cours') return { text: 'Enregistrement en cours', cls: 'rec' };
  return { text: s, cls: '' };
}

// Écran d'accueil : on choisit la caméra, rien ne s'affiche tant qu'on n'a pas cliqué
function renderList() {
  const box = $('list');
  box.innerHTML = '';
  for (const d of devices) {
    const r = recLabel(d.id);
    const el = document.createElement('div');
    el.className = 'card-cam';
    el.innerHTML = `<div class="n"></div>
      <div class="s"><span class="dot ${d.online ? 'on' : ''}"></span>${d.online ? 'En ligne' : 'Hors ligne'}</div>
      <div class="s"><span class="dot ${r.cls}"></span><span class="rt"></span></div>`;
    el.querySelector('.n').textContent = d.name;
    el.querySelector('.rt').textContent = r.text;
    el.onclick = () => openCamera(d);
    box.appendChild(el);
  }
}

function updateViewerRec() {
  if (!current) return;
  const r = recLabel(current.id);
  $('camRec').innerHTML = `<span class="dot ${r.cls}"></span>${r.text}`;
}

function stopPlayer() {
  if (hls) { hls.destroy(); hls = null; }
  if (flv) { try { flv.destroy(); } catch (e) { /* ignore */ } flv = null; }
  const v = $('video');
  v.removeAttribute('src');
  v.load();
}

// Lecture HLS (plus décalée) : sert de solution de secours
async function playHls(device) {
  const url = await window.api.getStream(device.id, 'hls');
  if (!current || current.id !== device.id) return;
  stopPlayer();
  const v = $('video');
  if (window.Hls && Hls.isSupported()) {
    hls = new Hls({
      lowLatencyMode: true,
      liveSyncDurationCount: 1,
      liveMaxLatencyDurationCount: 3,
      maxLiveSyncPlaybackRate: 1.5,
      backBufferLength: 5
    });
    hls.loadSource(url);
    hls.attachMedia(v);
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (data.fatal) setTimeout(() => { if (current && current.id === device.id) startPlayer(device); }, 5000);
    });
  } else {
    v.src = url;
  }
  v.play().catch(() => {});
}

// Lecture FLV : image presque en temps réel (1 à 3 secondes de décalage)
async function playFlv(device) {
  const url = await window.api.getStream(device.id, 'flv');
  if (!current || current.id !== device.id) return;
  stopPlayer();
  const v = $('video');
  flv = mpegts.createPlayer(
    { type: 'flv', isLive: true, url, hasAudio: false },
    {
      enableWorker: true,
      enableStashBuffer: false,
      stashInitialSize: 128,
      liveBufferLatencyChasing: true,
      liveBufferLatencyMaxLatency: 2.5,
      liveBufferLatencyMinRemain: 0.4,
      lazyLoadMaxDuration: 5
    }
  );
  flv.on(mpegts.Events.ERROR, () => {
    // Si le flux direct échoue, on bascule sur la solution de secours
    if (current && current.id === device.id) playHls(device).catch((e) => say(e.message));
  });
  flv.attachMediaElement(v);
  flv.load();
  v.play().catch(() => {});
}

async function startPlayer(device) {
  try {
    if (window.mpegts && mpegts.isSupported()) {
      try {
        await playFlv(device);
      } catch (e) {
        await playHls(device);
      }
    } else {
      await playHls(device);
    }
    say('');
  } catch (e) {
    say(e.message + '\n(Vérifie que « IoT Video Live Stream » est bien autorisé sur ton projet Tuya.)');
  }
}

function openCamera(d) {
  current = d;
  $('home').classList.add('hidden');
  $('viewer').classList.remove('hidden');
  $('openSettings').classList.add('hidden');
  $('camName').textContent = d.name;
  updateViewerRec();
  say('Connexion au flux vidéo…', true);
  startPlayer(d);
}

$('back').onclick = () => {
  current = null;
  stopPlayer();
  $('viewer').classList.add('hidden');
  $('home').classList.remove('hidden');
  $('openSettings').classList.remove('hidden');
  say('');
  renderList();
};

async function refresh() {
  say('Chargement des caméras…', true);
  try {
    devices = await window.api.listDevices(); // l'enregistrement démarre tout seul
    say(devices.length ? '' : "Aucune caméra trouvée. Vérifie que Smart Life est bien lié à ton projet Tuya.");
    renderList();
  } catch (e) {
    say(e.message);
  }
}

window.api.onUpdate((text) => say(text, true));
window.api.onRecordStatus(({ deviceId, status }) => {
  recState[deviceId] = status;
  if (current) updateViewerRec(); else renderList();
});

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
