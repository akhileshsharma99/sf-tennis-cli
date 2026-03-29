import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const SFRECPARK_URL = 'https://sfrecpark.org/1446/Reservable-Tennis-Courts';
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = resolve(__dirname, '..', '.cache');
const CACHE_FILE = resolve(CACHE_DIR, 'courts.json');

let _courts = null;
let _inflight = null;

function readCache() {
  try {
    const { ts, courts } = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    if (Date.now() - ts < CACHE_MAX_AGE_MS && courts?.length > 0) return courts;
  } catch {}
  return null;
}

function writeCache(courts) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ ts: Date.now(), courts }) + '\n');
  } catch {}
}

async function fetchCourtsFromSFRecPark() {
  const res = await fetch(SFRECPARK_URL);
  if (!res.ok) throw new Error(`sfrecpark.org returned ${res.status}`);
  const html = await res.text();

  const seen = new Map();
  const regex = /href="https?:\/\/(?:www\.)?rec\.us\/([a-z0-9-]+)"[^>]*>([^<]+)/gi;
  for (const match of html.matchAll(regex)) {
    const slug = match[1].toLowerCase();
    if (seen.has(slug)) continue;
    const name = match[2].trim().replace(/\s*Tennis\s*Court.*$/i, '').trim();
    seen.set(slug, { slug, name });
  }

  if (seen.size === 0) throw new Error('No courts found on sfrecpark.org — page format may have changed');
  return [...seen.values()];
}

async function loadCourts() {
  const cached = readCache();
  if (cached) return cached;

  const courts = await fetchCourtsFromSFRecPark();
  writeCache(courts);
  return courts;
}

export async function getCourts() {
  if (_courts) return _courts;
  if (_inflight) return _inflight;
  _inflight = loadCourts();
  try {
    _courts = await _inflight;
    return _courts;
  } finally {
    _inflight = null;
  }
}
