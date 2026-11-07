import type { PhotoRecord } from '@photoarchive/shared';
import type { AppDatabase, PhotoRow } from '../lib/database.js';

export function toPhotoRecord(db: AppDatabase, row: PhotoRow): PhotoRecord {
  return {
    id: row.id,
    path: row.path,
    relativePath: row.relative_path,
    fileName: row.file_name,
    extension: row.extension,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    takenAt: row.taken_at,
    timeZone: row.time_zone,
    cameraMake: row.camera_make,
    cameraModel: row.camera_model,
    latitude: row.latitude,
    longitude: row.longitude,
    altitude: row.altitude,
    gpsSource: row.gps_source,
    city: row.city,
    district: row.district,
    place: row.place,
    address: row.address,
    thumbnailPath: row.thumbnail_path,
    sha256: row.sha256,
    perceptualHash: row.perceptual_hash,
    embedding: row.embedding
      ? Array.from(new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4))
      : null,
    tags: db.getPhotoTags(row.id),
    status: row.status,
    canonicalPhotoId: row.canonical_photo_id,
    duplicateGroupId: row.duplicate_group_id,
    quarantineReason: row.quarantine_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    indexedAt: row.indexed_at
  };
}

export function toPhotoRecords(db: AppDatabase, rows: PhotoRow[]): PhotoRecord[] {
  return rows.map((row) => toPhotoRecord(db, row));
}
