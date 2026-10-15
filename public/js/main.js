import { BOARD_SIZE, FLEET, createEmptyGrid, canPlaceShip, cellsForShip, randomFleetPlacement, resolveShot } from './rules.js';
import { buildBoardDOM, cellAt, clearPreview, paintOwnBoard, paintEnemyBoard } from './board-render.js';
import { markCellHit, markCellMiss, markCellSunk, screenShake, fireworksShow } from './effects.js';
import { audio } from './audio.js';
import { AI } from './ai.js';
import { network } from './network.js';

// ==================== ОБЩИЕ УТИЛИТЫ ====================

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
  window.scrollTo(0, 0);
}

function coordLabel(x, y) {
  return `${String.fromCharCode(65 + x)}${y + 1}`;
}

function addLog(msg, cls) {
  const log = document.getElementById('battle-log');
  if (!log) return;
  const div = document.createElement('div');
  if (cls) div.className = cls;
  div.textContent = msg;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  while (log.children.length > 60) log.removeChild(log.firstChild);
}

function clearLog() {
  const log = document.getElementById('battle-log');
  if (log) log.innerHTML = '';
}

function updateTurnIndicator(text) {
  const el = document.getElementById('turn-indicator');
  if (el) el.textContent = text;
}

function renderFleetStatusBar(l1, a1, t1, l2, a2, t2) {
  const el = document.getElementById('fleet-status');
  if (!el) return;
  el.innerHTML =
    `<div class="fs-group"><span class="fs-label">${l1}</span>${'🚢'.repeat(Math.max(0, a1))}${'💀'.repeat(Math.max(0, t1 - a1))}</div>` +
    `<div class="fs-group"><span class="fs-label">${l2}</span>${'🚢'.repeat(Math.max(0, a2))}${'💀'.repeat(Math.max(0, t2 - a2))}</div>`;
}

function aliveCount(ships) { return ships.filter(s => !s.sunk).length; }

// Применяет визуальный + звуковой + лог-эффект результата выстрела к указанному полю.
function applyShotVisual(cells, x, y, result, shipCells, autoMiss, shooterLabel) {
  const prefix = shooterLabel ? `${shooterLabel}: ` : '';
  const cellEl = cellAt(cells, x, y);
  if (!cellEl) return;
  if (result === 'miss') {
    markCellMiss(cellEl);
    audio.splashMiss();
    addLog(`${prefix}мимо — ${coordLabel(x, y)}`, 'log-miss');
  } else if (result === 'hit') {
    markCellHit(cellEl);
    audio.hit();
    addLog(`${prefix}попадание! — ${coordLabel(x, y)}`, 'log-hit');
  } else if (result === 'sunk' || result === 'win') {
    audio.explosion();
    screenShake();
    (shipCells || []).forEach(c => {
      const el = cellAt(cells, c.x, c.y);
      if (el) markCellSunk(el);
    });
    (autoMiss || []).forEach(c => {
      const el = cellAt(cells, c.x, c.y);
      if (el && !el.classList.contains('miss') && !el.classList.contains('sunk')) {
        el.classList.add('miss');
        const ripple = document.createElement('span');
        ripple.className = 'ripple';
        el.appendChild(ripple);
        setTimeout(() => ripple.remove(), 650);
      }
    });
    addLog(`${prefix}корабль потоплен! — ${coordLabel(x, y)}`, 'log-sunk');
  }
}

function createBattleBoards(onEnemyClick) {
  const ownEl = document.getElementById('board-own');
  const enemyEl = document.getElementById('board-enemy');
  const ownCells = buildBoardDOM(ownEl, {});
  const enemyCells = buildBoardDOM(enemyEl, { onCellClick: onEnemyClick });
  return { ownCells, enemyCells };
}

function shotAlreadyMade(cellEl) {
  return cellEl.classList.contains('hit') || cellEl.classList.contains('miss') || cellEl.classList.contains('sunk');
}

