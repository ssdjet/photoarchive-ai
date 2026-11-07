# Installation guide

## Windows 11

1. Включите long paths:
   - `git config --system core.longpaths true`
   - Group Policy: Computer Configuration > Administrative Templates > System > Filesystem > Enable Win32 long paths.
2. Установите Node.js 20+ и Docker Desktop с WSL2 backend.
3. Клонируйте репозиторий и установите зависимости:

```powershell
git clone https://github.com/ssdjet/photoarchive-ai.git
cd photoarchive-ai
npm install
copy .env.example .env
```

4. В `.env` укажите папки, например:

```env
DATA_DIR=D:\PhotoArchiveAI\data
ARCHIVE_ROOT=D:\Photos
QUARANTINE_FOLDER=D:\PhotoArchiveAI\quarantine
THUMBNAILS_FOLDER=D:\PhotoArchiveAI\thumbnails
```

5. Для Qdrant/Redis:

```powershell
npm run compose:infra
```

6. Запуск:

```powershell
npm run dev
```

## Docker

```powershell
$env:ARCHIVE_HOST_PATH='D:\Photos'
docker compose up -d --build
```

## ONNX Runtime и DirectML

- CPU fallback для тестов встроен и не требует внешних вызовов.
- Для реальных ONNX-сессий установите `onnxruntime-node` или локальный пакет `onnxruntime-directml`.
- DirectML-пакет в публичном npm отсутствует; приложение пробует загрузить его динамически и сообщает статус на dashboard/settings.
- Если DirectML не найден, используется CPU/fallback режим.

## Безопасность файловых операций

- Все copy/move/delete проверяют, что путь остаётся внутри `ARCHIVE_ROOT`.
- Операции с более чем 10 файлами требуют подтверждения.
- Все операции пишутся в SQLite и отображаются в логах.
