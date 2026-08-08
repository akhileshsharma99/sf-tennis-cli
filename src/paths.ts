import { homedir } from "node:os";
import { join } from "node:path";

const APP_NAME = "sf-tennis-cli";

function xdgConfigHome(): string {
	return process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
}

function xdgCacheHome(): string {
	return process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
}

export const LOCATIONS_FILE = join(xdgConfigHome(), APP_NAME, "locations.json");

export const COURTS_CACHE_FILE = join(xdgCacheHome(), APP_NAME, "courts.json");