function showGameOver(isWin, subtitle) {
  const titleEl = document.getElementById('gameover-title');
  titleEl.textContent = isWin ? 'Победа!' : 'Поражение';
  titleEl.classList.toggle('lose', !isWin);
  document.getElementById('gameover-subtitle').textContent = subtitle;
  showScreen('screen-gameover');
  if (isWin) {
    audio.victory();
    fireworksShow(3600, document.getElementById('screen-gameover'));
  } else {
    audio.defeat();
  }
}

// ==================== ЭКРАН РАССТАНОВКИ ====================

let activePlacementKeyHandler = null;

function placementPhase(titleText, hintText) {
  return new Promise((resolve) => {
    if (activePlacementKeyHandler) {
      window.removeEventListener('keydown', activePlacementKeyHandler);
      activePlacementKeyHandler = null;
    }

    const boardEl = document.getElementById('placement-board');
    const dockEl = document.getElementById('fleet-dock');
    const rotateBtn = document.getElementById('btn-rotate');
    const randomBtn = document.getElementById('btn-random');
    const clearBtn = document.getElementById('btn-clear');
    const readyBtn = document.getElementById('btn-ready');
    const hintEl = document.getElementById('placement-hint');

    document.getElementById('placement-title').textContent = titleText;
    hintEl.textContent = hintText || 'Кликните по клетке, чтобы поставить корабль. R — повернуть.';
    readyBtn.disabled = true;

    let placedShips = [];
    let grid = createEmptyGrid();
    let horizontal = true;
    let selectedSize = null;
    const sizesDesc = [...new Set(FLEET)].sort((a, b) => b - a);
    const remaining = {};

    function resetRemaining() {
      sizesDesc.forEach(s => { remaining[s] = FLEET.filter(f => f === s).length; });
    }
    resetRemaining();

    function pickNextSize() {
      selectedSize = sizesDesc.find(s => remaining[s] > 0) || null;
    }
    pickNextSize();

    function rebuildGrid() {
      grid = createEmptyGrid();
      placedShips.forEach((s, i) => {
        s.cells.forEach(c => { grid[c.y * BOARD_SIZE + c.x].ship = i; });
      });
    }

    function renderDock() {
      dockEl.innerHTML = '';
      for (const size of sizesDesc) {
        const wrap = document.createElement('div');
        wrap.className = 'dock-ship' + (remaining[size] <= 0 ? ' used' : '') + (selectedSize === size ? ' selected' : '');
        for (let i = 0; i < size; i++) {
          const seg = document.createElement('div');
          seg.className = 'seg';
          wrap.appendChild(seg);
        }
        const badge = document.createElement('span');
        badge.style.marginLeft = '8px';
        badge.style.fontSize = '.8rem';
        badge.style.color = 'var(--text-dim)';
        badge.textContent = `×${remaining[size]}`;
        wrap.appendChild(badge);
        wrap.addEventListener('click', () => {
          if (remaining[size] > 0) { selectedSize = size; renderDock(); audio.select(); }
        });
        dockEl.appendChild(wrap);
      }
    }

    function redrawBoard() {
      cells.forEach(c => { c.classList.remove('ship'); });
      placedShips.forEach(s => s.cells.forEach(c => {
        const el = cellAt(cells, c.x, c.y);
        if (el) el.classList.add('ship');
      }));
    }

    function updateReady() {
      readyBtn.disabled = placedShips.length !== FLEET.length;
    }

    function onEnter(x, y) {
      clearPreview(cells);
      if (grid[y * BOARD_SIZE + x].ship !== null) return;
      if (selectedSize === null) return;
      const ok = canPlaceShip(grid, x, y, selectedSize, horizontal);
      const footprint = cellsForShip(x, y, selectedSize, horizontal);
      for (const c of footprint) {
        const el = cellAt(cells, c.x, c.y);
        if (el) el.classList.add(ok ? 'preview-ok' : 'preview-bad');
      }
    }
    function onLeave() { clearPreview(cells); }

    function onClick(x, y) {
      const existingShipIdx = grid[y * BOARD_SIZE + x].ship;
      if (existingShipIdx !== null) {
        const removed = placedShips[existingShipIdx];
        placedShips.splice(existingShipIdx, 1);
        remaining[removed.size]++;
        rebuildGrid();
        redrawBoard();
        if (selectedSize === null) pickNextSize();
        renderDock();
        updateReady();
        audio.click();
        return;
      }
      if (selectedSize === null) return;
      if (!canPlaceShip(grid, x, y, selectedSize, horizontal)) { audio.error(); return; }
      const cellsFp = cellsForShip(x, y, selectedSize, horizontal);
      placedShips.push({ size: selectedSize, horizontal, x, y, cells: cellsFp });
      remaining[selectedSize]--;
      rebuildGrid();
      redrawBoard();
      pickNextSize();
      renderDock();
      updateReady();
      clearPreview(cells);
      audio.click();
    }

    const cells = buildBoardDOM(boardEl, { onCellClick: onClick, onCellEnter: onEnter, onCellLeave: onLeave });

    function keyHandler(e) {
      if (e.key.toLowerCase() === 'r') {
        horizontal = !horizontal;
        audio.select();
      }
    }
    activePlacementKeyHandler = keyHandler;
    window.addEventListener('keydown', keyHandler);

    rotateBtn.onclick = () => { horizontal = !horizontal; audio.click(); };

    randomBtn.onclick = () => {
      const rnd = randomFleetPlacement();
      placedShips = rnd.ships.map(s => ({
        size: s.size,
        horizontal: s.cells.length > 1 ? (s.cells[1].y === s.cells[0].y) : true,
        x: s.cells[0].x,
        y: s.cells[0].y,
        cells: s.cells
      }));
      sizesDesc.forEach(s => { remaining[s] = 0; });
      rebuildGrid();
      redrawBoard();
      selectedSize = null;
      renderDock();
      updateReady();
      audio.click();
    };

    clearBtn.onclick = () => {
      placedShips = [];
      resetRemaining();
      rebuildGrid();
      redrawBoard();
      pickNextSize();
      renderDock();
      updateReady();
      audio.click();
    };

    readyBtn.onclick = () => {
      if (placedShips.length !== FLEET.length) return;
      window.removeEventListener('keydown', keyHandler);
      activePlacementKeyHandler = null;
      audio.select();
      const finalShips = placedShips.map((s, i) => ({ id: i, size: s.size, cells: s.cells, hits: [], sunk: false }));
      resolve({ grid, ships: finalShips, placedShips });
    };

    renderDock();
    showScreen('screen-placement');
  });
}

