import type { SearchFilters, SearchResult } from '@photoarchive/shared';
import type { AppConfig } from '../config.js';
import type { AppDatabase, PhotoRow } from '../lib/database.js';
import type { Logger } from '../lib/logger.js';
import type { AiProvider } from './aiProvider.js';
import { toPhotoRecords } from './photoMapper.js';
import type { VectorStore } from './vectorStore.js';

export class SearchService {
  constructor(
    private readonly config: AppConfig,
    private readonly db: AppDatabase,
    private readonly logger: Logger,
    private readonly aiProvider: AiProvider,
    private readonly vectorStore: VectorStore
  ) {}

  async search(input: SearchFilters): Promise<SearchResult> {
    const started = performance.now();
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 48));
    const where = this.buildWhere(input);
    let rows: PhotoRow[] = [];
    let total = 0;
    let engine: SearchResult['engine'] = 'metadata_fts';

    const textEmbedding = input.q ? await this.aiProvider.embedText?.(input.q).catch(() => null) : null;
    if (input.q && textEmbedding && (await this.vectorStore.health())) {
      engine = this.vectorStore.kind === 'qdrant' ? 'qdrant' : 'sqlite_vector';
      const vectorIds = await this.vectorStore.search(textEmbedding, Math.max(page * pageSize, 200));
      if (vectorIds.length === 0) {
        return { items: [], total: 0, page, pageSize, tookMs: elapsed(started), engine };
      }

      const vectorWhere = `${where.sql ? `${where.sql} AND` : 'WHERE'} p.id IN (${vectorIds.map(() => '?').join(',')})`;
      total = this.count(vectorWhere, [...where.params, ...vectorIds]);
      rows = this.query(vectorWhere, [...where.params, ...vectorIds], page, pageSize, `ORDER BY p.updated_at DESC`);
    } else {
      const fallbackWhere = { ...where };
      if (input.q) {
        const q = `%${input.q.toLowerCase()}%`;
        fallbackWhere.sql += `${fallbackWhere.sql ? ' AND' : 'WHERE'} (
          lower(p.relative_path) LIKE ? OR lower(p.file_name) LIKE ? OR lower(COALESCE(p.address,'')) LIKE ?
          OR lower(COALESCE(p.city,'')) LIKE ? OR lower(COALESCE(p.district,'')) LIKE ? OR lower(COALESCE(p.place,'')) LIKE ?
          OR lower(COALESCE(p.camera_model,'')) LIKE ?
          OR EXISTS (
            SELECT 1 FROM photo_tags pt JOIN tags t ON t.id = pt.tag_id
            WHERE pt.photo_id = p.id AND (lower(t.name) LIKE ? OR lower(COALESCE(t.russian_name,'')) LIKE ?)
          )
        )`;
        fallbackWhere.params.push(q, q, q, q, q, q, q, q, q);
      }

      total = this.count(fallbackWhere.sql, fallbackWhere.params);
      rows = this.query(fallbackWhere.sql, fallbackWhere.params, page, pageSize);
    }

    if (input.style) {
      this.logger.debug('search', 'Style search uses tag/object metadata in fallback mode', { style: input.style });
    }

    return {
      items: toPhotoRecords(this.db, rows),
      total,
      page,
      pageSize,
      tookMs: elapsed(started),
      engine
    };
  }

  private buildWhere(input: SearchFilters): { sql: string; params: unknown[] } {
    const clauses: string[] = [`p.status != 'deleted'`];
    const params: unknown[] = [];

    if (input.from) {
      clauses.push('p.taken_at >= ?');
      params.push(new Date(input.from).toISOString());
    }
    if (input.to) {
      clauses.push('p.taken_at <= ?');
      params.push(new Date(input.to).toISOString());
    }
    if (input.location) {
      const q = `%${input.location.toLowerCase()}%`;
      clauses.push(`(
        lower(COALESCE(p.address,'')) LIKE ? OR lower(COALESCE(p.city,'')) LIKE ?
        OR lower(COALESCE(p.district,'')) LIKE ? OR lower(COALESCE(p.place,'')) LIKE ?
      )`);
      params.push(q, q, q, q);
    }
    if (input.faceClusterId) {
      clauses.push('EXISTS (SELECT 1 FROM faces f WHERE f.photo_id = p.id AND f.cluster_id = ?)');
      params.push(input.faceClusterId);
    }
    if (input.tag) {
      clauses.push(`EXISTS (
        SELECT 1 FROM photo_tags pt JOIN tags t ON t.id = pt.tag_id
        WHERE pt.photo_id = p.id AND lower(t.name) LIKE ?
      )`);
      params.push(`%${input.tag.toLowerCase()}%`);
    }
    if (input.style) {
      const style = `%${input.style.toLowerCase()}%`;
      clauses.push(`(
        EXISTS (
          SELECT 1 FROM photo_tags pt JOIN tags t ON t.id = pt.tag_id
          WHERE pt.photo_id = p.id AND (lower(t.name) LIKE ? OR lower(COALESCE(t.russian_name,'')) LIKE ?)
        )
        OR EXISTS (
          SELECT 1 FROM objects o WHERE o.photo_id = p.id AND lower(o.label) LIKE ?
        )
      )`);
      params.push(style, style, style);
    }

    return { sql: `WHERE ${clauses.join(' AND ')}`, params };
  }

  private count(whereSql: string, params: unknown[]): number {
    const row = this.db.db
      .prepare(`SELECT COUNT(*) AS value FROM photos p ${whereSql}`)
      .get(...params) as { value: number } | undefined;
    return Number(row?.value ?? 0);
  }

  private query(whereSql: string, params: unknown[], page: number, pageSize: number, orderBy = 'ORDER BY COALESCE(p.taken_at, p.created_at) DESC'): PhotoRow[] {
    return (
      this.db.db
        .prepare(`SELECT p.* FROM photos p ${whereSql} ${orderBy} LIMIT ? OFFSET ?`)
        .all(...params, pageSize, (page - 1) * pageSize) as Record<string, unknown>[]
    ).map((row) => ({
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
      status: row.status as PhotoRow['status'],
      canonical_photo_id: (row.canonical_photo_id as string | null) ?? null,
      duplicate_group_id: (row.duplicate_group_id as string | null) ?? null,
      quarantine_reason: (row.quarantine_reason as string | null) ?? null,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      indexed_at: (row.indexed_at as string | null) ?? null
    }));
  }
}

function elapsed(started: number): number {
  return Math.round(performance.now() - started);
}
