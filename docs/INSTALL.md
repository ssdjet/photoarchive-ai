# Установка и запуск

## Требования

- Node.js 20+ и npm 10+ (для локального запуска без Docker)
- Docker с Compose plugin (рекомендуемый способ)
- Для GPU-ускорения на Windows: драйвер Radeon + пакет `onnxruntime-directml` (ставится локально, см. ниже)

## Вариант 1. Docker Compose (рекомендуется)

```bash
git clone https://github.com/ssdjet/photoarchive-ai.git
cd photoarchive-ai
cp .env.example .env
# укажите ARCHIVE_DIR — папку с фотографиями, в .env или как переменную окружения
ARCHIVE_DIR=/path/to/photos docker compose up --build
```

Откройте http://localhost:3000 — дашборд, запуск индексации кнопкой «Запустить полную индексацию».

Сервисы: Qdrant (вектора), Redis (очередь), API (порт 4000), Web (порт 3000).
Если Qdrant/Redis недоступны, приложение автоматически использует SQLite-вектора и in-memory очередь.

## Вариант 2. Локальный запуск без Docker

```bash
npm ci
npm run build
cp .env.example .env   # при необходимости поправьте ARCHIVE_ROOT
npm start              # API на :4000
# в другом терминале:
npm run start -w apps/web   # Web на :3000
```

## Настройка AI-моделей

Приложение стартует без моделей в режиме `fallback-local` (эвристические теги, поиск по метаданным).
Для полноценной семантики:

1. Скачайте ONNX-модели (CLIP image+text, face detection/recognition, scene).
2. Укажите пути в `.env`:
   - `CLIP_MODEL_PATH`, `CLIP_TEXT_MODEL_PATH`, `TOKENIZER_PATH` (vocab JSON для текстового энкодера)
   - `FACE_DETECTION_MODEL_PATH`, `FACE_RECOGNITION_MODEL_PATH`, `SCENE_MODEL_PATH`
3. Перезапустите API. Статус провайдера виден на дашборде.

### DirectML (Windows, Radeon)

```powershell
npm install onnxruntime-directml   # пакет не опубликован на npmjs — ставится из локального источника/реестра
$env:DIRECTML="on"
```

Если пакет недоступен, используется `onnxruntime-node` (CPU) — приложение остаётся полностью рабочим.

## OCR

`OCR_ENABLED=true` в `.env` включает tesseract.js (языки через `OCR_LANGUAGES=rus+eng`). OCR выполняется локально.

## Тесты и проверки

```bash
npm run check   # typecheck всех workspaces
npm run test    # unit + integration (10 тестов)
npm run build   # production-сборка
```