function passDevice(title, subtitle) {
  return new Promise((resolve) => {
    document.getElementById('pass-title').textContent = title;
    document.getElementById('pass-subtitle').textContent = subtitle;
    showScreen('screen-pass');
    document.getElementById('pass-continue').onclick = () => { audio.click(); resolve(); };
  });
}

// ==================== СОСТОЯНИЕ ТЕКУЩЕЙ ИГРЫ ====================

let currentMode = null;
let gameOverFlag = false;
let battleRefs = null;

// ==================== РЕЖИМ: ИГРА С КОМПЬЮТЕРОМ ====================

async function startVsComputer(difficulty) {
  currentMode = 'vscomputer';
  gameOverFlag = false;
  clearLog();

  const placed = await placementPhase('Расставьте свой флот', 'Кликните по клетке, чтобы поставить корабль. R — повернуть.');
  const ownBoard = { grid: placed.grid, ships: placed.ships };
  const rnd = randomFleetPlacement();
  const enemyBoard = { grid: rnd.grid, ships: rnd.ships };
  const ai = new AI(difficulty);

  let myTurn = true;

  function updateFS() {
    renderFleetStatusBar('Вы', aliveCount(ownBoard.ships), FLEET.length, 'Компьютер', aliveCount(enemyBoard.ships), FLEET.length);
  }

  function onEnemyClick(x, y, cellEl) {
    if (!myTurn || gameOverFlag) return;
    if (shotAlreadyMade(cellEl)) return;
    const outcome = resolveShot(enemyBoard.grid, enemyBoard.ships, x, y);
    if (outcome.result === 'repeat') return;
    applyShotVisual(enemyCells, x, y, outcome.result, outcome.shipCells, outcome.autoMiss, 'Вы');
    if (outcome.result === 'sunk') updateFS();

    if (outcome.result === 'win') {
      updateFS();
      gameOverFlag = true;
      showGameOver(true, 'Вы потопили весь флот противника!');
      return;
    }
    if (outcome.result === 'miss') {
      myTurn = false;
      updateTurnIndicator('Ход компьютера…');
      computerTurn();
    }
  }

  async function computerTurn() {
    await wait(550 + Math.random() * 500);
    if (gameOverFlag) return;
    const shot = ai.nextShot();
    if (!shot) return;
    const outcome = resolveShot(ownBoard.grid, ownBoard.ships, shot.x, shot.y);
    ai.registerResult(shot.x, shot.y, outcome.result === 'win' ? 'win' : outcome.result, { shipCells: outcome.shipCells, autoMiss: outcome.autoMiss });
    applyShotVisual(ownCells, shot.x, shot.y, outcome.result, outcome.shipCells, outcome.autoMiss, 'Компьютер');
    if (outcome.result === 'sunk') updateFS();

    if (outcome.result === 'win') {
      updateFS();
      gameOverFlag = true;
      showGameOver(false, 'Компьютер потопил ваш флот...');
      return;
    }
    if (outcome.result === 'miss') {
      myTurn = true;
      updateTurnIndicator('Ваш ход');
    } else {
      computerTurn();
    }
  }

  showScreen('screen-battle');
  const { ownCells, enemyCells } = createBattleBoards(onEnemyClick);
  battleRefs = { ownCells, enemyCells };
  paintOwnBoard(ownCells, ownBoard);
  updateTurnIndicator('Ваш ход');
  updateFS();
}

