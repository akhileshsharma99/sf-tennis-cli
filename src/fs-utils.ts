import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function readJson<T = unknown>(
	path: string,
	fallback: T | null = null,
): T | null {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as T;
	} catch {
		return fallback;
	}
}

export function writeJson(
	path: string,
	data: unknown,
	{ pretty = false } = {},
): void {
	mkdirSync(dirname(path), { recursive: true });
	const content = `${pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)}\n`;
	// Write to temp then rename for atomic updates
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, content);
	renameSync(tmp, path);
}
