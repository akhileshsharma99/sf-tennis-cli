// All 27 SF Rec & Park reservable tennis courts
export const COURTS = [
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

// Known locations — "home" is loaded from env vars
export function getLocations() {
  const locations = {};
  if (process.env.TENNIS_HOME_LAT && process.env.TENNIS_HOME_LNG) {
    locations.home = {
      lat: parseFloat(process.env.TENNIS_HOME_LAT),
      lng: parseFloat(process.env.TENNIS_HOME_LNG),
      label: process.env.TENNIS_HOME_LABEL || 'Home',
    };
  }
  return locations;
}
