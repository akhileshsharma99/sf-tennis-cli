import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeJson } from "../src/fs-utils";

const TMP_DIR = join(import.meta.dirname ?? ".", ".tmp-test");

afterEach(() => {
	if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
});

describe("readJson", () => {
	test("returns fallback for missing file", () => {
		expect(readJson("/nonexistent/path.json", [])).toEqual([]);
	});

	test("returns null fallback by default", () => {
		expect(readJson("/nonexistent/path.json")).toBeNull();
	});

	test("reads written JSON file", () => {
		const file = join(TMP_DIR, "data.json");
		writeJson(file, { a: 1 });
		const result = readJson<{ a: number }>(file);
		expect(result).toEqual({ a: 1 });
	});
});

describe("writeJson", () => {
	test("creates parent directories", () => {
		const file = join(TMP_DIR, "nested", "deep", "data.json");
		writeJson(file, [1, 2, 3]);
		const result = readJson<number[]>(file);
		expect(result).toEqual([1, 2, 3]);
	});

	test("overwrites existing file", () => {
		const file = join(TMP_DIR, "data.json");
		writeJson(file, { v: 1 });
		writeJson(file, { v: 2 });
		const result = readJson<{ v: number }>(file);
		expect(result).toEqual({ v: 2 });
	});

	test("pretty prints when requested", () => {
		const file = join(TMP_DIR, "pretty.json");
		writeJson(file, { a: 1 }, { pretty: true });
		const raw = readFileSync(file, "utf8");
		expect(raw).toContain("\n");
		expect(raw).toContain("  "); // 2-space indent
	});

	test("compact by default", () => {
		const file = join(TMP_DIR, "compact.json");
		writeJson(file, { a: 1, b: 2 });
		const raw = readFileSync(file, "utf8");
		// Should be single-line JSON + newline
		expect(raw).toBe('{"a":1,"b":2}\n');
	});

	test("no leftover .tmp file after write", () => {
		const file = join(TMP_DIR, "atomic.json");
		writeJson(file, { ok: true });
		expect(existsSync(`${file}.tmp`)).toBe(false);
		expect(existsSync(file)).toBe(true);
	});
});

describe("readJson + writeJson round-trip", () => {
	test("preserves arrays", () => {
		const file = join(TMP_DIR, "arr.json");
		const data = [1, "two", { three: 3 }];
		writeJson(file, data);
		const result = readJson<typeof data>(file);
		expect(result).toEqual(data);
	});

	test("preserves nested objects", () => {
		const file = join(TMP_DIR, "nested.json");
		const data = { courts: [{ slug: "a", name: "A" }], ts: 123 };
		writeJson(file, data);
		const result = readJson<typeof data>(file);
		expect(result).toEqual(data);
	});
});
