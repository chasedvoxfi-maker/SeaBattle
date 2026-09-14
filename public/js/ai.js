// ИИ противника: режимы "охота" (случайный/вероятностный поиск) и "добивание" (после попадания).
import { BOARD_SIZE, FLEET } from './rules.js';

function key(x, y) { return `${x},${y}`; }

export class AI {
  constructor(difficulty = 'normal', boardSize = BOARD_SIZE, fleet = FLEET) {
    this.difficulty = difficulty;
    this.size = boardSize;
    this.remainingSizes = [...fleet];
    this.state = new Array(boardSize * boardSize).fill('unknown'); // unknown|miss|hit|sunk
    this.hitStack = [];
    this.direction = null; // {dx,dy}
  }

  idx(x, y) { return y * this.size + x; }
  inBounds(x, y) { return x >= 0 && x < this.size && y >= 0 && y < this.size; }
  isShot(x, y) { const s = this.state[this.idx(x, y)]; return s !== 'unknown'; }

  // ---------- выбор следующего выстрела ----------
  nextShot() {
    if (this.hitStack.length > 0) {
      const targeted = this._targetModeShot();
      if (targeted) return targeted;
    }
    return this._huntModeShot();
  }

  _targetModeShot() {
    if (this.direction) {
      const dir = this.direction;
      const proj = (p) => (dir.dx !== 0 ? p.x : p.y);
      let min = this.hitStack[0], max = this.hitStack[0];
      for (const h of this.hitStack) {
        if (proj(h) < proj(min)) min = h;
        if (proj(h) > proj(max)) max = h;
      }
      const forward = { x: max.x + dir.dx, y: max.y + dir.dy };
      const backward = { x: min.x - dir.dx, y: min.y - dir.dy };
      const candidates = [];
      if (this.inBounds(forward.x, forward.y) && !this.isShot(forward.x, forward.y)) candidates.push(forward);
      if (this.inBounds(backward.x, backward.y) && !this.isShot(backward.x, backward.y)) candidates.push(backward);
      if (candidates.length > 0) return candidates[Math.floor(Math.random() * candidates.length)];
      // оба конца упёрлись — сбрасываем направление, попробуем соседей известных попаданий
      this.direction = null;
    }
    const candidates = [];
    for (const h of this.hitStack) {
      const around = [
        { x: h.x + 1, y: h.y }, { x: h.x - 1, y: h.y },
        { x: h.x, y: h.y + 1 }, { x: h.x, y: h.y - 1 }
      ];
      for (const c of around) {
        if (this.inBounds(c.x, c.y) && !this.isShot(c.x, c.y)) candidates.push(c);
      }
    }
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  _huntModeShot() {
    const minShip = Math.min(...this.remainingSizes, 1);
    const unknownCells = [];
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.state[this.idx(x, y)] === 'unknown') unknownCells.push({ x, y });
      }
    }
    if (unknownCells.length === 0) return null;

    if (this.difficulty === 'easy') {
      return unknownCells[Math.floor(Math.random() * unknownCells.length)];
    }

    if (this.difficulty === 'hard') {
      return this._densityShot(unknownCells);
    }

    // normal: шахматная раскладка по чётности + случайность
    const parityCells = unknownCells.filter(c => (c.x + c.y) % minShip === 0);
    const pool = parityCells.length > 0 ? parityCells : unknownCells;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  _densityShot(unknownCells) {
    const density = new Array(this.size * this.size).fill(0);
    const sizes = [...new Set(this.remainingSizes)];
    for (const size of sizes) {
      for (let horizontal = 0; horizontal < 2; horizontal++) {
        const maxX = horizontal ? this.size - size : this.size - 1;
        const maxY = horizontal ? this.size - 1 : this.size - size;
        for (let y = 0; y <= maxY; y++) {
          for (let x = 0; x <= maxX; x++) {
            const cells = [];
            let valid = true;
            let hitBonus = 0;
            for (let i = 0; i < size; i++) {
              const cx = horizontal ? x + i : x;
              const cy = horizontal ? y : y + i;
              const s = this.state[this.idx(cx, cy)];
              if (s === 'miss' || s === 'sunk') { valid = false; break; }
              if (s === 'hit') hitBonus += 8;
              cells.push({ x: cx, y: cy });
            }
            if (!valid) continue;
            for (const c of cells) {
              if (this.state[this.idx(c.x, c.y)] === 'unknown') {
                density[this.idx(c.x, c.y)] += 1 + hitBonus;
              }
            }
          }
        }
      }
    }
    let best = -1;
    let bestCells = [];
    for (const c of unknownCells) {
      const d = density[this.idx(c.x, c.y)];
      if (d > best) { best = d; bestCells = [c]; }
      else if (d === best) bestCells.push(c);
    }
    return bestCells[Math.floor(Math.random() * bestCells.length)];
  }

  // ---------- регистрация результата выстрела ----------
  registerResult(x, y, result, extra = {}) {
    if (result === 'miss') {
      this.state[this.idx(x, y)] = 'miss';
      return;
    }
    // hit / sunk / win
    this.state[this.idx(x, y)] = 'hit';
    this.hitStack.push({ x, y });

    if (!this.direction && this.hitStack.length >= 2) {
      const a = this.hitStack[0];
      for (let i = 1; i < this.hitStack.length; i++) {
        const b = this.hitStack[i];
        if (a.x === b.x && a.y !== b.y) { this.direction = { dx: 0, dy: Math.sign(b.y - a.y) }; break; }
        if (a.y === b.y && a.x !== b.x) { this.direction = { dx: Math.sign(b.x - a.x), dy: 0 }; break; }
      }
    }

    if (result === 'sunk' || result === 'win') {
      if (extra.shipCells) {
        for (const c of extra.shipCells) this.state[this.idx(c.x, c.y)] = 'sunk';
        const sunkSize = extra.shipCells.length;
        const pos = this.remainingSizes.indexOf(sunkSize);
        if (pos !== -1) this.remainingSizes.splice(pos, 1);
      }
      if (extra.autoMiss) {
        for (const c of extra.autoMiss) this.state[this.idx(c.x, c.y)] = 'miss';
      }
      this.hitStack = [];
      this.direction = null;
    }
  }
}
