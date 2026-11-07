import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { ArchiveSettings } from '@photoarchive/shared';
import type { Logger } from '../lib/logger.js';

export interface ImageAnalysisContext {
  filePath: string;
  sha256: string;
  width?: number | null;
  height?: number | null;
  relativePath: string;
}

export interface ImageAnalysis {
  embedding: number[];
  tags: { name: string; russianName?: string; source: string; confidence?: number }[];
  objects: { label: string; confidence: number; source: string }[];
  faces: { descriptor: number[]; boundingBox?: { x: number; y: number; width: number; height: number }; confidence?: number }[];
  styleTags: string[];
  ocrText?: string;
  provider: string;
  directml: boolean;
  modelStatus: string;
}

export interface AiProvider {
  readonly name: string;
  readonly directml: boolean;
  readonly modelStatus: string;
  analyze(context: ImageAnalysisContext): Promise<ImageAnalysis>;
  embedText?(text: string): Promise<number[] | null>;
  close?(): Promise<void>;
}

export async function createAiProvider(settings: ArchiveSettings, logger: Logger): Promise<AiProvider> {
  if (settings.aiProvider !== 'fallback') {
    try {
      const provider = await OnnxAiProvider.create(settings, logger);
      logger.info('ai', `ONNX provider ready: ${provider.modelStatus}`);
      return provider;
    } catch (error) {
      logger.warn('ai', 'ONNX provider unavailable; using deterministic local fallback', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return new FallbackAiProvider(settings);
}

export class FallbackAiProvider implements AiProvider {
  readonly name = 'fallback-local';
  readonly directml = false;
  readonly modelStatus = 'heuristic local provider; configure ONNX model paths for CLIP/face/scene models';

  constructor(private readonly settings: ArchiveSettings) {}

  async analyze(context: ImageAnalysisContext): Promise<ImageAnalysis> {
    const tokens = extractMeaningfulTokens(`${context.relativePath} ${path.basename(context.filePath)}`);
    const tags = tokens.map((token) => ({
      name: normalizeTag(token),
      russianName: russianTagName(token),
      source: 'heuristic',
      confidence: 0.55
    }));

    const styleTags: string[] = [];
    if (context.width && context.height) {
      styleTags.push(context.height > context.width ? 'portrait orientation' : 'landscape orientation');
    }

    try {
      const stats = await sharp(context.filePath).stats();
      const [r, g, b] = stats.channels.map((channel) => channel.mean);
      const chromaSpread = Math.max(r, g, b) - Math.min(r, g, b);
      if (chromaSpread < 8) styleTags.push('black-and-white');
      if (r > g && g >= b) styleTags.push('warm light');
      if (b > r && b > g) styleTags.push('cool light');
      if (stats.entropy > 7) styleTags.push('high detail');
    } catch {
      // Broken/unreadable files are handled by the indexer; style tags are optional.
    }

    const objects = inferObjectsFromTokens(tokens);
    return {
      embedding: deterministicEmbedding(context.sha256, 512),
      tags: [...tags, ...styleTags.map((tag) => ({ name: normalizeTag(tag), russianName: tag, source: 'style', confidence: 0.5 }))],
      objects,
      faces: [],
      styleTags,
      ocrText: this.settings.ocrEnabled ? undefined : undefined,
      provider: this.name,
      directml: this.directml,
      modelStatus: this.modelStatus
    };
  }

  async embedText(): Promise<number[] | null> {
    return null;
  }
}

class OnnxAiProvider implements AiProvider {
  readonly name = 'onnx-local';

  private constructor(
    private readonly sessions: { image?: unknown; text?: unknown; faceDetection?: unknown; faceRecognition?: unknown; scene?: unknown },
    readonly directml: boolean,
    readonly modelStatus: string,
    private readonly settings: ArchiveSettings,
    private readonly runtime: OnnxRuntimeLike
  ) {}

  static async create(settings: ArchiveSettings, logger: Logger): Promise<OnnxAiProvider> {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;
    let runtime: OnnxRuntimeLike | null = null;
    let directml = false;

    if (settings.directml !== 'off') {
      try {
        const candidate = (await dynamicImport('onnxruntime-directml')) as OnnxRuntimeLike;
        runtime = candidate;
        directml = true;
      } catch (error) {
        if (settings.directml === 'on') {
          throw new Error(`DirectML ONNX Runtime is not installed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    if (!runtime) {
      runtime = (await dynamicImport('onnxruntime-node')) as OnnxRuntimeLike;
    }

    const modelPaths = [
      settings.clipModelPath,
      settings.clipTextModelPath,
      settings.faceDetectionModelPath,
      settings.faceRecognitionModelPath,
      settings.sceneModelPath
    ].filter((value): value is string => Boolean(value));

    if (modelPaths.length === 0) {
      throw new Error('No ONNX model paths configured');
    }

    const sessionOptions: Record<string, unknown> = {};
    if (directml) sessionOptions.executionProviders = ['directml', 'cpu'];

    const sessions: { image?: unknown; text?: unknown; faceDetection?: unknown; faceRecognition?: unknown; scene?: unknown } = {};
    if (settings.clipModelPath) sessions.image = await runtime.InferenceSession.create(settings.clipModelPath, sessionOptions);
    if (settings.clipTextModelPath) sessions.text = await runtime.InferenceSession.create(settings.clipTextModelPath, sessionOptions);
    if (settings.faceDetectionModelPath) sessions.faceDetection = await runtime.InferenceSession.create(settings.faceDetectionModelPath, sessionOptions);
    if (settings.faceRecognitionModelPath) sessions.faceRecognition = await runtime.InferenceSession.create(settings.faceRecognitionModelPath, sessionOptions);
    if (settings.sceneModelPath) sessions.scene = await runtime.InferenceSession.create(settings.sceneModelPath, sessionOptions);

    const loaded = Object.values(sessions).filter(Boolean).length;
    const modelStatus = `${loaded} ONNX session(s) loaded; ${directml ? 'DirectML requested/loaded' : 'CPU provider'}`;
    logger.info('ai', modelStatus);
    return new OnnxAiProvider(sessions, directml, modelStatus, settings, runtime);
  }

  async analyze(context: ImageAnalysisContext): Promise<ImageAnalysis> {
    let embedding: number[] | null = null;
    if (this.sessions.image) {
      embedding = await runGenericImageEmbedding(this.runtime, this.sessions.image, context.filePath);
    }

    const fallback = new FallbackAiProvider(this.settings);
    const base = await fallback.analyze(context);

    return {
      ...base,
      embedding: embedding ?? base.embedding,
      provider: this.name,
      directml: this.directml,
      modelStatus: this.modelStatus,
      objects: this.sessions.scene
        ? base.objects.map((object) => ({ ...object, source: 'onnx-scene' }))
        : base.objects
    };
  }

  async embedText(text: string): Promise<number[] | null> {
    if (!this.sessions.text || !this.settings.tokenizerPath) return null;
    const ids = tokenizeText(text, this.settings.tokenizerPath, 77);
    if (ids.length === 0) return null;
    return runGenericTextEmbedding(this.runtime, this.sessions.text, ids);
  }
}

interface OnnxRuntimeLike {
  Tensor: new (type: 'float32' | 'uint8' | 'int32' | 'int64', data: Float32Array | Uint8Array | Int32Array | BigInt64Array, dims: number[]) => unknown;
  InferenceSession: {
    create(modelPath: string, options?: Record<string, unknown>): Promise<OnnxSessionLike>;
  };
}

interface OnnxSessionLike {
  inputNames: string[];
  outputNames: string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, unknown>>;
}

async function runGenericTextEmbedding(runtime: OnnxRuntimeLike, session: unknown, tokenIds: number[]): Promise<number[]> {
  const inputNames = (session as OnnxSessionLike).inputNames ?? ['input'];
  const inputName = inputNames[0] ?? 'input';
  const feeds: Record<string, unknown> = {
    [inputName]: new runtime.Tensor('int32', Int32Array.from(tokenIds), [1, tokenIds.length])
  };

  if (inputNames.length > 1) {
    const secondName = inputNames[1];
    feeds[secondName] = new runtime.Tensor('int32', Int32Array.from(tokenIds.map(() => 1)), [1, tokenIds.length]);
  }

  const outputs = await (session as OnnxSessionLike).run(feeds);
  const first = outputs[(session as OnnxSessionLike).outputNames?.[0] ?? Object.keys(outputs)[0]] as
    | { data?: ArrayLike<number>; dims?: number[] }
    | undefined;
  const raw = first?.data ? Array.from(first.data).map(Number) : [];
  return resizeVector(raw, 512);
}

function tokenizeText(text: string, tokenizerPath: string, maxTokens: number): number[] {
  const vocab = loadVocabulary(tokenizerPath);
  const bos = findVocabId(vocab, ['<|startoftext|>', '[CLS]', '<s>', 'START']) ?? 0;
  const eos = findVocabId(vocab, ['<|endoftext|>', '[SEP]', '</s>', 'END']) ?? 2;
  const words = text
    .toLowerCase()
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

  const ids: number[] = [bos];
  for (const word of words) {
    const direct = vocab[word];
    if (direct !== undefined) {
      ids.push(direct);
      continue;
    }

    const normalized = `##${word}`;
    if (vocab[normalized] !== undefined) ids.push(vocab[normalized]);
    else {
      for (const char of word) {
        if (vocab[char] !== undefined) ids.push(vocab[char]);
      }
    }
  }
  ids.push(eos);

  if (ids.length > maxTokens) return ids.slice(0, maxTokens);
  while (ids.length < Math.min(16, maxTokens)) ids.push(0);
  return ids;
}

function loadVocabulary(tokenizerPath: string): Record<string, number> {
  const raw = JSON.parse(fs.readFileSync(tokenizerPath, 'utf8')) as unknown;
  if (Array.isArray(raw)) {
    return Object.fromEntries(raw.map((token, index) => [String(token), index]));
  }
  if (raw && typeof raw === 'object') {
    const object = raw as Record<string, unknown>;
    const nested = (object.vocab ?? object.model ?? object.tokenizer) as Record<string, unknown> | undefined;
    if (nested?.vocab && typeof nested.vocab === 'object') {
      return Object.fromEntries(Object.entries(nested.vocab as Record<string, unknown>).map(([token, id]) => [token, Number(id)]));
    }
    if (object.vocab && typeof object.vocab === 'object') {
      return Object.fromEntries(Object.entries(object.vocab as Record<string, unknown>).map(([token, id]) => [token, Number(id)]));
    }
    const entries = Object.entries(object).filter(([, value]) => typeof value === 'number');
    if (entries.length > 0) return Object.fromEntries(entries.map(([token, id]) => [token, Number(id)]));
  }
  throw new Error(`Unsupported tokenizer vocabulary format: ${tokenizerPath}`);
}

function findVocabId(vocab: Record<string, number>, candidates: string[]): number | null {
  for (const candidate of candidates) {
    if (vocab[candidate] !== undefined) return vocab[candidate];
  }
  return null;
}

async function runGenericImageEmbedding(runtime: OnnxRuntimeLike, session: unknown, filePath: string): Promise<number[]> {
  const inputName = (session as OnnxSessionLike).inputNames?.[0] ?? 'input';
  const image = sharp(filePath).rotate().resize(224, 224, { fit: 'cover' }).removeAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const floatData = new Float32Array(info.width * info.height * info.channels);
  for (let i = 0; i < floatData.length; i += 1) {
    floatData[i] = (data[i] ?? 0) / 255;
  }

  const feeds = {
    [inputName]: new runtime.Tensor('float32', floatData, [1, info.channels, info.height, info.width])
  };

  const outputs = await (session as OnnxSessionLike).run(feeds);
  const first = outputs[(session as OnnxSessionLike).outputNames?.[0] ?? Object.keys(outputs)[0]] as
    | { data?: ArrayLike<number>; dims?: number[] }
    | undefined;
  const raw = first?.data ? Array.from(first.data).map(Number) : [];
  return resizeVector(raw, 512);
}

export function deterministicEmbedding(seed: string, size: number): number[] {
  const vector = new Array<number>(size).fill(0);
  let counter = 0;
  while (counter * 64 < size) {
    const digest = crypto.createHash('sha256').update(seed).update(String(counter)).digest();
    for (let i = 0; i < digest.length && counter * 64 + i < size; i += 1) {
      vector[counter * 64 + i] = digest[i] / 127.5 - 1;
    }
    counter += 1;
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

export function resizeVector(values: number[], size: number): number[] {
  if (values.length === 0) return deterministicEmbedding('empty-vector', size);
  if (values.length === size) return normalizeVector(values);
  if (values.length > size) {
    const bucket = values.length / size;
    const result: number[] = [];
    for (let i = 0; i < size; i += 1) {
      const start = Math.floor(i * bucket);
      const end = Math.max(start + 1, Math.floor((i + 1) * bucket));
      let sum = 0;
      for (let j = start; j < end; j += 1) sum += values[j] ?? 0;
      result.push(sum / (end - start));
    }
    return normalizeVector(result);
  }

  const result = values.slice();
  while (result.length < size) result.push(...values.slice(0, Math.min(values.length, size - result.length)));
  return normalizeVector(result.slice(0, size));
}

export function normalizeVector(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;
  return values.map((value) => value / norm);
}

export function cosineSimilarity(a: number[] | Float32Array, b: number[] | Float32Array): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i += 1) {
    const av = Number(a[i]);
    const bv = Number(b[i]);
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  return dot / ((Math.sqrt(normA) || 1) * (Math.sqrt(normB) || 1));
}

function extractMeaningfulTokens(value: string): string[] {
  return value
    .replace(/[_-]+/g, ' ')
    .split(/[\s/.]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 3 && !['jpg', 'jpeg', 'png', 'webp', 'heic', 'raw', 'img', 'photo', 'image'].includes(token));
}

function normalizeTag(token: string): string {
  return token.toLowerCase().replace(/\s+/g, '-');
}

function russianTagName(token: string): string | undefined {
  const map: Record<string, string> = {
    wedding: 'свадьба',
    birthday: 'день рождения',
    party: 'вечеринка',
    office: 'офис',
    street: 'улица',
    nature: 'природа',
    sea: 'море',
    beach: 'пляж',
    mountain: 'горы',
    forest: 'лес',
    city: 'город',
    portrait: 'портрет',
    family: 'семья',
    friends: 'друзья',
    dog: 'собака',
    cat: 'кошка',
    car: 'автомобиль',
    sochi: 'Сочи',
    moscow: 'Москва',
    arbat: 'Арбат',
    taganka: 'Таганка'
  };
  return map[token];
}

function inferObjectsFromTokens(tokens: string[]): { label: string; confidence: number; source: string }[] {
  const known = ['wedding', 'birthday', 'party', 'office', 'street', 'nature', 'sea', 'beach', 'mountain', 'forest', 'city', 'portrait', 'family', 'friends', 'dog', 'cat', 'car'];
  return tokens
    .filter((token) => known.includes(token))
    .map((token) => ({ label: normalizeTag(token), confidence: 0.62, source: 'heuristic' }));
}

export function fileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
