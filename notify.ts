#!/usr/bin/env bun

// Notification script for GitHub Actions.
// Imports shared code from src/ — zero extra npm dependencies.

process.env.TZ = "America/Los_Angeles";

import { resolve } from "node:path";
import type { ScheduleResponse, TimeSlot } from "./src/api";
import {
	computeReleaseDate,
	DEFAULT_COURT_META,
	fetchJson,
	fetchLocationData,
	parseHour,
	parseReservableSlots,
	scheduleUrl,
} from "./src/api";
import type { Court } from "./src/courts";
import { getCourts } from "./src/courts";
import { formatDateLabel } from "./src/format";
import { readJson, writeJson } from "./src/fs-utils";
import { distanceMiles } from "./src/geo";

interface NotifyParams {
	title: string;
	body: string;
	tags: string;
	priority?: "urgent" | "high" | "default" | "low" | "min";
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

interface CourtFailure {
	name: string;
	reason: string;
}

interface CourtCheckResult {
	notifications: SlotNotification[];
	failures: CourtFailure[];
}

type DedupCache = Record<string, number>;

const HOME_LAT = parseFloat(process.env.HOME_LAT || "");
const HOME_LNG = parseFloat(process.env.HOME_LNG || "");
const HOME = { lat: HOME_LAT, lng: HOME_LNG };
const NTFY_TOPIC = process.env.NTFY_TOPIC;
const MAX_DISTANCE = parseFloat(process.env.MAX_DISTANCE || "2");
const PREF_DAYS = (process.env.PREF_DAYS || "2,4").split(",").map(Number); // 0=Sun, 2=Tue, 4=Thu
const PREF_START = parseInt(process.env.PREF_START_HOUR || "17", 10);
const PREF_END = parseInt(process.env.PREF_END_HOUR || "19", 10);
const WINDOW_ALERT_MINS = 20;

const FAILURE_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const FAILURE_ALERT_KEY = "alert:court-failures";

if (!HOME_LAT || !HOME_LNG || !NTFY_TOPIC) {
	console.error("Missing required env vars: HOME_LAT, HOME_LNG, NTFY_TOPIC");
	process.exit(1);
}

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
	return formatDateLabel(new Date(`${dateStr}T12:00:00`));
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

async function checkCourt(
	court: Court,
	dates: string[],
): Promise<CourtCheckResult> {
	const notifications: SlotNotification[] = [];

	const locData = await fetchLocationData(court.slug);
	if (!locData) {
		return {
			notifications,
			failures: [{ name: court.name, reason: "location unavailable" }],
		};
	}

	const dist = distanceMiles(HOME, locData);
	if (dist > MAX_DISTANCE) return { notifications, failures: [] };

	const now = new Date();

	const schedResults = await Promise.all(
		dates.map(async (date) => {
			const schedRes = await fetchJson<ScheduleResponse>(
				scheduleUrl(locData.locationId, date),
			);
			return { date, schedRes };
		}),
	);

	if (schedResults.every(({ schedRes }) => !schedRes)) {
		return {
			notifications,
			failures: [{ name: court.name, reason: "schedule unavailable" }],
		};
	}

	for (const { date, schedRes } of schedResults) {
		if (!schedRes) continue;
		const dateKey = date.replace(/-/g, "");

		const dayCourts = schedRes.dates?.[dateKey] ?? [];
		for (const c of dayCourts) {
			const meta = locData.courtMeta[c.courtNumber] || DEFAULT_COURT_META;
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
			const courtUrl = `https://www.rec.us/${court.slug}`;

			if (windowOpeningSoon) {
				const minsLeft = Math.round(minsUntilOpen);
				notifications.push({
					title: `${dateLabel} - ${court.name} opens in ${minsLeft} min!`,
					body: `${c.courtNumber}: ${timesStr}`,
					tags: "alarm_clock,tennis",
					priority: "urgent",
					click: courtUrl,
					_dedupKey: `${court.slug}:${c.courtNumber}:${date}:window`,
				});
			} else if (windowOpen) {
				notifications.push({
					title: `${dateLabel} - ${court.name}`,
					body: `${c.courtNumber}: ${timesStr}`,
					tags: "tennis",
					priority: "default",
					click: courtUrl,
					_groupKey: `${date}:${court.slug}`,
					_slotKeys: matchingSlots.map(
						(s) => `${court.slug}:${c.courtNumber}:${date}:${s.start}`,
					),
				});
			}
		}
	}

	return { notifications, failures: [] };
}

function runUrl(): string {
	const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
	return GITHUB_SERVER_URL && GITHUB_REPOSITORY && GITHUB_RUN_ID
		? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`
		: "https://www.rec.us";
}

async function reportFailures(
	failures: CourtFailure[],
	total: number,
	dedupCache: DedupCache,
): Promise<void> {
	if (failures.length === 0) return;
	console.warn(`${failures.length}/${total} location(s) failed to load.`);

	const lastAlert = dedupCache[FAILURE_ALERT_KEY] ?? 0;
	if (Date.now() - lastAlert < FAILURE_ALERT_COOLDOWN_MS) return;

	await notify({
		title: `Tennis check failed - ${failures.length}/${total} locations`,
		body: failures.map((f) => `${f.name}: ${f.reason}`).join("\n"),
		tags: "warning",
		priority: "high",
		click: runUrl(),
	});
	dedupCache[FAILURE_ALERT_KEY] = Date.now();
	console.log("Sent failure alert.");
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
	const failures: CourtFailure[] = [];

	for (let i = 0; i < courts.length; i += 5) {
		const batch = courts.slice(i, i + 5);
		const results = await Promise.all(
			batch.map((c) =>
				checkCourt(c, dates).catch((e: Error): CourtCheckResult => {
					console.warn(`  [error] ${c.name}: ${e.message}`);
					return {
						notifications: [],
						failures: [{ name: c.name, reason: e.message }],
					};
				}),
			),
		);
		for (const r of results) {
			notifications.push(...r.notifications);
			failures.push(...r.failures);
		}
	}

	const dedupKeys = (n: SlotNotification): string[] =>
		n._slotKeys || (n._dedupKey ? [n._dedupKey] : []);

	const dedupCache = loadDedupCache();
	await reportFailures(failures, courts.length, dedupCache);
	const fresh = notifications.filter((n) =>
		dedupKeys(n).some((k) => !dedupCache[k]),
	);

	if (fresh.length === 0) {
		console.log("No new notifications to send.");
		writeJson(DEDUP_FILE, dedupCache);
		return;
	}

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
			priority: g.priority as NotifyParams["priority"],
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

main().catch(async (e: Error) => {
	console.error(e);
	await notify({
		title: "Tennis notifier crashed",
		body: e.message,
		tags: "rotating_light",
		priority: "high",
		click: runUrl(),
	}).catch(() => {});
	process.exit(1);
});
