export type PhotoStatus = 'active' | 'duplicate' | 'quarantine' | 'deleted';

export interface PhotoRecord {
  id: string;
  path: string;
  relativePath: string;
  fileName: string;
  extension: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  takenAt?: string | null;
  timeZone?: string | null;
  cameraMake?: string | null;
  cameraModel?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  altitude?: number | null;
  gpsSource?: 'exif' | 'visual' | 'manual' | null;
  city?: string | null;
  district?: string | null;
  place?: string | null;
  address?: string | null;
  thumbnailPath?: string | null;
  sha256: string;
  perceptualHash: string;
  embedding?: number[] | null;
  tags: string[];
  status: PhotoStatus;
  canonicalPhotoId?: string | null;
  duplicateGroupId?: string | null;
  quarantineReason?: string | null;
  createdAt: string;
  updatedAt: string;
  indexedAt?: string | null;
}

export interface FaceRecord {
  id: string;
  photoId: string;
  clusterId?: string | null;
  descriptor: number[];
  boundingBox?: { x: number; y: number; width: number; height: number } | null;
  confidence?: number | null;
  createdAt: string;
}

export interface FaceClusterRecord {
  id: string;
  name: string;
  faceCount: number;
  photoCount: number;
  coverPhotoId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DuplicatePhotoCandidate {
  id: string;
  path: string;
  relativePath: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  sha256: string;
  similarity: number;
  isCanonical: boolean;
}

export interface DuplicateGroup {
  id: string;
  reason: 'exact_hash' | 'visual_similarity';
  photos: DuplicatePhotoCandidate[];
  createdAt: string;
  resolvedAt?: string | null;
}

export interface SearchFilters {
  q?: string;
  from?: string;
  to?: string;
  location?: string;
  faceClusterId?: string;
  tag?: string;
  style?: string;
  ocrText?: boolean;
  page?: number;
  pageSize?: number;
}

export interface SearchResult {
  items: PhotoRecord[];
  total: number;
  page: number;
  pageSize: number;
  tookMs: number;
  engine: 'qdrant' | 'sqlite_vector' | 'metadata_fts';
}

export interface ArchiveStats {
  photos: number;
  indexedPhotos: number;
  faces: number;
  faceClusters: number;
  duplicateGroups: number;
  quarantined: number;
  tags: number;
  locations: number;
  storageBytes: number;
  indexing: IndexStatus | null;
  warnings: {
    duplicates: number;
    brokenFiles: number;
    qdrantUnavailable: boolean;
    redisUnavailable: boolean;
    aiFallback: boolean;
  };
  aiProvider: string;
  directml: boolean;
  vectorStoreKind: string;
  queueKind: string;
}

export interface IndexStatus {
  runId: string;
  state: 'idle' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  total: number;
  processed: number;
  queued: number;
  failed: number;
  skipped: number;
  startedAt?: string | null;
  finishedAt?: string | null;
  error?: string | null;
}

export interface LogRecord {
  id: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  scope: string;
  message: string;
  context?: Record<string, unknown> | null;
  createdAt: string;
}

export interface ArchiveSettings {
  archiveRoot: string;
  dataDir: string;
  quarantineFolder: string;
  thumbnailsFolder: string;
  ocrEnabled: boolean;
  ocrLanguages: string;
  aiProvider: 'auto' | 'onnx' | 'fallback';
  directml: 'auto' | 'on' | 'off';
  clipModelPath: string;
  clipTextModelPath: string;
  tokenizerPath: string;
  textMaxTokens: number;
  faceDetectionModelPath: string;
  faceRecognitionModelPath: string;
  sceneModelPath: string;
  batchSize: number;
  nearDuplicateThreshold: number;
  vectorSize: number;
}

export interface FileOperationResult {
  operation: 'delete' | 'copy' | 'move';
  confirmed: boolean;
  affected: number;
  requested: number;
  requiresConfirmation: boolean;
  results: Array<{ photoId: string; path: string; success: boolean; error?: string | null; targetPath?: string | null }>;
}

export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif', '.heic', '.avif'] as const;
export const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'] as const;

export const BULK_OPERATION_CONFIRMATION_THRESHOLD = 10;

export const STYLE_OPTIONS = [
  { value: 'portrait', label: 'Портрет' },
  { value: 'landscape', label: 'Пейзаж' },
  { value: 'street', label: 'Улица' },
  { value: 'family', label: 'Семья' },
  { value: 'travel', label: 'Путешествия' },
  { value: 'night', label: 'Ночь' },
  { value: 'bw', label: 'Ч/Б' }
] as const;
