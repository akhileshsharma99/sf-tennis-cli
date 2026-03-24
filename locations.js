import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { geocode } from './geo.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCATIONS_FILE = resolve(__dirname, 'locations.json');

function readLocationsFile() {
  try {
    return JSON.parse(readFileSync(LOCATIONS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeLocationsFile(locations) {
  writeFileSync(LOCATIONS_FILE, JSON.stringify(locations, null, 2) + '\n');
}

// Load all locations, geocoding any that haven't been resolved yet
export async function loadLocations({ quiet = false } = {}) {
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
      if (!quiet) console.log('done');
    } else {
      if (!quiet) console.log('failed (address not found)');
    }
  }

  if (changed) writeLocationsFile(locations);
  return locations;
}

// Get a location by name (case-insensitive)
export async function getLocation(name) {
  const locations = await loadLocations();
  return locations.find((l) => l.name.toLowerCase() === name.toLowerCase()) ?? null;
}

// Add a new named location
export async function addLocation(name, address) {
  const locations = readLocationsFile();
  const existing = locations.findIndex((l) => l.name.toLowerCase() === name.toLowerCase());
  if (existing !== -1) locations.splice(existing, 1);

  process.stdout.write(`Geocoding "${address}"... `);
  const coords = await geocode(address);
  if (!coords) {
    console.log('failed (address not found)');
    return null;
  }
  console.log('done');

  const loc = { name, address, lat: coords.lat, lng: coords.lng };
  if (locations.length === 0) loc.default = true;
  locations.push(loc);
  writeLocationsFile(locations);
  return loc;
}

// Remove a named location
export function removeLocation(name) {
  const locations = readLocationsFile();
  const idx = locations.findIndex((l) => l.name.toLowerCase() === name.toLowerCase());
  if (idx === -1) return false;
  locations.splice(idx, 1);
  writeLocationsFile(locations);
  return true;
}

// Get the default location (the one with "default": true, or the first one)
export function getDefaultLocation() {
  const locations = readLocationsFile();
  return locations.find((l) => l.default) ?? locations[0] ?? null;
}

// Set a location as the default
export function setDefaultLocation(name) {
  const locations = readLocationsFile();
  const idx = locations.findIndex((l) => l.name.toLowerCase() === name.toLowerCase());
  if (idx === -1) return false;
  for (const l of locations) delete l.default;
  locations[idx].default = true;
  writeLocationsFile(locations);
  return true;
}

// List all saved locations
export function listLocations() {
  return readLocationsFile();
}
