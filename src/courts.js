const SFRECPARK_URL = 'https://sfrecpark.org/1446/Reservable-Tennis-Courts';

// Fallback if sfrecpark.org is unreachable
const FALLBACK_COURTS = [
  { slug: 'alicemarble',     name: 'Alice Marble' },
  { slug: 'balboa',          name: 'Balboa Park' },
  { slug: 'buenavista',      name: 'Buena Vista' },
  { slug: 'crockeramazon',   name: 'Crocker Amazon' },
  { slug: 'dolores',         name: 'Dolores Park' },
  { slug: 'dupont',          name: 'DuPont' },
  { slug: 'fulton',          name: 'Fulton Playground' },
  { slug: 'glencanyon',      name: 'Glen Park' },
  { slug: 'hamilton',        name: 'Hamilton' },
  { slug: 'jpmurphy',        name: 'J.P. Murphy' },
  { slug: 'jackson',         name: 'Jackson Playground' },
  { slug: 'joedimaggio',     name: 'Joe DiMaggio' },
  { slug: 'lafayette',       name: 'Lafayette Park' },
  { slug: 'mclaren',         name: 'McLaren Park' },
  { slug: 'minnielovieward', name: 'Minnie & Lovie' },
  { slug: 'miraloma',        name: 'Miraloma Park' },
  { slug: 'moscone',         name: 'Moscone' },
  { slug: 'mountainlake',    name: 'Mountain Lake Park' },
  { slug: 'parkside',        name: 'Parkside Square' },
  { slug: 'potrerohill',     name: 'Potrero Hill' },
  { slug: 'presidiowall',    name: 'Presidio Wall' },
  { slug: 'richmond',        name: 'Richmond Playground' },
  { slug: 'rossi',           name: 'Rossi Park' },
  { slug: 'stmarys',         name: "St. Mary's" },
  { slug: 'sterngrove',      name: 'Stern Grove' },
  { slug: 'sunset',          name: 'Sunset Rec' },
  { slug: 'uppernoe',        name: 'Upper Noe' },
];

let _cached = null;

async function fetchCourtsFromSFRecPark() {
  const res = await fetch(SFRECPARK_URL);
  const html = await res.text();

  // Extract rec.us links and deduplicate by slug
  const seen = new Map();
  const regex = /href="https?:\/\/(?:www\.)?rec\.us\/([a-z]+)"[^>]*>([^<]+)</gi;
  for (const match of html.matchAll(regex)) {
    const slug = match[1].toLowerCase();
    if (seen.has(slug)) continue;
    // Derive location name: "Alice Marble Tennis Court #1" → "Alice Marble"
    const rawName = match[2].trim();
    const name = rawName.replace(/\s*Tennis\s*Court.*$/i, '').trim();
    seen.set(slug, { slug, name });
  }

  const courts = [...seen.values()];
  return courts.length > 0 ? courts : null;
}

export async function getCourts() {
  if (_cached) return _cached;
  try {
    _cached = await fetchCourtsFromSFRecPark();
  } catch {}
  if (!_cached) _cached = FALLBACK_COURTS;
  return _cached;
}

// Synchronous access for callers that don't need fresh data
export const COURTS = FALLBACK_COURTS;
