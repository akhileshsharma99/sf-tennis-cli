#!/usr/bin/env bun

import chalk from "chalk";
import { program } from "commander";
import dayjs from "dayjs";
import pkg from "./package.json";
import type { WalkUpResult } from "./src/api";
import { fetchAllCourts, fetchWalkUpSpots } from "./src/api";
import { formatDateLabel } from "./src/format";
import type { Coords } from "./src/geo";
import { getCurrentLocation } from "./src/geo";
import {
	addLocation,
	getDefaultLocation,
	getLocation,
	listLocations,
	removeLocation,
	setDefaultLocation,
} from "./src/locations";
import type { Sport } from "./src/sports";
import { parseSports, sportLabel } from "./src/sports";

interface CliOptions {
	date?: string;
	location?: string;
	range?: string;
	sport?: string;
	maxDistance?: number;
	json?: boolean;
}

// The `pickleball` and `courts` entry points set this; bare `tennis` doesn't
const DEFAULT_SPORT = process.env.SF_DEFAULT_SPORT || "tennis";
const DEFAULT_SPORTS = parseSports(DEFAULT_SPORT) ?? ["tennis"];
// Which name we were invoked as, so help text and hints match
const BIN =
	DEFAULT_SPORT === "all" ? "courts" : (DEFAULT_SPORTS[0] ?? "tennis");

