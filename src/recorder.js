// Enregistrement automatique : ffmpeg découpe le flux en fichiers de N minutes
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

let ffmpegPath;
try {
  // Une fois installée, l'appli est empaquetée : ffmpeg se trouve dans le dossier « unpacked »
  ffmpegPath = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
} catch (e) {
  ffmpegPath = null;
}

const jobs = new Map(); // deviceId -> { proc, wanted, timer, status }

function safeName(name) {
  return String(name || 'camera').replace(/[^a-zA-Z0-9_-]+/g, '_');
}

function cleanOld(dir, days) {
  if (!days || days <= 0) return;
  const limit = Date.now() - days * 86400000;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.mp4')) continue;
      const full = path.join(dir, f);
      if (fs.statSync(full).mtimeMs < limit) fs.unlinkSync(full);
    }
  } catch (e) {
    /* dossier absent : rien à nettoyer */
  }
}

async function launch(job, device, tuya, settings, onStatus) {
  if (!job.wanted) return;
  if (!ffmpegPath) {
    job.status = 'ffmpeg introuvable (relance « npm install »)';
    onStatus(device.id, job.status);
    return;
  }
  try {
    const dir = settings.recordFolder;
    fs.mkdirSync(dir, { recursive: true });
    cleanOld(dir, settings.retentionDays);
    const url = await tuya.getStreamUrl(device.id);
    const pattern = path.join(dir, `${safeName(device.name)}_%Y-%m-%d_%H-%M-%S.mp4`);
    const args = [
      '-hide_banner', '-loglevel', 'warning',
      '-i', url,
      '-c:v', 'copy', '-an',
      '-f', 'segment',
      '-segment_time', String(Math.max(1, settings.segmentHours) * 3600),
      '-segment_format_options', 'movflags=frag_keyframe+empty_moov+default_base_moof',
      '-reset_timestamps', '1',
      '-strftime', '1',
      pattern
    ];
    job.proc = spawn(ffmpegPath, args, { windowsHide: true });
    job.status = 'Enregistrement en cours';
    onStatus(device.id, job.status);
    job.proc.on('exit', () => {
      job.proc = null;
      if (job.wanted) {
        job.status = 'Reconnexion…';
        onStatus(device.id, job.status);
        job.timer = setTimeout(() => launch(job, device, tuya, settings, onStatus), 5000);
      }
    });
  } catch (e) {
    job.status = 'Erreur : ' + e.message;
    onStatus(device.id, job.status);
    if (job.wanted) {
      job.timer = setTimeout(() => launch(job, device, tuya, settings, onStatus), 30000);
    }
  }
}

function start(device, tuya, settings, onStatus) {
  if (jobs.has(device.id) && jobs.get(device.id).wanted) return;
  const job = { proc: null, wanted: true, timer: null, status: 'Démarrage…' };
  jobs.set(device.id, job);
  onStatus(device.id, job.status);
  launch(job, device, tuya, settings, onStatus);
}

function stop(deviceId, onStatus) {
  const job = jobs.get(deviceId);
  if (!job) return;
  job.wanted = false;
  if (job.timer) clearTimeout(job.timer);
  if (job.proc) {
    try { job.proc.stdin.write('q'); } catch (e) { /* ignore */ }
    setTimeout(() => { if (job.proc) job.proc.kill(); }, 2000);
  }
  job.status = 'Arrêté';
  onStatus(deviceId, job.status);
}

function stopAll() {
  for (const [id, job] of jobs) {
    job.wanted = false;
    if (job.timer) clearTimeout(job.timer);
    if (job.proc) job.proc.kill();
  }
}

function isRecording(deviceId) {
  const j = jobs.get(deviceId);
  return !!(j && j.wanted);
}

module.exports = { start, stop, stopAll, isRecording };
