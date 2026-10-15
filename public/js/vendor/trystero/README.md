Вендоринг библиотеки [Trystero](https://github.com/dmotz/trystero) (пакеты
`@trystero-p2p/core` и `@trystero-p2p/torrent`, версия 0.26.0, MIT-лицензия,
см. LICENSE) — обеспечивает serverless P2P-соединение (WebRTC с поиском пиров
через публичные BitTorrent-трекеры) для онлайн-режима игры.

Файлы скопированы из npm-пакетов как есть, единственное изменение — путь
импорта в torrent.mjs поправлен на локальный `./core/index.mjs` вместо
пакетного `@trystero-p2p/core`, чтобы всё работало без сборщика, напрямую
через `<script type="module">`.
