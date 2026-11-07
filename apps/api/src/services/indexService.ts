import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ArchiveSettings, IndexStatus } from '@photoarchive/shared';
import type { AppConfig } from '../config.js';
import type { AppDatabase, PhotoRow } from '../lib/database.js';
import { normalizeArchivePath, relativeToRoot, toOSPath, uniqueTargetPath } from '../lib/pathSafety.js';
import type { Logger } from '../lib/logger.js';
import type { AiProvider } from './aiProvider.js';
import { cosineSimilarity, fileSha256 } from './aiProvider.js';
import { generateThumbnail, inferDateFromName, perceptualHash, readImageMetadata } from './metadata.js';
import type { IndexQueue } from './queue.js';
import type { VectorStore } from './vectorStore.js';

export type IndexFileResult = 'indexed' | 'skipped' | 'quarantined' | 'failed';

interface RunRoot {
  root: string;
  full: boolean;
}

export class IndexService {
  private workerStarted = false;
  private closed = false;
  private readonly runRoots = new Map<string, RunRoot>();

  constructor(
    private readonly config: AppConfig,
    private readonly db: AppDatabase,
    private readonly logger: Logger,
    private readonly aiProvider: AiProvider,
    private readonly vectorStore: VectorStore,
    private readonly queue: IndexQueue
  ) {}

  settings(): ArchiveSettings {
    return this.db.getSettings({
      ...this.db.defaultSettings(),
      archiveRoot: this.config.archiveRoot,
      quarantineFolder: this.config.quarantineFolder,
      thumbnailsFolder: this.config.thumbnailsFolder,
      ocrEnabled: this.config.OCR_ENABLED,
      ocrLanguages: this.config.OCR_LANGUAGES,
      aiProvider: this.config.AI_PROVIDER,
      directml: this.config.DIRECTML,
      clipModelPath: this.config.CLIP_MODEL_PATH ?? null,
      clipTextModelPath: this.config.CLIP_TEXT_MODEL_PATH ?? null,
      tokenizerPath: this.config.TOKENIZER_PATH ?? null,
      faceDetectionModelPath: this.config.FACE_DETECTION_MODEL_PATH ?? null,
      faceRecognitionModelPath: this.config.FACE_RECOGNITION_MODEL_PATH ?? null,
      sceneModelPath: this.config.SCENE_MODEL_PATH ?? null,
      batchSize: this.config.BATCH_SIZE,
      nearDuplicateThreshold: this.config.NEAR_DUPLICATE_THRESHOLD
    });
  }

  async startIndexing(rootOverride?: string, full = false): Promise<IndexStatus> {
    const settings = this.settings();
    const root = normalizeArchivePath(rootOverride ?? settings.archiveRoot, settings.archiveRoot);
    await fs.mkdir(root, { recursive: true });

    const runId = crypto.randomUUID();
    const run = this.db.createRun(runId);
    this.runRoots.set(runId, { root, full });
    this.db.updateRun(runId, { ...run, state: 'queued', queued: 0 });
    await this.queue.enqueue(runId);
    this.ensureWorker();

    this.logger.info('indexing', 'Indexing run queued', { runId, root, full });
    return this.db.getRun(runId)!;
  }

  status(): IndexStatus | null {
    return this.db.latestRun();
  }

  async indexRunNow(runId: string): Promise<IndexStatus> {
    const run = this.db.getRun(runId);
    if (!run) throw new Error(`Indexing run not found: ${runId}`);
    await this.processRun(runId);
    return this.db.getRun(runId)!;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.queue.close();
  }

  private ensureWorker(): void {
    if (this.workerStarted) return;
    this.workerStarted = true;
    void this.workerLoop();
  }

