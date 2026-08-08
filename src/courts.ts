import { readJson, writeJson } from "./fs-utils";
import { COURTS_CACHE_FILE } from "./paths";

export interface Court {
	slug: string;
	name: string;
}

interface CourtsCache {
	ts: number;
	courts: Court[];
}

const SFRECPARK_URL = "https://sfrecpark.org/1446/Reservable-Tennis-Courts";
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const CACHE_FILE = COURTS_CACHE_FILE;

let _courts: Court[] | null = null;
let _inflight: Promise<Court[]> | null = null;

function readCache(): Court[] | null {
	const data = readJson<CourtsCache>(CACHE_FILE);
	if (
		data &&
		Date.now() - data.ts < CACHE_MAX_AGE_MS &&
		data.courts?.length > 0
	) {
		return data.courts;
	}
	return null;
}

function writeCache(courts: Court[]): void {
	try {
		writeJson(CACHE_FILE, { ts: Date.now(), courts });
	} catch (err) {
		console.warn(
			`[cache] Failed to write ${CACHE_FILE}: ${(err as Error).message}`,
		);
	}
}

async function fetchCourtsFromSFRecPark(): Promise<Court[]> {
	const res = await fetch(SFRECPARK_URL);
	if (!res.ok) throw new Error(`sfrecpark.org returned ${res.status}`);
	const html = await res.text();

	const seen = new Map<string, Court>();
	const regex =
		/href="https?:\/\/(?:www\.)?rec\.us\/([a-z0-9-]+)"[^>]*>([^<]+)/gi;
	for (const match of html.matchAll(regex)) {
		const slug = match[1].toLowerCase();
		if (seen.has(slug)) continue;
		const name = match[2]
			.trim()
			.replace(/\s*Tennis\s*Court.*$/i, "")
			.trim();
		seen.set(slug, { slug, name });
	}

	if (seen.size === 0)
		throw new Error(
			"No courts found on sfrecpark.org — page format may have changed",
		);
	return [...seen.values()];
}

async function loadCourts(): Promise<Court[]> {
	const cached = readCache();
	if (cached) return cached;

	const courts = await fetchCourtsFromSFRecPark();
	writeCache(courts);
	return courts;
}

export async function getCourts(): Promise<Court[]> {
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
