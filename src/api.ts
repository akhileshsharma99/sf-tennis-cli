import type { Court } from "./courts";
import { getCourts } from "./courts";
import type { Coords } from "./geo";
import { distanceMiles } from "./geo";

const API_BASE = "https://api.rec.us/v1/locations";
const REC_US_BASE = "https://www.rec.us";

export interface RecUsLocationCourt {
	courtNumber: string;
	maxReservationTime?: string;
	defaultReservationWindowDays?: number;
	reservationReleaseTimeLocal?: string;
	sports?: Array<{ name: string }>;
}

export interface RecUsLocation {
	lat: string;
	lng: string;
	formattedAddress: string;
	courts?: RecUsLocationCourt[];
}

export interface RecUsLocationResponse {
	location?: RecUsLocation;
	lat?: string;
	lng?: string;
	formattedAddress?: string;
	courts?: RecUsLocationCourt[];
}

type ReferenceType = "RESERVABLE" | "RESERVATION";

export interface ScheduleEntry {
	referenceType: ReferenceType;
}

export interface ScheduleCourtDay {
	courtNumber: string;
	schedule: Record<string, ScheduleEntry>;
	sports?: Array<{ name: string }>;
}

export interface ScheduleResponse {
	dates?: Record<string, ScheduleCourtDay[]>;
}

export interface CourtMeta {
	slotDuration: number;
	windowDays: number;
	releaseTime: string;
}

export interface TimeSlot {
	start: string;
	end: string;
}

interface CourtResult {
	courtNumber: string;
	sports: string[] | undefined;
	available: TimeSlot[];
	booked: TimeSlot[];
	pendingSlots: TimeSlot[];
	opensAt: Date | null;
}

export interface CourtLocationResult {
	name: string;
	slug: string;
	locationId: string;
	address: string;
	lat: number;
	lng: number;
	distance: number;
	url: string;
	courts: CourtResult[];
	totalAvailableSlots: number;
	totalPendingSlots: number;
	opensAt: Date | null;
}

interface CourtLocationError {
	slug: string;
	name: string;
	error: string;
}

interface FetchAllCourtsOptions {
	date: string;
	ref: Coords;
	maxDistance?: number;
	timeRange?: [number, number] | null;
}

interface FetchAllCourtsResult {
	courts: CourtLocationResult[];
	errors: number;
}

export interface LocationData extends Coords {
	locationId: string;
	address: string;
	courtMeta: Record<string, CourtMeta>;
}

const HEADERS: Record<string, string> = {
	"User-Agent":
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
	Origin: REC_US_BASE,
	Referer: `${REC_US_BASE}/`,
	Accept: "application/json",
};

const _locationIdCache = new Map<string, string>();
export async function resolveLocationId(slug: string): Promise<string | null> {
	const cached = _locationIdCache.get(slug);
	if (cached) return cached;
	const res = await fetch(`${REC_US_BASE}/${slug}`, { headers: HEADERS });
	const html = await res.text();
	const id = html.match(/"locationId":"([^"]+)"/)?.[1] ?? null;
	if (id) _locationIdCache.set(slug, id);
	return id;
}

export async function fetchJson<T = unknown>(url: string): Promise<T | null> {
	const res = await fetch(url, { headers: HEADERS });
	if (!res.ok) return null;
	try {
		return (await res.json()) as T;
	} catch {
		return null;
	}
}

export function scheduleUrl(locationId: string, date: string): string {
	return `${API_BASE}/${locationId}/schedule?startDate=${date}`;
}

export async function fetchLocationData(
	slug: string,
): Promise<LocationData | null> {
	const locationId = await resolveLocationId(slug);
	if (!locationId) return null;

	const locRes = await fetchJson<RecUsLocationResponse>(
		`${API_BASE}/${locationId}?publishedSites=true`,
	);
	if (!locRes) return null;

	const loc: RecUsLocation =
		locRes.location ?? (locRes as unknown as RecUsLocation);
	return {
		locationId,
		lat: parseFloat(loc.lat),
		lng: parseFloat(loc.lng),
		address: loc.formattedAddress,
		courtMeta: buildCourtMeta(loc.courts),
	};
}

export const DEFAULT_COURT_META: CourtMeta = {
	slotDuration: 60,
	windowDays: 7,
	releaseTime: "00:00:00",
};

export function buildCourtMeta(
	locationCourts: RecUsLocationCourt[] | undefined,
): Record<string, CourtMeta> {
	const meta: Record<string, CourtMeta> = {};
	for (const c of locationCourts ?? []) {
		meta[c.courtNumber] = {
			slotDuration: parseMinutes(c.maxReservationTime),
			windowDays: c.defaultReservationWindowDays ?? 7,
			releaseTime: c.reservationReleaseTimeLocal ?? "00:00:00",
		};
	}
	return meta;
}

