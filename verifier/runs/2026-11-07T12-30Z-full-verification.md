# Verification run — 2026-11-07T12:30Z

## Environment
- Sandbox: Linux, Node 20.20.2, no Docker daemon (compose validated via YAML parse)
- AI provider: fallback-local (no ONNX models in sandbox — expected)
- Vector store: sqlite_vector (Qdrant unreachable in sandbox — fallback path exercised)
- Queue: memory (Redis unavailable — fallback path exercised)

## Results

### 1. Static checks
- `npm run check` (tsc, all 3 workspaces): 0 errors
- Web production build: OK, 8 routes (/, /dashboard, /search, /duplicates, /faces, /logs, /settings static; /photos/[id] dynamic)
- API build (tsc): OK

### 2. Unit + integration tests (vitest)
- Test files: 2 passed (2)
- Tests: 10 passed (10)
  - unit: embeddings, resizeVector, date inference, perceptual hash, path safety (6/6)
  - integration: indexing pipeline w/ quarantine + duplicates + search + canonical switch + thumbnail; bulk delete >10 confirmation; copy/move; face cluster rename/split/merge (4/4)

### 3. Docker
- `docker compose config`: docker binary absent in sandbox; YAML parse OK — services qdrant, redis, api, web all present with correct build contexts and ports

### 4. Live smoke test (API + Next.js production, Chromium via Playwright)
- GET /health: 200, provider=fallback-local, vectorStore=sqlite_vector
- POST /api/index/start → status polling: completed 3/3, 0 failed
- GET /api/stats: photos=3, tags=4, locations=3
- GET /api/search?q=photo: 200, total=3, engine=metadata_fts
- GET /api/search?q=закат: total=0 (correct — no semantic model in fallback mode)
- GET /api/photos/:id: 200; thumbnail: 200 image/jpeg
- GET /api/logs: 200
- Browser (desktop 1440px): /dashboard /search /duplicates /faces /logs /settings all HTTP 200, 0 console errors, 0 pageerrors
- Browser (mobile 375px): /dashboard HTTP 200, 0 errors
- Dashboard badges show honest fallback state: "SQLite (local)", "in-memory" (fix verified after adding vectorStoreKind/queueKind to /api/stats)
- Search interaction: query "photo" → 3 results rendered with thumbnails, tags, pagination

## Fixed during this run
- Dashboard AI-provider card claimed "Qdrant"/"Redis" even when running on fallbacks → added vectorStoreKind/queueKind to ArchiveStats and badge now shows actual engine

## Not verifiable in sandbox (documented limitations)
- Radeon DirectML acceleration (no GPU/Windows in sandbox)
- Real CLIP/face/OCR semantics (no ONNX model files)
- 5000+ photo load test (sandbox scale)
- `docker compose up` end-to-end (no Docker daemon)
