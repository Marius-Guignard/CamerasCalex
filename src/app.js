const $ = (id) => document.getElementById(id);
let devices = [];
let current = null;
let mode = 'live'; // 'live' ou 'file'
let activeFile = null;
let hls = null;
let flv = null;
let filesTimer = null;
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

/* ---------- Écran d'accueil ---------- */
function renderList() {
  const box = $('list');
  box.querySelectorAll('.cam-item').forEach((e) => e.remove());
  for (const d of devices) {
    const r = recLabel(d.id);
    const el = document.createElement('div');
    el.className = 'card-cam cam-item';
    el.innerHTML = `<div class="n"></div>
      <div class="s"><span class="dot ${d.online ? 'on' : ''}"></span>${d.online ? 'En ligne' : 'Hors ligne'}</div>
      <div class="s"><span class="dot ${r.cls}"></span><span class="rt"></span></div>`;
    el.querySelector('.n').textContent = d.name;
    el.querySelector('.rt').textContent = r.text;
    const trash = document.createElement('button');
    trash.className = 'trash';
    trash.title = 'Supprimer cet appareil';
    trash.textContent = '🗑';
    trash.onclick = async (ev) => {
      ev.stopPropagation();
      if (!confirm(`Supprimer « ${d.name} » de l'application ?\n\nL'enregistrement de cette caméra s'arrête. La caméra reste dans Smart Life et les vidéos déjà enregistrées restent dans ton dossier.`)) return;
      await window.api.hideDevice(d.id);
      devices = devices.filter((x) => x.id !== d.id);
      renderList();
    };
    el.appendChild(trash);
    el.onclick = () => openCamera(d);
    box.appendChild(el);
  }
}

/* ---------- Lecteurs ---------- */
function stopPlayer() {
  if (hls) { hls.destroy(); hls = null; }
  if (flv) { try { flv.destroy(); } catch (e) { /* ignore */ } flv = null; }
  const v = $('video');
  v.pause();
  v.removeAttribute('src');
  v.load();
}

async function playHls(device) {
  const url = await window.api.getStream(device.id, 'hls');
  if (!current || current.id !== device.id || mode !== 'live') return;
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
      if (data.fatal) setTimeout(() => { if (current && current.id === device.id && mode === 'live') startLive(device); }, 5000);
    });
  } else {
    v.src = url;
  }
  v.play().catch(() => {});
  $('mode').textContent = 'En direct (flux standard, plus décalé)';
}

async function playFlv(device) {
  const url = await window.api.getStream(device.id, 'flv');
  if (!current || current.id !== device.id || mode !== 'live') return;
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
    if (current && current.id === device.id && mode === 'live') playHls(device).catch((e) => say(e.message));
  });
  flv.attachMediaElement(v);
  flv.load();
  v.play().catch(() => {});
  $('mode').textContent = 'En direct (flux rapide)';
}

function showVideo(on) {
  $('video').classList.toggle('hidden', !on);
  $('idle').classList.toggle('hidden', on);
}

function showIdle() {
  mode = 'idle';
  activeFile = null;
  stopPlayer();
  showVideo(false);
  $('mode').textContent = '';
  $('goLive').classList.remove('hidden');
  $('stopLive').classList.add('hidden');
  highlightFile();
  say('');
}

async function startLive(device) {
  mode = 'live';
  activeFile = null;
  showVideo(true);
  $('video').controls = false;
  $('mode').textContent = 'En direct';
  $('goLive').classList.add('hidden');
  $('stopLive').classList.remove('hidden');
  highlightFile();
  say('Connexion au flux vidéo…', true);
  try {
    if (window.mpegts && mpegts.isSupported()) {
      try { await playFlv(device); } catch (e) { await playHls(device); }
    } else {
      await playHls(device);
    }
    say('');
  } catch (e) {
    say(e.message + '\n(Vérifie que « IoT Video Live Stream » est bien autorisé sur ton projet Tuya.)');
  }
}

/* ---------- Lecture d'un fichier enregistré ---------- */
function playFile(f) {
  mode = 'file';
  activeFile = f.name;
  stopPlayer();
  showVideo(true);
  const v = $('video');
  v.controls = true;
  v.muted = true;
  v.src = f.url;
  v.play().catch(() => {});
  $('mode').textContent = 'Enregistrement : ' + fileTitle(f);
  $('goLive').classList.remove('hidden');
  $('stopLive').classList.add('hidden');
  highlightFile();
  say('');
}

