import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type {
  ArchiveSettings,
  DuplicateGroup,
  FaceClusterRecord,
  FaceRecord,
  IndexStatus,
  LogRecord,
  PhotoRecord,
  PhotoStatus
} from '@photoarchive/shared';
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from '@photoarchive/shared';

export interface PhotoRow {
  id: string;
  path: string;
  relative_path: string;
  file_name: string;
  extension: string;
  size_bytes: number;
  mtime_ms: number;
  width: number | null;
  height: number | null;
  taken_at: string | null;
  time_zone: string | null;
  camera_make: string | null;
  camera_model: string | null;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  gps_source: 'exif' | 'visual' | 'manual' | null;
  city: string | null;
  district: string | null;
  place: string | null;
  address: string | null;
  thumbnail_path: string | null;
  sha256: string;
  perceptual_hash: string;
  embedding: Buffer | null;
  status: PhotoStatus;
  canonical_photo_id: string | null;
  duplicate_group_id: string | null;
  quarantine_reason: string | null;
  created_at: string;
  updated_at: string;
  indexed_at: string | null;
}

export interface FaceRow {
  id: string;
  photo_id: string;
  cluster_id: string | null;
  descriptor: Buffer;
  bounding_box: string | null;
  confidence: number | null;
  created_at: string;
}

