import { getCourts } from "./courts.js";
import { distanceMiles } from "./geo.js";

const HEADERS = {
	"User-Agent":
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
	Origin: "https://www.rec.us",
	Referer: "https://www.rec.us/",
	Accept: "application/json",
};

const _locationIdCache = new Map();
export async function resolveLocationId(slug) {
	if (_locationIdCache.has(slug)) return _locationIdCache.get(slug);
	const res = await fetch(`https://www.rec.us/${slug}`, { headers: HEADERS });
	const html = await res.text();
	const id = html.match(/"locationId":"([^"]+)"/)?.[1] ?? null;
	if (id) _locationIdCache.set(slug, id);
	return id;
}

export async function fetchJson(url) {
	const res = await fetch(url, { headers: HEADERS });
	if (!res.ok) return null;
	const text = await res.text();
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

// --- Shared helpers used by both CLI and notify ---

export const DEFAULT_COURT_META = {
	slotDuration: 60,
	windowDays: 7,
	releaseTime: "00:00:00",
};

export function buildCourtMeta(locationCourts) {
	const meta = {};
	for (const c of locationCourts ?? []) {
		meta[c.courtNumber] = {
			slotDuration: parseMinutes(c.maxReservationTime),
			windowDays: c.defaultReservationWindowDays ?? 7,
			releaseTime: c.reservationReleaseTimeLocal ?? "00:00:00",
		};
	}
	return meta;
}

export function computeReleaseDate(dateStr, meta) {
	const releaseDate = new Date(`${dateStr}T00:00:00`);
	releaseDate.setDate(releaseDate.getDate() - meta.windowDays);
	const [rh, rm] = meta.releaseTime.split(":").map(Number);
	releaseDate.setHours(rh, rm, 0, 0);
	return releaseDate;
}

export function parseReservableSlots(schedule, slotDuration) {
	const slots = [];
	for (const [range, info] of Object.entries(schedule ?? {})) {
		const [start, end] = range.split(",").map((s) => s.trim());
		if (info.referenceType === "RESERVABLE") {
			slots.push(...splitIntoSlots(start, end, slotDuration));
		}
	}
	return slots;
}

// --- CLI data fetching ---

async function fetchCourtData(court, date, refLat, refLng) {
	const locationId = await resolveLocationId(court.slug);
	if (!locationId) {
		return { ...court, error: "Could not resolve locationId" };
	}

	const dateKey = date.replace(/-/g, "");
	const [locRes, schedRes] = await Promise.all([
		fetchJson(
			`https://api.rec.us/v1/locations/${locationId}?publishedSites=true`,
		),
		fetchJson(
			`https://api.rec.us/v1/locations/${locationId}/schedule?startDate=${date}`,
		),
	]);

	if (!locRes || !schedRes) {
		return { ...court, error: "API request failed" };
	}

	const loc = locRes.location ?? locRes;
	const lat = parseFloat(loc.lat);
	const lng = parseFloat(loc.lng);
	const dist = Math.round(distanceMiles(refLat, refLng, lat, lng) * 100) / 100;
	const courtMeta = buildCourtMeta(loc.courts);

	const todayCourts = schedRes.dates?.[dateKey] ?? [];
	const now = new Date();
	const courts = todayCourts.map((c) => {
		const meta = courtMeta[c.courtNumber] || DEFAULT_COURT_META;
		const releaseDate = computeReleaseDate(date, meta);
		const windowOpen = now >= releaseDate;

		const reservable = parseReservableSlots(c.schedule, meta.slotDuration);
		const available = windowOpen ? reservable : [];
		const pendingSlots = windowOpen ? [] : reservable;
		const booked = [];
		for (const [range, info] of Object.entries(c.schedule ?? {})) {
			if (info.referenceType === "RESERVATION") {
				const [start, end] = range.split(",").map((s) => s.trim());
				booked.push({ start, end });
			}
		}
		return {
			courtNumber: c.courtNumber,
			sports: c.sports?.map((s) => s.name),
			available,
			booked,
			pendingSlots,
			opensAt: !windowOpen && pendingSlots.length > 0 ? releaseDate : null,
		};
	});

	const opensAtDates = courts.map((c) => c.opensAt).filter(Boolean);
	const earliestOpensAt =
		opensAtDates.length > 0
			? new Date(Math.min(...opensAtDates.map((d) => d.getTime())))
			: null;
	const totalPendingSlots = courts.reduce(
		(n, c) => n + c.pendingSlots.length,
		0,
	);

	return {
		name: court.name,
		slug: court.slug,
		locationId,
		address: loc.formattedAddress,
		lat,
		lng,
		distance: dist,
		url: `https://www.rec.us/${court.slug}`,
		courts,
		totalAvailableSlots: courts.reduce((n, c) => n + c.available.length, 0),
		totalPendingSlots,
		opensAt: earliestOpensAt,
	};
}

export async function fetchAllCourts({
	date,
	refLat,
	refLng,
	maxDistance,
	timeRange,
}) {
	const courts = await getCourts();
	const results = await Promise.all(
		courts.map((court) =>
			fetchCourtData(court, date, refLat, refLng).catch(() => ({
				...court,
				error: "fetch failed",
			})),
		),
	);

	const errors = results.filter((r) => r.error);
	let filtered = results.filter((r) => !r.error);

	// Filter by max distance
	if (maxDistance != null) {
		filtered = filtered.filter((r) => r.distance <= maxDistance);
	}

	// Filter by time range (overlap check)
	if (timeRange) {
		const [startHour, endHour] = timeRange;
		const timeFilter = (slot) => {
			const slotStart = parseHour(slot.start);
			const slotEnd = parseHour(slot.end);
			return (
				slotStart != null &&
				slotEnd != null &&
				slotStart < endHour &&
				slotEnd > startHour
			);
		};
		filtered = filtered.map((r) => {
			const courts = r.courts.map((c) => ({
				...c,
				available: c.available.filter(timeFilter),
				pendingSlots: c.pendingSlots.filter(timeFilter),
			}));
			const totalPendingSlots = courts.reduce(
				(n, c) => n + c.pendingSlots.length,
				0,
			);
			return {
				...r,
				courts,
				totalAvailableSlots: courts.reduce((n, c) => n + c.available.length, 0),
				totalPendingSlots,
				opensAt: totalPendingSlots > 0 ? r.opensAt : null,
			};
		});
		// Remove locations with no availability AND no pending slots in the time range
		filtered = filtered.filter(
			(r) => r.totalAvailableSlots > 0 || r.totalPendingSlots > 0,
		);
	}

	// Sort by distance
	filtered.sort((a, b) => a.distance - b.distance);

	return { courts: filtered, errors: errors.length };
}

export function parseHour(time) {
	const m = time?.match(/^(\d{1,2}):/);
	return m ? parseInt(m[1], 10) : null;
}

function parseMinutes(duration) {
	if (!duration) return 60;
	const [h, m] = duration.split(":").map(Number);
	return h * 60 + m;
}

function timeToMinutes(time) {
	const [h, m] = time.split(":").map(Number);
	return h * 60 + m;
}

function minutesToTime(mins) {
	const h = String(Math.floor(mins / 60)).padStart(2, "0");
	const m = String(mins % 60).padStart(2, "0");
	return `${h}:${m}`;
}

function splitIntoSlots(start, end, durationMins) {
	const startMins = timeToMinutes(start);
	const endMins = timeToMinutes(end);
	const slots = [];
	for (let t = startMins; t + durationMins <= endMins; t += durationMins) {
		slots.push({
			start: minutesToTime(t),
			end: minutesToTime(t + durationMins),
		});
	}
	return slots;
}
