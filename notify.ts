#!/usr/bin/env bun

// Notification script for GitHub Actions.
// Imports shared code from src/ — zero extra npm dependencies.

process.env.TZ = "America/Los_Angeles";

import { resolve } from "node:path";
import type {
	RecUsLocationResponse,
	ScheduleResponse,
	TimeSlot,
} from "./src/api";
import {
	buildCourtMeta,
	computeReleaseDate,
	DEFAULT_COURT_META,
	fetchJson,
	parseHour,
	parseReservableSlots,
	resolveLocationId,
} from "./src/api";
import type { Court } from "./src/courts";
import { getCourts } from "./src/courts";
import { readJson, writeJson } from "./src/fs-utils";
import { distanceMiles } from "./src/geo";

// --- Types ---

interface NotifyParams {
	title: string;
	body: string;
	tags: string;
	priority?: string;
	click: string;
}

interface SlotNotification extends NotifyParams {
	_dedupKey?: string;
	_groupKey?: string;
	_slotKeys?: string[];
}

interface GroupedNotification {
	title: string;
	tags: string;
	priority: string;
	click: string;
	lines: string[];
}

type DedupCache = Record<string, number>;

// --- Config from env ---
const HOME_LAT = parseFloat(process.env.HOME_LAT || "");
const HOME_LNG = parseFloat(process.env.HOME_LNG || "");
const NTFY_TOPIC = process.env.NTFY_TOPIC;
const MAX_DISTANCE = parseFloat(process.env.MAX_DISTANCE || "2");
const PREF_DAYS = (process.env.PREF_DAYS || "2,4").split(",").map(Number); // 0=Sun, 2=Tue, 4=Thu
const PREF_START = parseInt(process.env.PREF_START_HOUR || "17", 10);
const PREF_END = parseInt(process.env.PREF_END_HOUR || "19", 10);
const WINDOW_ALERT_MINS = 20;

if (!HOME_LAT || !HOME_LNG || !NTFY_TOPIC) {
	console.error("Missing required env vars: HOME_LAT, HOME_LNG, NTFY_TOPIC");
	process.exit(1);
}

// --- Helpers ---
function slotOverlaps(slot: TimeSlot): boolean {
	const s = parseHour(slot.start);
	const e = parseHour(slot.end);
	return s != null && e != null && s < PREF_END && e > PREF_START;
}

function formatDate(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

function formatDateShort(dateStr: string): string {
	const d = new Date(`${dateStr}T12:00:00`);
	const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
	const months = [
		"Jan",
		"Feb",
		"Mar",
		"Apr",
		"May",
		"Jun",
		"Jul",
		"Aug",
		"Sep",
		"Oct",
		"Nov",
		"Dec",
	];
	return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}`;
}

function getTargetDates(): string[] {
	const dates: string[] = [];
	const today = new Date();
	for (let i = 0; i <= 10; i++) {
		const d = new Date(today);
		d.setDate(d.getDate() + i);
		if (PREF_DAYS.includes(d.getDay())) {
			dates.push(formatDate(d));
		}
	}
	return dates;
}

// --- Local dedup cache (24 h TTL) ---
const DEDUP_FILE = resolve(
	import.meta.dirname ?? ".",
	".cache",
	"notified.json",
);
const DEDUP_TTL_MS = 24 * 60 * 60 * 1000;

function loadDedupCache(): DedupCache {
	const raw = readJson<DedupCache>(DEDUP_FILE, {}) ?? {};
	const now = Date.now();
	const cleaned: DedupCache = {};
	for (const [key, ts] of Object.entries(raw)) {
		if (now - ts < DEDUP_TTL_MS) cleaned[key] = ts;
	}
	return cleaned;
}

// --- ntfy ---
async function notify({
	title,
	body,
	tags,
	priority,
	click,
}: NotifyParams): Promise<void> {
	const res = await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
		method: "POST",
		headers: {
			Title: title,
			Tags: tags,
			Priority: priority || "default",
			Click: click,
		},
		body,
	});
	if (!res.ok) console.warn(`  [failed] ${res.status}`);
}

// --- Core logic ---
async function checkCourt(
	court: Court,
	dates: string[],
): Promise<SlotNotification[]> {
	const notifications: SlotNotification[] = [];

	const locationId = await resolveLocationId(court.slug);
	if (!locationId) return notifications;

	const locRes = await fetchJson<RecUsLocationResponse>(
		`https://api.rec.us/v1/locations/${locationId}?publishedSites=true`,
	);
	if (!locRes) return notifications;

	const loc = locRes.location ?? locRes;
	const lat = parseFloat(loc.lat ?? "");
	const lng = parseFloat(loc.lng ?? "");
	const dist =
		Math.round(distanceMiles(HOME_LAT, HOME_LNG, lat, lng) * 100) / 100;
	if (dist > MAX_DISTANCE) return notifications;

	const courtMeta = buildCourtMeta(loc.courts);

	const now = new Date();

	// Fetch all dates in parallel — they are independent requests for the same location
	const schedResults = await Promise.all(
		dates.map(async (date) => {
			const schedRes = await fetchJson<ScheduleResponse>(
				`https://api.rec.us/v1/locations/${locationId}/schedule?startDate=${date}`,
			);
			return { date, schedRes };
		}),
	);

	for (const { date, schedRes } of schedResults) {
		if (!schedRes) continue;
		const dateKey = date.replace(/-/g, "");

		const dayCourts = schedRes.dates?.[dateKey] ?? [];
		for (const c of dayCourts) {
			const meta = courtMeta[c.courtNumber] || DEFAULT_COURT_META;
			const releaseDate = computeReleaseDate(date, meta);

			const windowOpen = now >= releaseDate;
			const minsUntilOpen = (releaseDate.getTime() - now.getTime()) / 60000;
			const windowOpeningSoon =
				!windowOpen && minsUntilOpen > 0 && minsUntilOpen <= WINDOW_ALERT_MINS;

			const matchingSlots = parseReservableSlots(
				c.schedule,
				meta.slotDuration,
			).filter(slotOverlaps);
			if (matchingSlots.length === 0) continue;

			const dateLabel = formatDateShort(date);
			const timesStr = matchingSlots
				.map((s) => `${s.start}-${s.end}`)
				.join(", ");

			if (windowOpeningSoon) {
				const minsLeft = Math.round(minsUntilOpen);
				notifications.push({
					title: `${dateLabel} - ${court.name} opens in ${minsLeft} min!`,
					body: `${c.courtNumber}: ${timesStr}`,
					tags: "alarm_clock,tennis",
					priority: "urgent",
					click: `https://www.rec.us/${court.slug}`,
					_dedupKey: `${court.slug}:${c.courtNumber}:${date}:window`,
				});
			} else if (windowOpen) {
				notifications.push({
					title: `${dateLabel} - ${court.name}`,
					body: `${c.courtNumber}: ${timesStr}`,
					tags: "tennis",
					priority: "default",
					click: `https://www.rec.us/${court.slug}`,
					_groupKey: `${date}:${court.slug}`,
					_slotKeys: matchingSlots.map(
						(s) => `${court.slug}:${c.courtNumber}:${date}:${s.start}`,
					),
				});
			}
		}
	}

	return notifications;
}

