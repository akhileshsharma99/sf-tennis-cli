import { COURTS } from './courts.js';
import { distanceMiles } from './geo.js';

const HEADERS = { 'User-Agent': 'sf-tennis-cli/1.0' };

// Resolve a court slug to its rec.us locationId by scraping the HTML
async function resolveLocationId(slug) {
  const res = await fetch(`https://www.rec.us/${slug}`, { headers: HEADERS });
  const html = await res.text();
  const match = html.match(/"locationId":"([^"]+)"/);
  return match?.[1] ?? null;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) return null;
  const text = await res.text();
  try { return JSON.parse(text); } catch { return null; }
}

// Fetch location details + schedule for a single court
async function fetchCourtData(court, date, refLat, refLng) {
  const locationId = await resolveLocationId(court.slug);
  if (!locationId) {
    return { ...court, error: 'Could not resolve locationId' };
  }

  const dateKey = date.replace(/-/g, '');
  const [locRes, schedRes] = await Promise.all([
    fetchJson(`https://api.rec.us/v1/locations/${locationId}?publishedSites=true`),
    fetchJson(`https://api.rec.us/v1/locations/${locationId}/schedule?startDate=${date}`),
  ]);

  if (!locRes || !schedRes) {
    return { ...court, error: 'API request failed' };
  }

  const loc = locRes.location ?? locRes;
  const lat = parseFloat(loc.lat);
  const lng = parseFloat(loc.lng);
  const dist = Math.round(distanceMiles(refLat, refLng, lat, lng) * 100) / 100;

  const todayCourts = schedRes.dates?.[dateKey] ?? [];
  const courts = todayCourts.map((c) => {
    const available = [];
    const booked = [];
    for (const [range, info] of Object.entries(c.schedule ?? {})) {
      if (info.referenceType === 'RESERVABLE') available.push(range);
      else if (info.referenceType === 'RESERVATION') booked.push(range);
    }
    return { courtNumber: c.courtNumber, sports: c.sports?.map((s) => s.name), available, booked };
  });

  return {
    name: court.name,
    slug: court.slug,
    locationId,
    address: loc.formattedAddress,
    lat,
    lng,
    distance: dist,
    url: `https://www.rec.us/${court.slug}`,
    courts,
    totalAvailableSlots: courts.reduce((n, c) => n + c.available.length, 0),
  };
}

// Fetch all courts, sorted by distance
export async function fetchAllCourts({ date, refLat, refLng, maxDistance, timeRange }) {
  const results = await Promise.all(
    COURTS.map((court) =>
      fetchCourtData(court, date, refLat, refLng).catch(() => ({ ...court, error: 'fetch failed' }))
    )
  );

  const errors = results.filter((r) => r.error);
  let filtered = results.filter((r) => !r.error);

  // Filter by max distance
  if (maxDistance != null) {
    filtered = filtered.filter((r) => r.distance <= maxDistance);
  }

  // Filter by time range
  if (timeRange) {
    const [startHour, endHour] = timeRange;
    filtered = filtered.map((r) => {
      const courts = r.courts.map((c) => ({
        ...c,
        available: c.available.filter((slot) => {
          const hour = parseSlotStartHour(slot);
          return hour != null && hour >= startHour && hour < endHour;
        }),
      }));
      return {
        ...r,
        courts,
        totalAvailableSlots: courts.reduce((n, c) => n + c.available.length, 0),
      };
    });
    // Remove courts with no availability in the time range
    filtered = filtered.filter((r) => r.totalAvailableSlots > 0);
  }

  // Sort by distance
  filtered.sort((a, b) => a.distance - b.distance);

  return { courts: filtered, errors: errors.length };
}

// Parse "7:00am-8:00am" -> 7, "2:00pm-3:00pm" -> 14
function parseSlotStartHour(slot) {
  const match = slot.match(/^(\d{1,2}):(\d{2})(am|pm)/i);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const period = match[3].toLowerCase();
  if (period === 'pm' && hour !== 12) hour += 12;
  if (period === 'am' && hour === 12) hour = 0;
  return hour;
}