export class AppDatabase {
  readonly db: Database.Database;
  readonly dataDir: string;
  readonly file: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'photoarchive.db');
    this.db = new Database(this.file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('synchronous = NORMAL');
    this.migrate();
  }

  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS indexing_runs (
        id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        total INTEGER NOT NULL DEFAULT 0,
        processed INTEGER NOT NULL DEFAULT 0,
        queued INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        skipped INTEGER NOT NULL DEFAULT 0,
        started_at TEXT,
        finished_at TEXT,
        error TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS photos (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        relative_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        extension TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        mtime_ms INTEGER NOT NULL,
        width INTEGER,
        height INTEGER,
        taken_at TEXT,
        time_zone TEXT,
        camera_make TEXT,
        camera_model TEXT,
        latitude REAL,
        longitude REAL,
        altitude REAL,
        gps_source TEXT,
        city TEXT,
        district TEXT,
        place TEXT,
        address TEXT,
        thumbnail_path TEXT,
        sha256 TEXT NOT NULL,
        perceptual_hash TEXT NOT NULL,
        embedding BLOB,
        status TEXT NOT NULL DEFAULT 'active',
        canonical_photo_id TEXT,
        duplicate_group_id TEXT,
        quarantine_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        indexed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_photos_taken_at ON photos(taken_at);
      CREATE INDEX IF NOT EXISTS idx_photos_sha256 ON photos(sha256);
      CREATE INDEX IF NOT EXISTS idx_photos_status ON photos(status);
      CREATE INDEX IF NOT EXISTS idx_photos_location ON photos(city, district, place);

      CREATE TABLE IF NOT EXISTS faces (
        id TEXT PRIMARY KEY,
        photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
        cluster_id TEXT REFERENCES face_clusters(id) ON DELETE SET NULL,
        descriptor BLOB NOT NULL,
        bounding_box TEXT,
        confidence REAL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_faces_photo ON faces(photo_id);
      CREATE INDEX IF NOT EXISTS idx_faces_cluster ON faces(cluster_id);

      CREATE TABLE IF NOT EXISTS face_clusters (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        cover_photo_id TEXT REFERENCES photos(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS objects (
        id TEXT PRIMARY KEY,
        photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        confidence REAL NOT NULL,
        source TEXT NOT NULL DEFAULT 'model',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_objects_photo ON objects(photo_id);
      CREATE INDEX IF NOT EXISTS idx_objects_label ON objects(label);

      CREATE TABLE IF NOT EXISTS locations (
        id TEXT PRIMARY KEY,
        photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
        address TEXT,
        city TEXT,
        district TEXT,
        place TEXT,
        latitude REAL,
        longitude REAL,
        source TEXT NOT NULL DEFAULT 'exif',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_locations_photo ON locations(photo_id);

      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        russian_name TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS photo_tags (
        photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        source TEXT NOT NULL DEFAULT 'model',
        confidence REAL,
        PRIMARY KEY (photo_id, tag_id)
      );

      CREATE TABLE IF NOT EXISTS duplicate_groups (
        id TEXT PRIMARY KEY,
        reason TEXT NOT NULL,
        canonical_photo_id TEXT REFERENCES photos(id) ON DELETE SET NULL,
        resolved_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS duplicate_group_photos (
        group_id TEXT NOT NULL REFERENCES duplicate_groups(id) ON DELETE CASCADE,
        photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
        similarity REAL NOT NULL DEFAULT 1,
        PRIMARY KEY (group_id, photo_id)
      );
      CREATE INDEX IF NOT EXISTS idx_duplicate_photo ON duplicate_group_photos(photo_id);

      CREATE TABLE IF NOT EXISTS logs (
        id TEXT PRIMARY KEY,
        level TEXT NOT NULL,
        scope TEXT NOT NULL,
        message TEXT NOT NULL,
        context TEXT,
        photo_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at);

      CREATE TABLE IF NOT EXISTS file_operations (
        id TEXT PRIMARY KEY,
        operation TEXT NOT NULL,
        photo_id TEXT,
        source_path TEXT,
        target_path TEXT,
        status TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  saveSettings(settings: ArchiveSettings): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES ('archive', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(JSON.stringify(settings), new Date().toISOString());
  }

  getSettings(defaults: ArchiveSettings): ArchiveSettings {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = 'archive'`).get() as
      | { value: string }
      | undefined;
    if (!row) return defaults;
    try {
      return { ...defaults, ...(JSON.parse(row.value) as ArchiveSettings) };
    } catch {
      return defaults;
    }
  }

  createRun(id: string): IndexStatus {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO indexing_runs (id, state, created_at) VALUES (?, 'queued', ?)`
      )
      .run(id, now);
    return this.getRun(id)!;
  }

  updateRun(id: string, patch: Partial<IndexStatus>): void {
    const current = this.getRun(id);
    if (!current) return;
    const next = { ...current, ...patch };
    this.db
      .prepare(
        `UPDATE indexing_runs SET
          state = ?, total = ?, processed = ?, queued = ?, failed = ?, skipped = ?,
          started_at = ?, finished_at = ?, error = ?
         WHERE id = ?`
      )
      .run(
        next.state,
        next.total,
        next.processed,
        next.queued,
        next.failed,
        next.skipped,
        next.startedAt ?? null,
        next.finishedAt ?? null,
        next.error ?? null,
        id
      );
  }

  getRun(id: string): IndexStatus | null {
    const row = this.db.prepare(`SELECT * FROM indexing_runs WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? mapRun(row) : null;
  }

  latestRun(): IndexStatus | null {
    const row = this.db
      .prepare(`SELECT * FROM indexing_runs ORDER BY created_at DESC LIMIT 1`)
      .get() as Record<string, unknown> | undefined;
    return row ? mapRun(row) : null;
  }

  upsertPhoto(photo: Omit<PhotoRow, 'created_at' | 'updated_at'> & {
    created_at?: string;
    updated_at?: string;
  }): PhotoRow {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO photos (
          id, path, relative_path, file_name, extension, size_bytes, mtime_ms, width, height,
          taken_at, time_zone, camera_make, camera_model, latitude, longitude, altitude, gps_source,
          city, district, place, address, thumbnail_path, sha256, perceptual_hash, embedding, status,
          canonical_photo_id, duplicate_group_id, quarantine_reason, created_at, updated_at, indexed_at
        ) VALUES (
          @id, @path, @relative_path, @file_name, @extension, @size_bytes, @mtime_ms, @width, @height,
          @taken_at, @time_zone, @camera_make, @camera_model, @latitude, @longitude, @altitude, @gps_source,
          @city, @district, @place, @address, @thumbnail_path, @sha256, @perceptual_hash, @embedding, @status,
          @canonical_photo_id, @duplicate_group_id, @quarantine_reason, @created_at, @updated_at, @indexed_at
        )
        ON CONFLICT(path) DO UPDATE SET
          relative_path = excluded.relative_path,
          file_name = excluded.file_name,
          extension = excluded.extension,
          size_bytes = excluded.size_bytes,
          mtime_ms = excluded.mtime_ms,
          width = excluded.width,
          height = excluded.height,
          taken_at = excluded.taken_at,
          time_zone = excluded.time_zone,
          camera_make = excluded.camera_make,
          camera_model = excluded.camera_model,
          latitude = excluded.latitude,
          longitude = excluded.longitude,
          altitude = excluded.altitude,
          gps_source = excluded.gps_source,
          city = excluded.city,
          district = excluded.district,
          place = excluded.place,
          address = excluded.address,
          thumbnail_path = excluded.thumbnail_path,
          sha256 = excluded.sha256,
          perceptual_hash = excluded.perceptual_hash,
          embedding = excluded.embedding,
          status = excluded.status,
          canonical_photo_id = excluded.canonical_photo_id,
          duplicate_group_id = excluded.duplicate_group_id,
          quarantine_reason = excluded.quarantine_reason,
          updated_at = excluded.updated_at,
          indexed_at = excluded.indexed_at`
      )
      .run({
        ...photo,
        created_at: photo.created_at ?? now,
        updated_at: photo.updated_at ?? now
      });

    return this.getPhotoByPath(photo.path)!;
  }

  getPhotoByPath(filePath: string): PhotoRow | null {
    const row = this.db.prepare(`SELECT * FROM photos WHERE path = ?`).get(filePath) as
      | Record<string, unknown>
      | undefined;
    return row ? mapPhotoRow(row) : null;
  }

  getPhotoById(id: string): PhotoRow | null {
    const row = this.db.prepare(`SELECT * FROM photos WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? mapPhotoRow(row) : null;
  }

  listPhotos(ids: string[]): PhotoRow[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    return (
      this.db
        .prepare(`SELECT * FROM photos WHERE id IN (${placeholders})`)
        .all(...ids) as Record<string, unknown>[]
    ).map(mapPhotoRow);
  }

  listPhotoPage(page: number, pageSize: number): PhotoRow[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM photos
           WHERE status IN ('active', 'duplicate', 'quarantine')
           ORDER BY COALESCE(taken_at, created_at) DESC
           LIMIT ? OFFSET ?`
        )
        .all(pageSize, (page - 1) * pageSize) as Record<string, unknown>[]
    ).map(mapPhotoRow);
  }

  updatePhotoPath(id: string, nextPath: string, relativePath: string, mtimeMs?: number): void {
    this.db
      .prepare(
        `UPDATE photos SET path = ?, relative_path = ?, mtime_ms = COALESCE(?, mtime_ms), updated_at = ? WHERE id = ?`
      )
      .run(nextPath, relativePath, mtimeMs ?? null, new Date().toISOString(), id);
  }

  updatePhotoStatus(
    id: string,
    status: PhotoStatus,
    patch: Partial<Pick<PhotoRow, 'quarantine_reason' | 'canonical_photo_id' | 'duplicate_group_id'>> = {}
  ): void {
    this.db
      .prepare(
        `UPDATE photos SET status = ?, quarantine_reason = ?, canonical_photo_id = ?, duplicate_group_id = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        status,
        patch.quarantine_reason ?? null,
        patch.canonical_photo_id ?? null,
        patch.duplicate_group_id ?? null,
        new Date().toISOString(),
        id
      );
  }

  findBySha256(sha256: string, excludeId?: string): PhotoRow[] {
    const rows = excludeId
      ? this.db.prepare(`SELECT * FROM photos WHERE sha256 = ? AND id != ? LIMIT 50`).all(sha256, excludeId)
      : this.db.prepare(`SELECT * FROM photos WHERE sha256 = ? LIMIT 50`).all(sha256);
    return (rows as Record<string, unknown>[]).map(mapPhotoRow);
  }

  photosWithEmbeddings(excludeId?: string, limit = 5000): PhotoRow[] {
    const rows = excludeId
      ? this.db
          .prepare(
            `SELECT * FROM photos WHERE embedding IS NOT NULL AND id != ? AND status = 'active' ORDER BY indexed_at DESC LIMIT ?`
          )
          .all(excludeId, limit)
      : this.db
          .prepare(
            `SELECT * FROM photos WHERE embedding IS NOT NULL AND status = 'active' ORDER BY indexed_at DESC LIMIT ?`
          )
          .all(limit);
    return (rows as Record<string, unknown>[]).map(mapPhotoRow);
  }

  insertTag(name: string, russianName?: string): string {
    const existing = this.db.prepare(`SELECT id FROM tags WHERE name = ?`).get(name) as
      | { id: string }
      | undefined;
    if (existing) return existing.id;
    const id = crypto.randomUUID();
    this.db
      .prepare(`INSERT INTO tags (id, name, russian_name, created_at) VALUES (?, ?, ?, ?)`)
      .run(id, name, russianName ?? name, new Date().toISOString());
    return id;
  }

  setPhotoTags(photoId: string, tags: { name: string; russianName?: string; source: string; confidence?: number }[]): void {
    this.db.prepare(`DELETE FROM photo_tags WHERE photo_id = ?`).run(photoId);
    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO photo_tags (photo_id, tag_id, source, confidence) VALUES (?, ?, ?, ?)`
    );
    for (const tag of tags) {
      insert.run(photoId, this.insertTag(tag.name, tag.russianName), tag.source, tag.confidence ?? null);
    }
  }

  getPhotoTags(photoId: string): string[] {
    return (
      this.db
        .prepare(
          `SELECT t.name FROM tags t
           JOIN photo_tags pt ON pt.tag_id = t.id
           WHERE pt.photo_id = ? ORDER BY t.name`
        )
        .all(photoId) as { name: string }[]
    ).map((row) => row.name);
  }

  insertFace(face: { id: string; photoId: string; clusterId?: string | null; descriptor: Buffer; boundingBox?: unknown; confidence?: number | null }): void {
    this.db
      .prepare(
        `INSERT INTO faces (id, photo_id, cluster_id, descriptor, bounding_box, confidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET cluster_id = excluded.cluster_id, bounding_box = excluded.bounding_box, confidence = excluded.confidence`
      )
      .run(
        face.id,
        face.photoId,
        face.clusterId ?? null,
        face.descriptor,
        face.boundingBox ? JSON.stringify(face.boundingBox) : null,
        face.confidence ?? null,
        new Date().toISOString()
      );
  }

  deleteFacesForPhoto(photoId: string): void {
    this.db.prepare(`DELETE FROM faces WHERE photo_id = ?`).run(photoId);
  }

  listFaces(photoId: string): FaceRow[] {
    return (
      this.db.prepare(`SELECT * FROM faces WHERE photo_id = ?`).all(photoId) as Record<string, unknown>[]
    ).map(mapFaceRow);
  }

  createFaceCluster(name: string, coverPhotoId?: string | null): string {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(`INSERT INTO face_clusters (id, name, cover_photo_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run(id, name, coverPhotoId ?? null, now, now);
    return id;
  }

  updateFaceCluster(id: string, patch: { name?: string; coverPhotoId?: string | null }): void {
    const current = this.getFaceCluster(id);
    if (!current) return;
    this.db
      .prepare(`UPDATE face_clusters SET name = ?, cover_photo_id = ?, updated_at = ? WHERE id = ?`)
      .run(patch.name ?? current.name, patch.coverPhotoId !== undefined ? patch.coverPhotoId : current.coverPhotoId, new Date().toISOString(), id);
  }

  getFaceCluster(id: string): FaceClusterRecord | null {
    const row = this.db
      .prepare(
        `SELECT fc.*,
                COUNT(f.id) AS face_count,
                COUNT(DISTINCT f.photo_id) AS photo_count
         FROM face_clusters fc
         LEFT JOIN faces f ON f.cluster_id = fc.id
         WHERE fc.id = ?
         GROUP BY fc.id`
      )
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      name: row.name as string,
      faceCount: Number(row.face_count ?? 0),
      photoCount: Number(row.photo_count ?? 0),
      coverPhotoId: (row.cover_photo_id as string | null) ?? null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string
    };
  }

  listFaceClusters(): FaceClusterRecord[] {
    return (
      this.db
        .prepare(
          `SELECT fc.*,
                  COUNT(f.id) AS face_count,
                  COUNT(DISTINCT f.photo_id) AS photo_count
           FROM face_clusters fc
           LEFT JOIN faces f ON f.cluster_id = fc.id
           GROUP BY fc.id
           ORDER BY photo_count DESC, fc.updated_at DESC`
        )
        .all() as Record<string, unknown>[]
    ).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      faceCount: Number(row.face_count ?? 0),
      photoCount: Number(row.photo_count ?? 0),
      coverPhotoId: (row.cover_photo_id as string | null) ?? null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string
    }));
  }

  listFacesByCluster(clusterId: string): FaceRecord[] {
    return (
      this.db
        .prepare(
          `SELECT f.*, p.path AS photo_path FROM faces f JOIN photos p ON p.id = f.photo_id WHERE f.cluster_id = ? ORDER BY p.taken_at DESC`
        )
        .all(clusterId) as Record<string, unknown>[]
    ).map((row) => ({
      id: row.id as string,
      photoId: row.photo_id as string,
      clusterId: (row.cluster_id as string | null) ?? null,
      descriptor: Array.from(new Float32Array((row.descriptor as Buffer).buffer.slice((row.descriptor as Buffer).byteOffset, (row.descriptor as Buffer).byteOffset + (row.descriptor as Buffer).byteLength))),
      boundingBox: row.bounding_box ? (JSON.parse(row.bounding_box as string) as FaceRecord['boundingBox']) : null,
      confidence: (row.confidence as number | null) ?? null,
      createdAt: row.created_at as string
    }));
  }

  updateFaceClusterId(faceIds: string[], clusterId: string | null): void {
    const update = this.db.prepare(`UPDATE faces SET cluster_id = ? WHERE id = ?`);
    for (const id of faceIds) update.run(clusterId, id);
  }

  listUnclusteredFaces(limit = 5000): FaceRecord[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM faces WHERE cluster_id IS NULL ORDER BY created_at DESC LIMIT ?`
        )
        .all(limit) as Record<string, unknown>[]
    ).map((row) => ({
      id: row.id as string,
      photoId: row.photo_id as string,
      clusterId: null,
      descriptor: Array.from(new Float32Array((row.descriptor as Buffer).buffer.slice((row.descriptor as Buffer).byteOffset, (row.descriptor as Buffer).byteOffset + (row.descriptor as Buffer).byteLength))),
      boundingBox: row.bounding_box ? (JSON.parse(row.bounding_box as string) as FaceRecord['boundingBox']) : null,
      confidence: (row.confidence as number | null) ?? null,
      createdAt: row.created_at as string
    }));
  }

  listClusteredFaces(limit = 50000): FaceRecord[] {
    return (
      this.db.prepare(`SELECT * FROM faces WHERE cluster_id IS NOT NULL ORDER BY cluster_id, created_at DESC LIMIT ?`)
        .all(limit) as Record<string, unknown>[]
    ).map((row) => ({
      id: row.id as string,
      photoId: row.photo_id as string,
      clusterId: (row.cluster_id as string | null) ?? null,
      descriptor: Array.from(new Float32Array((row.descriptor as Buffer).buffer.slice((row.descriptor as Buffer).byteOffset, (row.descriptor as Buffer).byteOffset + (row.descriptor as Buffer).byteLength))),
      boundingBox: row.bounding_box ? (JSON.parse(row.bounding_box as string) as FaceRecord['boundingBox']) : null,
      confidence: (row.confidence as number | null) ?? null,
      createdAt: row.created_at as string
    }));
  }

  deleteEmptyFaceClusters(): void {
    this.db.exec(
      `DELETE FROM face_clusters WHERE id NOT IN (SELECT DISTINCT cluster_id FROM faces WHERE cluster_id IS NOT NULL)`
    );
  }

  createDuplicateGroup(reason: 'exact_hash' | 'visual_similarity', canonicalPhotoId?: string | null): string {
    const id = crypto.randomUUID();
    this.db
      .prepare(`INSERT INTO duplicate_groups (id, reason, canonical_photo_id, created_at) VALUES (?, ?, ?, ?)`)
      .run(id, reason, canonicalPhotoId ?? null, new Date().toISOString());
    return id;
  }

  addPhotoToDuplicateGroup(groupId: string, photoId: string, similarity: number): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO duplicate_group_photos (group_id, photo_id, similarity) VALUES (?, ?, ?)`
      )
      .run(groupId, photoId, similarity);
    this.db
      .prepare(`UPDATE photos SET duplicate_group_id = ?, updated_at = ? WHERE id = ?`)
      .run(groupId, new Date().toISOString(), photoId);
  }

  setCanonicalPhoto(groupId: string, photoId: string): void {
    this.db
      .prepare(`UPDATE duplicate_groups SET canonical_photo_id = ? WHERE id = ?`)
      .run(photoId, groupId);
    this.db
      .prepare(`UPDATE photos SET canonical_photo_id = ?, updated_at = ? WHERE duplicate_group_id = ?`)
      .run(photoId, new Date().toISOString(), groupId);
  }

  listDuplicateGroups(): DuplicateGroup[] {
    const groups = this.db
      .prepare(
        `SELECT dg.* FROM duplicate_groups dg
         WHERE dg.resolved_at IS NULL
         ORDER BY dg.created_at DESC`
      )
      .all() as Record<string, unknown>[];

    return groups.map((group) => {
      const photos = (
        this.db
          .prepare(
            `SELECT p.*, dgp.similarity FROM duplicate_group_photos dgp
             JOIN photos p ON p.id = dgp.photo_id
             WHERE dgp.group_id = ?
             ORDER BY dgp.similarity DESC, p.size_bytes DESC`
          )
          .all(group.id as string) as Record<string, unknown>[]
      ).map((row) => ({
        id: row.id as string,
        path: row.path as string,
        relativePath: row.relative_path as string,
        sizeBytes: Number(row.size_bytes),
        width: (row.width as number | null) ?? null,
        height: (row.height as number | null) ?? null,
        sha256: row.sha256 as string,
        similarity: Number(row.similarity),
        isCanonical: group.canonical_photo_id === row.id
      }));

      return {
        id: group.id as string,
        reason: group.reason as DuplicateGroup['reason'],
        photos,
        createdAt: group.created_at as string,
        resolvedAt: (group.resolved_at as string | null) ?? null
      };
    });
  }

  getDuplicateGroup(id: string): DuplicateGroup | null {
    return this.listDuplicateGroups().find((group) => group.id === id) ?? null;
  }

  resolveDuplicateGroup(id: string): void {
    this.db
      .prepare(`UPDATE duplicate_groups SET resolved_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), id);
  }

  insertObject(photoId: string, label: string, confidence: number, source = 'model'): void {
    this.db
      .prepare(
        `INSERT INTO objects (id, photo_id, label, confidence, source, created_at) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(crypto.randomUUID(), photoId, label, confidence, source, new Date().toISOString());
  }

  replaceObjects(photoId: string, objects: { label: string; confidence: number; source?: string }[]): void {
    this.db.prepare(`DELETE FROM objects WHERE photo_id = ?`).run(photoId);
    for (const object of objects) {
      this.insertObject(photoId, object.label, object.confidence, object.source ?? 'model');
    }
  }

  insertLocation(
    photoId: string,
    location: {
      address?: string | null;
      city?: string | null;
      district?: string | null;
      place?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      source?: string;
    }
  ): void {
    this.db
      .prepare(
        `INSERT INTO locations (id, photo_id, address, city, district, place, latitude, longitude, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        crypto.randomUUID(),
        photoId,
        location.address ?? null,
        location.city ?? null,
        location.district ?? null,
        location.place ?? null,
        location.latitude ?? null,
        location.longitude ?? null,
        location.source ?? 'exif',
        new Date().toISOString()
      );
  }

  replaceLocation(photoId: string, location: Parameters<AppDatabase['insertLocation']>[1]): void {
    this.db.prepare(`DELETE FROM locations WHERE photo_id = ?`).run(photoId);
    this.insertLocation(photoId, location);
  }

  log(level: LogRecord['level'], scope: string, message: string, context?: Record<string, unknown>, photoId?: string | null): void {
    this.db
      .prepare(
        `INSERT INTO logs (id, level, scope, message, context, photo_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        crypto.randomUUID(),
        level,
        scope,
        message,
        context ? JSON.stringify(context) : null,
        photoId ?? null,
        new Date().toISOString()
      );
  }

  listLogs(level?: LogRecord['level'], limit = 200): LogRecord[] {
    const rows = level
      ? this.db.prepare(`SELECT * FROM logs WHERE level = ? ORDER BY created_at DESC LIMIT ?`).all(level, limit)
      : this.db.prepare(`SELECT * FROM logs ORDER BY created_at DESC LIMIT ?`).all(limit);
    return (rows as Record<string, unknown>[]).map((row) => ({
      id: row.id as string,
      level: row.level as LogRecord['level'],
      scope: row.scope as string,
      message: row.message as string,
      context: row.context ? (JSON.parse(row.context as string) as Record<string, unknown>) : null,
      photoId: (row.photo_id as string | null) ?? null,
      createdAt: row.created_at as string
    }));
  }

  logFileOperation(operation: string, photoId: string | null, sourcePath: string, targetPath: string | null, status: 'success' | 'failed', error?: string): void {
    this.db
      .prepare(
        `INSERT INTO file_operations (id, operation, photo_id, source_path, target_path, status, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        crypto.randomUUID(),
        operation,
        photoId,
        sourcePath,
        targetPath,
        status,
        error ?? null,
        new Date().toISOString()
      );
  }

  stats(): {
    photos: number;
    indexedPhotos: number;
    faces: number;
    faceClusters: number;
    duplicateGroups: number;
    quarantined: number;
    tags: number;
    locations: number;
    storageBytes: number;
  } {
    const scalar = <T>(sql: string): T => (this.db.prepare(sql).get() as Record<string, unknown> | undefined)?.value as T;
    return {
      photos: Number(scalar<number>(`SELECT COUNT(*) AS value FROM photos WHERE status != 'deleted'`)),
      indexedPhotos: Number(scalar<number>(`SELECT COUNT(*) AS value FROM photos WHERE indexed_at IS NOT NULL AND status != 'deleted'`)),
      faces: Number(scalar<number>(`SELECT COUNT(*) AS value FROM faces`)),
      faceClusters: Number(scalar<number>(`SELECT COUNT(*) AS value FROM face_clusters`)),
      duplicateGroups: Number(scalar<number>(`SELECT COUNT(*) AS value FROM duplicate_groups WHERE resolved_at IS NULL`)),
      quarantined: Number(scalar<number>(`SELECT COUNT(*) AS value FROM photos WHERE status = 'quarantine'`)),
      tags: Number(scalar<number>(`SELECT COUNT(*) AS value FROM tags`)),
      locations: Number(scalar<number>(`SELECT COUNT(*) AS value FROM locations`)),
      storageBytes: Number(scalar<number | null>(`SELECT SUM(size_bytes) AS value FROM photos WHERE status != 'deleted'`) ?? 0)
    };
  }

  backup(targetFile?: string): string {
    const target = targetFile ?? path.join(this.dataDir, `photoarchive-backup-${Date.now()}.db`);
    fs.copyFileSync(this.file, target);
    return target;
  }

  defaultSettings(): ArchiveSettings {
    return {
      archiveRoot: this.dataDir,
      quarantineFolder: path.join(this.dataDir, 'quarantine'),
      thumbnailsFolder: path.join(this.dataDir, 'thumbnails'),
      ocrEnabled: false,
      ocrLanguages: 'rus+eng',
      aiProvider: 'auto',
      directml: 'auto',
      clipModelPath: null,
      clipTextModelPath: null,
      tokenizerPath: null,
      faceDetectionModelPath: null,
      faceRecognitionModelPath: null,
      sceneModelPath: null,
      batchSize: 64,
      nearDuplicateThreshold: 0.93,
      imageExtensions: IMAGE_EXTENSIONS,
      videoExtensions: VIDEO_EXTENSIONS,
      updatedAt: new Date().toISOString()
    };
  }
}

function mapRun(row: Record<string, unknown>): IndexStatus {
  return {
    runId: row.id as string,
    state: row.state as IndexStatus['state'],
    total: Number(row.total ?? 0),
    processed: Number(row.processed ?? 0),
    queued: Number(row.queued ?? 0),
    failed: Number(row.failed ?? 0),
    skipped: Number(row.skipped ?? 0),
    startedAt: (row.started_at as string | null) ?? null,
    finishedAt: (row.finished_at as string | null) ?? null,
    error: (row.error as string | null) ?? null
  };
}

export function mapPhotoRow(row: Record<string, unknown>): PhotoRow {
  return {
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
    gps_source: (row.gps_source as PhotoRow['gps_source']) ?? null,
    city: (row.city as string | null) ?? null,
    district: (row.district as string | null) ?? null,
    place: (row.place as string | null) ?? null,
    address: (row.address as string | null) ?? null,
    thumbnail_path: (row.thumbnail_path as string | null) ?? null,
    sha256: row.sha256 as string,
    perceptual_hash: row.perceptual_hash as string,
    embedding: (row.embedding as Buffer | null) ?? null,
    status: row.status as PhotoStatus,
    canonical_photo_id: (row.canonical_photo_id as string | null) ?? null,
    duplicate_group_id: (row.duplicate_group_id as string | null) ?? null,
    quarantine_reason: (row.quarantine_reason as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    indexed_at: (row.indexed_at as string | null) ?? null
  };
}

function mapFaceRow(row: Record<string, unknown>): FaceRow {
  return {
    id: row.id as string,
    photo_id: row.photo_id as string,
    cluster_id: (row.cluster_id as string | null) ?? null,
    descriptor: row.descriptor as Buffer,
    bounding_box: (row.bounding_box as string | null) ?? null,
    confidence: (row.confidence as number | null) ?? null,
    created_at: row.created_at as string
  };
}
