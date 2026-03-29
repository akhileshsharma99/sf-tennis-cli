import { describe, expect, test } from "bun:test";
import { distanceMiles } from "../src/geo";

describe("distanceMiles", () => {
	test("same point returns 0", () => {
		const p = { lat: 37.7749, lng: -122.4194 };
		expect(distanceMiles(p, p)).toBe(0);
	});

	test("SF City Hall to Golden Gate Park (~2.4 mi)", () => {
		const cityHall = { lat: 37.7793, lng: -122.4193 };
		const ggPark = { lat: 37.7694, lng: -122.4862 };
		const d = distanceMiles(cityHall, ggPark);
		expect(d).toBeGreaterThan(2);
		expect(d).toBeLessThan(4);
	});

	test("SF to Oakland (~8-10 mi)", () => {
		const sf = { lat: 37.7749, lng: -122.4194 };
		const oakland = { lat: 37.8044, lng: -122.2712 };
		const d = distanceMiles(sf, oakland);
		expect(d).toBeGreaterThan(7);
		expect(d).toBeLessThan(12);
	});

	test("SF to LA (~347 mi)", () => {
		const sf = { lat: 37.7749, lng: -122.4194 };
		const la = { lat: 34.0522, lng: -118.2437 };
		const d = distanceMiles(sf, la);
		expect(d).toBeGreaterThan(340);
		expect(d).toBeLessThan(360);
	});

	test("order does not matter (symmetric)", () => {
		const a = { lat: 37.7749, lng: -122.4194 };
		const b = { lat: 34.0522, lng: -118.2437 };
		expect(distanceMiles(a, b)).toBe(distanceMiles(b, a));
	});

	test("returns number rounded to 2 decimal places", () => {
		const a = { lat: 37.7749, lng: -122.4194 };
		const b = { lat: 37.78, lng: -122.42 };
		const d = distanceMiles(a, b);
		const decimals = d.toString().split(".")[1]?.length ?? 0;
		expect(decimals).toBeLessThanOrEqual(2);
	});
});
