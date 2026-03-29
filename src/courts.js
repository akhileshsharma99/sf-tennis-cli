import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, writeJson } from "./fs-utils.js";

const SFRECPARK_URL = "https://sfrecpark.org/1446/Reservable-Tennis-Courts";
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = resolve(__dirname, "..", ".cache", "courts.json");

let _courts = null;
let _inflight = null;

function readCache() {
	const data = readJson(CACHE_FILE);
	if (
		data &&
		Date.now() - data.ts < CACHE_MAX_AGE_MS &&
		data.courts?.length > 0
	) {
		return data.courts;
	}
	return null;
}

function writeCache(courts) {
	try {
		writeJson(CACHE_FILE, { ts: Date.now(), courts });
	} catch (err) {
		console.warn(`[cache] Failed to write ${CACHE_FILE}: ${err.message}`);
	}
}

async function fetchCourtsFromSFRecPark() {
	const res = await fetch(SFRECPARK_URL);
	if (!res.ok) throw new Error(`sfrecpark.org returned ${res.status}`);
	const html = await res.text();

	const seen = new Map();
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
