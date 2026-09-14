// Общая логика игры "Морской бой" — используется сервером (CommonJS).
// Зеркальная копия для браузера лежит в public/js/rules.js (ES-модуль).

const BOARD_SIZE = 10;
const FLEET = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1]; // классический русский состав флота

function createEmptyGrid(size = BOARD_SIZE) {
  return Array.from({ length: size * size }, () => ({
    ship: null,   // id корабля, если есть
    state: 'empty' // empty | hit | miss
  }));
}

function idx(x, y, size = BOARD_SIZE) {
  return y * size + x;
}

function inBounds(x, y, size = BOARD_SIZE) {
  return x >= 0 && x < size && y >= 0 && y < size;
}

function cellsForShip(x, y, size, horizontal) {
  const cells = [];
  for (let i = 0; i < size; i++) {
    cells.push(horizontal ? { x: x + i, y } : { x, y: y + i });
  }
  return cells;
}

function neighbors(x, y, size = BOARD_SIZE) {
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

// Проверяет можно ли поставить корабль (в границах, не пересекается и не касается других)
function canPlaceShip(grid, x, y, shipSize, horizontal, boardSize = BOARD_SIZE) {
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

function placeShip(grid, ships, x, y, shipSize, horizontal, boardSize = BOARD_SIZE) {
  const cells = cellsForShip(x, y, shipSize, horizontal);
  const id = ships.length;
  for (const c of cells) {
    grid[idx(c.x, c.y, boardSize)].ship = id;
  }
  ships.push({ id, size: shipSize, cells, hits: [], sunk: false });
  return id;
}

function randomFleetPlacement(boardSize = BOARD_SIZE, fleet = FLEET) {
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
      // перезапускаем целиком в редком случае неудачи
      return randomFleetPlacement(boardSize, fleet);
    }
  }
  return { grid, ships };
}

// Валидирует присланную клиентом расстановку (массив кораблей {x,y,size,horizontal})
function validatePlacement(placement, boardSize = BOARD_SIZE, fleet = FLEET) {
  if (!Array.isArray(placement) || placement.length !== fleet.length) return null;
  const sizesNeeded = [...fleet].sort((a, b) => a - b);
  const sizesGiven = placement.map(s => s.size).sort((a, b) => a - b);
  if (JSON.stringify(sizesNeeded) !== JSON.stringify(sizesGiven)) return null;

  const grid = createEmptyGrid(boardSize);
  const ships = [];
  for (const s of placement) {
    if (typeof s.x !== 'number' || typeof s.y !== 'number' || typeof s.size !== 'number') return null;
    if (!canPlaceShip(grid, s.x, s.y, s.size, !!s.horizontal, boardSize)) return null;
    placeShip(grid, ships, s.x, s.y, s.size, !!s.horizontal, boardSize);
  }
  return { grid, ships };
}

// Обрабатывает выстрел по доске (грид+корабли мутируются)
function resolveShot(grid, ships, x, y, boardSize = BOARD_SIZE) {
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

module.exports = {
  BOARD_SIZE,
  FLEET,
  createEmptyGrid,
  idx,
  inBounds,
  cellsForShip,
  neighbors,
  canPlaceShip,
  placeShip,
  randomFleetPlacement,
  validatePlacement,
  resolveShot
};
