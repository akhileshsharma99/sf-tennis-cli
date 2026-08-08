import { readJson, writeJson } from "./fs-utils";
import { COURTS_CACHE_FILE } from "./paths";
import type { Sport } from "./sports";

export interface Court {
	slug: string;
	name: string;
	sports: Sport[];
}

interface CourtsCache {
	version: number;
	ts: number;
	courts: Court[];
}

const TENNIS_URL = "https://sfrecpark.org/1446/Reservable-Tennis-Courts";
const PICKLEBALL_URL = "https://sfrecpark.org/1772/Pickleball-Court-Directory";
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CACHE_VERSION = 3;

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

const ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
};

/** Decode HTML entities in court names. */
export function decodeEntities(text: string): string {
	return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
		if (body[0] === "#") {
			const code =
				body[1]?.toLowerCase() === "x"
					? parseInt(body.slice(2), 16)
					: parseInt(body.slice(1), 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
		}
		return ENTITIES[body.toLowerCase()] ?? whole;
	});
}

/** Parse court slug/name pairs from the tennis directory page (1446). */
export function parseCourtsFromHtml(html: string): Court[] {
	const seen = new Map<string, Court>();
	// Prefer aria-label: `Reserve 4 courts at Alice Marble`
	const withLabel =
		/href="https?:\/\/(?:www\.)?rec\.us\/([a-z0-9-]+)"[^>]*aria-label="Reserve \d+ courts? at ([^"]+)"/gi;
	for (const match of html.matchAll(withLabel)) {
		const slug = match[1].toLowerCase();
		if (seen.has(slug)) continue;
		const name = decodeEntities(match[2]).trim();
		if (!name) continue;
		seen.set(slug, { slug, name, sports: ["tennis"] });
	}

	// Then link text, for rows without an aria-label
	const withText =
		/href="https?:\/\/(?:www\.)?rec\.us\/([a-z0-9-]+)"[^>]*>([^<]+)/gi;
	for (const match of html.matchAll(withText)) {
		const slug = match[1].toLowerCase();
		if (seen.has(slug)) continue;
		const name = decodeEntities(match[2])
			.trim()
			.replace(/\s*Tennis\s*Court.*$/i, "")
			.trim();
		// The current layout renders link text as a court count (">4")
		if (!name || /^[>\s]*\d+$/.test(name)) continue;
		seen.set(slug, { slug, name, sports: ["tennis"] });
	}
	return [...seen.values()];
}

/**
 * Parse the pickleball directory page (1772), which uses a table rather than
 * the tennis page's aria-label links: the name lives in the Facility cell and
 * the rec.us link sits in the Reservable cell of the same row.
 */
export function parseCourtsFromTable(html: string): Court[] {
	const seen = new Map<string, Court>();
	for (const [row] of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
		const slug = row
			.match(/href="https?:\/\/(?:www\.)?rec\.us\/([a-z0-9-]+)"/i)?.[1]
			?.toLowerCase();
		if (!slug || seen.has(slug)) continue;
		const cell = row.match(/data-label="Facility"[^>]*>([\s\S]*?)<\/td>/i)?.[1];
		if (!cell) continue;
		const name = decodeEntities(cell.replace(/<[^>]*>/g, " "))
			.replace(/\s+/g, " ")
			.trim();
		if (!name) continue;
		seen.set(slug, { slug, name, sports: ["pickleball"] });
	}
	return [...seen.values()];
}

function mergeCourts(...lists: Court[][]): Court[] {
	const merged = new Map<string, Court>();
	for (const list of lists) {
		for (const court of list) {
			const existing = merged.get(court.slug);
			if (!existing) {
				merged.set(court.slug, { ...court, sports: [...court.sports] });
				continue;
			}
			for (const sport of court.sports) {
				if (!existing.sports.includes(sport)) existing.sports.push(sport);
			}
		}
	}
	return [...merged.values()];
}

async function fetchPage(url: string): Promise<string> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${url} returned ${res.status}`);
	return res.text();
}

async function fetchCourtsFromSFRecPark(): Promise<Court[]> {
	const tennis = parseCourtsFromHtml(await fetchPage(TENNIS_URL));
	if (tennis.length === 0)
		throw new Error(
			"No courts found on sfrecpark.org — page format may have changed",
		);

	// Losing the pickleball page degrades to tennis-only rather than failing
	let pickleball: Court[] = [];
	try {
		pickleball = parseCourtsFromTable(await fetchPage(PICKLEBALL_URL));
		if (pickleball.length === 0)
			console.warn("[courts] No pickleball courts found on sfrecpark.org");
	} catch (err) {
		console.warn(`[courts] Pickleball directory: ${(err as Error).message}`);
	}

	return mergeCourts(tennis, pickleball);
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
