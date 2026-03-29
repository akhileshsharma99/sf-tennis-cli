interface IpLocation {
	lat: number;
	lng: number;
	label: string;
}

interface GeocodingResult {
	lat: number;
	lng: number;
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

export function distanceMiles(
	lat1: number,
	lng1: number,
	lat2: number,
	lng2: number,
): number {
	const R = 3958.8;
	const dLat = toRad(lat2 - lat1);
	const dLng = toRad(lng2 - lng1);
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
	return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Get current location via IP geolocation
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

// Geocode an address to lat/lng using US Census Bureau (free, no API key)
export async function geocode(
	address: string,
): Promise<GeocodingResult | null> {
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
