import type { FaceClusterRecord, PhotoRecord } from '@photoarchive/shared';
import type { AppDatabase } from '../lib/database.js';
import { toPhotoRecords } from './photoMapper.js';

export class FacesService {
  constructor(private readonly db: AppDatabase) {}

  listClusters(): FaceClusterRecord[] {
    return this.db.listFaceClusters();
  }

  photosForCluster(clusterId: string): PhotoRecord[] {
    const faces = this.db.listFacesByCluster(clusterId);
    const photoIds = [...new Set(faces.map((face) => face.photoId))];
    const rows = this.db.listPhotos(photoIds);
    const byRelevance = new Map(faces.map((face) => [face.photoId, face.createdAt]));
    return toPhotoRecords(this.db, rows).sort(
      (a, b) => (byRelevance.get(b.id) ?? b.createdAt).localeCompare(byRelevance.get(a.id) ?? a.createdAt)
    );
  }

  renameCluster(clusterId: string, name: string): FaceClusterRecord | null {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Cluster name cannot be empty');
    this.db.updateFaceCluster(clusterId, { name: trimmed });
    return this.db.getFaceCluster(clusterId);
  }

  mergeClusters(clusterIds: string[]): FaceClusterRecord | null {
    const unique = [...new Set(clusterIds)].filter(Boolean);
    if (unique.length < 2) throw new Error('Select at least two clusters to merge');
    const [target, ...rest] = unique;
    for (const source of rest) {
      const faces = this.db.listFacesByCluster(source);
      this.db.updateFaceClusterId(faces.map((face) => face.id), target);
    }
    this.db.deleteEmptyFaceClusters();
    return this.db.getFaceCluster(target);
  }

  splitCluster(clusterId: string, photoIds: string[]): FaceClusterRecord | null {
    if (photoIds.length === 0) throw new Error('Select at least one photo to split');
    const faces = this.db.listFacesByCluster(clusterId).filter((face) => photoIds.includes(face.photoId));
    if (faces.length === 0) throw new Error('Selected photos do not contain faces from this cluster');
    const newClusterId = this.db.createFaceCluster(`Человек ${this.db.listFaceClusters().length + 1}`, photoIds[0]);
    this.db.updateFaceClusterId(faces.map((face) => face.id), newClusterId);
    return this.db.getFaceCluster(newClusterId);
  }
}
