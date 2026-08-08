export type Sport = "tennis" | "pickleball";

export const ALL_SPORTS: Sport[] = ["tennis", "pickleball"];

/** Map a rec.us sport name ("Pickleball") to a Sport, or null if we don't track it. */
export function toSport(apiName: string | undefined): Sport | null {
	const s = apiName?.trim().toLowerCase();
	return s === "tennis" || s === "pickleball" ? s : null;
}

/** Parse a --sport value: "all", "tennis", "pickleball", or a comma list. */
export function parseSports(input: string): Sport[] | null {
	const parts = input
		.split(",")
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
	if (parts.length === 0) return null;
	if (parts.includes("all")) return [...ALL_SPORTS];

	const out: Sport[] = [];
	for (const p of parts) {
		const sport = toSport(p);
		if (!sport) return null;
		if (!out.includes(sport)) out.push(sport);
	}
	return out;
}

export function sportLabel(sport: Sport): string {
	return sport === "tennis" ? "Tennis" : "Pickleball";
}
