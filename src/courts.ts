import { readJson, writeJson } from "./fs-utils";
import { COORDS_CACHE_FILE, COURTS_CACHE_FILE } from "./paths";
import type { Sport } from "./sports";

/** Courts you can turn up and play without booking. */
export interface WalkUp {
	/** Courts open on a first-come basis. */
	courts: number;
	/** Directory wording for dedicated open play, verbatim. */
	openPlay: string | null;
}

/** Walk-up courts per sport; a park can offer both. */
export type WalkUpBySport = Partial<Record<Sport, WalkUp>>;

export interface Court {
	slug: string;
	name: string;
	sports: Sport[];
	walkUp?: WalkUpBySport;
}

/** A park with walk-up play but nothing bookable through rec.us. */
export interface WalkUpSpot {
	name: string;
	url: string | null;
	lat: number | null;
	lng: number | null;
	walkUp: WalkUpBySport;
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
const CACHE_VERSION = 5;
const COORDS_BATCH_SIZE = 8;

const CACHE_FILE = COURTS_CACHE_FILE;

interface CourtData {
	courts: Court[];
	walkUpSpots: WalkUpSpot[];
	/** False when a directory page failed, so the result isn't worth caching. */
	complete: boolean;
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
		return {
			courts: data.courts,
			walkUpSpots: data.walkUpSpots ?? [],
			complete: true,
		};
	}
	return null;
}

