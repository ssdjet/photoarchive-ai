# PhotoArchive AI

Локальный умный фотоархив с семантическим поиском, автотегами, кластерами лиц, дедупликацией и файловыми операциями через веб-интерфейс.

## Что реализовано

- Next.js App Router + TypeScript + Tailwind CSS + TanStack Query + Framer Motion + Lucide.
- Fastify API на Node.js 20+ с ESM/TypeScript.
- SQLite через `better-sqlite3` для метаданных, логов, настроек и операций.
- Qdrant для векторного поиска; при недоступности Qdrant используется локальный SQLite/cosine fallback, чтобы приложение оставалось запускаемым.
- Redis для очереди индексации; при недоступности Redis используется in-memory queue.
- Индексация: обход папок, EXIF, даты, GPS, миниатюры, SHA-256, perceptual hash, эмбеддинги, теги, объекты, лица, карантин битых файлов.
- Дубликаты: точные по SHA-256 и near-duplicate по векторному сходству, выбор canonical version, массовые действия с подтверждением.
- Файловые операции: delete/copy/move только внутри корня архива, с логированием и защитой от случайной массовой операции.
- UI: dashboard, поиск, дубликаты, лица, карточка фото, логи, настройки.
- ONNX/DirectML-адаптер: динамически подхватывает локально установленный `onnxruntime-directml` на Windows или `onnxruntime-node`; без моделей работает честный fallback-режим для запуска и тестов.

## Быстрый старт локально

Требования: Node.js 20+, npm 10+, Docker Desktop с WSL2 — опционально для Qdrant/Redis.

```bash
git clone https://github.com/ssdjet/photoarchive-ai.git
cd photoarchive-ai
npm install
cp .env.example .env
```

Запустите инфраструктуру, если нужны Qdrant/Redis:

```bash
npm run compose:infra
```

Запустите API и web:

```bash
npm run dev
```

Откройте `http://localhost:3000`, перейдите в «Настройки», укажите корень архива и запустите полную индексацию с dashboard.

## Запуск через Docker Compose

```bash
# Linux/macOS
ARCHIVE_HOST_PATH=/absolute/path/to/photos docker compose up -d --build

# Windows PowerShell
$env:ARCHIVE_HOST_PATH='D:\PhotoArchive'; docker compose up -d --build
```

Web UI: `http://localhost:3000`, API: `http://localhost:4000`.

## AI-модели и DirectML

По умолчанию приложение не отправляет фото во внешние сервисы и работает в fallback-режиме: метаданные, эвристические теги, exact duplicates. Для настоящего CLIP/face/scene поиска:

1. Скачайте ONNX-модели локально в `models/`.
2. Установите runtime:
   - CPU: `npm install onnxruntime-node --workspace apps/api`
   - Windows DirectML: установите локальный DirectML-билд ONNX Runtime, доступный как модуль `onnxruntime-directml`.
3. Укажите пути в `.env` или UI:
   - `CLIP_MODEL_PATH`
   - `CLIP_TEXT_MODEL_PATH`
   - `TOKENIZER_PATH`
   - `FACE_DETECTION_MODEL_PATH`
   - `FACE_RECOGNITION_MODEL_PATH`
   - `SCENE_MODEL_PATH`
4. Перезапустите API и запустите полную индексацию.

`TOKENIZER_PATH` поддерживает простой JSON vocab формата `{ "токен": id }` или Hugging Face-like `{ "vocab": {...} }`. Для точного CLIP токенизатора используйте модель, совместимую с таким vocab; сложные BPE/SentencePiece токенизаторы требуют отдельного адаптера.

## Проверки

```bash
npm run check
npm run test
npm run build
docker compose config
```

## Структура

```text
apps/web       Next.js App Router UI
apps/api       Fastify API, SQLite, indexing, AI adapter
packages/shared Shared TypeScript contracts
verifier       Acceptance criteria and run logs
docs           Installation and user guide
```

## Лицензия

[MIT](LICENSE)