function fileTitle(f) {
  const m = f.name.match(/_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.mp4$/);
  if (m) return `${m[3]}/${m[2]} à ${m[4]}h${m[5]}`;
  return new Date(f.mtime).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function fileSize(b) {
  if (b > 1e9) return (b / 1e9).toFixed(1) + ' Go';
  return Math.max(1, Math.round(b / 1e6)) + ' Mo';
}

function highlightFile() {
  document.querySelectorAll('.file').forEach((el) => el.classList.toggle('active', el.dataset.name === activeFile));
}

async function loadFiles() {
  if (!current) return;
  const files = await window.api.listFiles(current.id);
  const box = $('fileList');
  box.innerHTML = '';
  if (!files.length) {
    box.innerHTML = '<div class="empty-files">Aucun enregistrement pour l\'instant.</div>';
    return;
  }
  const recording = recState[current.id] === 'Enregistrement en cours';
  files.forEach((f, i) => {
    const el = document.createElement('div');
    el.className = 'file';
    el.dataset.name = f.name;
    const now = i === 0 && recording;
    el.innerHTML = `<div class="t"></div><div class="d"><span>${fileSize(f.size)}</span>${now ? '<span class="now">● en cours</span>' : ''}</div>`;
    el.querySelector('.t').textContent = fileTitle(f);
    el.onclick = () => playFile(f);
    box.appendChild(el);
  });
  highlightFile();
}

/* ---------- Écran d'une caméra ---------- */
function updateViewerRec() {
  if (!current) return;
  const r = recLabel(current.id);
  $('camRec').innerHTML = `<span class="dot ${r.cls}"></span>${r.text}`;
}

function openCamera(d) {
  current = d;
  $('home').classList.add('hidden');
  $('viewer').classList.remove('hidden');
  $('camName').textContent = d.name;
  updateViewerRec();
  loadFiles();
  clearInterval(filesTimer);
  filesTimer = setInterval(loadFiles, 30000);
  showIdle(); // l'image en direct ne démarre que si on le demande
}

$('goLive').onclick = () => { if (current) startLive(current); };
$('stopLive').onclick = () => showIdle();

$('back').onclick = () => {
  current = null;
  clearInterval(filesTimer);
  stopPlayer();
  $('viewer').classList.add('hidden');
  $('home').classList.remove('hidden');
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

/* ---------- Réglages ---------- */
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
$('settingsCard').onclick = openSettings;
$('addCard').onclick = () => $('addModal').classList.remove('hidden');
let pairTimer = null;
function stopPairing() { clearInterval(pairTimer); pairTimer = null; }
$('openPair').onclick = () => {
  $('addModal').classList.add('hidden');
  $('qrBox').classList.add('hidden');
  $('pairStatus').textContent = '';
  $('pairModal').classList.remove('hidden');
};
$('closePair').onclick = () => { stopPairing(); $('pairModal').classList.add('hidden'); };
$('makeQr').onclick = async () => {
  stopPairing();
  $('pairStatus').textContent = 'Préparation du QR code…';
  try {
    const { qr, token } = await window.api.pairStart($('wifiName').value.trim(), $('wifiPass').value);
    $('qrImg').src = qr;
    $('qrBox').classList.remove('hidden');
    $('pairStatus').textContent = 'Présente ce QR code devant la caméra. En attente de la caméra…';
    const started = Date.now();
    pairTimer = setInterval(async () => {
      if (Date.now() - started > 5 * 60 * 1000) {
        stopPairing();
        $('pairStatus').textContent = "Délai dépassé. Vérifie que la caméra clignote, puis clique à nouveau sur « Générer le QR code ».";
        return;
      }
      try {
        const r = await window.api.pairCheck(token);
        if (r.found) {
          stopPairing();
          $('pairStatus').textContent = 'Caméra ajoutée : ' + r.names.join(', ');
          setTimeout(() => { $('pairModal').classList.add('hidden'); refresh(); }, 1500);
        }
      } catch (e) { /* on réessaie */ }
    }, 4000);
  } catch (e) {
    $('pairStatus').textContent = e.message;
  }
};
$('closeAdd').onclick = () => $('addModal').classList.add('hidden');
$('unhide').onclick = async () => { await window.api.unhideAll(); $('addModal').classList.add('hidden'); refresh(); };
$('refreshAdd').onclick = () => { $('addModal').classList.add('hidden'); refresh(); };
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
