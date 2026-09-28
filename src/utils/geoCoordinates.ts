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
