import fs from 'node:fs/promises';
import path from 'node:path';
import type { FileOperationResult, PhotoRecord } from '@photoarchive/shared';
import { BULK_OPERATION_CONFIRMATION_THRESHOLD } from '@photoarchive/shared';
import type { AppDatabase, PhotoRow } from '../lib/database.js';
import { normalizeArchivePath, relativeToRoot, uniqueTargetPath } from '../lib/pathSafety.js';
import type { Logger } from '../lib/logger.js';

export type FileOperation = 'delete' | 'copy' | 'move';
export type DuplicateAction = 'mark' | 'delete' | 'move' | 'skip';

export class FileOperationService {
  constructor(
    private readonly db: AppDatabase,
    private readonly logger: Logger,
    private readonly archiveRoot: () => string
  ) {}

  async operate(operation: FileOperation, ids: string[], targetFolder?: string, confirmBulk = false): Promise<FileOperationResult> {
    const uniqueIds = [...new Set(ids)].filter(Boolean);
    if (uniqueIds.length === 0) {
      return { ok: false, processed: 0, failed: [], message: 'No photo IDs provided' };
    }
    if (uniqueIds.length > BULK_OPERATION_CONFIRMATION_THRESHOLD && !confirmBulk) {
      return {
        ok: false,
        processed: 0,
        failed: [],
        requiresConfirmation: true,
        message: `Operation affects ${uniqueIds.length} files. Explicit confirmation is required.`
      };
    }

    const photos = this.db.listPhotos(uniqueIds).filter((photo) => photo.status !== 'deleted');
    const failures: { id: string; error: string }[] = [];
    let processed = 0;

    let normalizedTarget: string | null = null;
    if (operation !== 'delete') {
      if (!targetFolder) {
        return { ok: false, processed: 0, failed: [], message: 'targetFolder is required for copy/move operations' };
      }
      normalizedTarget = normalizeArchivePath(targetFolder, this.archiveRoot());
      await fs.mkdir(normalizedTarget, { recursive: true });
    }

    for (const photo of photos) {
      try {
        if (operation === 'delete') await this.deletePhoto(photo);
        else if (operation === 'copy') await this.copyPhoto(photo, normalizedTarget!);
        else await this.movePhoto(photo, normalizedTarget!);
        processed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ id: photo.id, error: message });
        this.db.logFileOperation(operation, photo.id, photo.path, normalizedTarget, 'failed', message);
      }
    }

    const missing = uniqueIds.filter((id) => !photos.some((photo) => photo.id === id));
    for (const id of missing) failures.push({ id, error: 'Photo not found or already deleted' });

    return {
      ok: failures.length === 0,
      processed,
      failed: failures,
      message: failures.length === 0 ? `${operation} completed for ${processed} file(s)` : `${operation} completed with ${failures.length} failure(s)`
    };
  }

  async resolveDuplicateGroup(groupId: string, action: DuplicateAction, targetFolder?: string, confirmBulk = false): Promise<FileOperationResult> {
    const group = this.db.getDuplicateGroup(groupId);
    if (!group) return { ok: false, processed: 0, failed: [], message: 'Duplicate group not found' };

    const nonCanonical = group.photos.filter((photo) => !photo.isCanonical);
    if (action === 'skip') {
      this.db.resolveDuplicateGroup(groupId);
      return { ok: true, processed: 0, failed: [], message: 'Duplicate group skipped' };
    }

    if (action === 'mark') {
      for (const photo of nonCanonical) {
        this.db.updatePhotoStatus(photo.id, 'duplicate', { canonical_photo_id: group.photos.find((item) => item.isCanonical)?.id, duplicate_group_id: groupId });
      }
      this.db.resolveDuplicateGroup(groupId);
      return { ok: true, processed: nonCanonical.length, failed: [], message: 'Duplicates marked; canonical version kept' };
    }

    return this.operate(action, nonCanonical.map((photo) => photo.id), targetFolder, confirmBulk);
  }

  private async deletePhoto(photo: PhotoRow): Promise<void> {
    await fs.rm(photo.path, { force: true });
    this.db.updatePhotoStatus(photo.id, 'deleted', { quarantine_reason: null });
    this.db.logFileOperation('delete', photo.id, photo.path, null, 'success');
    this.logger.info('files', 'Photo deleted', { photoId: photo.id, path: photo.path });
  }

  private async copyPhoto(photo: PhotoRow, targetFolder: string): Promise<void> {
    const target = uniqueTargetPath(targetFolder, photo.file_name);
    await fs.copyFile(photo.path, target);
    this.db.logFileOperation('copy', photo.id, photo.path, target, 'success');
    this.logger.info('files', 'Photo copied', { photoId: photo.id, source: photo.path, target });
  }

  private async movePhoto(photo: PhotoRow, targetFolder: string): Promise<void> {
    const target = uniqueTargetPath(targetFolder, photo.file_name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rename(photo.path, target);
    this.db.updatePhotoPath(photo.id, target, relativeToRoot(target, this.archiveRoot()));
    this.db.logFileOperation('move', photo.id, photo.path, target, 'success');
    this.logger.info('files', 'Photo moved', { photoId: photo.id, source: photo.path, target });
  }
}

export function photoRowToRecord(row: PhotoRow, tags: string[]): PhotoRecord {
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
    embedding: row.embedding ? Array.from(new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4)) : null,
    tags,
    status: row.status,
    canonicalPhotoId: row.canonical_photo_id,
    duplicateGroupId: row.duplicate_group_id,
    quarantineReason: row.quarantine_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    indexedAt: row.indexed_at
  };
}
