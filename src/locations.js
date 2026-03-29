import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, writeJson } from "./fs-utils.js";
import { geocode } from "./geo.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCATIONS_FILE = resolve(__dirname, "..", "locations.json");

function readLocationsFile() {
	return readJson(LOCATIONS_FILE, []);
}

function writeLocationsFile(locations) {
	writeJson(LOCATIONS_FILE, locations, { pretty: true });
}

async function loadLocations({ quiet = false } = {}) {
	const locations = readLocationsFile();
	let changed = false;

	for (const loc of locations) {
		if (loc.lat != null && loc.lng != null) continue;
		if (!quiet) process.stdout.write(`Geocoding "${loc.address}"... `);
		const coords = await geocode(loc.address);
		if (coords) {
			loc.lat = coords.lat;
			loc.lng = coords.lng;
			changed = true;
			if (!quiet) console.log("done");
		} else {
			if (!quiet) console.log("failed (address not found)");
		}
	}

	if (changed) writeLocationsFile(locations);
	return locations;
}

export async function getLocation(name) {
	const locations = await loadLocations();
	return (
		locations.find((l) => l.name.toLowerCase() === name.toLowerCase()) ?? null
	);
}

export async function addLocation(name, address) {
	const locations = readLocationsFile();
	const existing = locations.findIndex(
		(l) => l.name.toLowerCase() === name.toLowerCase(),
	);
	if (existing !== -1) locations.splice(existing, 1);

	process.stdout.write(`Geocoding "${address}"... `);
	const coords = await geocode(address);
	if (!coords) {
		console.log("failed (address not found)");
		return null;
	}
	console.log("done");

	const loc = { name, address, lat: coords.lat, lng: coords.lng };
	if (locations.length === 0) loc.default = true;
	locations.push(loc);
	writeLocationsFile(locations);
	return loc;
}

export function removeLocation(name) {
	const locations = readLocationsFile();
	const idx = locations.findIndex(
		(l) => l.name.toLowerCase() === name.toLowerCase(),
	);
	if (idx === -1) return false;
	locations.splice(idx, 1);
	writeLocationsFile(locations);
	return true;
}

export function getDefaultLocation() {
	const locations = readLocationsFile();
	return locations.find((l) => l.default) ?? locations[0] ?? null;
}

export function setDefaultLocation(name) {
	const locations = readLocationsFile();
	const idx = locations.findIndex(
		(l) => l.name.toLowerCase() === name.toLowerCase(),
	);
	if (idx === -1) return false;
	for (const l of locations) delete l.default;
	locations[idx].default = true;
	writeLocationsFile(locations);
	return true;
}

export function listLocations() {
	return readLocationsFile();
}
