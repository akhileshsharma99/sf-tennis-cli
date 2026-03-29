const SFRECPARK_URL = 'https://sfrecpark.org/1446/Reservable-Tennis-Courts';

let _cached = null;

async function fetchCourtsFromSFRecPark() {
  const res = await fetch(SFRECPARK_URL);
  if (!res.ok) throw new Error(`sfrecpark.org returned ${res.status}`);
  const html = await res.text();

  const seen = new Map();
  const regex = /href="https?:\/\/(?:www\.)?rec\.us\/([a-z0-9-]+)"[^>]*>([^<]+)/gi;
  for (const match of html.matchAll(regex)) {
    const slug = match[1].toLowerCase();
    if (seen.has(slug)) continue;
    const name = match[2].trim().replace(/\s*Tennis\s*Court.*$/i, '').trim();
    seen.set(slug, { slug, name });
  }

  if (seen.size === 0) throw new Error('No courts found on sfrecpark.org — page format may have changed');
  return [...seen.values()];
}

export async function getCourts() {
  if (_cached) return _cached;
  _cached = await fetchCourtsFromSFRecPark();
  return _cached;
}
