// P2P-клиент онлайн-режима поверх WebRTC (через Trystero, BitTorrent-трекеры для первичного
// обнаружения пиров). Сервер не нужен — подходит для чисто статического хостинга (GitHub Pages).
//
// Модель доверия: сервера-судьи больше нет, каждый игрок считает попадания по СВОЕЙ доске
// и сообщает результат сопернику. Для игры с другом этого достаточно.
import { joinRoom, selfId } from './vendor/trystero/torrent.mjs';

const APP_ID = 'seabattle-p2p-v1';

class P2PNetwork {
  constructor() {
    this.room = null;
    this.listeners = new Map();
    this.remotePeerId = null;
    this.roomCode = null;
    this.actions = null;
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

  _setupRoom(code) {
    this.roomCode = code;
    this.room = joinRoom({ appId: APP_ID }, `sb-${code}`);

    const readyAction = this.room.makeAction('ready');
    const shootAction = this.room.makeAction('shoot');
    const resultAction = this.room.makeAction('result');
    this.actions = { sendReady: readyAction.send, sendShoot: shootAction.send, sendResult: resultAction.send };

    readyAction.onMessage = () => this._emit('opponent_ready');
    shootAction.onMessage = (msg) => this._emit('shot_incoming', msg);
    resultAction.onMessage = (msg) => this._emit('shot_result', msg);

    this.room.onPeerJoin = (peerId) => {
      this.remotePeerId = peerId;
      this._emit('opponent_joined');
    };
    this.room.onPeerLeave = (peerId) => {
      if (peerId === this.remotePeerId) {
        this.remotePeerId = null;
        this._emit('opponent_left');
      }
    };
  }

  // "Создать комнату" — просто генерируем код и сразу подключаемся к нему;
  // в P2P-модели нет отдельного "сервера", который создаёт комнату заранее.
  createRoom() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
    this._setupRoom(code);
    return code;
  }

  joinRoom(code) {
    this._setupRoom(code.toUpperCase().trim());
  }

  // Я иду первым, если мой peer-id лексикографически меньше — оба игрока
  // считают это независимо и всегда приходят к одному и тому же результату.
  amIFirst() {
    return this.remotePeerId ? selfId < this.remotePeerId : true;
  }

  sendReady() {
    this.actions?.sendReady({});
  }

  sendShot(x, y) {
    this.actions?.sendShoot({ x, y });
  }

  sendShotResult(x, y, result, shipCells, autoMiss) {
    this.actions?.sendResult({ x, y, result, shipCells: shipCells || null, autoMiss: autoMiss || [] });
  }

  leave() {
    if (this.room) this.room.leave();
    this.room = null;
    this.actions = null;
    this.remotePeerId = null;
  }
}

export const network = new P2PNetwork();
