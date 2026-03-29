import { describe, expect, test } from "bun:test";
import { formatDateLabel } from "../src/format";

describe("formatDateLabel", () => {
	test("formats a known date correctly", () => {
		// Jan 5, 2025 is a Sunday
		const date = new Date(2025, 0, 5);
		expect(formatDateLabel(date)).toBe("Sun Jan 5");
	});

	test("handles double-digit day", () => {
		// Nov 25, 2025 is a Tuesday
		const date = new Date(2025, 10, 25);
		expect(formatDateLabel(date)).toBe("Tue Nov 25");
	});

	test("handles first of month", () => {
		// Mar 1, 2025 is a Saturday
		const date = new Date(2025, 2, 1);
		expect(formatDateLabel(date)).toBe("Sat Mar 1");
	});

	test("handles December 31", () => {
		// Dec 31, 2025 is a Wednesday
		const date = new Date(2025, 11, 31);
		expect(formatDateLabel(date)).toBe("Wed Dec 31");
	});

	test("each day-of-week abbreviation is 3 chars", () => {
		for (let i = 0; i < 7; i++) {
			// Jan 5-11, 2025 covers Sun-Sat
			const date = new Date(2025, 0, 5 + i);
			const label = formatDateLabel(date);
			const dayAbbr = label.split(" ")[0];
			expect(dayAbbr.length).toBe(3);
		}
	});

	test("each month abbreviation is 3 chars", () => {
		for (let month = 0; month < 12; month++) {
			const date = new Date(2025, month, 15);
			const label = formatDateLabel(date);
			const monthAbbr = label.split(" ")[1];
			expect(monthAbbr.length).toBe(3);
		}
	});
});
