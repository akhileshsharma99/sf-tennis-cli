#!/usr/bin/env bun

// Notification script for GitHub Actions.
// Imports shared code from src/ — zero extra npm dependencies.

process.env.TZ = 'America/Los_Angeles';

import {
  COURTS, distanceMiles,
  resolveLocationId, fetchJson,
  parseMinutes, parseHour, splitIntoSlots,
} from './src/api.js';

// --- Config from env ---
const HOME_LAT = parseFloat(process.env.HOME_LAT);
const HOME_LNG = parseFloat(process.env.HOME_LNG);
const NTFY_TOPIC = process.env.NTFY_TOPIC;
const MAX_DISTANCE = parseFloat(process.env.MAX_DISTANCE || '2');
const PREF_DAYS = (process.env.PREF_DAYS || '2,4').split(',').map(Number); // 0=Sun, 2=Tue, 4=Thu
const PREF_START = parseInt(process.env.PREF_START_HOUR || '17');
const PREF_END = parseInt(process.env.PREF_END_HOUR || '19');
const WINDOW_ALERT_MINS = 20;

if (!HOME_LAT || !HOME_LNG || !NTFY_TOPIC) {
  console.error('Missing required env vars: HOME_LAT, HOME_LNG, NTFY_TOPIC');
  process.exit(1);
}

// --- Helpers ---
function slotOverlaps(slot) {
  const s = parseHour(slot.start);
  const e = parseHour(slot.end);
  return s != null && e != null && s < PREF_END && e > PREF_START;
}

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDateShort(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}`;
}

function getTargetDates() {
  const dates = [];
  const today = new Date();
  for (let i = 0; i <= 10; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    if (PREF_DAYS.includes(d.getDay())) {
      dates.push(formatDate(d));
    }
  }
  return dates;
}

// --- ntfy ---
async function notify({ title, body, tags, priority, click, idempotencyKey }) {
  const headers = {
    'Title': title,
    'Tags': tags,
    'Priority': priority || 'default',
    'Click': click,
  };
  if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;

  const res = await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
    method: 'POST',
    headers,
    body,
  });
  const status = res.ok ? 'sent' : `failed (${res.status})`;
  console.log(`  [${status}] ${title}: ${body}`);
}

// --- Core logic ---
async function checkCourt(court, dates) {
  const notifications = [];

  const locationId = await resolveLocationId(court.slug);
  if (!locationId) return notifications;

  const locRes = await fetchJson(`https://api.rec.us/v1/locations/${locationId}?publishedSites=true`);
  if (!locRes) return notifications;

  const loc = locRes.location ?? locRes;
  const lat = parseFloat(loc.lat);
  const lng = parseFloat(loc.lng);
  const dist = Math.round(distanceMiles(HOME_LAT, HOME_LNG, lat, lng) * 100) / 100;
  if (dist > MAX_DISTANCE) return notifications;

  const courtMeta = {};
  for (const c of loc.courts ?? []) {
    courtMeta[c.courtNumber] = {
      slotDuration: parseMinutes(c.maxReservationTime),
      windowDays: c.defaultReservationWindowDays ?? 7,
      releaseTime: c.reservationReleaseTimeLocal ?? '00:00:00',
    };
  }

  const now = new Date();

  for (const date of dates) {
    const dateKey = date.replace(/-/g, '');
    const schedRes = await fetchJson(`https://api.rec.us/v1/locations/${locationId}/schedule?startDate=${date}`);
    if (!schedRes) continue;

    const dayCourts = schedRes.dates?.[dateKey] ?? [];
    for (const c of dayCourts) {
      const meta = courtMeta[c.courtNumber] || { slotDuration: 60, windowDays: 7, releaseTime: '00:00:00' };

      const requestedDate = new Date(date + 'T00:00:00');
      const releaseDate = new Date(requestedDate);
      releaseDate.setDate(releaseDate.getDate() - meta.windowDays);
      const [rh, rm] = meta.releaseTime.split(':').map(Number);
      releaseDate.setHours(rh, rm, 0, 0);

      const windowOpen = now >= releaseDate;
      const minsUntilOpen = (releaseDate.getTime() - now.getTime()) / 60000;
      const windowOpeningSoon = !windowOpen && minsUntilOpen > 0 && minsUntilOpen <= WINDOW_ALERT_MINS;

      const slots = [];
      for (const [range, info] of Object.entries(c.schedule ?? {})) {
        const [start, end] = range.split(',').map((s) => s.trim());
        if (info.referenceType === 'RESERVABLE') {
          slots.push(...splitIntoSlots(start, end, meta.slotDuration));
        }
      }

      const matchingSlots = slots.filter(slotOverlaps);
      if (matchingSlots.length === 0) continue;

      const dateLabel = formatDateShort(date);
      const timesStr = matchingSlots.map((s) => `${s.start}-${s.end}`).join(', ');
      const distStr = `${dist} mi`;

      if (windowOpeningSoon) {
        const minsLeft = Math.round(minsUntilOpen);
        notifications.push({
          title: `${court.name} opens in ${minsLeft} min!`,
          body: `${c.courtNumber}: ${timesStr} on ${dateLabel} (${distStr})`,
          tags: 'alarm_clock,tennis',
          priority: 'urgent',
          click: `https://www.rec.us/${court.slug}`,
          idempotencyKey: `${court.slug}:${c.courtNumber}:${date}:window`,
        });
      } else if (windowOpen) {
        for (const slot of matchingSlots) {
          notifications.push({
            title: `${court.name} - ${dateLabel}`,
            body: `${c.courtNumber}: ${slot.start}-${slot.end} available (${distStr})`,
            tags: 'tennis',
            priority: 'default',
            click: `https://www.rec.us/${court.slug}`,
            idempotencyKey: `${court.slug}:${c.courtNumber}:${date}:${slot.start}`,
          });
        }
      }
    }
  }

  return notifications;
}

async function main() {
  const dates = getTargetDates();
  if (dates.length === 0) {
    console.log('No target dates in the next 10 days.');
    return;
  }
  console.log(`Checking ${COURTS.length} locations for ${dates.map(formatDateShort).join(', ')}...`);
  console.log(`Preferences: ${PREF_START}:00-${PREF_END}:00, within ${MAX_DISTANCE} mi\n`);

  const notifications = [];

  for (let i = 0; i < COURTS.length; i += 5) {
    const batch = COURTS.slice(i, i + 5);
    const results = await Promise.all(
      batch.map((c) => checkCourt(c, dates).catch((e) => {
        console.warn(`  [error] ${c.name}: ${e.message}`);
        return [];
      }))
    );
    notifications.push(...results.flat());
  }

  if (notifications.length === 0) {
    console.log('No notifications to send.');
    return;
  }

  console.log(`\nSending ${notifications.length} notification(s)...`);
  await Promise.all(notifications.map(notify));
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
