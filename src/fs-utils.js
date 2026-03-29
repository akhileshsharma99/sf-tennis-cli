import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(path, data, { pretty = false } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const content = (pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)) + '\n';
  // Write to temp then rename for atomic updates
  const tmp = path + '.tmp';
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}
