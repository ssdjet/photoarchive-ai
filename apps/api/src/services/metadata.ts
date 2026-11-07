import fs from 'node:fs/promises';
import path from 'node:path';
import ExifReader from 'exifreader';
import sharp from 'sharp';
import { fileSha256 } from './aiProvider.js';

export interface ImageMetadata {
  sizeBytes: number;
  mtimeMs: number;
  width: number | null;
  height: number | null;
  takenAt: string | null;
  timeZone: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  gpsSource: 'exif' | null;
}

export async function readImageMetadata(filePath: string): Promise<ImageMetadata> {
  const stat = await fs.stat(filePath);
  let width: number | null = null;
  let height: number | null = null;
  let cameraMake: string | null = null;
  let cameraModel: string | null = null;

  try {
    const metadata = await sharp(filePath).rotate().metadata();
    width = metadata.width ?? null;
    height = metadata.height ?? null;
    cameraMake = metadata.exif ? null : cameraMake;
  } catch {
    // EXIF reader may still recover metadata for some files that sharp cannot decode.
  }

  let takenAt: string | null = null;
  let timeZone: string | null = null;
  let latitude: number | null = null;
  let longitude: number | null = null;
  let altitude: number | null = null;
  let gpsSource: 'exif' | null = null;

  try {
    const buffer = await fs.readFile(filePath);
    const tags = ExifReader.load(buffer, { expanded: true }) as Record<string, unknown>;
    cameraMake = stringTag(tags, 'Make') ?? cameraMake;
    cameraModel = stringTag(tags, 'Model') ?? cameraModel;
    takenAt = parseExifDate(
      stringTag(tags, 'DateTimeOriginal') ??
        stringTag(tags, 'DateTime') ??
        stringTag(tags, 'MediaCreateDate') ??
        stringTag(tags, 'DateTimeDigitized')
    );
    timeZone = extractTimeZone(stringTag(tags, 'OffsetTimeOriginal') ?? stringTag(tags, 'OffsetTime'));

    const gps = (tags.GPS ?? tags.gps) as Record<string, unknown> | undefined;
    latitude = numberFromUnknown(gps?.Latitude) ?? parseGpsCoordinate(stringTag(gps ?? {}, 'GPSLatitude'));
    longitude = numberFromUnknown(gps?.Longitude) ?? parseGpsCoordinate(stringTag(gps ?? {}, 'GPSLongitude'));
    altitude = numberFromUnknown(gps?.Altitude);
    if (latitude !== null && longitude !== null) gpsSource = 'exif';
  } catch {
    // Broken files are quarantined by the caller; metadata stays null.
  }

  return {
    sizeBytes: stat.size,
    mtimeMs: Math.round(stat.mtimeMs),
    width,
    height,
    takenAt,
    timeZone,
    cameraMake,
    cameraModel,
    latitude,
    longitude,
    altitude,
    gpsSource
  };
}

export async function generateThumbnail(filePath: string, thumbnailsFolder: string, photoId: string): Promise<string> {
  await fs.mkdir(thumbnailsFolder, { recursive: true });
  const target = path.join(thumbnailsFolder, `${photoId}.jpg`);
  await sharp(filePath)
    .rotate()
    .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(target);
  return target;
}

export async function perceptualHash(filePath: string): Promise<string> {
  const { data, info } = await sharp(filePath)
    .rotate()
    .grayscale()
    .resize(9, 8, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let hash = '';
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const left = data[y * info.width + x] ?? 0;
      const right = data[y * info.width + x + 1] ?? 0;
      hash += left > right ? '1' : '0';
    }
  }
  return hash;
}

export function hammingDistance(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  let distance = Math.abs(a.length - b.length);
  for (let i = 0; i < length; i += 1) {
    if (a[i] !== b[i]) distance += 1;
  }
  return distance;
}

export function inferDateFromName(relativePath: string): string | null {
  const text = decodeURIComponent(relativePath);
  const patterns = [
    /(?<year>20\d{2})[-_.]?(?<month>0[1-9]|1[0-2])[-_.]?(?<day>0[1-9]|[12]\d|3[01])/,
    /(?<day>0[1-9]|[12]\d|3[01])[-_.](?<month>0[1-9]|1[0-2])[-_.](?<year>20\d{2})/
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.groups) {
      const { year, month, day } = match.groups;
      return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).toISOString();
    }
  }

  return null;
}

function stringTag(tags: Record<string, unknown>, key: string): string | null {
  const tag = tags[key] as { description?: unknown; value?: unknown } | undefined;
  const value = tag?.description ?? tag?.value;
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
}

function numberFromUnknown(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'number') return Number(value[0]);
  return null;
}

function parseGpsCoordinate(value: string | null): number | null {
  if (!value) return null;
  const parts = value
    .trim()
    .split(/[^\d.,NSEW+-]+/i)
    .filter(Boolean);
  if (parts.length === 0) return null;

  const direction = /[SW]/i.test(value) ? -1 : 1;
  if (parts.length >= 3) {
    const [deg, min, sec] = parts.map((part) => Number(part.replace(',', '.')));
    if ([deg, min, sec].every(Number.isFinite)) return direction * (deg + min / 60 + sec / 3600);
  }

  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function extractTimeZone(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/([+-]\d{2}:?\d{2}|Z)$/);
  return match?.[1] ?? null;
}

function parseExifDate(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}
