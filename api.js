import { COURTS } from './courts.js';
import { distanceMiles } from './geo.js';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  'Origin': 'https://www.rec.us',
  'Referer': 'https://www.rec.us/',
  'Accept': 'application/json',
};

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

  // Build a map of court number -> slot duration + reservation window from location data
  const courtMeta = {};
  for (const c of loc.courts ?? []) {
    courtMeta[c.courtNumber] = {
      slotDuration: parseMinutes(c.maxReservationTime),
      windowDays: c.defaultReservationWindowDays ?? 7,
      releaseTime: c.reservationReleaseTimeLocal ?? '00:00:00',
    };
  }

  const todayCourts = schedRes.dates?.[dateKey] ?? [];
  const now = new Date();
  const courts = todayCourts.map((c) => {
    const meta = courtMeta[c.courtNumber] || { slotDuration: 60, windowDays: 7, releaseTime: '00:00:00' };

    // Check if the reservation window has opened for this court on the requested date
    const requestedDate = new Date(date + 'T00:00:00');
    const releaseDate = new Date(requestedDate);
    releaseDate.setDate(releaseDate.getDate() - meta.windowDays);
    const [rh, rm] = meta.releaseTime.split(':').map(Number);
    releaseDate.setHours(rh, rm, 0, 0);
    const windowOpen = now >= releaseDate;

    const available = [];
    const pendingSlots = [];
    const booked = [];
    for (const [range, info] of Object.entries(c.schedule ?? {})) {
      const [start, end] = range.split(',').map((s) => s.trim());
      if (info.referenceType === 'RESERVABLE') {
        const slots = splitIntoSlots(start, end, meta.slotDuration);
        if (windowOpen) {
          available.push(...slots);
        } else {
          pendingSlots.push(...slots);
        }
      } else if (info.referenceType === 'RESERVATION') {
        booked.push({ start, end });
      }
    }
    return {
      courtNumber: c.courtNumber,
      sports: c.sports?.map((s) => s.name),
      available,
      booked,
      pendingSlots,
      opensAt: !windowOpen && pendingSlots.length > 0 ? releaseDate : null,
    };
  });

  // Find the earliest opensAt across all courts at this location
  const opensAtDates = courts.map((c) => c.opensAt).filter(Boolean);
  const earliestOpensAt = opensAtDates.length > 0
    ? new Date(Math.min(...opensAtDates.map((d) => d.getTime())))
    : null;
  const totalPendingSlots = courts.reduce((n, c) => n + c.pendingSlots.length, 0);

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
    totalPendingSlots,
    opensAt: earliestOpensAt,
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

  // Filter by time range (overlap check)
  if (timeRange) {
    const [startHour, endHour] = timeRange;
    const timeFilter = (slot) => {
      const slotStart = parseHour(slot.start);
      const slotEnd = parseHour(slot.end);
      return slotStart != null && slotEnd != null && slotStart < endHour && slotEnd > startHour;
    };
    filtered = filtered.map((r) => {
      const courts = r.courts.map((c) => ({
        ...c,
        available: c.available.filter(timeFilter),
        pendingSlots: c.pendingSlots.filter(timeFilter),
      }));
      const totalPendingSlots = courts.reduce((n, c) => n + c.pendingSlots.length, 0);
      return {
        ...r,
        courts,
        totalAvailableSlots: courts.reduce((n, c) => n + c.available.length, 0),
        totalPendingSlots,
        opensAt: totalPendingSlots > 0 ? r.opensAt : null,
      };
    });
    // Remove locations with no availability AND no pending slots in the time range
    filtered = filtered.filter((r) => r.totalAvailableSlots > 0 || r.totalPendingSlots > 0);
  }

  // Sort by distance
  filtered.sort((a, b) => a.distance - b.distance);

  return { courts: filtered, errors: errors.length };
}

// Parse "18:00" -> 18
function parseHour(time) {
  const m = time?.match(/^(\d{1,2}):/);
  return m ? parseInt(m[1], 10) : null;
}

// Parse "01:30:00" -> 90 (minutes)
function parseMinutes(duration) {
  if (!duration) return 60;
  const [h, m] = duration.split(':').map(Number);
  return h * 60 + m;
}

// Convert "HH:MM" to total minutes from midnight
function timeToMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

// Convert total minutes to "HH:MM"
function minutesToTime(mins) {
  const h = String(Math.floor(mins / 60)).padStart(2, '0');
  const m = String(mins % 60).padStart(2, '0');
  return `${h}:${m}`;
}

// Split a RESERVABLE range into individual bookable slots
function splitIntoSlots(start, end, durationMins) {
  const startMins = timeToMinutes(start);
  const endMins = timeToMinutes(end);
  const slots = [];
  for (let t = startMins; t + durationMins <= endMins; t += durationMins) {
    slots.push({ start: minutesToTime(t), end: minutesToTime(t + durationMins) });
  }
  return slots;
}
