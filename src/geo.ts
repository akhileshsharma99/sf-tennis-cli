export interface Coords {
	lat: number;
	lng: number;
}

interface IpLocation extends Coords {
	label: string;
}

interface IpInfoResponse {
	loc: string;
	city: string;
	region: string;
}

interface CensusGeocodeResponse {
	result: {
		addressMatches: Array<{
			coordinates: { x: number; y: number };
		}>;
	};
}

const toRad = (d: number): number => (d * Math.PI) / 180;

/** Haversine distance in miles, rounded to 2 decimal places. */
export function distanceMiles(a: Coords, b: Coords): number {
	const R = 3958.8;
	const dLat = toRad(b.lat - a.lat);
	const dLng = toRad(b.lng - a.lng);
	const x =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
	return (
		Math.round(R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)) * 100) / 100
	);
}

export async function getCurrentLocation(): Promise<IpLocation | null> {
	try {
		const res = await fetch("https://ipinfo.io/json");
		const data = (await res.json()) as IpInfoResponse;
		const [lat, lng] = data.loc.split(",").map(Number);
		return { lat, lng, label: `${data.city}, ${data.region} (IP-based)` };
	} catch {
		return null;
	}
}

export async function geocode(address: string): Promise<Coords | null> {
	const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
	const res = await fetch(url);
	const data = (await res.json()) as CensusGeocodeResponse;
	const match = data.result?.addressMatches?.[0];
	if (!match) return null;
	return {
		lat: match.coordinates.y,
		lng: match.coordinates.x,
	};
}
