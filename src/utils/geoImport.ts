import { isValidLatLng, parseCoordinatesText, type LatLng } from './geoCoordinates';
import { isMapsUrl } from './linkPreview';

// «ІМПОРТ ТОЧОК» (2026-10-28, sketch NhS6SVqj1GGGYdsZPYwP7K, the user: «вікно імпорту з csv або excel декількох
// геоточок... назва, координати і примітка; гуглівське можна підтягнути просто довгим вікном підвантаження»). A sheet
// read by importTable's parseTableFile is turned into points here: which column is what is guessed from the header
// row and the cells, and the user can reassign any column.

export type GeoColumnRole = 'name' | 'coords' | 'lat' | 'lng' | 'note' | 'skip';
export const GEO_ROLE_LABEL: Record<GeoColumnRole, string> = {
  name: 'Назва',
  coords: 'Координати',
  lat: 'Широта',
  lng: 'Довгота',
  note: 'Примітка',
  skip: 'Пропустити',
};
// The order a column's chip steps through on each tap.
export const GEO_ROLE_CYCLE: GeoColumnRole[] = ['name', 'coords', 'lat', 'lng', 'note', 'skip'];

// What one row became: a place read on the phone, a Maps link that needs the network to be read, or nothing usable.
export type GeoImportRow =
  | { kind: 'point'; title: string; note: string; point: LatLng }
  | { kind: 'link'; title: string; note: string; url: string }
  | { kind: 'bad'; title: string; reason: string };

const num = (s: string) => Number(s.trim().replace(',', '.'));
const isNumberCell = (s: string) => /^-?\d+([.,]\d+)?$/.test(s.trim());
const readsAsPlace = (s: string) => !!parseCoordinatesText(s) || isMapsUrl(s.trim());

const HEAD: Record<Exclude<GeoColumnRole, 'skip'>, RegExp> = {
  name: /^(назва|ім'?я|name|title|точка|об'?єкт|місце)$/i,
  coords: /(координат|coord|mgrs|посилання|link|url|google|мапа)/i,
  lat: /^(lat|latitude|широта|ш)$/i,
  lng: /^(lng|lon|long|longitude|довгота|д)$/i,
  note: /(примітк|note|comment|коментар|опис|description)/i,
};

// Whether the first row is a header: none of its cells reads as a place or a number, and the next row has one that does.
export function looksLikeHeader(grid: string[][]): boolean {
  if (grid.length < 2) return false;
  const first = grid[0].map((c) => String(c ?? ''));
  if (first.some((c) => readsAsPlace(c) || isNumberCell(c))) return false;
  return grid[1].some((c) => readsAsPlace(String(c ?? '')) || isNumberCell(String(c ?? '')));
}

export function guessGeoRoles(grid: string[][], hasHeader: boolean): GeoColumnRole[] {
  const width = Math.max(0, ...grid.map((r) => r.length));
  const header = hasHeader ? grid[0].map((c) => String(c ?? '').trim()) : [];
  const body = (hasHeader ? grid.slice(1) : grid).slice(0, 50);
  const cells = (i: number) => body.map((r) => String(r[i] ?? '').trim()).filter(Boolean);
  const roles: GeoColumnRole[] = Array(width).fill('skip');
  const taken = new Set<GeoColumnRole>();
  const set = (i: number, role: GeoColumnRole) => {
    roles[i] = role;
    taken.add(role);
  };
  // By the header first.
  header.forEach((h, i) => {
    for (const role of ['lat', 'lng', 'coords', 'note', 'name'] as const) {
      if (!taken.has(role) && HEAD[role].test(h)) {
        set(i, role);
        return;
      }
    }
  });
  // A column most of whose cells read as a whole place.
  if (!taken.has('coords') && !(taken.has('lat') && taken.has('lng'))) {
    for (let i = 0; i < width; i++) {
      const c = cells(i);
      if (roles[i] === 'skip' && c.length && c.filter(readsAsPlace).length >= c.length * 0.6) {
        set(i, 'coords');
        break;
      }
    }
  }
  // Two neighbouring number columns in latitude / longitude ranges.
  if (!taken.has('coords') && !(taken.has('lat') && taken.has('lng'))) {
    for (let i = 0; i + 1 < width; i++) {
      const a = cells(i);
      const b = cells(i + 1);
      const numeric = (c: string[]) => c.length > 0 && c.every(isNumberCell);
      if (roles[i] === 'skip' && roles[i + 1] === 'skip' && numeric(a) && numeric(b) && a.every((v) => Math.abs(num(v)) <= 90)) {
        set(i, 'lat');
        set(i + 1, 'lng');
        break;
      }
    }
  }
  // The rest: the first text column is the name, the next the note.
  for (let i = 0; i < width; i++) {
    if (roles[i] !== 'skip') continue;
    const c = cells(i);
    if (!c.length || c.every(isNumberCell)) continue;
    if (!taken.has('name')) set(i, 'name');
    else if (!taken.has('note')) set(i, 'note');
  }
  return roles;
}

export function readGeoRows(grid: string[][], hasHeader: boolean, roles: GeoColumnRole[]): GeoImportRow[] {
  const at = (row: string[], role: GeoColumnRole) => {
    const i = roles.indexOf(role);
    return i < 0 ? '' : String(row[i] ?? '').trim();
  };
  return (hasHeader ? grid.slice(1) : grid)
    .filter((row) => row.some((c) => String(c ?? '').trim()))
    .map((row, n): GeoImportRow => {
      const title = at(row, 'name') || `Точка ${n + 1}`;
      const note = at(row, 'note');
      const lat = at(row, 'lat');
      const lng = at(row, 'lng');
      if (lat && lng) {
        const point = { lat: num(lat), lng: num(lng) };
        return isValidLatLng(point.lat, point.lng) ? { kind: 'point', title, note, point } : { kind: 'bad', title, reason: 'координати поза межами' };
      }
      const raw = at(row, 'coords');
      if (!raw) return { kind: 'bad', title, reason: 'немає координат' };
      const point = parseCoordinatesText(raw);
      if (point) return { kind: 'point', title, note, point };
      if (isMapsUrl(raw)) return { kind: 'link', title, note, url: raw };
      return { kind: 'bad', title, reason: 'не схоже на координати' };
    });
}
