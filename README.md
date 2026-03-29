# SF Rec & Park Tennis Availability CLI

CLI to find available tennis court times across all 27 SF Rec & Park courts. Fetches real-time availability from [rec.us](https://www.rec.us) and sorts by distance from your location. Optionally, get push notifications via [ntfy.sh](https://ntfy.sh) when courts matching your day/time/distance preferences open up — runs on GitHub Actions every 15 minutes.

## Install

### Pre-built binary (no dependencies)

```bash
# macOS (Apple Silicon)
curl -fSL https://github.com/akhileshsharma99/sf-tennis-cli/releases/latest/download/tennis-darwin-arm64 -o tennis
chmod +x tennis && sudo mv tennis /usr/local/bin/

# macOS (Intel)
curl -fSL https://github.com/akhileshsharma99/sf-tennis-cli/releases/latest/download/tennis-darwin-x64 -o tennis
chmod +x tennis && sudo mv tennis /usr/local/bin/

# Linux (x64)
curl -fSL https://github.com/akhileshsharma99/sf-tennis-cli/releases/latest/download/tennis-linux-x64 -o tennis
chmod +x tennis && sudo mv tennis /usr/local/bin/
```

### From source (requires [Bun](https://bun.sh))

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
tennis location default <name>  # set default location
```

### Options


| Flag                         | Description                                                       |
| ---------------------------- | ----------------------------------------------------------------- |
| `-d, --date <YYYY-MM-DD>`    | Date to check (default: today)                                    |
| `-l, --location <name>`      | Saved location name or `current` (default: your default location) |
| `-r, --range <start-end>`    | Time range filter in 24h, e.g. `9-17`                             |
| `-m, --max-distance <miles>` | Max distance in miles                                             |
| `--json`                     | Output raw JSON                                                   |


## Notifications

Get push notifications when courts matching your preferences become available, powered by GitHub Actions and [ntfy.sh](https://ntfy.sh).

### Setup

1. Install the [ntfy app](https://ntfy.sh) on your phone
2. Pick a random topic name and subscribe to it in the app
3. Set secrets as GitHub Actions secrets (Settings > Secrets and variables > Actions) and/or in a local `.env` file (see `.env.example`):

```bash
# GitHub Actions
gh secret set HOME_LAT      # your latitude
gh secret set HOME_LNG      # your longitude
gh secret set NTFY_TOPIC    # your ntfy topic name

# Local testing
cp .env.example .env         # then fill in values
bun notify.ts                # run locally
```

4. Optionally set variables for preferences (or use defaults):

| Variable | Default | Description |
|---|---|---|
| `MAX_DISTANCE` | `2` | Miles radius from home |
| `PREF_DAYS` | `2,4` | Days of week (0=Sun, 1=Mon, 2=Tue, ..., 6=Sat) |
| `PREF_START_HOUR` | `17` | Start of preferred time window (24h) |
| `PREF_END_HOUR` | `19` | End of preferred time window (24h) |

5. The workflow runs every 15 minutes automatically. Test with:

```bash
gh workflow run notify.yml
```

### How it works

- **Window opening alerts** (urgent): Notifies when a court's booking window opens within the next 20 minutes, so you can race to book
- **Available slot alerts**: Notifies when open slots match your day/time/distance preferences (catches cancellations), batched by day and location
- Deduplication via local cache (24h TTL) — each slot only notifies once

## Data Source

All court data comes from the [SF Rec & Park](https://www.rec.us) booking system API. Addresses are geocoded via the [US Census Bureau Geocoder](https://geocoding.geo.census.gov/).