# sf-tennis-cli

CLI to find available tennis court times across all 27 SF Rec & Park courts. Fetches real-time availability from [rec.us](https://www.rec.us) and sorts by distance from your location.

## Setup

```bash
npm install
cp .env.example .env  # edit with your home coordinates
npm link              # optional: makes `tennis` available globally
```

### .env

Set your home location in `.env`:

```
TENNIS_HOME_LAT=37.7749
TENNIS_HOME_LNG=-122.4194
TENNIS_HOME_LABEL=Home
```

## Usage

```bash
tennis                          # courts near home, today
tennis -l current               # courts near your current IP location
tennis -l 37.78,-122.41         # courts near a custom lat/lng
tennis -m 1.5                   # only courts within 1.5 miles
tennis -r 9-17                  # only slots between 9am-5pm
tennis -d 2026-03-25            # check a specific date
tennis -m 2 -r 17-21            # evening slots within 2 miles
tennis --json                   # raw JSON output
```

### Options

| Flag | Description |
|------|-------------|
| `-d, --date <YYYY-MM-DD>` | Date to check (default: today) |
| `-l, --location <name>` | `home`, `current`, or `lat,lng` (default: home) |
| `-r, --range <start-end>` | Time range filter in 24h, e.g. `9-17` |
| `-m, --max-distance <miles>` | Max distance in miles |
| `--json` | Output raw JSON |

## Data Source

All court data comes from the [SF Rec & Park](https://www.rec.us) booking system API.
