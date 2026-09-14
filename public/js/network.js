// Клиент онлайн-режима: обёртка над WebSocket с простой pub/sub моделью событий.

class NetworkClient {
  constructor() {
    this.ws = null;
    this.listeners = new Map();
    this.playerIndex = -1;
    this.code = null;
  }

  on(event, cb) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(cb);
    return () => this.listeners.get(event).delete(cb);
  }

  _emit(event, data) {
    const set = this.listeners.get(event);
    if (set) set.forEach(cb => cb(data));
  }

  connect() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      this.ws = new WebSocket(`${proto}://${location.host}/ws`);
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', (e) => reject(e));
      this.ws.addEventListener('close', () => this._emit('disconnected'));
      this.ws.addEventListener('message', (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === 'created' || msg.type === 'joined') {
          this.playerIndex = msg.playerIndex;
          this.code = msg.code;
        }
        this._emit(msg.type, msg);
      });
    });
  }

  _send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  async createRoom(name) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) await this.connect();
    this._send({ type: 'create', name });
  }

  async joinRoom(code, name) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) await this.connect();
    this._send({ type: 'join', code, name });
  }

  place(ships) {
    this._send({ type: 'place', ships });
  }

  shoot(x, y) {
    this._send({ type: 'shoot', x, y });
  }

  leave() {
    this._send({ type: 'leave' });
    if (this.ws) this.ws.close();
  }
}

export const network = new NetworkClient();
