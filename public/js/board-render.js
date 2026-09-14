// Рендер игрового поля 10x10 в DOM.
import { BOARD_SIZE } from './rules.js';

export function buildBoardDOM(containerEl, { size = BOARD_SIZE, onCellClick, onCellEnter, onCellLeave } = {}) {
  containerEl.innerHTML = '';
  const cells = new Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.x = x;
      cell.dataset.y = y;
      if (onCellClick) cell.addEventListener('click', () => onCellClick(x, y, cell));
      if (onCellEnter) cell.addEventListener('mouseenter', () => onCellEnter(x, y, cell));
      if (onCellLeave) cell.addEventListener('mouseleave', () => onCellLeave(x, y, cell));
      containerEl.appendChild(cell);
      cells[y * size + x] = cell;
    }
  }
  return cells;
}

export function cellAt(cells, x, y, size = BOARD_SIZE) {
  if (x < 0 || y < 0 || x >= size || y >= size) return null;
  return cells[y * size + x];
}

export function clearPreview(cells) {
  for (const c of cells) c.classList.remove('preview-ok', 'preview-bad');
}

export function renderOwnShips(cells, ships) {
  for (const ship of ships) {
    for (const c of ship.cells) {
      const el = cellAt(cells, c.x, c.y);
      if (el) el.classList.add('ship');
    }
  }
}

// Статичная (без частиц/звука) отрисовка клетки — для полной перерисовки поля.
export function paintCell(cellEl, kind) {
  cellEl.classList.remove('ship', 'hit', 'miss', 'sunk');
  cellEl.innerHTML = '';
  if (kind === 'ship') {
    cellEl.classList.add('ship');
  } else if (kind === 'hit') {
    cellEl.classList.add('hit');
    cellEl.innerHTML = '<span class="fire">🔥</span>';
  } else if (kind === 'miss') {
    cellEl.classList.add('miss');
  } else if (kind === 'sunk') {
    cellEl.classList.add('sunk');
    cellEl.innerHTML = '<span class="wreck">☠️</span>';
  }
}

// Полная перерисовка "своего" поля — показывает все свои корабли.
export function paintOwnBoard(cells, boardState, size = BOARD_SIZE) {
  for (const c of cells) { c.classList.remove('ship', 'hit', 'miss', 'sunk'); c.innerHTML = ''; }
  for (const ship of boardState.ships) {
    for (const c of ship.cells) {
      const el = cellAt(cells, c.x, c.y, size);
      if (!el) continue;
      if (ship.sunk) paintCell(el, 'sunk');
      else if (ship.hits.some(h => h.x === c.x && h.y === c.y)) paintCell(el, 'hit');
      else paintCell(el, 'ship');
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cell = boardState.grid[y * size + x];
      if (cell.ship === null && cell.state === 'miss') {
        paintCell(cellAt(cells, x, y, size), 'miss');
      }
    }
  }
}

// Полная перерисовка "вражеского" поля — только известная информация (туман войны).
export function paintEnemyBoard(cells, boardState, size = BOARD_SIZE) {
  for (const c of cells) { c.classList.remove('ship', 'hit', 'miss', 'sunk'); c.innerHTML = ''; }
  for (const ship of boardState.ships) {
    if (ship.sunk) {
      for (const c of ship.cells) paintCell(cellAt(cells, c.x, c.y, size), 'sunk');
    } else {
      for (const h of ship.hits) paintCell(cellAt(cells, h.x, h.y, size), 'hit');
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cell = boardState.grid[y * size + x];
      if (cell.ship === null && cell.state === 'miss') {
        paintCell(cellAt(cells, x, y, size), 'miss');
      }
    }
  }
}
