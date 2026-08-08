import { describe, expect, test } from "bun:test";
import { parseCourtsFromHtml, parseCourtsFromTable } from "../src/courts";

describe("parseCourtsFromHtml", () => {
	test("parses slug and name from aria-label links", () => {
		const html = `
			<a href="https://www.rec.us/alicemarble" aria-label="Reserve 4 courts at Alice Marble">4</a>
			<a href="https://www.rec.us/buenavista" aria-label="Reserve 1 court at Buena Vista">1</a>
		`;
		expect(parseCourtsFromHtml(html)).toEqual([
			{ slug: "alicemarble", name: "Alice Marble", sports: ["tennis"] },
			{ slug: "buenavista", name: "Buena Vista", sports: ["tennis"] },
		]);
	});

	test("falls back to link text when aria-label missing", () => {
		const html = `
			<a href="https://www.rec.us/alice-marble-tennis-courts">Alice Marble Tennis Courts</a>
		`;
		expect(parseCourtsFromHtml(html)).toEqual([
			{
				slug: "alice-marble-tennis-courts",
				name: "Alice Marble",
				sports: ["tennis"],
			},
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
			{ slug: "alicemarble", name: "Alice Marble", sports: ["tennis"] },
			{
				slug: "buena-vista-tennis-courts",
				name: "Buena Vista",
				sports: ["tennis"],
			},
		]);
	});

	test("decodes HTML entities in aria-label names", () => {
		const html = `<a href="https://www.rec.us/stmarys" aria-label="Reserve 2 courts at St. Mary&#39;s &amp; Co">2</a>`;
		expect(parseCourtsFromHtml(html)).toEqual([
			{ slug: "stmarys", name: "St. Mary's & Co", sports: ["tennis"] },
		]);
	});
});

describe("parseCourtsFromTable", () => {
	const row = (facility: string, slug: string) =>
		`<tr><td data-label="Facility">${facility}</td><td data-label="ZIP code">94117</td><td data-label="Total courts">4</td><td data-label="Reservable"><a href="https://www.rec.us/${slug}">4</a></td></tr>`;

	test("parses the pickleball directory table", () => {
		const html = `<table>${row('<a href="https://sfrecpark.org/x">Buena Vista</a>', "buenavista")}${row("Rossi", "rossi")}</table>`;
		expect(parseCourtsFromTable(html)).toEqual([
			{ slug: "buenavista", name: "Buena Vista", sports: ["pickleball"] },
			{ slug: "rossi", name: "Rossi", sports: ["pickleball"] },
		]);
	});

	test("skips rows with no rec.us link", () => {
		const html = `<table><tr><td data-label="Facility">Walk-up Only</td><td data-label="Reservable">0</td></tr>${row("Rossi", "rossi")}</table>`;
		expect(parseCourtsFromTable(html)).toEqual([
			{ slug: "rossi", name: "Rossi", sports: ["pickleball"] },
		]);
	});

	test("decodes entities and collapses whitespace in facility names", () => {
		const html = `<table>${row("St. Mary&#39;s\n  Rec", "stmarys")}</table>`;
		expect(parseCourtsFromTable(html)).toEqual([
			{ slug: "stmarys", name: "St. Mary's Rec", sports: ["pickleball"] },
		]);
	});

	test("returns nothing for the tennis page's non-table layout", () => {
		const html = `<a href="https://www.rec.us/alicemarble" aria-label="Reserve 4 courts at Alice Marble">4</a>`;
		expect(parseCourtsFromTable(html)).toEqual([]);
	});
});