export function computeReleaseDate(dateStr: string, meta: CourtMeta): Date {
	const releaseDate = new Date(`${dateStr}T00:00:00`);
	releaseDate.setDate(releaseDate.getDate() - meta.windowDays);
	const [rh, rm] = meta.releaseTime.split(":").map(Number);
	releaseDate.setHours(rh, rm, 0, 0);
	return releaseDate;
}

export function parseReservableSlots(
	schedule: Record<string, ScheduleEntry> | undefined,
	slotDuration: number,
): TimeSlot[] {
	const slots: TimeSlot[] = [];
	for (const [range, info] of Object.entries(schedule ?? {})) {
		const [start, end] = range.split(",").map((s) => s.trim());
		if (info.referenceType === "RESERVABLE") {
			slots.push(...splitIntoSlots(start, end, slotDuration));
		}
	}
	return slots;
}

async function fetchCourtData(
	court: Court,
	date: string,
	ref: Coords,
): Promise<CourtLocationResult | CourtLocationError> {
	const locData = await fetchLocationData(court.slug);
	if (!locData) {
		return { ...court, error: "Could not resolve location" };
	}

	const dist = distanceMiles(ref, locData);

	const schedRes = await fetchJson<ScheduleResponse>(
		scheduleUrl(locData.locationId, date),
	);
	if (!schedRes) {
		return { ...court, error: "API request failed" };
	}

	const dateKey = date.replace(/-/g, "");
	const todayCourts = schedRes.dates?.[dateKey] ?? [];
	const now = new Date();
	const courts: CourtResult[] = todayCourts.map((c) => {
		const meta = locData.courtMeta[c.courtNumber] || DEFAULT_COURT_META;
		const releaseDate = computeReleaseDate(date, meta);
		const windowOpen = now >= releaseDate;

		const reservable = parseReservableSlots(c.schedule, meta.slotDuration);
		const available = windowOpen ? reservable : [];
		const pendingSlots = windowOpen ? [] : reservable;
		const booked: TimeSlot[] = [];
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

	const opensAtDates = courts
		.map((c) => c.opensAt)
		.filter((d): d is Date => d !== null);
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
		locationId: locData.locationId,
		address: locData.address,
		lat: locData.lat,
		lng: locData.lng,
		distance: dist,
		url: `${REC_US_BASE}/${court.slug}`,
		courts,
		totalAvailableSlots: courts.reduce((n, c) => n + c.available.length, 0),
		totalPendingSlots,
		opensAt: earliestOpensAt,
	};
}

function isCourtLocationResult(
	r: CourtLocationResult | CourtLocationError,
): r is CourtLocationResult {
	return !("error" in r);
}

export async function fetchAllCourts({
	date,
	ref,
	maxDistance,
	timeRange,
}: FetchAllCourtsOptions): Promise<FetchAllCourtsResult> {
	const courts = await getCourts();
	const results: (CourtLocationResult | CourtLocationError)[] = [];
	for (let i = 0; i < courts.length; i += 5) {
		const batch = courts.slice(i, i + 5);
		const batchResults = await Promise.all(
			batch.map((court) =>
				fetchCourtData(court, date, ref).catch(
					(): CourtLocationError => ({
						...court,
						error: "fetch failed",
					}),
				),
			),
		);
		results.push(...batchResults);
	}

	const errors = results.filter((r) => !isCourtLocationResult(r));
	let filtered = results.filter(isCourtLocationResult);

	if (maxDistance != null) {
		filtered = filtered.filter((r) => r.distance <= maxDistance);
	}

	if (timeRange) {
		const [startHour, endHour] = timeRange;
		const timeFilter = (slot: TimeSlot): boolean => {
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
		filtered = filtered.filter(
			(r) => r.totalAvailableSlots > 0 || r.totalPendingSlots > 0,
		);
	}

	filtered.sort((a, b) => a.distance - b.distance);

	return { courts: filtered, errors: errors.length };
}

export function parseHour(time: string | undefined): number | null {
	const m = time?.match(/^(\d{1,2}):/);
	return m ? parseInt(m[1], 10) : null;
}

function parseMinutes(duration: string | undefined): number {
	if (!duration) return 60;
	const [h, m] = duration.split(":").map(Number);
	return h * 60 + m;
}

function timeToMinutes(time: string): number {
	const [h, m] = time.split(":").map(Number);
	return h * 60 + m;
}

function minutesToTime(mins: number): string {
	const h = String(Math.floor(mins / 60)).padStart(2, "0");
	const m = String(mins % 60).padStart(2, "0");
	return `${h}:${m}`;
}

function splitIntoSlots(
	start: string,
	end: string,
	durationMins: number,
): TimeSlot[] {
	const startMins = timeToMinutes(start);
	const endMins = timeToMinutes(end);
	const slots: TimeSlot[] = [];
	for (let t = startMins; t + durationMins <= endMins; t += durationMins) {
		slots.push({
			start: minutesToTime(t),
			end: minutesToTime(t + durationMins),
		});
	}
	return slots;
}