// ==================== РЕЖИМ: ХОТСИТ (ДВА ИГРОКА, ОДИН ЭКРАН) ====================

async function startHotseat() {
  currentMode = 'hotseat';
  gameOverFlag = false;
  clearLog();

  const p1 = await placementPhase('Игрок 1: расставьте флот', 'Игрок 1, кликните по клетке, чтобы поставить корабль. R — повернуть.');
  await passDevice('Передайте устройство', 'Следующий — Игрок 2 расставит свой флот. Игрок 1 не должен подсматривать!');
  const p2 = await placementPhase('Игрок 2: расставьте флот', 'Игрок 2, кликните по клетке, чтобы поставить корабль. R — повернуть.');
  await passDevice('Бой начинается!', 'Передайте устройство Игроку 1 — он ходит первым.');

  const boards = [{ grid: p1.grid, ships: p1.ships }, { grid: p2.grid, ships: p2.ships }];
  const names = ['Игрок 1', 'Игрок 2'];
  let active = 0;

  function refreshFS() {
    renderFleetStatusBar(names[0], aliveCount(boards[0].ships), FLEET.length, names[1], aliveCount(boards[1].ships), FLEET.length);
  }

  function refreshView() {
    paintOwnBoard(ownCells, boards[active]);
    paintEnemyBoard(enemyCells, boards[1 - active]);
    updateTurnIndicator(`Ход: ${names[active]}`);
    refreshFS();
  }

  function onEnemyClick(x, y, cellEl) {
    if (gameOverFlag) return;
    if (shotAlreadyMade(cellEl)) return;
    const targetBoard = boards[1 - active];
    const outcome = resolveShot(targetBoard.grid, targetBoard.ships, x, y);
    if (outcome.result === 'repeat') return;
    applyShotVisual(enemyCells, x, y, outcome.result, outcome.shipCells, outcome.autoMiss, names[active]);
    if (outcome.result === 'sunk') refreshFS();

    if (outcome.result === 'win') {
      gameOverFlag = true;
      showGameOver(true, `${names[active]} потопил весь флот противника!`);
      return;
    }
    if (outcome.result === 'miss') {
      const next = 1 - active;
      passDevice('Передайте устройство', `Ход переходит: ${names[next]}. Не подглядывайте!`).then(() => {
        active = next;
        refreshView();
      });
    }
  }

  showScreen('screen-battle');
  const { ownCells, enemyCells } = createBattleBoards(onEnemyClick);
  battleRefs = { ownCells, enemyCells };
  refreshView();
}

