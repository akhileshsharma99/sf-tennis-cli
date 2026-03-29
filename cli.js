#!/usr/bin/env bun

import { program } from 'commander';
import chalk from 'chalk';
import dayjs from 'dayjs';
import { fetchAllCourts } from './src/api.js';
import { getLocation, getDefaultLocation, addLocation, removeLocation, listLocations, setDefaultLocation } from './src/locations.js';
import { getCurrentLocation } from './src/geo.js';

// --- Main command: find courts ---
program
  .name('tennis')
  .description('Find available SF tennis court times near you')
  .option('-d, --date <date>', 'date: YYYY-MM-DD, day name (thursday, th), "tomorrow", "today" (default: today)')
  .option('-l, --location <name>', 'saved location name, "current", or "lat,lng" (default: your default location)')
  .option('-r, --range <start-end>', 'time range filter, e.g. "9-17" for 9am-5pm')
  .option('-m, --max-distance <miles>', 'max distance in miles', parseFloat)
  .option('--json', 'output raw JSON')
  .action(async (opts) => {
    const date = opts.date ? parseDate(opts.date) : dayjs().format('YYYY-MM-DD');

    // Resolve reference location
    let refLat, refLng, refLabel;
    const locStr = opts.location?.toLowerCase();

    if (!locStr) {
      const def = getDefaultLocation();
      if (!def || def.lat == null) {
        console.error(chalk.red('No default location set.'));
        console.error(chalk.dim('Add one with: tennis location add <name> "<address>"'));
        process.exit(1);
      }
      refLat = def.lat;
      refLng = def.lng;
      refLabel = `${def.name} (${def.address})`;
    } else if (locStr === 'current') {
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
    } else if (locStr.includes(',') && locStr.split(',').every((s) => !isNaN(parseFloat(s)))) {
      const [lat, lng] = locStr.split(',').map(Number);
      refLat = lat;
      refLng = lng;
      refLabel = `${lat}, ${lng}`;
    } else {
      const loc = await getLocation(locStr);
      if (!loc || loc.lat == null) {
        console.error(chalk.red(`Unknown location: "${locStr}".`));
        console.error(chalk.dim('Add it with: tennis location add <name> "<address>"'));
        console.error(chalk.dim('Or use: -l current, -l lat,lng'));
        process.exit(1);
      }
      refLat = loc.lat;
      refLng = loc.lng;
      refLabel = `${loc.name} (${loc.address})`;
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
    const { courts: results, errors } = await fetchAllCourts({
      date,
      refLat,
      refLng,
      maxDistance: opts.maxDistance,
      timeRange,
    });
    process.stdout.write('\r' + ' '.repeat(30) + '\r');

    if (errors > 0) {
      console.log(chalk.yellow(`${errors} court(s) failed to load.`));
    }

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

      const link = `\x1b]8;;${r.url}\x1b\\${r.name}\x1b]8;;\x1b\\`;
      console.log(`${chalk.bold(link)} ${distStr} — ${slotsStr}`);
      console.log(chalk.dim(`  ${r.address} · ${r.url}`));

      for (const court of r.courts) {
        if (court.available.length === 0 && court.pendingSlots.length === 0) continue;
        if (court.available.length > 0) {
          const times = court.available.map((s) => chalk.green(`${s.start}–${s.end}`)).join(', ');
          console.log(`  ${court.courtNumber}: ${times}`);
        }
        if (court.pendingSlots.length > 0 && court.opensAt) {
          const opensStr = formatOpensAt(court.opensAt);
          const pendingTimes = court.pendingSlots.map((s) => `${s.start}–${s.end}`).join(', ');
          console.log(chalk.yellow(`  ${court.courtNumber}: ${pendingTimes} (opens ${opensStr})`));
        }
      }
      console.log();
    }

    console.log(chalk.dim(`${results.length} courts shown. Book at https://www.rec.us`));
  });

// --- Subcommand: manage locations ---
const loc = program.command('location').description('Manage saved locations');

loc
  .command('add <name> <address>')
  .description('Add a named location (geocodes the address automatically)')
  .action(async (name, address) => {
    const result = await addLocation(name, address);
    if (result) {
      console.log(chalk.green(`Saved "${name}" → ${result.address}`));
    } else {
      console.error(chalk.red('Could not geocode that address. Try a more specific one.'));
      process.exit(1);
    }
  });

loc
  .command('remove <name>')
  .description('Remove a saved location')
  .action((name) => {
    if (removeLocation(name)) {
      console.log(chalk.green(`Removed "${name}".`));
    } else {
      console.error(chalk.red(`Location "${name}" not found.`));
      process.exit(1);
    }
  });

loc
  .command('list')
  .description('List all saved locations')
  .action(() => {
    const locs = listLocations();
    if (locs.length === 0) {
      console.log(chalk.dim('No saved locations. Add one with: tennis location add <name> "<address>"'));
      return;
    }
    for (const l of locs) {
      const def = l.default ? chalk.cyan(' (default)') : '';
      console.log(`  ${chalk.bold(l.name)}: ${l.address}${def}`);
    }
  });

loc
  .command('default <name>')
  .description('Set a location as the default')
  .action((name) => {
    if (setDefaultLocation(name)) {
      console.log(chalk.green(`Default location set to "${name}".`));
    } else {
      console.error(chalk.red(`Location "${name}" not found.`));
      process.exit(1);
    }
  });

const DAY_NAMES = {
  su: 0, sun: 0, sunday: 0,
  mo: 1, mon: 1, monday: 1,
  tu: 2, tue: 2, tuesday: 2,
  we: 3, wed: 3, wednesday: 3,
  th: 4, thu: 4, thursday: 4,
  fr: 5, fri: 5, friday: 5,
  sa: 6, sat: 6, saturday: 6,
};

function parseDate(input) {
  const s = input.trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (s === 'today') return dayjs().format('YYYY-MM-DD');
  if (s === 'tomorrow') return dayjs().add(1, 'day').format('YYYY-MM-DD');
  const targetDay = DAY_NAMES[s];
  if (targetDay != null) {
    let d = dayjs().day(targetDay);
    if (d.isBefore(dayjs(), 'day') || d.isSame(dayjs(), 'day')) d = d.add(7, 'day');
    return d.format('YYYY-MM-DD');
  }
  console.error(chalk.red(`Invalid date: "${input}". Use YYYY-MM-DD, a day name (thu, thursday), "today", or "tomorrow".`));
  process.exit(1);
}

function formatHour(h) {
  if (h === 0 || h === 24) return '12am';
  if (h === 12) return '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

function formatOpensAt(date) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = days[date.getDay()];
  const month = months[date.getMonth()];
  const d = date.getDate();
  const h = date.getHours();
  const m = date.getMinutes();
  const timeStr = formatHour(h) + (m > 0 ? `:${String(m).padStart(2, '0')}` : '');
  return `${day} ${month} ${d} at ${timeStr}`;
}

program.parse();
