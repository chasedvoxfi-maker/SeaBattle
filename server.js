const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const {
  BOARD_SIZE,
  FLEET,
  validatePlacement,
  resolveShot
} = require('./shared/rules');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

/** @type {Map<string, Room>} */
const rooms = new Map();

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без похожих символов
  let code;
  do {
    code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

class Room {
  constructor(code) {
    this.code = code;
    this.players = []; // { ws, name, placement: {grid, ships}|null, ready: bool, alive: bool }
    this.turn = 0;
    this.started = false;
    this.over = false;
  }

  broadcast(msg, exceptIndex = -1) {
    this.players.forEach((p, i) => {
      if (i !== exceptIndex) send(p.ws, msg);
    });
  }

  opponentOf(index) {
    return this.players[1 - index];
  }

  tryStart() {
    if (this.players.length === 2 && this.players.every(p => p.ready) && !this.started) {
      this.started = true;
      this.turn = Math.random() < 0.5 ? 0 : 1;
      this.players.forEach((p, i) => {
        send(p.ws, { type: 'both_ready', startingPlayer: this.turn, you: i });
      });
    }
  }
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  let room = null;
  let playerIndex = -1;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'create') {
      const code = makeCode();
      room = new Room(code);
      room.players.push({ ws, name: (msg.name || 'Игрок 1').slice(0, 20), placement: null, ready: false });
      playerIndex = 0;
      rooms.set(code, room);
      send(ws, { type: 'created', code, playerIndex, fleet: FLEET, boardSize: BOARD_SIZE });
      return;
    }

    if (msg.type === 'join') {
      const code = (msg.code || '').toUpperCase().trim();
      const r = rooms.get(code);
      if (!r || r.players.length >= 2) {
        send(ws, { type: 'error', message: 'Комната не найдена или уже заполнена' });
        return;
      }
      room = r;
      room.players.push({ ws, name: (msg.name || 'Игрок 2').slice(0, 20), placement: null, ready: false });
      playerIndex = 1;
      send(ws, { type: 'joined', code, playerIndex, fleet: FLEET, boardSize: BOARD_SIZE });
      room.broadcast({ type: 'opponent_joined', name: room.players[1].name }, 1);
      return;
    }

    if (!room || playerIndex === -1) return;

    if (msg.type === 'place') {
      const validated = validatePlacement(msg.ships, BOARD_SIZE, FLEET);
      if (!validated) {
        send(ws, { type: 'error', message: 'Некорректная расстановка кораблей' });
        return;
      }
      room.players[playerIndex].placement = validated;
      room.players[playerIndex].ready = true;
      room.broadcast({ type: 'opponent_ready' }, playerIndex);
      room.tryStart();
      return;
    }

    if (msg.type === 'shoot') {
      if (!room.started || room.over) return;
      if (room.turn !== playerIndex) {
        send(ws, { type: 'error', message: 'Сейчас не ваш ход' });
        return;
      }
      const opponent = room.opponentOf(playerIndex);
      if (!opponent || !opponent.placement) return;
      const { x, y } = msg;
      if (typeof x !== 'number' || typeof y !== 'number') return;
      const outcome = resolveShot(opponent.placement.grid, opponent.placement.ships, x, y, BOARD_SIZE);
      if (outcome.result === 'repeat') {
        send(ws, { type: 'error', message: 'В эту клетку уже стреляли' });
        return;
      }
      const payload = {
        type: 'shot_result',
        by: playerIndex,
        x, y,
        result: outcome.result,
        shipCells: outcome.shipCells || null,
        autoMiss: outcome.autoMiss || []
      };
      room.players.forEach(p => send(p.ws, payload));

      if (outcome.result === 'win') {
        room.over = true;
        room.players.forEach((p, i) => send(p.ws, { type: 'game_over', winner: playerIndex }));
        return;
      }
      // Промах — ход переходит сопернику. Попадание/потопление — ход остаётся у стрелявшего.
      if (outcome.result === 'miss') {
        room.turn = 1 - playerIndex;
      }
      room.players.forEach(p => send(p.ws, { type: 'turn', playerIndex: room.turn }));
      return;
    }

    if (msg.type === 'leave') {
      cleanupPlayer();
      return;
    }
  });

  ws.on('close', cleanupPlayer);

  function cleanupPlayer() {
    if (!room) return;
    room.broadcast({ type: 'opponent_left' }, playerIndex);
    room.players = room.players.filter((_, i) => i !== playerIndex);
    if (room.players.length === 0) {
      rooms.delete(room.code);
    }
    room = null;
    playerIndex = -1;
  }
});

// Пинг для очистки мёртвых соединений
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(interval));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Морской бой запущен: http://localhost:${PORT}`);
});
