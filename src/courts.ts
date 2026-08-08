import { readJson, writeJson } from "./fs-utils";
import { COURTS_CACHE_FILE } from "./paths";
import type { Sport } from "./sports";

/** Pickleball you can turn up and play without booking. */
export interface WalkUp {
	/** Courts shared on a first-come basis. */
	courts: number;
	/** Directory wording for dedicated open play, verbatim. */
	openPlay: string | null;
}

export interface Court {
	slug: string;
	name: string;
	sports: Sport[];
	walkUp?: WalkUp;
}

/** A park with walk-up pickleball but nothing bookable through rec.us. */
export interface WalkUpSpot extends WalkUp {
	name: string;
	url: string | null;
	lat: number | null;
	lng: number | null;
}

interface CourtsCache {
	version: number;
	ts: number;
	courts: Court[];
	walkUpSpots: WalkUpSpot[];
}

const TENNIS_URL = "https://sfrecpark.org/1446/Reservable-Tennis-Courts";
const PICKLEBALL_URL = "https://sfrecpark.org/1772/Pickleball-Court-Directory";
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CACHE_VERSION = 4;

const CACHE_FILE = COURTS_CACHE_FILE;

interface CourtData {
	courts: Court[];
	walkUpSpots: WalkUpSpot[];
}

let _data: CourtData | null = null;
let _inflight: Promise<CourtData> | null = null;

function readCache(): CourtData | null {
	const data = readJson<CourtsCache>(CACHE_FILE);
	if (
		data &&
		data.version === CACHE_VERSION &&
		Date.now() - data.ts < CACHE_MAX_AGE_MS &&
		data.courts?.length > 0
	) {
		return { courts: data.courts, walkUpSpots: data.walkUpSpots ?? [] };
	}
	return null;
}

function writeCache(data: CourtData): void {
	try {
		writeJson(CACHE_FILE, {
			version: CACHE_VERSION,
			ts: Date.now(),
			...data,
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

function cellText(row: string, label: string): string | null {
	const cell = row.match(
		new RegExp(`data-label="${label}"[^>]*>([\\s\\S]*?)</td>`, "i"),
	)?.[1];
	if (cell == null) return null;
	const text = decodeEntities(cell.replace(/<[^>]*>/g, " "))
		.replace(/\s+/g, " ")
		.trim();
	return text || null;
}

function parseWalkUp(row: string): WalkUp | null {
	const shared = parseInt(cellText(row, "Walk-up shared use") ?? "", 10) || 0;
	// "Dedicated open play" is either a court count, "0", or schedule prose
	const raw = cellText(row, "Dedicated open play") ?? "";
	const numeric = /^\d+$/.test(raw);
	const courts = shared + (numeric ? parseInt(raw, 10) : 0);
	const openPlay = !numeric && raw ? raw : null;
	return courts > 0 || openPlay ? { courts, openPlay } : null;
}

export interface PickleballDirectory {
	/** Rows bookable through rec.us, tagged pickleball. */
	courts: Court[];
	/** Rows with walk-up play but no rec.us listing. */
	walkUpSpots: WalkUpSpot[];
}

/**
 * Parse the pickleball directory page (1772), which uses a table rather than
 * the tennis page's aria-label links: the name lives in the Facility cell and
 * the rec.us link sits in the Reservable cell of the same row.
 */
export function parseCourtsFromTable(html: string): PickleballDirectory {
	const courts = new Map<string, Court>();
	const walkUpSpots: WalkUpSpot[] = [];

	for (const [row] of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
		const name = cellText(row, "Facility");
		if (!name) continue;
		const walkUp = parseWalkUp(row);

		const slug = row
			.match(/href="https?:\/\/(?:www\.)?rec\.us\/([a-z0-9-]+)"/i)?.[1]
			?.toLowerCase();
		if (slug) {
			if (courts.has(slug)) continue;
			courts.set(slug, {
				slug,
				name,
				sports: ["pickleball"],
				...(walkUp ? { walkUp } : {}),
			});
			continue;
		}

		// No rec.us listing: only worth keeping if you can walk up and play
		if (!walkUp) continue;
		const url = row.match(/href="([^"]*\/Facilities\/Facility\/[^"]*)"/i)?.[1];
		walkUpSpots.push({
			name,
			url: url ? decodeEntities(url) : null,
			lat: null,
			lng: null,
			...walkUp,
		});
	}

	return { courts: [...courts.values()], walkUpSpots };
}

/** Facility pages embed their coordinates in an escaped JSON blob. */
export function parseFacilityCoords(
	html: string,
): { lat: number; lng: number } | null {
	const m = decodeEntities(html).match(
		/"Latitude":"(-?[\d.]+)","Longitude":"(-?[\d.]+)"/,
	);
	if (!m) return null;
	const lat = parseFloat(m[1]);
	const lng = parseFloat(m[2]);
	return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
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
			if (court.walkUp) existing.walkUp = court.walkUp;
		}
	}
	return [...merged.values()];
}

async function fetchPage(url: string): Promise<string> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${url} returned ${res.status}`);
	return res.text();
}

/** Walk-up parks aren't in rec.us, so coordinates come from their facility page. */
async function locateWalkUpSpots(spots: WalkUpSpot[]): Promise<WalkUpSpot[]> {
	return Promise.all(
		spots.map(async (spot) => {
			if (!spot.url) return spot;
			try {
				const coords = parseFacilityCoords(await fetchPage(spot.url));
				return coords ? { ...spot, ...coords } : spot;
			} catch {
				return spot;
			}
		}),
	);
}

async function fetchCourtsFromSFRecPark(): Promise<CourtData> {
	const tennis = parseCourtsFromHtml(await fetchPage(TENNIS_URL));
	if (tennis.length === 0)
		throw new Error(
			"No courts found on sfrecpark.org — page format may have changed",
		);

	// Losing the pickleball page degrades to tennis-only rather than failing
	let pickleball: PickleballDirectory = { courts: [], walkUpSpots: [] };
	try {
		pickleball = parseCourtsFromTable(await fetchPage(PICKLEBALL_URL));
		if (pickleball.courts.length === 0)
			console.warn("[courts] No pickleball courts found on sfrecpark.org");
	} catch (err) {
		console.warn(`[courts] Pickleball directory: ${(err as Error).message}`);
	}

	return {
		courts: mergeCourts(tennis, pickleball.courts),
		walkUpSpots: await locateWalkUpSpots(pickleball.walkUpSpots),
	};
}

async function loadCourts(): Promise<CourtData> {
	const cached = readCache();
	if (cached) return cached;

	const data = await fetchCourtsFromSFRecPark();
	writeCache(data);
	return data;
}

async function getCourtData(): Promise<CourtData> {
	if (_data) return _data;
	if (_inflight) return _inflight;
	_inflight = loadCourts();
	try {
		_data = await _inflight;
		return _data;
	} finally {
		_inflight = null;
	}
}

export async function getCourts(): Promise<Court[]> {
	return (await getCourtData()).courts;
}

export async function getWalkUpSpots(): Promise<WalkUpSpot[]> {
	return (await getCourtData()).walkUpSpots;
}
