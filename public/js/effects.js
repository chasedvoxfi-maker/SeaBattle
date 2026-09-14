// Визуальные эффекты: частицы на canvas (взрывы, салют) + вспомогательные DOM-эффекты на клетках.

const canvas = document.getElementById('fx-canvas');
const ctx = canvas.getContext('2d');
let particles = [];
let dpr = Math.max(1, window.devicePixelRatio || 1);
let running = false;

function resize() {
  dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

function loop() {
  if (particles.length === 0) {
    running = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  running = true;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const next = [];
  for (const p of particles) {
    p.vy += p.gravity;
    p.vx *= p.drag;
    p.vy *= p.drag;
    p.x += p.vx;
    p.y += p.vy;
    p.life -= 1;
    if (p.life > 0) {
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      if (p.shape === 'spark') {
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size * (0.4 + alpha * 0.6));
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.5 + alpha * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
      next.push(p);
    }
  }
  ctx.globalAlpha = 1;
  particles = next;
  requestAnimationFrame(loop);
}

function ensureLoop() {
  if (!running) requestAnimationFrame(loop);
}

const EXPLOSION_COLORS = ['#fff2c4', '#ffd166', '#ff9f45', '#ff5e3a', '#c73b1d', '#6b6b6b'];
const FIREWORK_PALETTES = [
  ['#ff6b6b', '#ffd166', '#fff'],
  ['#4aa3ff', '#8be9fd', '#fff'],
  ['#7bed9f', '#ffd166', '#fff'],
  ['#ff9ff3', '#feca57', '#fff']
];

export function explosionBurst(x, y, { count = 46, power = 6.5, smoke = true } = {}) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (0.4 + Math.random()) * power;
    const isSpark = Math.random() < 0.5;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - power * 0.25,
      gravity: 0.18,
      drag: 0.965,
      life: 30 + Math.random() * 30,
      maxLife: 60,
      size: isSpark ? 2 + Math.random() * 3 : 2 + Math.random() * 4,
      shape: isSpark ? 'spark' : 'round',
      color: EXPLOSION_COLORS[Math.floor(Math.random() * EXPLOSION_COLORS.length)]
    });
  }
  if (smoke) {
    for (let i = 0; i < 14; i++) {
      const angle = Math.random() * Math.PI * 2;
      particles.push({
        x, y,
        vx: Math.cos(angle) * 1.2,
        vy: Math.sin(angle) * 1.2 - 1.6,
        gravity: -0.02,
        drag: 0.97,
        life: 60 + Math.random() * 40,
        maxLife: 100,
        size: 6 + Math.random() * 10,
        shape: 'round',
        color: 'rgba(90,90,90,0.5)'
      });
    }
  }
  ensureLoop();
}

export function splashBurst(x, y) {
  for (let i = 0; i < 14; i++) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
    const speed = 1.5 + Math.random() * 3;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      gravity: 0.22,
      drag: 0.98,
      life: 22 + Math.random() * 14,
      maxLife: 36,
      size: 1.5 + Math.random() * 2.5,
      shape: 'round',
      color: '#8fd3ff'
    });
  }
  ensureLoop();
}

export function fireworksShow(durationMs = 3000, boundsEl = null) {
  const rect = boundsEl ? boundsEl.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight * 0.6 };
  let elapsed = 0;
  const step = 420;
  function burstOnce() {
    const palette = FIREWORK_PALETTES[Math.floor(Math.random() * FIREWORK_PALETTES.length)];
    const x = rect.left + Math.random() * rect.width;
    const y = rect.top + Math.random() * Math.max(80, rect.height * 0.7) + 20;
    for (let i = 0; i < 55; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (0.5 + Math.random()) * 5.5;
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        gravity: 0.09,
        drag: 0.975,
        life: 45 + Math.random() * 25,
        maxLife: 70,
        size: 2 + Math.random() * 2.5,
        shape: Math.random() < 0.5 ? 'spark' : 'round',
        color: palette[Math.floor(Math.random() * palette.length)]
      });
    }
    ensureLoop();
    elapsed += step;
    if (elapsed < durationMs) setTimeout(burstOnce, step * (0.6 + Math.random() * 0.8));
  }
  burstOnce();
}

export function screenShake() {
  const app = document.getElementById('app');
  app.classList.remove('shake');
  // форсируем reflow чтобы анимация перезапустилась при повторных вызовах
  void app.offsetWidth;
  app.classList.add('shake');
  setTimeout(() => app.classList.remove('shake'), 420);
}

// ---------- DOM-эффекты на клетках доски ----------

export function cellCenter(cellEl) {
  const r = cellEl.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export function markCellMiss(cellEl) {
  cellEl.classList.add('miss');
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  cellEl.appendChild(ripple);
  setTimeout(() => ripple.remove(), 650);
  const { x, y } = cellCenter(cellEl);
  splashBurst(x, y);
}

export function markCellHit(cellEl) {
  cellEl.classList.add('hit');
  cellEl.innerHTML = '<span class="fire">🔥</span><span class="smoke"></span><span class="smoke"></span><span class="smoke"></span>';
  const { x, y } = cellCenter(cellEl);
  explosionBurst(x, y, { count: 22, power: 3.5, smoke: false });
}

export function markCellSunk(cellEl) {
  cellEl.classList.remove('hit');
  cellEl.classList.add('sunk', 'exploding');
  cellEl.innerHTML = '<span class="wreck">☠️</span>';
  const { x, y } = cellCenter(cellEl);
  explosionBurst(x, y, { count: 60, power: 7 });
  setTimeout(() => cellEl.classList.remove('exploding'), 500);
}
