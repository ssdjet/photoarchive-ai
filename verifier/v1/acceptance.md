# Verifier v1 — Acceptance Criteria

Date: 2026-11-07
Project: PhotoArchive AI

## Must-pass gates

1. **Repository structure**
   - Monorepo contains `apps/web` (Next.js App Router + TypeScript + Tailwind + TanStack Query + Lucide + Framer Motion), `apps/api` (Node.js 20+ ESM TypeScript + Fastify), `packages/shared`, `docker-compose.yml`, `.env.example`, install/user docs.
2. **Backend functionality**
   - Fastify exposes typed REST endpoints for health, stats, indexing, search, duplicates, face clusters, photo details/thumbnails/files, logs, settings, quarantine, and confirmed file operations.
   - SQLite schema includes photos, embeddings, faces/clusters, objects/scenes, locations, tags, duplicates, logs, settings, indexing runs.
   - Indexing is idempotent, tracks progress, extracts EXIF/date/GPS where possible, generates thumbnails, hashes files, detects exact and near duplicates, quarantines broken files, and writes operation logs.
   - Semantic/vector search uses Qdrant when configured; falls back to local cosine/FTS metadata mode when Qdrant is unavailable so the app remains runnable and testable.
   - File delete/copy/move require explicit confirmation for >10 files and validate that paths stay inside the configured archive.
3. **AI integration**
   - Model adapter supports local ONNX Runtime sessions and DirectML-provider detection; if model files/DirectML are absent it uses a deterministic local fallback provider and reports provider status honestly.
   - OCR is toggleable and disabled by default.
4. **Frontend functionality**
   - UI includes dashboard, search, duplicates, face clusters, photo view, logs, and settings screens.
   - All controls have reachable actions; bulk destructive actions show confirmation; loading/error/empty states are implemented.
5. **Quality gates**
   - `npm run check` passes (TypeScript typecheck/lint equivalent).
   - `npm run test` passes for backend unit/integration tests.
   - `npm run build` passes for web and API.
   - Docker Compose config is valid for Qdrant/Redis/API/Web services.
   - Browser smoke test: web app opens, dashboard/search render without console errors, API is reachable.
6. **Privacy**
   - No external AI service calls are required for normal operation; embeddings and metadata stay local.

## Known environment limitations for this verifier

- The sandbox cannot validate real Radeon DirectML acceleration or a 5,000-photo production archive.
- Real ONNX models are not committed; the app must start and pass tests using local fallback mode, then use real models when paths are configured.
