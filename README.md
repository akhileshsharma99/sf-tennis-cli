# SF Rec & Park Court Availability CLI

CLI to find available tennis and pickleball court times across all 28 SF Rec & Park locations. Fetches real-time availability from [rec.us](https://www.rec.us) and sorts by distance from your location. Optionally, get push notifications via [ntfy.sh](https://ntfy.sh) when courts matching your day/time/distance preferences open up — runs on GitHub Actions every 15 minutes.

Installs three names for the same tool, differing only in which sport they default to:

| Command      | Default sport            |
| ------------ | ------------------------ |
| `tennis`     | tennis                   |
| `pickleball` | pickleball               |
| `courts`     | both, grouped by sport   |

`--sport` overrides the default on any of them.

## Install

Shell (Mac, Linux):

```sh
curl -fsSL https://raw.githubusercontent.com/akhileshsharma99/sf-tennis-cli/main/install.sh | sh
```

Build from source ([Bun](https://bun.sh)):

```sh
bun install && bun link
```

### Add your locations

```bash
tennis location add home "1 Dr Carlton B Goodlett Pl, San Francisco, CA"
tennis location add work "123 Main St, San Francisco, CA"
tennis location add gym "1 Fitness Way, San Francisco, CA"
```

Addresses are automatically geocoded via the US Census Bureau API (free, no key needed). Coordinates are saved to `~/.config/sf-tennis-cli/locations.json`.


## Usage

```bash
tennis                          # tennis courts near your default location, today
pickleball                      # pickleball courts, same defaults
courts                          # both sports, grouped by sport
tennis -l work                  # courts near your "work" location
tennis -l current               # courts near your current IP location
tennis -m 1.5                   # only courts within 1.5 miles
tennis -r 9-17                  # only slots between 9am-5pm
tennis -d 2026-03-25            # check a specific date
tennis -m 2 -r 17-21            # evening slots within 2 miles
tennis -s pickleball            # override the default sport
courts -s tennis                # ...in either direction
tennis --json                   # raw JSON output
```

Locations that only have one of the two sports print a flat court list; where a
location offers both, courts are grouped under a `Tennis` / `Pickleball` heading.

### Walk-up courts

Output ends with the courts you can just turn up and play — first-come-first-served
or dedicated open play, no booking. Both directories list these: 38 parks in all,
far more than the 28 you can book. Bookable locations that also have walk-up courts
show a `+N walk-up` note, and any open-play hours are printed verbatim.

```
Joe DiMaggio  0.7 mi — no slots  +2 walk-up

Walk-up courts — no booking
  Alta Plaza             0.78 mi  3 tennis courts, 2 pickleball courts
  Willie "Woo Woo" Wong  0.94 mi  1 pickleball court
  Margaret S. Hayward    1.21 mi  2 tennis courts
```

These parks aren't on rec.us, so there's no availability to check and nothing to
notify on. Coordinates are scraped from each park's sfrecpark.org facility page
on first use and cached in `coords.json`; the notifier never triggers that work.
`--max-distance` applies to walk-ups too — worth using, since the full list is long.

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
| `-s, --sport <sport>`        | `tennis`, `pickleball`, or `all` (default: depends on the command) |
| `-m, --max-distance <miles>` | Max distance in miles                                             |
| `--json`                     | Output raw JSON: `{ courts, walkUps }`                            |


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
| `SPORTS` | `all` | `tennis`, `pickleball`, `all`, or a comma list |
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
- **Failure alerts**: If any location fails to load (or the run crashes), you get one notification listing every failure, at most once every 6 hours — so a broken scraper doesn't fail silently

## Data Source

All court data comes from the [SF Rec & Park](https://www.rec.us) booking system API. The location list is scraped from the [Tennis Court Directory](https://sfrecpark.org/1446/Reservable-Tennis-Courts) and [Pickleball Court Directory](https://sfrecpark.org/1772/Pickleball-Court-Directory) (cached 24h); the sport of each individual court comes from the rec.us schedule API. Addresses are geocoded via the [US Census Bureau Geocoder](https://geocoding.geo.census.gov/).
