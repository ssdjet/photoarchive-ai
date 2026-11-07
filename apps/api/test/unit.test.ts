import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { cosineSimilarity, deterministicEmbedding, normalizeVector, resizeVector } from '../src/services/aiProvider.js';
import { inferDateFromName } from '../src/services/metadata.js';
import { normalizeArchivePath, relativeToRoot, toOSPath } from '../src/lib/pathSafety.js';

describe('local AI math helpers', () => {
  it('creates stable normalized embeddings', () => {
    const a = deterministicEmbedding('same-seed', 512);
    const b = deterministicEmbedding('same-seed', 512);
    expect(a).toEqual(b);
    expect(Math.sqrt(a.reduce((sum, value) => sum + value * value, 0))).toBeCloseTo(1, 5);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 6);
    expect(cosineSimilarity(a, deterministicEmbedding('other-seed', 512))).toBeLessThan(0.8);
  });

  it('resizes vectors without changing length', () => {
    expect(resizeVector([1, 2, 3], 8)).toHaveLength(8);
    expect(resizeVector([1, 2, 3, 4, 5], 2)).toHaveLength(2);
    expect(normalizeVector([3, 4])).toEqual([0.6, 0.8]);
  });
});

describe('metadata helpers', () => {
  it('infers date from folder and file names', () => {
    expect(inferDateFromName('trips/2024-05-01/sochi.jpg')).toBe('2024-05-01T00:00:00.000Z');
    expect(inferDateFromName('01.06.2023/event/image.jpg')).toBe('2023-06-01T00:00:00.000Z');
    expect(inferDateFromName('no-date/image.jpg')).toBeNull();
  });

  it('computes a deterministic perceptual hash', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'photoarchive-unit-'));
    const file = path.join(dir, 'image.jpg');
    await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 3,
        background: { r: 80, g: 120, b: 200 }
      }
    })
      .jpeg()
      .toFile(file);

    const { perceptualHash } = await import('../src/services/metadata.js');
    const first = await perceptualHash(file);
    const second = await perceptualHash(file);
    expect(first).toHaveLength(64);
    expect(first).toBe(second);
  });
});

describe('path safety', () => {
  it('rejects paths outside the archive root', () => {
    const root = path.resolve('/tmp/archive');
    expect(() => normalizeArchivePath('../outside.jpg', root)).toThrow(/escapes archive root/);
    expect(normalizeArchivePath('events/photo.jpg', root)).toBe(path.join(root, 'events/photo.jpg'));
  });

  it('creates stable relative paths and OS paths', () => {
    const root = path.resolve('/tmp/archive');
    const file = path.join(root, 'events', 'photo.jpg');
    expect(relativeToRoot(file, root)).toBe('events/photo.jpg');
    expect(toOSPath(file)).toBe(file);
  });
});
