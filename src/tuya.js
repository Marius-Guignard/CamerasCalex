// Client minimal pour l'API cloud Tuya (signature HMAC-SHA256)
const crypto = require('crypto');

class Tuya {
  constructor(cfg) {
    this.id = (cfg.accessId || '').trim();
    this.secret = (cfg.accessSecret || '').trim();
    this.base = (cfg.baseUrl || '').trim().replace(/\/$/, '');
    this.token = null;
    this.expiresAt = 0;
  }

  _sha(body) {
    return crypto.createHash('sha256').update(body || '').digest('hex');
  }

  _sign(str) {
    return crypto.createHmac('sha256', this.secret).update(str).digest('hex').toUpperCase();
  }

  async _ensureToken() {
    if (this.token && Date.now() < this.expiresAt - 60000) return;
    const r = await this._call('GET', '/v1.0/token?grant_type=1', null, false);
    this.token = r.access_token;
    this.expiresAt = Date.now() + r.expire_time * 1000;
  }

  async _call(method, path, body, withToken = true) {
    if (!this.id || !this.secret || !this.base) {
      throw new Error('Réglages incomplets : renseigne Access ID, Access Secret et le serveur.');
    }
    if (withToken) await this._ensureToken();
    const t = Date.now().toString();
    const bodyStr = body ? JSON.stringify(body) : '';
    const stringToSign = [method, this._sha(bodyStr), '', path].join('\n');
    const signStr = this.id + (withToken ? this.token : '') + t + stringToSign;
    const headers = {
      client_id: this.id,
      t,
      sign_method: 'HMAC-SHA256',
      sign: this._sign(signStr),
      'Content-Type': 'application/json'
    };
    if (withToken) headers.access_token = this.token;
    const res = await fetch(this.base + path, { method, headers, body: bodyStr || undefined });
    const json = await res.json();
    if (!json.success) {
      throw new Error(`Tuya a refusé la demande (code ${json.code}) : ${json.msg}`);
    }
    return json.result;
  }

  // Liste des appareils des comptes liés au projet
  async listDevices() {
    let all = [];
    let lastRowKey = '';
    for (let i = 0; i < 10; i++) {
      const q = lastRowKey ? `?last_row_key=${encodeURIComponent(lastRowKey)}` : '';
      const r = await this._call('GET', '/v1.0/iot-01/associated-users/devices' + q);
      all = all.concat(r.devices || []);
      if (!r.has_more) break;
      lastRowKey = r.last_row_key;
    }
    return all.map((d) => ({
      id: d.id,
      name: d.name,
      category: d.category,
      online: !!d.online
    }));
  }

  // Adresse du flux vidéo en direct (HLS)
  async getStreamUrl(deviceId) {
    const r = await this._call('POST', `/v1.0/devices/${deviceId}/stream/actions/allocate`, { type: 'hls' });
    return r.url;
  }

  // Envoi d'une commande à l'appareil
  async sendCommands(deviceId, commands) {
    return this._call('POST', `/v1.0/devices/${deviceId}/commands`, { commands });
  }
}

module.exports = { Tuya };
