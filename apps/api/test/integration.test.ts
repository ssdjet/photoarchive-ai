import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BuiltApp } from '../src/server.js';
import { buildApp } from '../src/server.js';

async function makeImage(filePath: string, color: { r: number; g: number; b: number }, size = 96): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: color
    }
  })
    .jpeg({ quality: 88 })
    .toFile(filePath);
}

describe('PhotoArchive AI API integration', () => {
  let temp: string;
  let archive: string;
  let built: BuiltApp;

  beforeEach(async () => {
    temp = await fs.mkdtemp(path.join(os.tmpdir(), 'photoarchive-api-'));
    archive = path.join(temp, 'archive');
    built = await buildApp(
      {
        NODE_ENV: 'test',
        PORT: '1',
        DATA_DIR: path.join(temp, 'data'),
        ARCHIVE_ROOT: archive,
        QUARANTINE_FOLDER: path.join(temp, 'quarantine'),
        THUMBNAILS_FOLDER: path.join(temp, 'thumbnails'),
        AI_PROVIDER: 'fallback',
        OCR_ENABLED: 'false'
      },
      temp
    );
  });

  afterEach(async () => {
    if (built) await built.close();
    await fs.rm(temp, { recursive: true, force: true });
  });

  async function startIndexingAndWait(): Promise<void> {
    const started = await built.app.inject({
      method: 'POST',
      url: '/api/index/start',
      payload: { root: archive, full: true }
    });
    expect(started.statusCode).toBe(202);
    const runId = started.json().runId as string;

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const status = await built.app.inject({ method: 'GET', url: '/api/index/status' });
      const body = status.json();
      if (body.runId === runId && ['completed', 'failed'].includes(body.state)) {
        expect(body.state).toBe('completed');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Indexing did not finish in time');
  }

  it('indexes photos, quarantines broken files, groups exact duplicates, and searches metadata', async () => {
    await makeImage(path.join(archive, 'events', 'sochi-2024-05-01.jpg'), { r: 20, g: 80, b: 160 });
    await fs.copyFile(
      path.join(archive, 'events', 'sochi-2024-05-01.jpg'),
      path.join(archive, 'events', 'sochi-copy.jpg')
    );
    await fs.mkdir(path.join(archive, 'broken'), { recursive: true });
    await fs.writeFile(path.join(archive, 'broken', 'not-a-photo.jpg'), 'this is not an image');

    await startIndexingAndWait();

    const stats = await built.app.inject({ method: 'GET', url: '/api/stats' });
    expect(stats.statusCode).toBe(200);
    const statsBody = stats.json();
    expect(statsBody.photos).toBe(3);
    expect(statsBody.indexedPhotos).toBe(2);
    expect(statsBody.quarantined).toBe(1);
    expect(statsBody.duplicateGroups).toBe(1);

    const duplicates = await built.app.inject({ method: 'GET', url: '/api/duplicates' });
    expect(duplicates.statusCode).toBe(200);
    const groups = duplicates.json();
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe('exact_hash');
    expect(groups[0].photos).toHaveLength(2);

    const newCanonical = groups[0].photos[1].id as string;
    const canonical = await built.app.inject({
      method: 'POST',
      url: `/api/duplicates/groups/${groups[0].id}/canonical`,
      payload: { photoId: newCanonical }
    });
    expect(canonical.statusCode).toBe(200);
    expect(canonical.json().photos.find((photo: { id: string }) => photo.id === newCanonical).isCanonical).toBe(true);

    const search = await built.app.inject({ method: 'GET', url: '/api/search?q=sochi&pageSize=10' });
    expect(search.statusCode).toBe(200);
    const searchBody = search.json();
    expect(searchBody.total).toBeGreaterThanOrEqual(2);
    expect(searchBody.items[0].relativePath).toContain('sochi');

    const thumbnail = await built.app.inject({ method: 'GET', url: `/api/photos/${searchBody.items[0].id}/thumbnail` });
    expect(thumbnail.statusCode).toBe(200);
    expect(thumbnail.headers['content-type']).toContain('image/jpeg');

    const quarantine = await built.app.inject({ method: 'GET', url: '/api/quarantine' });
    expect(quarantine.statusCode).toBe(200);
    expect(quarantine.json()[0].status).toBe('quarantine');
  });

  it('requires explicit confirmation for bulk delete and performs confirmed operations', async () => {
    for (let index = 0; index < 11; index += 1) {
      await makeImage(path.join(archive, `bulk-${String(index).padStart(2, '0')}.jpg`), {
        r: index * 10,
        g: 40 + index,
        b: 180 - index
      });
    }

    await startIndexingAndWait();
    const all = await built.app.inject({ method: 'GET', url: '/api/search?pageSize=20' });
    const ids = all.json().items.map((photo: { id: string }) => photo.id) as string[];
    expect(ids).toHaveLength(11);

    const unconfirmed = await built.app.inject({
      method: 'POST',
      url: '/api/photos/delete',
      payload: { ids }
    });
    expect(unconfirmed.statusCode).toBe(200);
    expect(unconfirmed.json()).toMatchObject({ ok: false, requiresConfirmation: true });

    const confirmed = await built.app.inject({
      method: 'POST',
      url: '/api/photos/delete',
      payload: { ids, confirmBulk: true }
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({ ok: true, processed: 11 });

    const afterDelete = await built.app.inject({ method: 'GET', url: '/api/search?pageSize=20' });
    expect(afterDelete.json().total).toBe(0);
  });

  it('copies and moves individual photos inside the archive', async () => {
    const first = path.join(archive, 'copy-me.jpg');
    const second = path.join(archive, 'move-me.jpg');
    await makeImage(first, { r: 10, g: 90, b: 140 });
    await makeImage(second, { r: 90, g: 20, b: 120 });
    await startIndexingAndWait();

    const all = await built.app.inject({ method: 'GET', url: '/api/search?pageSize=10' });
    const items = all.json().items as { id: string; fileName: string }[];
    const copyId = items.find((photo) => photo.fileName === 'copy-me.jpg')!.id;
    const moveId = items.find((photo) => photo.fileName === 'move-me.jpg')!.id;

    const copy = await built.app.inject({
      method: 'POST',
      url: '/api/photos/copy',
      payload: { ids: [copyId], targetFolder: 'copied' }
    });
    expect(copy.statusCode).toBe(200);
    expect(copy.json()).toMatchObject({ ok: true, processed: 1 });
    await expect(fs.stat(path.join(archive, 'copied', 'copy-me.jpg'))).resolves.toBeTruthy();

    const move = await built.app.inject({
      method: 'POST',
      url: '/api/photos/move',
      payload: { ids: [moveId], targetFolder: 'moved' }
    });
    expect(move.statusCode).toBe(200);
    await expect(fs.stat(path.join(archive, 'moved', 'move-me.jpg'))).resolves.toBeTruthy();

    const logs = await built.app.inject({ method: 'GET', url: '/api/logs?limit=20' });
    expect(logs.json().some((log: { scope: string }) => log.scope === 'files')).toBe(true);
  });

  it('supports face cluster rename, split, and merge endpoints', async () => {
    const now = new Date().toISOString();
    const photoA = built.db.upsertPhoto({
      id: 'photo-a',
      path: path.join(archive, 'face-a.jpg'),
      relative_path: 'face-a.jpg',
      file_name: 'face-a.jpg',
      extension: '.jpg',
      size_bytes: 10,
      mtime_ms: 1,
      width: 10,
      height: 10,
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
      sha256: 'a'.repeat(64),
      perceptual_hash: '0'.repeat(64),
      embedding: null,
      status: 'active',
      canonical_photo_id: null,
      duplicate_group_id: null,
      quarantine_reason: null,
      created_at: now,
      updated_at: now,
      indexed_at: now
    });
    const photoB = built.db.upsertPhoto({
      ...photoA,
      id: 'photo-b',
      path: path.join(archive, 'face-b.jpg'),
      relative_path: 'face-b.jpg',
      file_name: 'face-b.jpg',
      sha256: 'b'.repeat(64)
    });

    built.db.insertFace({ id: 'face-a', photoId: photoA.id, descriptor: Buffer.from(Float32Array.from([1, 0, 0]).buffer), confidence: 0.99 });
    built.db.insertFace({ id: 'face-b', photoId: photoB.id, descriptor: Buffer.from(Float32Array.from([1, 0, 0]).buffer), confidence: 0.98 });
    const clusterId = built.db.createFaceCluster('Unknown person', photoA.id);
    built.db.updateFaceClusterId(['face-a', 'face-b'], clusterId);

    const clusters = await built.app.inject({ method: 'GET', url: '/api/faces/clusters' });
    expect(clusters.json()).toHaveLength(1);

    const photos = await built.app.inject({ method: 'GET', url: `/api/faces/clusters/${clusterId}/photos` });
    expect(photos.json()).toHaveLength(2);

    const renamed = await built.app.inject({
      method: 'PATCH',
      url: `/api/faces/clusters/${clusterId}`,
      payload: { name: 'Виктор' }
    });
    expect(renamed.json().name).toBe('Виктор');

    const split = await built.app.inject({
      method: 'POST',
      url: '/api/faces/clusters/split',
      payload: { clusterId, photoIds: [photoB.id] }
    });
    expect(split.statusCode).toBe(201);
    const splitClusterId = split.json().id as string;

    const merged = await built.app.inject({
      method: 'POST',
      url: '/api/faces/clusters/merge',
      payload: { clusterIds: [clusterId, splitClusterId] }
    });
    expect(merged.statusCode).toBe(200);
    expect(merged.json().photoCount).toBe(2);
  });
});