program
	.name(BIN)
	.version(pkg.version)
	.description("Find available SF tennis and pickleball court times near you")
	.option(
		"-d, --date <date>",
		'date: YYYY-MM-DD, day name (thursday, th), "tomorrow", "today" (default: today)',
	)
	.option(
		"-l, --location <name>",
		'saved location name, "current", or "lat,lng" (default: your default location)',
	)
	.option(
		"-r, --range <start-end>",
		'time range filter, e.g. "9-17" for 9am-5pm',
	)
	.option(
		"-s, --sport <sport>",
		`tennis, pickleball, or all (default: ${DEFAULT_SPORTS.join(",")})`,
	)
	.option("-m, --max-distance <miles>", "max distance in miles", parseFloat)
	.option("--json", "output raw JSON")
	.action(async (opts: CliOptions) => {
		const date = opts.date
			? parseDate(opts.date)
			: dayjs().format("YYYY-MM-DD");

		let ref: Coords;
		let refLabel: string;
		const locStr = opts.location?.toLowerCase();

		if (!locStr) {
			const def = getDefaultLocation();
			if (!def || def.lat == null || def.lng == null) {
				console.error(chalk.red("No default location set."));
				console.error(
					chalk.dim(`Add one with: ${BIN} location add <name> "<address>"`),
				);
				process.exit(1);
			}
			ref = { lat: def.lat, lng: def.lng };
			refLabel = `${def.name} (${def.address})`;
		} else if (locStr === "current") {
			process.stdout.write(chalk.dim("Getting current location... "));
			const loc = await getCurrentLocation();
			if (!loc) {
				console.error(chalk.red("Could not determine current location"));
				process.exit(1);
			}
			ref = { lat: loc.lat, lng: loc.lng };
			refLabel = loc.label;
			console.log(chalk.dim(refLabel));
		} else if (
			locStr.includes(",") &&
			locStr.split(",").every((s) => !Number.isNaN(parseFloat(s)))
		) {
			const [lat, lng] = locStr.split(",").map(Number);
			ref = { lat, lng };
			refLabel = `${lat}, ${lng}`;
		} else {
			const loc = await getLocation(locStr);
			if (!loc || loc.lat == null || loc.lng == null) {
				console.error(chalk.red(`Unknown location: "${locStr}".`));
				console.error(
					chalk.dim(`Add it with: ${BIN} location add <name> "<address>"`),
				);
				console.error(chalk.dim("Or use: -l current, -l lat,lng"));
				process.exit(1);
			}
			ref = { lat: loc.lat, lng: loc.lng };
			refLabel = `${loc.name} (${loc.address})`;
		}

		let sports: Sport[] = DEFAULT_SPORTS;
		if (opts.sport) {
			const parsed = parseSports(opts.sport);
			if (!parsed) {
				console.error(
					chalk.red(
						`Invalid sport: "${opts.sport}". Use tennis, pickleball, or all.`,
					),
				);
				process.exit(1);
			}
			sports = parsed;
		}

		let timeRange: [number, number] | null = null;
		if (opts.range) {
			const parts = opts.range.split("-").map(Number);
			if (
				parts.length === 2 &&
				!Number.isNaN(parts[0]) &&
				!Number.isNaN(parts[1])
			) {
				timeRange = parts as [number, number];
			} else {
				console.error(
					chalk.red('Invalid time range. Use format: "9-17" (9am to 5pm)'),
				);
				process.exit(1);
			}
		}

		const heading =
			sports.length === 1 ? `${sportLabel(sports[0])} Courts` : "Courts";
		console.log(chalk.bold(`\n${heading} — ${date}`));
		console.log(chalk.dim(`From: ${refLabel}`));
		if (opts.maxDistance)
			console.log(chalk.dim(`Within: ${opts.maxDistance} mi`));
		if (timeRange)
			console.log(
				chalk.dim(
					`Time: ${formatHour(timeRange[0])}–${formatHour(timeRange[1])}`,
				),
			);
		console.log();

		process.stdout.write(chalk.dim("Fetching court data..."));
		const { courts: results, errors } = await fetchAllCourts({
			date,
			ref,
			sports,
			maxDistance: opts.maxDistance,
			timeRange,
		});
		process.stdout.write(`\r${" ".repeat(30)}\r`);

		if (errors > 0) {
			console.log(chalk.yellow(`${errors} court(s) failed to load.`));
		}

		// Walk-up courts have no schedule to check — it's directory data
		const walkUps = await fetchWalkUpSpots(ref, sports, opts.maxDistance);

		if (opts.json) {
			console.log(JSON.stringify({ courts: results, walkUps }, null, 2));
			return;
		}

		if (results.length === 0) {
			console.log(chalk.yellow("No courts found with available slots."));
			printWalkUps(walkUps, sports);
			return;
		}

		for (const r of results) {
			const distStr = chalk.dim(`${r.distance} mi`);
			const slotsStr =
				r.totalAvailableSlots > 0
					? chalk.green(`${r.totalAvailableSlots} slots`)
					: chalk.red("no slots");

			const walkUpCourts = sports.reduce(
				(n, s) => n + (r.walkUp?.[s]?.courts ?? 0),
				0,
			);
			const walkUpStr = walkUpCourts
				? chalk.dim(`  +${walkUpCourts} walk-up`)
				: "";

			const link = `\x1b]8;;${r.url}\x1b\\${r.name}\x1b]8;;\x1b\\`;
			console.log(`${chalk.bold(link)} ${distStr} — ${slotsStr}${walkUpStr}`);
			console.log(chalk.dim(`  ${r.address} · ${r.url}`));
			for (const s of sports) {
				const openPlay = r.walkUp?.[s]?.openPlay;
				if (openPlay) console.log(chalk.dim(`  Open play: ${openPlay}`));
			}

			const sportRank = (s: Sport | null): number =>
				s ? sports.indexOf(s) : sports.length;
			const shown = r.courts
				.filter((c) => c.available.length > 0 || c.pendingSlots.length > 0)
				.sort((a, b) => sportRank(a.sport) - sportRank(b.sport));
			// Only label sports when this location contributes more than one
			const groupBySport =
				new Set(shown.map((c) => c.sport ?? "other")).size > 1;
			let lastSport: string | null = null;
			const indent = groupBySport ? "    " : "  ";

			for (const court of shown) {
				if (groupBySport && court.sport !== lastSport) {
					lastSport = court.sport;
					console.log(
						chalk.cyan(`  ${court.sport ? sportLabel(court.sport) : "Other"}`),
					);
				}
				if (court.available.length > 0) {
					const times = court.available
						.map((s) => chalk.green(`${s.start}–${s.end}`))
						.join(", ");
					console.log(`${indent}${court.courtNumber}: ${times}`);
				}
				if (court.pendingSlots.length > 0 && court.opensAt) {
					const opensStr = formatOpensAt(court.opensAt);
					const pendingTimes = court.pendingSlots
						.map((s) => `${s.start}–${s.end}`)
						.join(", ");
					console.log(
						chalk.yellow(
							`${indent}${court.courtNumber}: ${pendingTimes} (opens ${opensStr})`,
						),
					);
				}
			}
			console.log();
		}

		printWalkUps(walkUps, sports);

		console.log(
			chalk.dim(`${results.length} courts shown. Book at https://www.rec.us`),
		);
	});

