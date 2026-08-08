# Contributing

## Setup

```bash
bun install
bun link  # symlinks `tennis`, `pickleball`, and `courts` into ~/.bun/bin
```

`bun link` prints "To use sf-tennis-cli in a project, run: bun link sf-tennis-cli"
— ignore that, it's for consuming this as a dependency. The global bins are
already live, and because they symlink straight into this checkout, edits take
effect with no rebuild.

If a release was previously installed with `install.sh`, its compiled binary at
`/usr/local/bin/tennis` answers to the same name and can't be told apart by
version — it goes stale silently, and a shell that hashed it before the symlink
existed keeps using it. That looks exactly like `bun link` having failed.

`--version` reports which install is actually running and warns about any others
on PATH:

```
$ tennis --version
1.1.1 (from source)
  running: /Users/you/repos/sf-tennis-cli/cli.ts

  warning: 1 other install(s) of this CLI on PATH:
    /usr/local/bin/tennis
  a stale one can shadow this in shells that already hashed it — run `hash -r`
```

`install.sh` also refuses to install over a different existing `tennis` without
confirmation, so the two shouldn't coexist by accident.

## Project Structure

```
├── cli.ts              CLI entry point
├── bin/                Alias entry points that set SF_DEFAULT_SPORT
│   ├── pickleball.ts
│   └── courts.ts
├── notify.ts           GitHub Actions notification script
├── src/
│   ├── api.ts          rec.us API client + shared helpers
│   ├── courts.ts       Court list (fetched from sfrecpark.org, with fallback)
│   ├── fs-utils.ts     readJson/writeJson utilities
│   ├── geo.ts          Haversine distance + geocoding
│   ├── locations.ts    Saved location management
│   └── sports.ts       Sport union + parsing
├── .github/workflows/
│   └── notify.yml      Cron notification workflow
└── (user data)         ~/.config/sf-tennis-cli/locations.json
```

## Court List

The court list is fetched dynamically at runtime from two sfrecpark.org pages and merged by slug, so new courts are picked up automatically:

- [Tennis Court Directory](https://sfrecpark.org/1446/Reservable-Tennis-Courts) — aria-label links, parsed by `parseCourtsFromHtml`
- [Pickleball Court Directory](https://sfrecpark.org/1772/Pickleball-Court-Directory) — an HTML table, parsed by `parseCourtsFromTable`

These tags are only used to skip locations that can't have the requested sport. The authoritative per-court sport comes from the schedule API's `sports[].name`. If the pickleball page fails to load, the run degrades to tennis-only rather than erroring.

The pickleball table also carries walk-up play, in two columns: `Walk-up shared use` (a court count) and `Dedicated open play` (either a court count or free-text hours — numeric values are added to the court count, prose is shown verbatim). Rows with walk-up play but no rec.us link become `WalkUpSpot`s; since they aren't on rec.us, their coordinates are scraped from the `Latitude`/`Longitude` pair embedded in their sfrecpark.org facility page and cached with the court list.

## How the API Works

1. **Resolve location ID** — scrape `rec.us/{slug}` HTML/RSC for the location UUID (og:url or escaped `locationId`)
2. **Fetch location data** — `api.rec.us/v1/locations/{id}?publishedSites=true` returns court metadata (slot durations, booking windows)
3. **Fetch schedule** — `api.rec.us/v1/locations/{id}/schedule?startDate=YYYY-MM-DD` returns per-court availability with `RESERVABLE` and `RESERVATION` entries
4. **Reservation windows** — each court has `defaultReservationWindowDays` and `reservationReleaseTimeLocal` controlling when slots become bookable

## Testing

```bash
# CLI
tennis -d tomorrow -r 9-17
tennis -d tuesday -r 17-19 --json

# Notifications (local test)
HOME_LAT=37.7793 HOME_LNG=-122.4193 NTFY_TOPIC=test bun notify.ts
```

## Shared Code

`src/api.ts` exports helpers used by both `cli.ts` and `notify.ts`:
- `buildCourtMeta()` — parses court slot durations and booking windows
- `computeReleaseDate()` — calculates when a court's booking window opens
- `parseReservableSlots()` — extracts bookable time slots from schedule data
- `resolveLocationId()` / `fetchJson()` — API fetching with caching

If you're adding logic that touches court availability, use these instead of reimplementing.
