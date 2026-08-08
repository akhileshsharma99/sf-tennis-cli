import { describe, expect, test } from "bun:test";
import { parseCourtsFromHtml } from "../src/courts";

describe("parseCourtsFromHtml", () => {
	test("parses slug and name from aria-label links", () => {
		const html = `
			<a href="https://www.rec.us/alicemarble" aria-label="Reserve 4 courts at Alice Marble">4</a>
			<a href="https://www.rec.us/buenavista" aria-label="Reserve 1 court at Buena Vista">1</a>
		`;
		expect(parseCourtsFromHtml(html)).toEqual([
			{ slug: "alicemarble", name: "Alice Marble" },
			{ slug: "buenavista", name: "Buena Vista" },
		]);
	});

	test("falls back to link text when aria-label missing", () => {
		const html = `
			<a href="https://www.rec.us/alice-marble-tennis-courts">Alice Marble Tennis Courts</a>
		`;
		expect(parseCourtsFromHtml(html)).toEqual([
			{ slug: "alice-marble-tennis-courts", name: "Alice Marble" },
		]);
	});

	test("ignores numeric-only link text in fallback", () => {
		const html = `<a href="https://www.rec.us/alicemarble">4</a>`;
		expect(parseCourtsFromHtml(html)).toEqual([]);
	});

	test("ignores the '>4' court-count link text of the current layout", () => {
		const html = `<a href="https://www.rec.us/alicemarble">&gt;4</a>`;
		expect(parseCourtsFromHtml(html)).toEqual([]);
	});

	test("keeps link-text courts alongside aria-label courts", () => {
		const html = `
			<a href="https://www.rec.us/alicemarble" aria-label="Reserve 4 courts at Alice Marble">4</a>
			<a href="https://www.rec.us/buena-vista-tennis-courts">Buena Vista Tennis Courts</a>
		`;
		expect(parseCourtsFromHtml(html)).toEqual([
			{ slug: "alicemarble", name: "Alice Marble" },
			{ slug: "buena-vista-tennis-courts", name: "Buena Vista" },
		]);
	});

	test("decodes HTML entities in aria-label names", () => {
		const html = `<a href="https://www.rec.us/stmarys" aria-label="Reserve 2 courts at St. Mary&#39;s &amp; Co">2</a>`;
		expect(parseCourtsFromHtml(html)).toEqual([
			{ slug: "stmarys", name: "St. Mary's & Co" },
		]);
	});
});
