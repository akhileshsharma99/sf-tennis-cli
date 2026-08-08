import { describe, expect, test } from "bun:test";
import { parseSports, sportLabel, toSport } from "../src/sports";

describe("toSport", () => {
	test("maps rec.us sport names", () => {
		expect(toSport("Tennis")).toBe("tennis");
		expect(toSport("Pickleball")).toBe("pickleball");
		expect(toSport(" pickleball ")).toBe("pickleball");
	});

	test("drops sports we don't track", () => {
		expect(toSport("Basketball")).toBeNull();
		expect(toSport(undefined)).toBeNull();
		expect(toSport("")).toBeNull();
	});
});

describe("parseSports", () => {
	test("parses single sports", () => {
		expect(parseSports("tennis")).toEqual(["tennis"]);
		expect(parseSports("PICKLEBALL")).toEqual(["pickleball"]);
	});

	test("expands all", () => {
		expect(parseSports("all")).toEqual(["tennis", "pickleball"]);
	});

	test("parses comma lists and dedupes", () => {
		expect(parseSports("pickleball,tennis")).toEqual(["pickleball", "tennis"]);
		expect(parseSports("tennis, tennis")).toEqual(["tennis"]);
	});

	test("rejects unknown or empty input", () => {
		expect(parseSports("badminton")).toBeNull();
		expect(parseSports("tennis,badminton")).toBeNull();
		expect(parseSports("")).toBeNull();
		expect(parseSports(" , ")).toBeNull();
	});
});

describe("sportLabel", () => {
	test("capitalizes for display", () => {
		expect(sportLabel("tennis")).toBe("Tennis");
		expect(sportLabel("pickleball")).toBe("Pickleball");
	});
});
