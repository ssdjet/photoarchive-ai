import path from 'node:path';
import { z } from 'zod';

const envBoolean = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') return defaultValue;
      return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
    });

const configSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATA_DIR: z.string().default('./data'),
  ARCHIVE_ROOT: z.string().default('./data/archive'),
  QUARANTINE_FOLDER: z.string().default('./data/quarantine'),
  THUMBNAILS_FOLDER: z.string().default('./data/thumbnails'),
  QDRANT_URL: z.string().optional(),
  QDRANT_API_KEY: z.string().optional(),
  QDRANT_COLLECTION: z.string().default('photoarchive'),
  VECTOR_SIZE: z.coerce.number().int().positive().default(512),
  REDIS_URL: z.string().optional(),
  REDIS_PREFIX: z.string().default('photoarchive'),
  OCR_ENABLED: envBoolean(false),
  OCR_LANGUAGES: z.string().default('rus+eng'),
  AI_PROVIDER: z.enum(['auto', 'onnx', 'fallback']).default('auto'),
  DIRECTML: z.enum(['auto', 'on', 'off']).default('auto'),
  CLIP_MODEL_PATH: z.string().optional(),
  CLIP_TEXT_MODEL_PATH: z.string().optional(),
  TOKENIZER_PATH: z.string().optional(),
  TEXT_MAX_TOKENS: z.coerce.number().int().positive().default(77),
  FACE_DETECTION_MODEL_PATH: z.string().optional(),
  FACE_RECOGNITION_MODEL_PATH: z.string().optional(),
  SCENE_MODEL_PATH: z.string().optional(),
  BATCH_SIZE: z.coerce.number().int().positive().default(64),
  NEAR_DUPLICATE_THRESHOLD: z.coerce.number().min(0.5).max(1).default(0.93),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info')
});

export type AppConfig = z.infer<typeof configSchema> & {
  dataDir: string;
  archiveRoot: string;
  quarantineFolder: string;
  thumbnailsFolder: string;
  isProduction: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): AppConfig {
  const parsed = configSchema.parse(env);
  const dataDir = path.resolve(cwd, parsed.DATA_DIR);

  return {
    ...parsed,
    dataDir,
    archiveRoot: path.resolve(cwd, parsed.ARCHIVE_ROOT),
    quarantineFolder: path.resolve(cwd, parsed.QUARANTINE_FOLDER),
    thumbnailsFolder: path.resolve(cwd, parsed.THUMBNAILS_FOLDER),
    isProduction: parsed.NODE_ENV === 'production'
  };
}