async function main(): Promise<void> {
	const dates = getTargetDates();
	if (dates.length === 0) {
		console.log("No target dates in the next 10 days.");
		return;
	}
	const courts = await getCourts();
	console.log(`Checking ${courts.length} locations...`);

	const notifications: SlotNotification[] = [];

	for (let i = 0; i < courts.length; i += 5) {
		const batch = courts.slice(i, i + 5);
		const results = await Promise.all(
			batch.map((c) =>
				checkCourt(c, dates).catch((e: Error) => {
					console.warn(`  [error] ${c.name}: ${e.message}`);
					return [] as SlotNotification[];
				}),
			),
		);
		notifications.push(...results.flat());
	}

	const dedupKeys = (n: SlotNotification): string[] =>
		n._slotKeys || (n._dedupKey ? [n._dedupKey] : []);

	const dedupCache = loadDedupCache();
	const fresh = notifications.filter((n) =>
		dedupKeys(n).some((k) => !dedupCache[k]),
	);

	if (fresh.length === 0) {
		console.log("No new notifications to send.");
		writeJson(DEDUP_FILE, dedupCache);
		return;
	}

	// Group default-priority notifications by day+location
	const urgent = fresh.filter((n) => !n._groupKey);
	const groups = new Map<string, GroupedNotification>();
	for (const n of fresh) {
		if (!n._groupKey) continue;
		if (!groups.has(n._groupKey)) {
			groups.set(n._groupKey, {
				title: n.title,
				tags: n.tags,
				priority: n.priority || "default",
				click: n.click,
				lines: [n.body],
			});
		} else {
			groups.get(n._groupKey)?.lines.push(n.body);
		}
	}

	const toSend: NotifyParams[] = [
		...urgent,
		...[...groups.values()].map((g) => ({
			title: g.title,
			body: g.lines.join("\n"),
			tags: g.tags,
			priority: g.priority,
			click: g.click,
		})),
	];

	console.log(
		`Sending ${toSend.length} notification(s) (${notifications.length - fresh.length} deduped)...`,
	);
	await Promise.all(toSend.map(notify));

	const now = Date.now();
	for (const n of fresh) {
		for (const k of dedupKeys(n)) dedupCache[k] = now;
	}
	writeJson(DEDUP_FILE, dedupCache);

	console.log("Done.");
}

main().catch((e: Error) => {
	console.error(e);
	process.exit(1);
});
