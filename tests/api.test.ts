import { describe, expect, test } from "bun:test";
import type { RecUsLocationCourt, ScheduleEntry } from "../src/api";
import {
	buildCourtMeta,
	computeReleaseDate,
	DEFAULT_COURT_META,
	parseHour,
	parseReservableSlots,
	scheduleUrl,
} from "../src/api";

describe("parseHour", () => {
	test("parses standard HH:MM", () => {
		expect(parseHour("09:00")).toBe(9);
		expect(parseHour("17:30")).toBe(17);
		expect(parseHour("00:00")).toBe(0);
		expect(parseHour("23:59")).toBe(23);
	});

	test("parses single-digit hour", () => {
		expect(parseHour("9:00")).toBe(9);
	});

	test("returns null for undefined", () => {
		expect(parseHour(undefined)).toBeNull();
	});

	test("returns null for empty string", () => {
		expect(parseHour("")).toBeNull();
	});

	test("returns null for invalid format", () => {
		expect(parseHour("abc")).toBeNull();
		expect(parseHour("noon")).toBeNull();
	});
});

describe("scheduleUrl", () => {
	test("constructs correct URL", () => {
		const url = scheduleUrl("loc-123", "2025-03-15");
		expect(url).toBe(
			"https://api.rec.us/v1/locations/loc-123/schedule?startDate=2025-03-15",
		);
	});
});

describe("buildCourtMeta", () => {
	test("returns empty object for undefined input", () => {
		expect(buildCourtMeta(undefined)).toEqual({});
	});

	test("returns empty object for empty array", () => {
		expect(buildCourtMeta([])).toEqual({});
	});

	test("parses court metadata correctly", () => {
		const courts: RecUsLocationCourt[] = [
			{
				courtNumber: "Court 1",
				maxReservationTime: "01:30",
				defaultReservationWindowDays: 5,
				reservationReleaseTimeLocal: "18:00:00",
			},
		];
		const meta = buildCourtMeta(courts);
		expect(meta["Court 1"]).toEqual({
			slotDuration: 90,
			windowDays: 5,
			releaseTime: "18:00:00",
		});
	});

	test("uses defaults for missing fields", () => {
		const courts: RecUsLocationCourt[] = [{ courtNumber: "Court 1" }];
		const meta = buildCourtMeta(courts);
		expect(meta["Court 1"]).toEqual({
			slotDuration: 60,
			windowDays: 7,
			releaseTime: "00:00:00",
		});
	});

	test("handles multiple courts", () => {
		const courts: RecUsLocationCourt[] = [
			{ courtNumber: "Court 1", maxReservationTime: "01:00" },
			{ courtNumber: "Court 2", maxReservationTime: "02:00" },
		];
		const meta = buildCourtMeta(courts);
		expect(Object.keys(meta)).toHaveLength(2);
		expect(meta["Court 1"].slotDuration).toBe(60);
		expect(meta["Court 2"].slotDuration).toBe(120);
	});
});

describe("computeReleaseDate", () => {
	test("subtracts windowDays from target date", () => {
		const meta = { slotDuration: 60, windowDays: 7, releaseTime: "00:00:00" };
		const release = computeReleaseDate("2025-03-15", meta);
		expect(release.getFullYear()).toBe(2025);
		expect(release.getMonth()).toBe(2); // March = 2
		expect(release.getDate()).toBe(8); // 15 - 7 = 8
	});

	test("applies release time", () => {
		const meta = {
			slotDuration: 60,
			windowDays: 7,
			releaseTime: "18:00:00",
		};
		const release = computeReleaseDate("2025-03-15", meta);
		expect(release.getHours()).toBe(18);
		expect(release.getMinutes()).toBe(0);
	});

	test("handles midnight release time", () => {
		const release = computeReleaseDate("2025-03-15", DEFAULT_COURT_META);
		expect(release.getHours()).toBe(0);
		expect(release.getMinutes()).toBe(0);
	});

	test("release with non-zero minutes", () => {
		const meta = {
			slotDuration: 60,
			windowDays: 3,
			releaseTime: "06:30:00",
		};
		const release = computeReleaseDate("2025-03-15", meta);
		expect(release.getDate()).toBe(12); // 15 - 3
		expect(release.getHours()).toBe(6);
		expect(release.getMinutes()).toBe(30);
	});
});

describe("parseReservableSlots", () => {
	test("returns empty array for undefined schedule", () => {
		expect(parseReservableSlots(undefined, 60)).toEqual([]);
	});

	test("returns empty array for empty schedule", () => {
		expect(parseReservableSlots({}, 60)).toEqual([]);
	});

	test("parses RESERVABLE slots and splits into duration chunks", () => {
		const schedule: Record<string, ScheduleEntry> = {
			"09:00, 12:00": { referenceType: "RESERVABLE" },
		};
		const slots = parseReservableSlots(schedule, 60);
		expect(slots).toEqual([
			{ start: "09:00", end: "10:00" },
			{ start: "10:00", end: "11:00" },
			{ start: "11:00", end: "12:00" },
		]);
	});

	test("ignores RESERVATION entries", () => {
		const schedule: Record<string, ScheduleEntry> = {
			"09:00, 10:00": { referenceType: "RESERVATION" },
			"10:00, 12:00": { referenceType: "RESERVABLE" },
		};
		const slots = parseReservableSlots(schedule, 60);
		expect(slots).toEqual([
			{ start: "10:00", end: "11:00" },
			{ start: "11:00", end: "12:00" },
		]);
	});

	test("handles 90-minute slot duration", () => {
		const schedule: Record<string, ScheduleEntry> = {
			"09:00, 12:00": { referenceType: "RESERVABLE" },
		};
		const slots = parseReservableSlots(schedule, 90);
		expect(slots).toEqual([
			{ start: "09:00", end: "10:30" },
			{ start: "10:30", end: "12:00" },
		]);
	});

	test("drops remainder that doesn't fit a full slot", () => {
		const schedule: Record<string, ScheduleEntry> = {
			"09:00, 10:30": { referenceType: "RESERVABLE" },
		};
		// 90 minutes available, 60-minute slots → 1 slot, 30 min leftover dropped
		const slots = parseReservableSlots(schedule, 60);
		expect(slots).toEqual([{ start: "09:00", end: "10:00" }]);
	});

	test("handles multiple RESERVABLE ranges", () => {
		const schedule: Record<string, ScheduleEntry> = {
			"09:00, 10:00": { referenceType: "RESERVABLE" },
			"14:00, 15:00": { referenceType: "RESERVABLE" },
		};
		const slots = parseReservableSlots(schedule, 60);
		expect(slots).toHaveLength(2);
		expect(slots[0].start).toBe("09:00");
		expect(slots[1].start).toBe("14:00");
	});
});