  private async workerLoop(): Promise<void> {
    while (!this.closed) {
      const runId = await this.queue.pop(1000);
      if (!runId) {
        await sleep(100);
        continue;
      }
      try {
        await this.processRun(runId);
      } catch (error) {
        this.logger.error('indexing', 'Indexing worker failed', {
          runId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  private async processRun(runId: string): Promise<void> {
    const run = this.db.getRun(runId);
    if (!run || run.state === 'completed' || run.state === 'failed') return;

    const settings = this.settings();
    const runRoot = this.runRoots.get(runId);
    const root = runRoot?.root ?? settings.archiveRoot;
    const full = runRoot?.full ?? false;

    this.db.updateRun(runId, {
      state: 'running',
      startedAt: new Date().toISOString(),
      error: null
    });

    const files = await this.scanFiles(root, settings);
    this.db.updateRun(runId, { total: files.length, queued: files.length });

    const counts = { processed: 0, failed: 0, skipped: 0, quarantined: 0 };
    for (const file of files) {
      try {
        const result = await this.processFile(file, root, settings, full);
        if (result === 'indexed') counts.processed += 1;
        else if (result === 'skipped') counts.skipped += 1;
        else if (result === 'quarantined') counts.quarantined += 1;
      } catch (error) {
        counts.failed += 1;
        this.logger.error('indexing', 'Failed to process file', {
          file,
          error: error instanceof Error ? error.message : String(error)
        });
      }

      const processedTotal = counts.processed + counts.failed + counts.skipped + counts.quarantined;
      this.db.updateRun(runId, {
        processed: processedTotal,
        queued: Math.max(0, files.length - processedTotal),
        failed: counts.failed,
        skipped: counts.skipped
      });
    }

    await this.clusterUnassignedFaces();

    this.db.updateRun(runId, {
      state: counts.failed > 0 && counts.processed === 0 ? 'failed' : 'completed',
      processed: counts.processed + counts.failed + counts.skipped + counts.quarantined,
      queued: 0,
      failed: counts.failed,
      skipped: counts.skipped,
      finishedAt: new Date().toISOString(),
      error: counts.failed > 0 && counts.processed === 0 ? 'All files failed to index' : null
    });

    this.logger.info('indexing', 'Indexing run finished', { runId, ...counts });
  }

  private async scanFiles(root: string, settings: ArchiveSettings): Promise<string[]> {
    const extensions = new Set(settings.imageExtensions.map((extension) => extension.toLowerCase()));
    const quarantineFolder = path.resolve(settings.quarantineFolder);
    const results: string[] = [];

    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(toOSPath(dir), { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (path.resolve(fullPath) === quarantineFolder || fullPath.startsWith(quarantineFolder + path.sep)) continue;

        if (entry.isDirectory()) {
          if (entry.name.startsWith('.')) continue;
          await walk(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (extensions.has(ext)) results.push(fullPath);
        }
      }
    };

    await walk(root);
    return results.sort((a, b) => a.localeCompare(b));
  }

  private async processFile(filePath: string, root: string, settings: ArchiveSettings, full: boolean): Promise<IndexFileResult> {
    const ext = path.extname(filePath).toLowerCase();
    if (!settings.imageExtensions.map((extension) => extension.toLowerCase()).includes(ext)) return 'skipped';

    const stat = await fs.stat(filePath);
    const existing = this.db.getPhotoByPath(filePath);
    if (!full && existing && existing.size_bytes === stat.size && existing.mtime_ms === Math.round(stat.mtimeMs)) {
      return 'skipped';
    }

    const sha256 = await fileSha256(filePath).catch(async (error) => {
      await this.quarantineFile(filePath, root, settings, `hash failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
    if (!sha256) return 'quarantined';

    let metadata;
    try {
      metadata = await readImageMetadata(filePath);
    } catch (error) {
      await this.quarantineFile(filePath, root, settings, `metadata failed: ${error instanceof Error ? error.message : String(error)}`);
      return 'quarantined';
    }

    let thumbnailPath: string;
    let hash: string;
    try {
      thumbnailPath = await generateThumbnail(filePath, settings.thumbnailsFolder, existing?.id ?? crypto.randomUUID());
      hash = await perceptualHash(filePath);
    } catch (error) {
      await this.quarantineFile(filePath, root, settings, `thumbnail/decode failed: ${error instanceof Error ? error.message : String(error)}`);
      return 'quarantined';
    }

    const photoId = existing?.id ?? crypto.randomUUID();
    const relativePath = relativeToRoot(filePath, root);
    const analysis = await this.aiProvider.analyze({
      filePath,
      sha256,
      width: metadata.width,
      height: metadata.height,
      relativePath
    });

    const takenAt = metadata.takenAt ?? inferDateFromName(relativePath);
    const location = normalizeLocation(metadata, relativePath, analysis.tags.map((tag) => tag.name));
    const ocrTags = await this.extractOcrTags(filePath, settings, analysis.ocrText);

    const embeddingBuffer = analysis.embedding.length > 0
      ? Buffer.from(Float32Array.from(analysis.embedding).buffer)
      : null;

    const photo = this.db.upsertPhoto({
      id: photoId,
      path: filePath,
      relative_path: relativePath,
      file_name: path.basename(filePath),
      extension: ext,
      size_bytes: stat.size,
      mtime_ms: Math.round(stat.mtimeMs),
      width: metadata.width,
      height: metadata.height,
      taken_at: takenAt,
      time_zone: metadata.timeZone,
      camera_make: metadata.cameraMake,
      camera_model: metadata.cameraModel,
      latitude: location.latitude,
      longitude: location.longitude,
      altitude: metadata.altitude,
      gps_source: metadata.gpsSource,
      city: location.city,
      district: location.district,
      place: location.place,
      address: location.address,
      thumbnail_path: thumbnailPath,
      sha256,
      perceptual_hash: hash,
      embedding: embeddingBuffer,
      status: 'active',
      canonical_photo_id: null,
      duplicate_group_id: null,
      quarantine_reason: null,
      indexed_at: new Date().toISOString()
    });

    this.db.setPhotoTags(photo.id, [
      ...analysis.tags,
      ...ocrTags,
      ...location.tags
    ]);
    this.db.replaceObjects(photo.id, analysis.objects);
    this.db.replaceLocation(photo.id, {
      address: location.address,
      city: location.city,
      district: location.district,
      place: location.place,
      latitude: location.latitude,
      longitude: location.longitude,
      source: metadata.gpsSource ? 'exif' : 'visual'
    });

    this.db.deleteFacesForPhoto(photo.id);
    for (const face of analysis.faces) {
      this.db.insertFace({
        id: crypto.randomUUID(),
        photoId: photo.id,
        descriptor: Buffer.from(Float32Array.from(face.descriptor).buffer),
        boundingBox: face.boundingBox,
        confidence: face.confidence ?? null
      });
    }

    if (await this.vectorStore.health()) {
      await this.vectorStore.upsert(photo, analysis.embedding).catch((error) => {
        this.logger.warn('indexing', 'Vector upsert failed', {
          photoId: photo.id,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }

    this.registerExactDuplicates(photo);
    this.registerVisualDuplicates(photo, settings.nearDuplicateThreshold);
    return 'indexed';
  }

  private async quarantineFile(filePath: string, root: string, settings: ArchiveSettings, reason: string): Promise<void> {
    await fs.mkdir(settings.quarantineFolder, { recursive: true });
    const target = uniqueTargetPath(settings.quarantineFolder, path.basename(filePath));
    await fs.rename(filePath, target);

    const stat = await fs.stat(target).catch(() => null);
    const sha256 = await fileSha256(target).catch(() => 'unreadable');
    const id = crypto.randomUUID();
    this.db.upsertPhoto({
      id,
      path: target,
      relative_path: `quarantine/${path.basename(target)}`,
      file_name: path.basename(target),
      extension: path.extname(target).toLowerCase(),
      size_bytes: stat?.size ?? 0,
      mtime_ms: stat ? Math.round(stat.mtimeMs) : 0,
      width: null,
      height: null,
      taken_at: null,
      time_zone: null,
      camera_make: null,
      camera_model: null,
      latitude: null,
      longitude: null,
      altitude: null,
      gps_source: null,
      city: null,
      district: null,
      place: null,
      address: null,
      thumbnail_path: null,
      sha256,
      perceptual_hash: '',
      embedding: null,
      status: 'quarantine',
      canonical_photo_id: null,
      duplicate_group_id: null,
      quarantine_reason: reason,
      indexed_at: null
    });
    this.db.log('warn', 'indexing', 'Broken file moved to quarantine', { source: filePath, target, reason });
  }

  private registerExactDuplicates(photo: PhotoRow): void {
    const matches = this.db.findBySha256(photo.sha256, photo.id);
    if (matches.length === 0) return;
    this.createDuplicateGroup('exact_hash', photo, matches, 1);
  }

  private registerVisualDuplicates(photo: PhotoRow, threshold: number): void {
    if (!photo.embedding) return;
    const vector = new Float32Array(photo.embedding.buffer, photo.embedding.byteOffset, photo.embedding.byteLength / 4);
    const matches = this.db
      .photosWithEmbeddings(photo.id, 500)
      .filter((candidate) => candidate.id !== photo.id && candidate.sha256 !== photo.sha256)
      .map((candidate) => ({
        photo: candidate,
        similarity: candidate.embedding
          ? cosineSimilarity(vector, new Float32Array(candidate.embedding.buffer, candidate.embedding.byteOffset, candidate.embedding.byteLength / 4))
          : 0
      }))
      .filter((candidate) => candidate.similarity >= threshold)
      .map((candidate) => candidate.photo);

    if (matches.length > 0) {
      this.createDuplicateGroup('visual_similarity', photo, matches, threshold);
    }
  }

  private createDuplicateGroup(reason: 'exact_hash' | 'visual_similarity', current: PhotoRow, matches: PhotoRow[], similarity: number): void {
    const groupId = this.db.createDuplicateGroup(reason, current.id);
    this.db.addPhotoToDuplicateGroup(groupId, current.id, similarity);
    for (const match of matches) {
      this.db.addPhotoToDuplicateGroup(groupId, match.id, reason === 'exact_hash' ? 1 : similarity);
      if (match.id !== current.id) {
        this.db.updatePhotoStatus(match.id, 'duplicate', { canonical_photo_id: current.id, duplicate_group_id: groupId });
      }
    }
    this.db.setCanonicalPhoto(groupId, current.id);
    this.db.log('info', 'duplicates', 'Duplicate group created', {
      groupId,
      reason,
      canonicalPhotoId: current.id,
      photoCount: matches.length + 1
    });
  }

  private async extractOcrTags(filePath: string, settings: ArchiveSettings, ocrText?: string): Promise<{ name: string; russianName?: string; source: string; confidence?: number }[]> {
    if (!settings.ocrEnabled) return [];
    if (ocrText) {
      return ocrText
        .split(/\s+/)
        .filter((token) => token.length >= 4)
        .slice(0, 12)
        .map((token) => ({ name: `ocr-${token.toLowerCase()}`, source: 'ocr', confidence: 0.5 }));
    }

    this.logger.warn('ocr', 'OCR is enabled, but no OCR provider produced text', { filePath });
    return [];
  }

  private async clusterUnassignedFaces(): Promise<void> {
    const faces = this.db.listUnclusteredFaces(5000);
    if (faces.length === 0) {
      this.db.deleteEmptyFaceClusters();
      return;
    }

    const eps = 0.32;
    const minPoints = 2;
    const visited = new Set<string>();
    let clusterSerial = this.db.listFaceClusters().length + 1;

    const regionQuery = (index: number): number[] => {
      const neighbors: number[] = [];
      for (let j = 0; j < faces.length; j += 1) {
        if (j === index) continue;
        const distance = 1 - cosineSimilarity(faces[index].descriptor, faces[j].descriptor);
        if (distance <= eps) neighbors.push(j);
      }
      return neighbors;
    };

    const assign = (faceIds: string[]) => {
      const clusterId = this.db.createFaceCluster(`Человек ${clusterSerial}`, faces.find((face) => faceIds.includes(face.id))?.photoId ?? null);
      this.db.updateFaceClusterId(faceIds, clusterId);
      clusterSerial += 1;
    };

    for (let i = 0; i < faces.length; i += 1) {
      if (visited.has(faces[i].id)) continue;
      visited.add(faces[i].id);
      const neighbors = regionQuery(i);
      if (neighbors.length + 1 < minPoints) {
        assign([faces[i].id]);
        continue;
      }

      const clusterIndexes = [i];
      const queue = [...neighbors];
      while (queue.length > 0) {
        const index = queue.shift()!;
        if (visited.has(faces[index].id)) continue;
        visited.add(faces[index].id);
        clusterIndexes.push(index);
        const nextNeighbors = regionQuery(index);
        if (nextNeighbors.length + 1 >= minPoints) queue.push(...nextNeighbors.filter((index) => !visited.has(faces[index].id)));
      }

      assign(clusterIndexes.map((index) => faces[index].id));
    }

    this.db.deleteEmptyFaceClusters();
    this.logger.info('faces', 'Face clustering finished', { clusteredFaces: faces.length });
  }
}

function normalizeLocation(
  metadata: {
    latitude: number | null;
    longitude: number | null;
    gpsSource: 'exif' | null;
  },
  relativePath: string,
  tags: string[]
): {
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  district: string | null;
  place: string | null;
  address: string | null;
  tags: { name: string; russianName?: string; source: string; confidence?: number }[];
} {
  const lowerPath = relativePath.toLowerCase();
  const locationTags: { name: string; russianName?: string; source: string; confidence?: number }[] = [];
  let city: string | null = null;
  let district: string | null = null;
  let place: string | null = null;

  const knownPlaces: { token: string; city?: string; district?: string; place?: string; tag?: string }[] = [
    { token: 'sochi', city: 'Сочи', tag: 'sochi' },
    { token: 'moscow', city: 'Москва', tag: 'moscow' },
    { token: 'arbat', city: 'Москва', place: 'Арбат', tag: 'arbat' },
    { token: 'taganka', city: 'Москва', district: 'Таганский район', place: 'Таганка', tag: 'taganka' },
    { token: 'office', place: 'Офис', tag: 'office' }
  ];

  for (const known of knownPlaces) {
    if (lowerPath.includes(known.token) || tags.includes(known.tag ?? known.token)) {
      city = city ?? known.city ?? null;
      district = district ?? known.district ?? null;
      place = place ?? known.place ?? null;
      if (known.tag) locationTags.push({ name: known.tag, russianName: known.place ?? known.city, source: 'location', confidence: 0.65 });
    }
  }

  const address = metadata.latitude !== null && metadata.longitude !== null
    ? `GPS: ${metadata.latitude.toFixed(5)}, ${metadata.longitude.toFixed(5)}`
    : [city, district, place].filter(Boolean).join(', ') || null;

  return {
    latitude: metadata.latitude,
    longitude: metadata.longitude,
    city,
    district,
    place,
    address,
    tags: locationTags
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
