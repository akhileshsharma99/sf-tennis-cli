#!/usr/bin/env node

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { program } from 'commander';
import chalk from 'chalk';
import { fetchAllCourts } from './api.js';
import { getLocations } from './courts.js';
import { getCurrentLocation } from './geo.js';

// Load .env from the package directory
const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const envFile = readFileSync(resolve(__dirname, '.env'), 'utf8');
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx);
    const val = trimmed.slice(idx + 1);
    if (!(key in process.env)) process.env[key] = val;
  }
} catch {}

const LOCATIONS = getLocations();

program
  .name('tennis')
  .description('Find available SF tennis court times near you')
  .option('-d, --date <YYYY-MM-DD>', 'date to check (default: today)')
  .option('-l, --location <name>', 'reference location: "home", "current", or "lat,lng" (default: home)')
  .option('-r, --range <start-end>', 'time range filter, e.g. "9-17" for 9am-5pm')
  .option('-m, --max-distance <miles>', 'max distance in miles', parseFloat)
  .option('--json', 'output raw JSON')
  .action(async (opts) => {
    const date = opts.date || new Date().toISOString().slice(0, 10);

    // Resolve reference location
    let refLat, refLng, refLabel;
    const locStr = (opts.location || 'home').toLowerCase();

    if (locStr === 'current') {
      process.stdout.write(chalk.dim('Getting current location... '));
      const loc = await getCurrentLocation();
      if (!loc) {
        console.error(chalk.red('Could not determine current location'));
        process.exit(1);
      }
      refLat = loc.lat;
      refLng = loc.lng;
      refLabel = loc.label;
      console.log(chalk.dim(refLabel));
    } else if (LOCATIONS[locStr]) {
      refLat = LOCATIONS[locStr].lat;
      refLng = LOCATIONS[locStr].lng;
      refLabel = LOCATIONS[locStr].label;
    } else if (locStr.includes(',')) {
      const [lat, lng] = locStr.split(',').map(Number);
      refLat = lat;
      refLng = lng;
      refLabel = `${lat}, ${lng}`;
    } else if (locStr === 'home') {
      console.error(chalk.red('Home location not set. Add TENNIS_HOME_LAT and TENNIS_HOME_LNG to .env'));
      process.exit(1);
    } else {
      console.error(chalk.red(`Unknown location: "${locStr}". Use "home", "current", or "lat,lng".`));
      process.exit(1);
    }

    // Parse time range
    let timeRange = null;
    if (opts.range) {
      const parts = opts.range.split('-').map(Number);
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        timeRange = parts;
      } else {
        console.error(chalk.red('Invalid time range. Use format: "9-17" (9am to 5pm)'));
        process.exit(1);
      }
    }

    console.log(chalk.bold(`\nTennis Courts — ${date}`));
    console.log(chalk.dim(`From: ${refLabel}`));
    if (opts.maxDistance) console.log(chalk.dim(`Within: ${opts.maxDistance} mi`));
    if (timeRange) console.log(chalk.dim(`Time: ${formatHour(timeRange[0])}–${formatHour(timeRange[1])}`));
    console.log();

    process.stdout.write(chalk.dim('Fetching court data...'));
    const results = await fetchAllCourts({
      date,
      refLat,
      refLng,
      maxDistance: opts.maxDistance,
      timeRange,
    });
    process.stdout.write('\r' + ' '.repeat(30) + '\r');

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    if (results.length === 0) {
      console.log(chalk.yellow('No courts found with available slots.'));
      return;
    }

    for (const r of results) {
      const distStr = chalk.dim(`${r.distance} mi`);
      const slotsStr = r.totalAvailableSlots > 0
        ? chalk.green(`${r.totalAvailableSlots} slots`)
        : chalk.red('no slots');

      console.log(`${chalk.bold(r.name)} ${distStr} — ${slotsStr}`);
      console.log(chalk.dim(`  ${r.address}`));

      for (const court of r.courts) {
        if (court.available.length === 0) continue;
        const times = court.available.map((s) => chalk.green(s)).join(', ');
        console.log(`  Court ${court.courtNumber}: ${times}`);
      }
      console.log();
    }

    console.log(chalk.dim(`${results.length} courts shown. Book at https://www.rec.us`));
  });

function formatHour(h) {
  if (h === 0 || h === 24) return '12am';
  if (h === 12) return '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

program.parse();
