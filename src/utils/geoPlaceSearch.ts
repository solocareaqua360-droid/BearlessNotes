// A place's own administrative extent as Nominatim already returns it
// (its `boundingbox`) - the same free OpenStreetMap search already used
// for address geocoding elsewhere (see linkPreview.ts), but for a named
// place rather than a single dropped pin: "Львів" should give back the
// whole city's extent, not one point in the middle of it.
export type PlaceBounds = [west: number, south: number, east: number, north: number];

export type PlaceSearchResult = {
  displayName: string;
  lat: number;
  lng: number;
  bounds: PlaceBounds;
};

export async function searchPlace(query: string): Promise<PlaceSearchResult | null> {
  const q = query.trim();
  if (!q) return null;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`,
      { headers: { 'User-Agent': 'BearlessNotes (mindEva notes app)' } }
    );
    if (!res.ok) return null;
    const results = (await res.json()) as {
      lat?: string;
      lon?: string;
      display_name?: string;
      // Nominatim's own order: [south, north, west, east], all strings.
      boundingbox?: [string, string, string, string];
    }[];
    const first = results[0];
    if (!first?.lat || !first.lon || !first.boundingbox) return null;
    const lat = Number(first.lat);
    const lng = Number(first.lon);
    const [south, north, west, east] = first.boundingbox.map(Number);
    if (![lat, lng, south, north, west, east].every(Number.isFinite)) return null;
    return { displayName: first.display_name ?? q, lat, lng, bounds: [west, south, east, north] };
  } catch {
    return null;
  }
}
