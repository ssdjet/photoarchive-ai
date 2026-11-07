import fs from 'node:fs';
import path from 'node:path';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import mime from 'mime-types';
import { z } from 'zod';
import type { ArchiveSettings, SearchFilters } from '@photoarchive/shared';
import { loadConfig, type AppConfig } from './config.js';
import { AppDatabase } from './lib/database.js';
import { Logger } from './lib/logger.js';
import { createAiProvider } from './services/aiProvider.js';
import { FacesService } from './services/facesService.js';
import { FileOperationService } from './services/fileOperations.js';
import { IndexService } from './services/indexService.js';
import { toPhotoRecord, toPhotoRecords } from './services/photoMapper.js';
import { createIndexQueue } from './services/queue.js';
import { SearchService } from './services/searchService.js';
import { StatsService } from './services/statsService.js';
import { createVectorStore, type VectorStore } from './services/vectorStore.js';
import type { AiProvider } from './services/aiProvider.js';
import type { IndexQueue } from './services/queue.js';

export interface BuiltApp {
  app: FastifyInstance;
  config: AppConfig;
  db: AppDatabase;
  close: () => Promise<void>;
}

export async function buildApp(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): Promise<BuiltApp> {
  const config = loadConfig(env, cwd);
  const db = new AppDatabase(config.dataDir);
  const logger = new Logger(db, config.LOG_LEVEL);
  const aiProvider: AiProvider = await createAiProvider(
    db.getSettings({
      ...db.defaultSettings(),
      archiveRoot: config.archiveRoot,
      quarantineFolder: config.quarantineFolder,
      thumbnailsFolder: config.thumbnailsFolder,
      ocrEnabled: config.OCR_ENABLED,
      ocrLanguages: config.OCR_LANGUAGES,
      aiProvider: config.AI_PROVIDER,
      directml: config.DIRECTML,
      clipModelPath: config.CLIP_MODEL_PATH ?? null,
      clipTextModelPath: config.CLIP_TEXT_MODEL_PATH ?? null,
      tokenizerPath: config.TOKENIZER_PATH ?? null,
      faceDetectionModelPath: config.FACE_DETECTION_MODEL_PATH ?? null,
      faceRecognitionModelPath: config.FACE_RECOGNITION_MODEL_PATH ?? null,
      sceneModelPath: config.SCENE_MODEL_PATH ?? null,
      batchSize: config.BATCH_SIZE,
      nearDuplicateThreshold: config.NEAR_DUPLICATE_THRESHOLD
    }),
    logger
  );
  const vectorStore: VectorStore = createVectorStore(config, db);
  const queue: IndexQueue = await createIndexQueue(config, logger);
  const indexService = new IndexService(config, db, logger, aiProvider, vectorStore, queue);
  const searchService = new SearchService(config, db, logger, aiProvider, vectorStore);
  const fileOperations = new FileOperationService(db, logger, () => indexService.settings().archiveRoot);
  const faces = new FacesService(db);
  const stats = new StatsService(db, indexService, aiProvider, vectorStore, queue);

  const app = Fastify({
    logger: false,
    trustProxy: true
  });

  await app.register(cors, {
    origin: true
  });

  app.setErrorHandler((rawError, _request, reply) => {
    const error = rawError as { statusCode?: number; message?: string; stack?: string; name?: string };
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (statusCode >= 500) {
      logger.error('http', 'Unhandled request error', {
        message: error.message,
        stack: error.stack
      });
    }
    void reply.status(statusCode).send({
      error: statusCode >= 500 ? 'Internal Server Error' : error.name ?? 'Error',
      message: statusCode >= 500 ? 'Unexpected server error' : error.message ?? 'Request failed',
      statusCode
    });
  });

  app.setNotFoundHandler((_request, reply) => {
    void reply.status(404).send({ error: 'Not Found', message: 'Route not found', statusCode: 404 });
  });

  app.get('/health', async () => ({
    ok: true,
    provider: aiProvider.name,
    directml: aiProvider.directml,
    modelStatus: aiProvider.modelStatus,
    vectorStore: vectorStore.kind,
    queue: queue.kind
  }));

  app.get('/api/stats', async () => stats.stats());

  app.get('/api/settings', async () => indexService.settings());

  const settingsPatchSchema = z.object({
    archiveRoot: z.string().optional(),
    quarantineFolder: z.string().optional(),
    thumbnailsFolder: z.string().optional(),
    ocrEnabled: z.boolean().optional(),
    ocrLanguages: z.string().optional(),
    aiProvider: z.enum(['auto', 'onnx', 'fallback']).optional(),
    directml: z.enum(['auto', 'on', 'off']).optional(),
    clipModelPath: z.string().nullable().optional(),
    clipTextModelPath: z.string().nullable().optional(),
    tokenizerPath: z.string().nullable().optional(),
    faceDetectionModelPath: z.string().nullable().optional(),
    faceRecognitionModelPath: z.string().nullable().optional(),
    sceneModelPath: z.string().nullable().optional(),
    batchSize: z.number().int().min(1).max(512).optional(),
    nearDuplicateThreshold: z.number().min(0.5).max(1).optional(),
    imageExtensions: z.array(z.string()).optional(),
    videoExtensions: z.array(z.string()).optional()
  });

  app.put('/api/settings', async (request, reply) => {
    const patch = settingsPatchSchema.parse(request.body ?? {});
    const current = indexService.settings();
    const next: ArchiveSettings = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    };
    db.saveSettings(next);
    return reply.send(next);
  });

  const searchQuerySchema = z.object({
    q: z.string().trim().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    location: z.string().optional(),
    faceClusterId: z.string().optional(),
    tag: z.string().optional(),
    style: z.string().optional(),
    ocrText: z.boolean().optional(),
    page: z.coerce.number().int().positive().optional(),
    pageSize: z.coerce.number().int().positive().optional()
  });

  app.get('/api/search', async (request) => {
    const query = searchQuerySchema.parse(request.query ?? {});
    return searchService.search(query as SearchFilters);
  });

  const startIndexSchema = z.object({
    root: z.string().optional(),
    full: z.boolean().default(false)
  });

  app.post('/api/index/start', async (request, reply) => {
    const body = startIndexSchema.parse(request.body ?? {});
    const run = await indexService.startIndexing(body.root, body.full);
    return reply.status(202).send(run);
  });

  app.get('/api/index/status', async () => indexService.status());

  app.get('/api/duplicates', async () => db.listDuplicateGroups());

  const canonicalSchema = z.object({ photoId: z.string().min(1) });
  app.post('/api/duplicates/groups/:groupId/canonical', async (request, reply) => {
    const params = z.object({ groupId: z.string().min(1) }).parse(request.params);
    const body = canonicalSchema.parse(request.body ?? {});
    const group = db.getDuplicateGroup(params.groupId);
    if (!group) return reply.status(404).send({ error: 'Not Found', message: 'Duplicate group not found', statusCode: 404 });
    if (!group.photos.some((photo) => photo.id === body.photoId)) {
      return reply.status(400).send({ error: 'Bad Request', message: 'Photo is not in the duplicate group', statusCode: 400 });
    }
    db.setCanonicalPhoto(params.groupId, body.photoId);
    return reply.send(db.getDuplicateGroup(params.groupId));
  });

  const resolveDuplicateSchema = z.object({
    action: z.enum(['mark', 'delete', 'move', 'skip']),
    targetFolder: z.string().optional(),
    confirmBulk: z.boolean().default(false)
  });

  app.post('/api/duplicates/groups/:groupId/resolve', async (request, reply) => {
    const params = z.object({ groupId: z.string().min(1) }).parse(request.params);
    const body = resolveDuplicateSchema.parse(request.body ?? {});
    const result = await fileOperations.resolveDuplicateGroup(params.groupId, body.action, body.targetFolder, body.confirmBulk);
    return reply.status(result.ok ? 200 : 400).send(result);
  });

  app.get('/api/faces/clusters', async () => faces.listClusters());

  app.get('/api/faces/clusters/:clusterId/photos', async (request, reply) => {
    const params = z.object({ clusterId: z.string().min(1) }).parse(request.params);
    const cluster = db.getFaceCluster(params.clusterId);
    if (!cluster) return reply.status(404).send({ error: 'Not Found', message: 'Face cluster not found', statusCode: 404 });
    return faces.photosForCluster(params.clusterId);
  });

  const renameClusterSchema = z.object({ name: z.string().trim().min(1) });
  app.patch('/api/faces/clusters/:clusterId', async (request, reply) => {
    const params = z.object({ clusterId: z.string().min(1) }).parse(request.params);
    const body = renameClusterSchema.parse(request.body ?? {});
    const cluster = faces.renameCluster(params.clusterId, body.name);
    if (!cluster) return reply.status(404).send({ error: 'Not Found', message: 'Face cluster not found', statusCode: 404 });
    return cluster;
  });

  app.post('/api/faces/clusters/merge', async (request, reply) => {
    const body = z.object({ clusterIds: z.array(z.string().min(1)).min(2) }).parse(request.body ?? {});
    const cluster = faces.mergeClusters(body.clusterIds);
    return reply.status(cluster ? 200 : 404).send(cluster ?? { error: 'Not Found', message: 'Face cluster not found', statusCode: 404 });
  });

  app.post('/api/faces/clusters/split', async (request, reply) => {
    const body = z.object({
      clusterId: z.string().min(1),
      photoIds: z.array(z.string().min(1)).min(1)
    }).parse(request.body ?? {});
    const cluster = faces.splitCluster(body.clusterId, body.photoIds);
    return reply.status(cluster ? 201 : 400).send(cluster ?? { error: 'Bad Request', message: 'Unable to split cluster', statusCode: 400 });
  });

  app.get('/api/photos/:photoId', async (request, reply) => {
    const params = z.object({ photoId: z.string().min(1) }).parse(request.params);
    const row = db.getPhotoById(params.photoId);
    if (!row || row.status === 'deleted') {
      return reply.status(404).send({ error: 'Not Found', message: 'Photo not found', statusCode: 404 });
    }
    return {
      ...toPhotoRecord(db, row),
      faces: db.listFaces(row.id).map((face) => ({
        id: face.id,
        clusterId: face.cluster_id,
        boundingBox: face.bounding_box ? JSON.parse(face.bounding_box) : null,
        confidence: face.confidence
      }))
    };
  });

  app.get('/api/photos/:photoId/thumbnail', async (request, reply) => {
    const params = z.object({ photoId: z.string().min(1) }).parse(request.params);
    const row = db.getPhotoById(params.photoId);
    const thumbnail = row?.thumbnail_path;
    if (!thumbnail || !fs.existsSync(thumbnail)) {
      return reply.status(404).send({ error: 'Not Found', message: 'Thumbnail not found', statusCode: 404 });
    }
    return reply.header('Content-Type', 'image/jpeg').header('Cache-Control', 'private, max-age=3600').send(fs.createReadStream(thumbnail));
  });

  app.get('/api/photos/:photoId/file', async (request, reply) => {
    const params = z.object({ photoId: z.string().min(1) }).parse(request.params);
    const row = db.getPhotoById(params.photoId);
    if (!row || row.status === 'deleted' || !fs.existsSync(row.path)) {
      return reply.status(404).send({ error: 'Not Found', message: 'Photo file not found', statusCode: 404 });
    }
    const contentType = mime.lookup(row.path) || 'application/octet-stream';
    return reply
      .header('Content-Type', contentType)
      .header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(row.file_name)}`)
      .send(fs.createReadStream(row.path));
  });

  const fileOperationSchema = z.object({
    ids: z.array(z.string().min(1)).min(1),
    targetFolder: z.string().optional(),
    confirmBulk: z.boolean().default(false)
  });

  app.post('/api/photos/delete', async (request) => {
    const body = fileOperationSchema.parse(request.body ?? {});
    return fileOperations.operate('delete', body.ids, undefined, body.confirmBulk);
  });

  app.post('/api/photos/copy', async (request) => {
    const body = fileOperationSchema.parse(request.body ?? {});
    return fileOperations.operate('copy', body.ids, body.targetFolder, body.confirmBulk);
  });

  app.post('/api/photos/move', async (request) => {
    const body = fileOperationSchema.parse(request.body ?? {});
    return fileOperations.operate('move', body.ids, body.targetFolder, body.confirmBulk);
  });

  app.get('/api/logs', async (request) => {
    const query = z.object({
      level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
      limit: z.coerce.number().int().positive().max(1000).default(200)
    }).parse(request.query ?? {});
    return db.listLogs(query.level, query.limit);
  });

  app.get('/api/quarantine', async () => {
    const rows = db.db
      .prepare(`SELECT * FROM photos WHERE status = 'quarantine' ORDER BY updated_at DESC`)
      .all() as Record<string, unknown>[];
    return rows.map((row) => toPhotoRecord(db, {
      id: row.id as string,
      path: row.path as string,
      relative_path: row.relative_path as string,
      file_name: row.file_name as string,
      extension: row.extension as string,
      size_bytes: Number(row.size_bytes),
      mtime_ms: Number(row.mtime_ms),
      width: (row.width as number | null) ?? null,
      height: (row.height as number | null) ?? null,
      taken_at: (row.taken_at as string | null) ?? null,
      time_zone: (row.time_zone as string | null) ?? null,
      camera_make: (row.camera_make as string | null) ?? null,
      camera_model: (row.camera_model as string | null) ?? null,
      latitude: (row.latitude as number | null) ?? null,
      longitude: (row.longitude as number | null) ?? null,
      altitude: (row.altitude as number | null) ?? null,
      gps_source: (row.gps_source as 'exif' | 'visual' | 'manual' | null) ?? null,
      city: (row.city as string | null) ?? null,
      district: (row.district as string | null) ?? null,
      place: (row.place as string | null) ?? null,
      address: (row.address as string | null) ?? null,
      thumbnail_path: (row.thumbnail_path as string | null) ?? null,
      sha256: row.sha256 as string,
      perceptual_hash: row.perceptual_hash as string,
      embedding: (row.embedding as Buffer | null) ?? null,
      status: row.status as 'quarantine',
      canonical_photo_id: (row.canonical_photo_id as string | null) ?? null,
      duplicate_group_id: (row.duplicate_group_id as string | null) ?? null,
      quarantine_reason: (row.quarantine_reason as string | null) ?? null,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      indexed_at: (row.indexed_at as string | null) ?? null
    }));
  });

  app.post('/api/backup', async () => ({ ok: true, path: db.backup() }));

  const close = async () => {
    await indexService.close();
    await aiProvider.close?.();
    db.close();
    await app.close();
  };

  return { app, config, db, close };
}
