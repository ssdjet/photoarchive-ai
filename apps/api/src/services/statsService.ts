import type { ArchiveStats } from '@photoarchive/shared';
import type { AppDatabase } from '../lib/database.js';
import type { AiProvider } from './aiProvider.js';
import type { IndexService } from './indexService.js';
import type { IndexQueue } from './queue.js';
import type { VectorStore } from './vectorStore.js';

export class StatsService {
  constructor(
    private readonly db: AppDatabase,
    private readonly indexService: IndexService,
    private readonly aiProvider: AiProvider,
    private readonly vectorStore: VectorStore,
    private readonly queue: IndexQueue
  ) {}

  async stats(): Promise<ArchiveStats> {
    const dbStats = this.db.stats();
    const qdrantUnavailable = this.vectorStore.kind === 'qdrant' ? !(await this.vectorStore.health()) : false;
    const redisUnavailable = this.queue.kind === 'redis' ? !(await this.queue.health()) : false;

    return {
      ...dbStats,
      indexing: this.indexService.status(),
      warnings: {
        duplicates: dbStats.duplicateGroups,
        brokenFiles: dbStats.quarantined,
        qdrantUnavailable,
        redisUnavailable,
        aiFallback: this.aiProvider.name === 'fallback-local'
      },
      aiProvider: this.aiProvider.name,
      directml: this.aiProvider.directml,
      vectorStoreKind: this.vectorStore.kind,
      queueKind: this.queue.kind
    };
  }
}
