import { accessSync, constants, existsSync, realpathSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";

/** The three names this CLI installs itself under. */
export const BIN_NAMES = ["tennis", "pickleball", "courts"];

/**
 * `bun build --compile` rewrites argv[1] to a path inside its virtual
 * filesystem, which is the only reliable signal that we're a binary.
 */
export function isCompiled(): boolean {
	return process.argv[1]?.startsWith("/$bunfs") ?? false;
}

/** The entry point actually running — the binary, or the script invoked. */
export function runningFrom(): string {
	if (isCompiled()) return process.execPath;
	return process.argv[1] ?? fileURLToPath(import.meta.url);
}

/** Nearest ancestor holding a package.json, i.e. the checkout a script belongs to. */
function packageRoot(path: string): string | null {
	let dir = existsSync(path) && !path.endsWith(".ts") ? path : dirname(path);
	const { root } = parse(dir);
	while (dir !== root) {
		if (existsSync(join(dir, "package.json"))) return dir;
		dir = dirname(dir);
	}
	return null;
}

/**
 * One id per distinct installation. A `bun link`ed checkout puts three
 * symlinks on PATH that are all the same install, so collapse them to the
 * checkout; a compiled binary is its own id.
 */
function installId(path: string): string {
	const real = realpathSync(path);
	return real.endsWith(".ts") ? (packageRoot(real) ?? real) : real;
}

/** Every distinct install of this CLI reachable on PATH. */
export function installsOnPath(): string[] {
	const dirs = (process.env.PATH ?? "").split(":").filter(Boolean);
	const ids = new Set<string>();
	for (const dir of dirs) {
		for (const name of BIN_NAMES) {
			const path = join(dir, name);
			try {
				accessSync(path, constants.X_OK);
				ids.add(installId(path));
			} catch {
				// Not there, not executable, or a broken symlink
			}
		}
	}
	return [...ids];
}

/** Version string plus enough context to tell two installs apart. */
export function versionReport(version: string): string {
	const self = runningFrom();
	const lines = [
		`${version} (${isCompiled() ? "compiled binary" : "from source"})`,
		`  running: ${self}`,
	];

	let selfId: string | null = null;
	try {
		selfId = installId(self);
	} catch {
		// Fall through: without an id we just report every install we found
	}
	const others = installsOnPath().filter((id) => id !== selfId);

	if (others.length > 0) {
		lines.push(
			"",
			`  warning: ${others.length} other install(s) of this CLI on PATH:`,
			...others.map((id) => `    ${id}`),
			"  a stale one can shadow this in shells that already hashed it — run `hash -r`",
		);
	}
	return lines.join("\n");
}
