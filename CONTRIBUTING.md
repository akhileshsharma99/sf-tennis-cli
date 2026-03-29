# Contributing

## Setup

```bash
bun install
bun link  # makes `tennis` available globally
```

## Project Structure

```
├── cli.js              CLI entry point
├── notify.js           GitHub Actions notification script
├── src/
│   ├── api.js          rec.us API client + shared helpers
│   ├── courts.js       List of all 27 SF Rec & Park courts
│   ├── geo.js          Haversine distance + geocoding
│   └── locations.js    Saved location management
├── .github/workflows/
│   └── notify.yml      Cron notification workflow
└── locations.json      User's saved locations (gitignored)
```

## Adding a Court

If SF Rec & Park adds a new reservable court, add it to `src/courts.js`:

```js
{ slug: 'newcourt', name: 'New Court Name' },
```

The slug is the path on rec.us (e.g., `rec.us/newcourt`).

## How the API Works

1. **Resolve location ID** — scrape `rec.us/{slug}` HTML for the `locationId`
2. **Fetch location data** — `api.rec.us/v1/locations/{id}?publishedSites=true` returns court metadata (slot durations, booking windows)
3. **Fetch schedule** — `api.rec.us/v1/locations/{id}/schedule?startDate=YYYY-MM-DD` returns per-court availability with `RESERVABLE` and `RESERVATION` entries
4. **Reservation windows** — each court has `defaultReservationWindowDays` and `reservationReleaseTimeLocal` controlling when slots become bookable

## Testing

```bash
# CLI
tennis -d tomorrow -r 9-17
tennis -d tuesday -r 17-19 --json

# Notifications (local test)
HOME_LAT=37.7793 HOME_LNG=-122.4193 NTFY_TOPIC=test bun notify.js
```

## Shared Code

`src/api.js` exports helpers used by both `cli.js` and `notify.js`:
- `buildCourtMeta()` — parses court slot durations and booking windows
- `computeReleaseDate()` — calculates when a court's booking window opens
- `parseReservableSlots()` — extracts bookable time slots from schedule data
- `resolveLocationId()` / `fetchJson()` — API fetching with caching

If you're adding logic that touches court availability, use these instead of reimplementing.