function writeCache({ courts, walkUpSpots }: CourtData): void {
	try {
		writeJson(CACHE_FILE, {
			version: CACHE_VERSION,
			ts: Date.now(),
			courts,
			walkUpSpots,
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

/** The two directories name their walk-up columns differently. */
interface WalkUpColumns {
	/** Columns holding a plain court count. */
	counts: string[];
	/** Column that is either a court count or free-text hours. */
	openPlay?: string;
}

const TENNIS_COLUMNS: WalkUpColumns = { counts: ["Walk-up courts"] };
const PICKLEBALL_COLUMNS: WalkUpColumns = {
	counts: ["Walk-up shared use"],
	openPlay: "Dedicated open play",
};

function parseWalkUp(row: string, cols: WalkUpColumns): WalkUp | null {
	let courts = cols.counts.reduce(
		(n, label) => n + (parseInt(cellText(row, label) ?? "", 10) || 0),
		0,
	);
	let openPlay: string | null = null;

	if (cols.openPlay) {
		const raw = cellText(row, cols.openPlay) ?? "";
		// Either a court count ("8") or schedule prose ("See schedule")
		if (/^\d+$/.test(raw)) courts += parseInt(raw, 10);
		else if (raw) openPlay = raw;
	}

	return courts > 0 || openPlay ? { courts, openPlay } : null;
}

export interface Directory {
	/** Rows bookable through rec.us. */
	courts: Court[];
	/** Rows with walk-up play but no rec.us listing. */
	walkUpSpots: WalkUpSpot[];
}

/**
 * Parse a court directory page. Both directories are tables keyed by a
 * Facility cell, with the rec.us link (when there is one) in the reservable
 * cell of the same row.
 */
export function parseDirectoryTable(
	html: string,
	sport: Sport,
	cols: WalkUpColumns = sport === "tennis"
		? TENNIS_COLUMNS
		: PICKLEBALL_COLUMNS,
): Directory {
	const courts = new Map<string, Court>();
	const walkUpSpots: WalkUpSpot[] = [];

	for (const [row] of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
		const name = cellText(row, "Facility");
		if (!name) continue;
		const walk = parseWalkUp(row, cols);
		const walkUp: WalkUpBySport | undefined = walk
			? { [sport]: walk }
			: undefined;

		const slug = row
			.match(/href="https?:\/\/(?:www\.)?rec\.us\/([a-z0-9-]+)"/i)?.[1]
			?.toLowerCase();
		if (slug) {
			if (courts.has(slug)) continue;
			courts.set(slug, {
				slug,
				name,
				sports: [sport],
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
			walkUp,
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

function mergeWalkUp(
	a: WalkUpBySport | undefined,
	b: WalkUpBySport | undefined,
): WalkUpBySport | undefined {
	if (!a) return b;
	if (!b) return a;
	return { ...a, ...b };
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
			existing.walkUp = mergeWalkUp(existing.walkUp, court.walkUp);
		}
	}
	return [...merged.values()];
}

/** Parks appear on both directories under the same name, so merge by name. */
function mergeWalkUpSpots(...lists: WalkUpSpot[][]): WalkUpSpot[] {
	const merged = new Map<string, WalkUpSpot>();
	for (const list of lists) {
		for (const spot of list) {
			const existing = merged.get(spot.name);
			if (!existing) {
				merged.set(spot.name, { ...spot, walkUp: { ...spot.walkUp } });
				continue;
			}
			existing.walkUp = { ...existing.walkUp, ...spot.walkUp };
			existing.url ??= spot.url;
		}
	}
	return [...merged.values()];
}

async function fetchPage(url: string): Promise<string> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${url} returned ${res.status}`);
	return res.text();
}

async function fetchDirectory(url: string, sport: Sport): Promise<Directory> {
	const html = await fetchPage(url);
	const parsed = parseDirectoryTable(html, sport);
	// The tennis page used to be a plain link list; keep that path as a fallback
	if (parsed.courts.length === 0 && sport === "tennis") {
		return { courts: parseCourtsFromHtml(html), walkUpSpots: [] };
	}
	return parsed;
}

async function fetchCourtsFromSFRecPark(): Promise<CourtData> {
	const tennis = await fetchDirectory(TENNIS_URL, "tennis");
	if (tennis.courts.length === 0)
		throw new Error(
			"No courts found on sfrecpark.org — page format may have changed",
		);

	// Losing the pickleball page degrades to tennis-only rather than failing
	let pickleball: Directory = { courts: [], walkUpSpots: [] };
	let complete = true;
	try {
		pickleball = await fetchDirectory(PICKLEBALL_URL, "pickleball");
		if (pickleball.courts.length === 0) {
			console.warn("[courts] No pickleball courts found on sfrecpark.org");
			complete = false;
		}
	} catch (err) {
		console.warn(`[courts] Pickleball directory: ${(err as Error).message}`);
		complete = false;
	}

	return {
		courts: mergeCourts(tennis.courts, pickleball.courts),
		walkUpSpots: mergeWalkUpSpots(tennis.walkUpSpots, pickleball.walkUpSpots),
		complete,
	};
}

async function loadCourts(): Promise<CourtData> {
	const cached = readCache();
	if (cached) return cached;

	const data = await fetchCourtsFromSFRecPark();
	// Don't pin a degraded tennis-only list for 24h over one bad response
	if (data.complete) writeCache(data);
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

interface CoordsCache {
	[facilityUrl: string]: { lat: number; lng: number };
}

/**
 * Walk-up parks aren't in rec.us, so each one's coordinates come from its
 * sfrecpark.org facility page. That's ~40 fetches, so it happens lazily —
 * only the CLI asks for walk-ups, never the notifier — and the results are
 * cached separately from the court list since park coordinates don't move.
 */
export async function getWalkUpSpots(): Promise<WalkUpSpot[]> {
	const spots = (await getCourtData()).walkUpSpots;
	const cache = readJson<CoordsCache>(COORDS_CACHE_FILE, {}) ?? {};

	const missing = spots.filter((s) => s.url && !cache[s.url]);
	for (let i = 0; i < missing.length; i += COORDS_BATCH_SIZE) {
		await Promise.all(
			missing.slice(i, i + COORDS_BATCH_SIZE).map(async (spot) => {
				if (!spot.url) return;
				try {
					const coords = parseFacilityCoords(await fetchPage(spot.url));
					if (coords) cache[spot.url] = coords;
				} catch {
					// A park without coordinates just sorts last
				}
			}),
		);
	}

	if (missing.length > 0) {
		try {
			writeJson(COORDS_CACHE_FILE, cache);
		} catch (err) {
			console.warn(`[cache] ${(err as Error).message}`);
		}
	}

	return spots.map((s) => ({ ...s, ...(s.url ? cache[s.url] : null) }));
}
