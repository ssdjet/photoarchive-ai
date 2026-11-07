import fs from 'node:fs';
import path from 'node:path';

export class PathSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathSafetyError';
  }
}

export function normalizeArchivePath(input: string, root: string): string {
  const normalizedRoot = path.resolve(root);
  const candidate = path.resolve(normalizedRoot, input);

  if (candidate !== normalizedRoot && !candidate.startsWith(normalizedRoot + path.sep)) {
    throw new PathSafetyError(`Path escapes archive root: ${input}`);
  }

  return candidate;
}

export function toOSPath(filePath: string): string {
  if (process.platform !== 'win32') return filePath;
  const resolved = path.resolve(filePath);
  if (resolved.length > 240 && !resolved.startsWith('\\\\?\\')) {
    return `\\\\?\\${resolved}`;
  }
  return resolved;
}

export function relativeToRoot(filePath: string, root: string): string {
  return path.relative(path.resolve(root), path.resolve(filePath)).split(path.sep).join('/');
}

export function uniqueTargetPath(targetFolder: string, fileName: string): string {
  const ext = path.extname(fileName);
  const stem = fileName.slice(0, fileName.length - ext.length);
  let candidate = path.join(targetFolder, fileName);
  let counter = 1;

  while (true) {
    if (!fs.existsSync(candidate)) return candidate;
    candidate = path.join(targetFolder, `${stem} (${counter})${ext}`);
    counter += 1;
  }
}
