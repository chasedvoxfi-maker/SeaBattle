// Статический сервер для локальной разработки/тестирования.
// Онлайн-режим теперь работает через P2P (WebRTC) прямо в браузере — см. public/js/network.js —
// поэтому никакой игровой логики на сервере больше нет, нужна только раздача файлов.
// Для реального деплоя подойдёт любой статический хостинг (например, GitHub Pages).
const path = require('path');
const express = require('express');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Морской бой запущен: http://localhost:${PORT}`);
});