// ==================== РЕЖИМ: ОНЛАЙН (P2P, без сервера) ====================
//
// Сервера-судьи больше нет: каждый игрок считает попадания по своей доске
// (resolveShot) и пересылает результат сопернику напрямую через WebRTC.

let onlineRoomCode = null;
let onlineOwnBoard = null;
let onlineEnemySunk = 0;
let onlineMyTurn = false;
let onlinePeerConnected = false;
let onlineAmIReady = false;
let onlineISentReady = false;
let onlineOpponentReady = false;
let onlineBattleStarted = false;

function resetOnlineState() {
  onlineRoomCode = null;
  onlineOwnBoard = null;
  onlineEnemySunk = 0;
  onlineMyTurn = false;
  onlinePeerConnected = false;
  onlineAmIReady = false;
  onlineISentReady = false;
  onlineOpponentReady = false;
  onlineBattleStarted = false;
}

function sendReadyIfPossible() {
  if (onlineAmIReady && onlinePeerConnected && !onlineISentReady) {
    network.sendReady();
    onlineISentReady = true;
  }
}

function tryStartOnlineBattle() {
  if (onlineAmIReady && onlineOpponentReady && !onlineBattleStarted) {
    onlineBattleStarted = true;
    startOnlineBattle();
  }
}

async function startOnlinePlacement() {
  const hint = `Комната: ${onlineRoomCode}. Кликните по клетке, чтобы поставить корабль. R — повернуть.`;
  const placed = await placementPhase('Расставьте свой флот', hint);
  onlineOwnBoard = { grid: placed.grid, ships: placed.ships };
  onlineEnemySunk = 0;
  onlineAmIReady = true;
  sendReadyIfPossible();
  document.getElementById('waiting-title').textContent = 'Ожидание соперника…';
  document.getElementById('waiting-subtitle').textContent = `Код комнаты: ${onlineRoomCode}. Ждём, пока соперник подключится и расставит флот.`;
  showScreen('screen-waiting');
  tryStartOnlineBattle();
}

function updateOnlineFS() {
  renderFleetStatusBar('Вы', aliveCount(onlineOwnBoard.ships), FLEET.length, 'Соперник', FLEET.length - onlineEnemySunk, FLEET.length);
}

function startOnlineBattle() {
  currentMode = 'online';
  gameOverFlag = false;
  clearLog();
  onlineMyTurn = network.amIFirst();

  function onEnemyClick(x, y, cellEl) {
    if (!onlineMyTurn || gameOverFlag) return;
    if (shotAlreadyMade(cellEl)) return;
    network.sendShot(x, y);
    onlineMyTurn = false;
    updateTurnIndicator('Ход соперника…');
  }

  showScreen('screen-battle');
  const { ownCells, enemyCells } = createBattleBoards(onEnemyClick);
  battleRefs = { ownCells, enemyCells };
  paintOwnBoard(ownCells, onlineOwnBoard);
  updateTurnIndicator(onlineMyTurn ? 'Ваш ход' : 'Ход соперника…');
  updateOnlineFS();
}

function notifyOpponentLeft() {
  if (currentMode === 'online' && battleRefs && !gameOverFlag) {
    addLog('Соперник отключился.', 'log-miss');
    setTimeout(() => {
      if (!gameOverFlag) { currentMode = null; showScreen('screen-menu'); }
    }, 2500);
  } else if (!gameOverFlag) {
    const statusEl = document.getElementById('online-status');
    if (statusEl) statusEl.textContent = 'Соперник отключился.';
    setTimeout(() => showScreen('screen-menu'), 2500);
  }
}

network.on('opponent_joined', () => {
  onlinePeerConnected = true;
  const statusEl = document.getElementById('online-status');
  if (statusEl) statusEl.textContent = 'Соперник подключился!';
  addLog('Соперник подключился.', 'log-sunk');
  sendReadyIfPossible();
});

network.on('opponent_ready', () => {
  onlineOpponentReady = true;
  addLog('Соперник расставил флот и готов к бою.', 'log-sunk');
  tryStartOnlineBattle();
});

