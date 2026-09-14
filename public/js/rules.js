// Общая логика игры "Морской бой" — версия для браузера (ES-модуль).
// Логика зеркалит shared/rules.js на сервере (для онлайн-режима сервер — источник истины).

export const BOARD_SIZE = 10;
export const FLEET = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];

export function createEmptyGrid(size = BOARD_SIZE) {
  return Array.from({ length: size * size }, () => ({
    ship: null,
    state: 'empty'
  }));
}

export function idx(x, y, size = BOARD_SIZE) {
  return y * size + x;
}

export function inBounds(x, y, size = BOARD_SIZE) {
  return x >= 0 && x < size && y >= 0 && y < size;
}

export function cellsForShip(x, y, size, horizontal) {
  const cells = [];
  for (let i = 0; i < size; i++) {
    cells.push(horizontal ? { x: x + i, y } : { x, y: y + i });
  }
  return cells;
}

export function neighbors(x, y, size = BOARD_SIZE) {
  const out = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx, ny = y + dy;
      if (inBounds(nx, ny, size)) out.push({ x: nx, y: ny });
    }
  }
  return out;
}

export function canPlaceShip(grid, x, y, shipSize, horizontal, boardSize = BOARD_SIZE) {
  const cells = cellsForShip(x, y, shipSize, horizontal);
  for (const c of cells) {
    if (!inBounds(c.x, c.y, boardSize)) return false;
    if (grid[idx(c.x, c.y, boardSize)].ship !== null) return false;
    for (const n of neighbors(c.x, c.y, boardSize)) {
      if (grid[idx(n.x, n.y, boardSize)].ship !== null) return false;
    }
  }
  return true;
}

export function placeShip(grid, ships, x, y, shipSize, horizontal, boardSize = BOARD_SIZE) {
  const cells = cellsForShip(x, y, shipSize, horizontal);
  const id = ships.length;
  for (const c of cells) {
    grid[idx(c.x, c.y, boardSize)].ship = id;
  }
  ships.push({ id, size: shipSize, cells, hits: [], sunk: false });
  return id;
}

export function randomFleetPlacement(boardSize = BOARD_SIZE, fleet = FLEET) {
  const grid = createEmptyGrid(boardSize);
  const ships = [];
  for (const size of fleet) {
    let placed = false;
    let attempts = 0;
    while (!placed && attempts < 2000) {
      attempts++;
      const horizontal = Math.random() < 0.5;
      const x = Math.floor(Math.random() * boardSize);
      const y = Math.floor(Math.random() * boardSize);
      if (canPlaceShip(grid, x, y, size, horizontal, boardSize)) {
        placeShip(grid, ships, x, y, size, horizontal, boardSize);
        placed = true;
      }
    }
    if (!placed) {
      return randomFleetPlacement(boardSize, fleet);
    }
  }
  return { grid, ships };
}

export function resolveShot(grid, ships, x, y, boardSize = BOARD_SIZE) {
  const cell = grid[idx(x, y, boardSize)];
  if (cell.state === 'hit' || cell.state === 'miss') {
    return { result: 'repeat' };
  }
  if (cell.ship === null) {
    cell.state = 'miss';
    return { result: 'miss' };
  }
  cell.state = 'hit';
  const ship = ships[cell.ship];
  ship.hits.push({ x, y });
  if (ship.hits.length >= ship.size) {
    ship.sunk = true;
    const around = new Set();
    for (const c of ship.cells) {
      for (const n of neighbors(c.x, c.y, boardSize)) {
        const ncell = grid[idx(n.x, n.y, boardSize)];
        if (ncell.ship === null && ncell.state === 'empty') {
          ncell.state = 'miss';
          around.add(`${n.x},${n.y}`);
        }
      }
    }
    const allSunk = ships.every(s => s.sunk);
    return {
      result: allSunk ? 'win' : 'sunk',
      shipCells: ship.cells,
      autoMiss: [...around].map(s => {
        const [ax, ay] = s.split(',').map(Number);
        return { x: ax, y: ay };
      })
    };
  }
  return { result: 'hit' };
}
