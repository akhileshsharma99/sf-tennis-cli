# Contributing

## Setup

```bash
bun install
bun link  # makes `tennis`, `pickleball`, and `courts` available globally
```

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