// Соперник выстрелил по моей доске — считаю результат сам и отправляю обратно.
network.on('shot_incoming', ({ x, y }) => {
  if (currentMode !== 'online' || !battleRefs || gameOverFlag) return;
  const outcome = resolveShot(onlineOwnBoard.grid, onlineOwnBoard.ships, x, y);
  if (outcome.result === 'repeat') return;
  applyShotVisual(battleRefs.ownCells, x, y, outcome.result, outcome.shipCells, outcome.autoMiss, 'Соперник');
  network.sendShotResult(x, y, outcome.result, outcome.shipCells, outcome.autoMiss);

  if (outcome.result === 'win') {
    gameOverFlag = true;
    showGameOver(false, 'Ваш флот потоплен соперником...');
    return;
  }
  if (outcome.result === 'miss') {
    onlineMyTurn = true;
    updateTurnIndicator('Ваш ход');
  }
});

// Результат моего выстрела по доске соперника.
network.on('shot_result', ({ x, y, result, shipCells, autoMiss }) => {
  if (currentMode !== 'online' || !battleRefs || gameOverFlag) return;
  applyShotVisual(battleRefs.enemyCells, x, y, result, shipCells, autoMiss, 'Вы');
  if (result === 'sunk' || result === 'win') {
    onlineEnemySunk++;
    updateOnlineFS();
  }

  if (result === 'win') {
    gameOverFlag = true;
    showGameOver(true, 'Вы потопили весь флот соперника!');
    return;
  }
  if (result === 'miss') {
    onlineMyTurn = false;
    updateTurnIndicator('Ход соперника…');
  } else {
    onlineMyTurn = true;
    updateTurnIndicator('Ваш ход');
  }
});

network.on('opponent_left', () => {
  onlinePeerConnected = false;
  notifyOpponentLeft();
});

// ==================== ГЛОБАЛЬНАЯ ИНИЦИАЛИЗАЦИЯ UI ====================

function initNav() {
  document.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      audio.click();
      if (btn.dataset.nav === 'menu' && currentMode === 'online') {
        network.leave();
        resetOnlineState();
        currentMode = null;
      }
      showScreen('screen-' + btn.dataset.nav);
    });
  });
}

function initSoundToggle() {
  const btn = document.getElementById('sound-toggle');
  btn.textContent = audio.muted ? '🔇' : '🔊';
  btn.addEventListener('click', () => {
    const m = audio.toggleMuted();
    btn.textContent = m ? '🔇' : '🔊';
  });
}

function initDifficulty() {
  let selected = 'normal';
  document.querySelectorAll('.btn-diff').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.btn-diff').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      selected = b.dataset.diff;
      audio.select();
    });
  });
  document.getElementById('start-vs-computer').addEventListener('click', () => {
    audio.click();
    startVsComputer(selected);
  });
}

function initHotseat() {
  document.getElementById('start-hotseat').addEventListener('click', () => {
    audio.click();
    startHotseat();
  });
}

function initOnline() {
  document.getElementById('online-create').addEventListener('click', () => {
    audio.click();
    resetOnlineState();
    const code = network.createRoom();
    onlineRoomCode = code;
    const statusEl = document.getElementById('online-status');
    statusEl.textContent = `Комната создана! Код: ${code} — отправьте другу и ждите подключения…`;
    startOnlinePlacement();
  });

  function doJoin() {
    audio.click();
    const code = document.getElementById('online-code-input').value.trim().toUpperCase();
    if (!code || code.length !== 4) return;
    resetOnlineState();
    network.joinRoom(code);
    onlineRoomCode = code;
    const statusEl = document.getElementById('online-status');
    statusEl.textContent = 'Подключение к комнате…';
    startOnlinePlacement();
  }
  document.getElementById('online-join').addEventListener('click', doJoin);
  document.getElementById('online-code-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doJoin();
  });
}

function init() {
  initNav();
  initSoundToggle();
  initDifficulty();
  initHotseat();
  initOnline();
  showScreen('screen-menu');
}

init();