function printWalkUps(spots: WalkUpResult[], sports: Sport[]): void {
	if (spots.length === 0) return;
	const what = sports.length === 1 ? sports[0] : "courts";
	console.log(chalk.bold(`Walk-up ${what} — no booking`));

	const width = Math.max(...spots.map((s) => s.name.length));
	for (const s of spots) {
		const dist = s.distance != null ? `${s.distance} mi` : "—";
		// With both sports in scope, say which courts are which
		const counts = sports
			.filter((sport) => s.walkUp[sport]?.courts)
			.map((sport) => {
				const n = s.walkUp[sport]?.courts ?? 0;
				const noun = `court${n === 1 ? "" : "s"}`;
				return sports.length === 1
					? `${n} ${noun}`
					: `${n} ${sportLabel(sport).toLowerCase()} ${noun}`;
			});
		const link = s.url
			? `\x1b]8;;${s.url}\x1b\\${s.name}\x1b]8;;\x1b\\`
			: s.name;
		console.log(
			`  ${link}${" ".repeat(width - s.name.length)}  ${chalk.dim(dist.padStart(7))}  ${counts.join(", ") || "open play only"}`,
		);
		for (const sport of sports) {
			const openPlay = s.walkUp[sport]?.openPlay;
			if (openPlay)
				console.log(
					chalk.dim(`  ${" ".repeat(width)}  Open play: ${openPlay}`),
				);
		}
	}
	console.log();
}

const loc = program.command("location").description("Manage saved locations");

loc
	.command("add <name> <address>")
	.description("Add a named location (geocodes the address automatically)")
	.action(async (name: string, address: string) => {
		const result = await addLocation(name, address);
		if (result) {
			console.log(chalk.green(`Saved "${name}" → ${result.address}`));
		} else {
			console.error(
				chalk.red("Could not geocode that address. Try a more specific one."),
			);
			process.exit(1);
		}
	});

loc
	.command("remove <name>")
	.description("Remove a saved location")
	.action((name: string) => {
		if (removeLocation(name)) {
			console.log(chalk.green(`Removed "${name}".`));
		} else {
			console.error(chalk.red(`Location "${name}" not found.`));
			process.exit(1);
		}
	});

loc
	.command("list")
	.description("List all saved locations")
	.action(() => {
		const locs = listLocations();
		if (locs.length === 0) {
			console.log(
				chalk.dim(
					`No saved locations. Add one with: ${BIN} location add <name> "<address>"`,
				),
			);
			return;
		}
		for (const l of locs) {
			const def = l.default ? chalk.cyan(" (default)") : "";
			console.log(`  ${chalk.bold(l.name)}: ${l.address}${def}`);
		}
	});

loc
	.command("default <name>")
	.description("Set a location as the default")
	.action((name: string) => {
		if (setDefaultLocation(name)) {
			console.log(chalk.green(`Default location set to "${name}".`));
		} else {
			console.error(chalk.red(`Location "${name}" not found.`));
			process.exit(1);
		}
	});

const DAY_NAMES: Record<string, number> = {
	su: 0,
	sun: 0,
	sunday: 0,
	mo: 1,
	mon: 1,
	monday: 1,
	tu: 2,
	tue: 2,
	tuesday: 2,
	we: 3,
	wed: 3,
	wednesday: 3,
	th: 4,
	thu: 4,
	thursday: 4,
	fr: 5,
	fri: 5,
	friday: 5,
	sa: 6,
	sat: 6,
	saturday: 6,
};

function parseDate(input: string): string {
	const s = input.trim().toLowerCase();
	if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
	if (s === "today") return dayjs().format("YYYY-MM-DD");
	if (s === "tomorrow") return dayjs().add(1, "day").format("YYYY-MM-DD");
	const targetDay = DAY_NAMES[s];
	if (targetDay != null) {
		let d = dayjs().day(targetDay);
		if (d.isBefore(dayjs(), "day") || d.isSame(dayjs(), "day"))
			d = d.add(7, "day");
		return d.format("YYYY-MM-DD");
	}
	console.error(
		chalk.red(
			`Invalid date: "${input}". Use YYYY-MM-DD, a day name (thu, thursday), "today", or "tomorrow".`,
		),
	);
	process.exit(1);
}

function formatHour(h: number): string {
	if (h === 0 || h === 24) return "12am";
	if (h === 12) return "12pm";
	return h < 12 ? `${h}am` : `${h - 12}pm`;
}

function formatOpensAt(date: Date): string {
	const label = formatDateLabel(date);
	const h = date.getHours();
	const m = date.getMinutes();
	const timeStr =
		formatHour(h) + (m > 0 ? `:${String(m).padStart(2, "0")}` : "");
	return `${label} at ${timeStr}`;
}

program.parse();
