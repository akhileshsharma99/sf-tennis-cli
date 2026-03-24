# sf-tennis-cli

CLI to find available tennis court times across all 27 SF Rec & Park courts. Fetches real-time availability from [rec.us](https://www.rec.us) and sorts by distance from your location.

## Setup

```bash
bun install
bun link  # makes `tennis` available globally
```

### Add your locations

```bash
tennis location add home "1 Dr Carlton B Goodlett Pl, San Francisco, CA"
tennis location add work "123 Main St, San Francisco, CA"
tennis location add gym "1 Fitness Way, San Francisco, CA"
```

Addresses are automatically geocoded via the US Census Bureau API (free, no key needed). Coordinates are cached in `locations.json` (gitignored).

## Usage

```bash
tennis                          # courts near your default location, today
tennis -l work                  # courts near your "work" location
tennis -l current               # courts near your current IP location
tennis -m 1.5                   # only courts within 1.5 miles
tennis -r 9-17                  # only slots between 9am-5pm
tennis -d 2026-03-25            # check a specific date
tennis -m 2 -r 17-21            # evening slots within 2 miles
tennis --json                   # raw JSON output
```

### Manage locations

```bash
tennis location list            # show all saved locations
tennis location add <name> "<address>"
tennis location remove <name>
tennis location default <name>  # set default locationok 
```

### Options


| Flag                         | Description                                                       |
| ---------------------------- | ----------------------------------------------------------------- |
| `-d, --date <YYYY-MM-DD>`    | Date to check (default: today)                                    |
| `-l, --location <name>`      | Saved location name or `current` (default: your default location) |
| `-r, --range <start-end>`    | Time range filter in 24h, e.g. `9-17`                             |
| `-m, --max-distance <miles>` | Max distance in miles                                             |
| `--json`                     | Output raw JSON                                                   |


## Data Source

All court data comes from the [SF Rec & Park](https://www.rec.us) booking system API. Addresses are geocoded via the [US Census Bureau Geocoder](https://geocoding.geo.census.gov/).