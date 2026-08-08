import { describe, expect, test } from "bun:test";
import {
	parseCourtsFromHtml,
	parseCourtsFromTable,
	parseFacilityCoords,
} from "../src/courts";

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
	const row = (
		facility: string,
		{ slug = "", walkUp = "0", openPlay = "0" } = {},
	) =>
		`<tr><td data-label="Facility">${facility}</td><td data-label="ZIP code">94117</td><td data-label="Total courts">4</td>` +
		`<td data-label="Reservable">${slug ? `<a href="https://www.rec.us/${slug}">4</a>` : "0"}</td>` +
		`<td data-label="Walk-up shared use">${walkUp}</td>` +
		`<td data-label="Dedicated open play">${openPlay}</td></tr>`;

	test("parses the pickleball directory table", () => {
		const html = `<table>${row('<a href="https://sfrecpark.org/x">Buena Vista</a>', { slug: "buenavista" })}${row("Rossi", { slug: "rossi" })}</table>`;
		expect(parseCourtsFromTable(html)).toEqual({
			courts: [
				{ slug: "buenavista", name: "Buena Vista", sports: ["pickleball"] },
				{ slug: "rossi", name: "Rossi", sports: ["pickleball"] },
			],
			walkUpSpots: [],
		});
	});

	test("decodes entities and collapses whitespace in facility names", () => {
		const html = `<table>${row("St. Mary&#39;s\n  Rec", { slug: "stmarys" })}</table>`;
		expect(parseCourtsFromTable(html).courts).toEqual([
			{ slug: "stmarys", name: "St. Mary's Rec", sports: ["pickleball"] },
		]);
	});

	test("returns nothing for the tennis page's non-table layout", () => {
		const html = `<a href="https://www.rec.us/alicemarble" aria-label="Reserve 4 courts at Alice Marble">4</a>`;
		expect(parseCourtsFromTable(html)).toEqual({
			courts: [],
			walkUpSpots: [],
		});
	});

	test("attaches walk-up info to bookable locations", () => {
		const html = `<table>${row("Rossi", { slug: "rossi", walkUp: "4", openPlay: "See schedule" })}</table>`;
		expect(parseCourtsFromTable(html).courts).toEqual([
			{
				slug: "rossi",
				name: "Rossi",
				sports: ["pickleball"],
				walkUp: { courts: 4, openPlay: "See schedule" },
			},
		]);
	});

	test("collects walk-up-only parks with their facility link", () => {
		const facility = `<a href="https://sfrecpark.org/Facilities/Facility/Details/Alta-Plaza-Park-147">Alta Plaza</a>`;
		const html = `<table>${row(facility, { walkUp: "2" })}</table>`;
		expect(parseCourtsFromTable(html)).toEqual({
			courts: [],
			walkUpSpots: [
				{
					name: "Alta Plaza",
					url: "https://sfrecpark.org/Facilities/Facility/Details/Alta-Plaza-Park-147",
					lat: null,
					lng: null,
					courts: 2,
					openPlay: null,
				},
			],
		});
	});

	test("counts a numeric open-play cell as courts, not prose", () => {
		const html = `<table>${row("Larsen", { openPlay: "8" })}${row("Rossi", { slug: "rossi", walkUp: "4", openPlay: "2" })}</table>`;
		const { courts, walkUpSpots } = parseCourtsFromTable(html);
		expect(walkUpSpots.map((s) => [s.name, s.courts, s.openPlay])).toEqual([
			["Larsen", 8, null],
		]);
		expect(courts[0].walkUp).toEqual({ courts: 6, openPlay: null });
	});

	test("drops rows with neither reservable nor walk-up play", () => {
		const html = `<table>${row("Goldman Tennis Center")}</table>`;
		expect(parseCourtsFromTable(html)).toEqual({
			courts: [],
			walkUpSpots: [],
		});
	});
});

describe("parseFacilityCoords", () => {
	test("reads the escaped JSON blob on a facility page", () => {
		const html = `<input type="hidden" value="[{&quot;ID&quot;:&quot;147&quot;,&quot;Latitude&quot;:&quot;37.7922622376925&quot;,&quot;Longitude&quot;:&quot;-122.436196847937&quot;}]" />`;
		expect(parseFacilityCoords(html)).toEqual({
			lat: 37.7922622376925,
			lng: -122.436196847937,
		});
	});

	test("returns null when absent", () => {
		expect(parseFacilityCoords("<html></html>")).toBeNull();
	});
});
