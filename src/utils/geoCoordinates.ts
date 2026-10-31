import { forward, toPoint } from 'mgrs';

// THE ONE CANONICAL SHAPE every geo point boils down to - a plain
// latitude/longitude pair. Every other way of writing a point down
// (a Maps URL, MGRS) is a VIEW onto this, converted here and nowhere
// else, so the three input modes the user picked between never drift out
// of step with one another.
export type LatLng = { lat: number; lng: number };

export function isValidLatLng(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

// "55.7558, 37.6173" - comma, semicolon or plain whitespace between the
// two numbers, matching however someone actually pastes a pair they
// copied from somewhere else (Google Maps' own long-press "Copy
// coordinates" gives exactly this, comma-separated).
export function parseDecimalLatLng(text: string): LatLng | null {
  const match = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return isValidLatLng(lat, lng) ? { lat, lng } : null;
}

// Degrees, minutes, seconds - what Google Maps shows under a dropped pin and what a paper or a radio message carries:
// 47°51'49.9"N 35°06'39.7"E, also with spaces, «'» / «′», «"» / «″», minutes alone, or a minus instead of S / W.
export function parseDmsLatLng(text: string): LatLng | null {
  const part = String.raw`(-?\d+(?:[.,]\d+)?)\s*°\s*(?:(\d+(?:[.,]\d+)?)\s*['′’]\s*)?(?:(\d+(?:[.,]\d+)?)\s*(?:"|″|''|”)\s*)?([NSEW]?)`;
  const match = text.trim().match(new RegExp(`^${part}[\\s,;]*${part}$`, 'i'));
  if (!match) return null;
  const one = (d: string, m?: string, s?: string, h?: string) => {
    const n = (x?: string) => (x ? Number(x.replace(',', '.')) : 0);
    const deg = n(d);
    const value = Math.abs(deg) + n(m) / 60 + n(s) / 3600;
    return deg < 0 || /^[SW]$/i.test(h ?? '') ? -value : value;
  };
  const lat = one(match[1], match[2], match[3], match[4]);
  const lng = one(match[5], match[6], match[7], match[8]);
  return isValidLatLng(lat, lng) ? { lat, lng } : null;
}

// Metres between two points along the ground (haversine) - enough for «is there a point of mine near here».
export function distanceMeters(a: LatLng, b: LatLng): number {
  const r = 6371000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

export function formatDecimalLatLng({ lat, lng }: LatLng): string {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

// The `mgrs` package takes and returns [lng, lat] - the one place in this
// app that order appears, kept inside these two functions so nothing
// downstream ever has to remember it.
export function parseMgrs(text: string): LatLng | null {
  const value = text.trim().toUpperCase().replace(/\s+/g, '');
  if (!value) return null;
  try {
    const [lng, lat] = toPoint(value);
    return isValidLatLng(lat, lng) ? { lat, lng } : null;
  } catch {
    return null;
  }
}

export function formatMgrs({ lat, lng }: LatLng): string | null {
  try {
    return forward([lng, lat]);
  } catch {
    return null;
  }
}

// A Google Maps URL that opens straight to this point - always
// constructible from a plain lat/lng, no API and no key. The reverse
// direction of extractMapsCoordinates (utils/linkPreview.ts), which
// reads a URL like this one back into a point.
export function mapsUrlForLatLng({ lat, lng }: LatLng): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

// Whatever a search field holds, read as a place if it is one: decimal degrees (also with a decimal comma), degrees-
// minutes-seconds, MGRS. Read on the phone, so it works offline; a Maps link (which may need the network) is separate.
export function parseCoordinatesText(text: string): LatLng | null {
  const t = text.trim();
  if (!t) return null;
  // «47,8638 35,1110» - only when there is no dot, or «47.86,35.11» would break.
  const commaDecimal = !t.includes('.') ? parseDecimalLatLng(t.replace(/(\d),(\d)/g, '$1.$2')) : null;
  return parseDecimalLatLng(t) ?? commaDecimal ?? parseDmsLatLng(t) ?? parseMgrs(t);
}
