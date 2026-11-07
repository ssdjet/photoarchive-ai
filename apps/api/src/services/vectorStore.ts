import { QdrantClient } from '@qdrant/js-client-rest';
import type { AppConfig } from '../config.js';
import type { AppDatabase, PhotoRow } from '../lib/database.js';
import { cosineSimilarity } from './aiProvider.js';

export interface VectorStore {
  readonly kind: 'qdrant' | 'sqlite' | 'sqlite_vector';
  health(): Promise<boolean>;
  upsert(photo: PhotoRow, vector: number[]): Promise<void>;
  search(vector: number[], limit: number): Promise<string[]>;
}

export class QdrantVectorStore implements VectorStore {
  readonly kind = 'qdrant';
  private client: QdrantClient;
  private available: boolean | null = null;

  constructor(private readonly config: AppConfig) {
    this.client = new QdrantClient({
      url: config.QDRANT_URL,
      apiKey: config.QDRANT_API_KEY
    });
  }

  async health(): Promise<boolean> {
    if (this.available !== null) return this.available;
    try {
      await this.ensureCollection();
      this.available = true;
    } catch {
      this.available = false;
    }
    return this.available;
  }

  async upsert(photo: PhotoRow, vector: number[]): Promise<void> {
    await this.ensureCollection();
    await this.client.upsert(this.config.QDRANT_COLLECTION, {
      points: [
        {
          id: photo.id,
          vector,
          payload: {
            photoId: photo.id,
            sha256: photo.sha256,
            takenAt: photo.taken_at,
            status: photo.status
          }
        }
      ]
    });
  }

  async search(vector: number[], limit: number): Promise<string[]> {
    await this.ensureCollection();
    const result = await this.client.search(this.config.QDRANT_COLLECTION, {
      vector,
      limit,
      with_payload: true
    });

    return result
      .map((point) => (point.payload as { photoId?: string } | null | undefined)?.photoId)
      .filter((id): id is string => Boolean(id));
  }

  private async ensureCollection(): Promise<void> {
    const collections = await this.client.getCollections();
    const exists = collections.collections.some((collection) => collection.name === this.config.QDRANT_COLLECTION);
    if (!exists) {
      await this.client.createCollection(this.config.QDRANT_COLLECTION, {
        vectors: {
          size: this.config.VECTOR_SIZE,
          distance: 'Cosine'
        }
      });
    }
  }
}

export class SqliteVectorStore implements VectorStore {
  readonly kind = 'sqlite_vector';

  constructor(private readonly db: AppDatabase) {}

  async health(): Promise<boolean> {
    return true;
  }

  async upsert(): Promise<void> {
    // Embeddings are persisted in SQLite by the indexer. This store performs local cosine search.
  }

  async search(vector: number[], limit: number): Promise<string[]> {
    const candidates = this.db.photosWithEmbeddings(undefined, Math.max(limit * 20, 1000));
    return candidates
      .map((photo) => ({
        id: photo.id,
        similarity: photo.embedding ? cosineSimilarity(vector, new Float32Array(photo.embedding.buffer, photo.embedding.byteOffset, photo.embedding.byteLength / 4)) : 0
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit)
      .map((candidate) => candidate.id);
  }
}

export function createVectorStore(config: AppConfig, db: AppDatabase): VectorStore {
  if (config.QDRANT_URL) return new QdrantVectorStore(config);
  return new SqliteVectorStore(db);
}
