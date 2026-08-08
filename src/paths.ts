import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

const APP_NAME = "sf-tennis-cli";

// The XDG spec says to ignore relative or empty values
function xdgDir(value: string | undefined, fallback: string): string {
	return value && isAbsolute(value) ? value : fallback;
}

function xdgConfigHome(): string {
	return xdgDir(process.env.XDG_CONFIG_HOME, join(homedir(), ".config"));
}

function xdgCacheHome(): string {
	return xdgDir(process.env.XDG_CACHE_HOME, join(homedir(), ".cache"));
}

export const LOCATIONS_FILE = join(xdgConfigHome(), APP_NAME, "locations.json");

export const COURTS_CACHE_FILE = join(xdgCacheHome(), APP_NAME, "courts.json");
