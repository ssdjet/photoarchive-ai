import type {
  ArchiveSettings,
  ArchiveStats,
  DuplicateGroup,
  FaceClusterRecord,
  FileOperationResult,
  IndexStatus,
  LogRecord,
  PhotoRecord,
  SearchFilters,
  SearchResult
} from '@photoarchive/shared';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export interface HealthResponse {
  ok: boolean;
  provider: string;
  directml: boolean;
  modelStatus: string;
  vectorStore: string;
  queue: string;
}

export interface PhotoDetail extends PhotoRecord {
  faces: {
    id: string;
    clusterId: string | null;
    boundingBox?: { x: number; y: number; width: number; height: number } | null;
    confidence: number | null;
  }[];
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload?: unknown
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    },
    cache: 'no-store'
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'message' in payload
      ? String((payload as { message?: unknown }).message)
      : `Request failed with ${response.status}`;
    throw new ApiRequestError(message, response.status, payload);
  }
  return payload as T;
}

function queryString(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const api = {
  health: () => request<HealthResponse>('/health'),
  stats: () => request<ArchiveStats>('/api/stats'),
  settings: () => request<ArchiveSettings>('/api/settings'),
  updateSettings: (settings: ArchiveSettings) =>
    request<ArchiveSettings>('/api/settings', { method: 'PUT', body: JSON.stringify(settings) }),
  search: (filters: SearchFilters) => request<SearchResult>(`/api/search${queryString(filters as Record<string, string | number | boolean | undefined>)}`),
  startIndexing: (root?: string, full = false) =>
    request<IndexStatus>('/api/index/start', { method: 'POST', body: JSON.stringify({ root, full }) }),
  indexStatus: () => request<IndexStatus | null>('/api/index/status'),
  duplicates: () => request<DuplicateGroup[]>('/api/duplicates'),
  setCanonical: (groupId: string, photoId: string) =>
    request<DuplicateGroup>(`/api/duplicates/groups/${groupId}/canonical`, { method: 'POST', body: JSON.stringify({ photoId }) }),
  resolveDuplicate: (groupId: string, action: 'mark' | 'delete' | 'move' | 'skip', targetFolder?: string, confirmBulk = false) =>
    request<FileOperationResult>(`/api/duplicates/groups/${groupId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ action, targetFolder, confirmBulk })
    }),
  faceClusters: () => request<FaceClusterRecord[]>('/api/faces/clusters'),
  clusterPhotos: (clusterId: string) => request<PhotoRecord[]>(`/api/faces/clusters/${clusterId}/photos`),
  renameCluster: (clusterId: string, name: string) =>
    request<FaceClusterRecord>(`/api/faces/clusters/${clusterId}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  mergeClusters: (clusterIds: string[]) =>
    request<FaceClusterRecord>('/api/faces/clusters/merge', { method: 'POST', body: JSON.stringify({ clusterIds }) }),
  splitCluster: (clusterId: string, photoIds: string[]) =>
    request<FaceClusterRecord>('/api/faces/clusters/split', { method: 'POST', body: JSON.stringify({ clusterId, photoIds }) }),
  photo: (photoId: string) => request<PhotoDetail>(`/api/photos/${photoId}`),
  deletePhotos: (ids: string[], confirmBulk = false) =>
    request<FileOperationResult>('/api/photos/delete', { method: 'POST', body: JSON.stringify({ ids, confirmBulk }) }),
  copyPhotos: (ids: string[], targetFolder: string, confirmBulk = false) =>
    request<FileOperationResult>('/api/photos/copy', { method: 'POST', body: JSON.stringify({ ids, targetFolder, confirmBulk }) }),
  movePhotos: (ids: string[], targetFolder: string, confirmBulk = false) =>
    request<FileOperationResult>('/api/photos/move', { method: 'POST', body: JSON.stringify({ ids, targetFolder, confirmBulk }) }),
  logs: (level?: LogRecord['level'], limit = 200) =>
    request<LogRecord[]>(`/api/logs${queryString({ level, limit })}`),
  quarantine: () => request<PhotoRecord[]>('/api/quarantine'),
  backup: () => request<{ ok: boolean; path: string }>('/api/backup', { method: 'POST', body: JSON.stringify({}) })
};

export function thumbnailUrl(photoId: string): string {
  return `${API_URL}/api/photos/${photoId}/thumbnail`;
}

export function photoFileUrl(photoId: string): string {
  return `${API_URL}/api/photos/${photoId}/file`;
}
