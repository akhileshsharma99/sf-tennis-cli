import { readJson, writeJson } from "./fs-utils";
import { COURTS_CACHE_FILE } from "./paths";

export interface Court {
	slug: string;
	name: string;
}

interface CourtsCache {
	version: number;
	ts: number;
	courts: Court[];
}

const SFRECPARK_URL = "https://sfrecpark.org/1446/Reservable-Tennis-Courts";
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CACHE_VERSION = 2;

const CACHE_FILE = COURTS_CACHE_FILE;

let _courts: Court[] | null = null;
let _inflight: Promise<Court[]> | null = null;

function readCache(): Court[] | null {
	const data = readJson<CourtsCache>(CACHE_FILE);
	if (
		data &&
		data.version === CACHE_VERSION &&
		Date.now() - data.ts < CACHE_MAX_AGE_MS &&
		data.courts?.length > 0
	) {
		return data.courts;
	}
	return null;
}

function writeCache(courts: Court[]): void {
	try {
		writeJson(CACHE_FILE, {
			version: CACHE_VERSION,
			ts: Date.now(),
			courts,
		});
	} catch (err) {
		console.warn(
			`[cache] Failed to write ${CACHE_FILE}: ${(err as Error).message}`,
		);
	}
}

/** Parse court slug/name pairs from the SF Rec & Park reservable-courts page. */
export function parseCourtsFromHtml(html: string): Court[] {
	const seen = new Map<string, Court>();
	// Prefer aria-label: `Reserve 4 courts at Alice Marble`
	const withLabel =
		/href="https?:\/\/(?:www\.)?rec\.us\/([a-z0-9-]+)"[^>]*aria-label="Reserve \d+ courts? at ([^"]+)"/gi;
	for (const match of html.matchAll(withLabel)) {
		const slug = match[1].toLowerCase();
		if (seen.has(slug)) continue;
		seen.set(slug, { slug, name: match[2].trim() });
	}
	if (seen.size > 0) return [...seen.values()];

	// Fallback: link text (older page layout)
	const withText =
		/href="https?:\/\/(?:www\.)?rec\.us\/([a-z0-9-]+)"[^>]*>([^<]+)/gi;
	for (const match of html.matchAll(withText)) {
		const slug = match[1].toLowerCase();
		if (seen.has(slug)) continue;
		const name = match[2]
			.trim()
			.replace(/\s*Tennis\s*Court.*$/i, "")
			.trim();
		if (!name || /^\d+$/.test(name)) continue;
		seen.set(slug, { slug, name });
	}
	return [...seen.values()];
}

async function fetchCourtsFromSFRecPark(): Promise<Court[]> {
	const res = await fetch(SFRECPARK_URL);
	if (!res.ok) throw new Error(`sfrecpark.org returned ${res.status}`);
	const courts = parseCourtsFromHtml(await res.text());
	if (courts.length === 0)
		throw new Error(
			"No courts found on sfrecpark.org — page format may have changed",
		);
	return courts;
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
