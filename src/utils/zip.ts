import * as XLSX from 'xlsx';

// ZIP, BOTH WAYS (2026-10-31, «експорт папки в zip», «відкриття zip»).
// Reading goes through SheetJS's CFB (already in the app for tables): it inflates what is compressed, but it hands names back as the
// RAW bytes of their UTF-8, one byte a character - «Ð\x9FÐ°Ð¿ÐºÐ°» for «Папка» - so they are decoded once more here. Writing is our
// own: CFB writes a name by the low byte of each character, so a Cyrillic name came out as «^_0?:0» - a zip that a phone's own archiver
// would show as garbage. Ours stores the files as they are (no compression: a picture is compressed already, a note is small) and marks
// every name as UTF-8 (general-purpose flag bit 11), which every archiver reads.

export type ZipEntry = { path: string; bytes: Uint8Array };

// ---- base64 (Hermes' atob/btoa want strings of bytes; these work on arrays, in chunks) --------------------------------------------
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  if (i < bytes.length) {
    const n = (bytes[i] << 16) | ((i + 1 < bytes.length ? bytes[i + 1] : 0) << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + '=';
  }
  return out;
}
export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64.indexOf(clean[i]) << 18) |
      (B64.indexOf(clean[i + 1]) << 12) |
      ((i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : 0) << 6) |
      (i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : 0);
    out[o++] = (n >> 16) & 255;
    if (i + 2 < clean.length && o < out.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < clean.length && o < out.length) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}
export const utf8 = (text: string) => new TextEncoder().encode(text);

// ---- writing --------------------------------------------------------------------------------------------------------------------
let CRC_TABLE: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function writeZip(entries: ZipEntry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const entry of entries) {
    const name = utf8(entry.path);
    const crc = crc32(entry.bytes);
    const size = entry.bytes.length;
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    parts.push(local, entry.bytes);
    const head = new Uint8Array(46 + name.length);
    const cv = new DataView(head.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    head.set(name, 46);
    central.push(head);
    offset += local.length + size;
  }
  const centralSize = central.reduce((sum, c) => sum + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const total = offset + centralSize + end.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of [...parts, ...central, end]) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ---- reading --------------------------------------------------------------------------------------------------------------------
function fixName(raw: string): string {
  const bytes = Uint8Array.from([...raw].map((ch) => ch.charCodeAt(0) & 255));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return raw;
  }
}

// The files of a zip (folders and SheetJS's own placeholder left out), with their real names.
export function readZip(base64: string): ZipEntry[] {
  const cfb = XLSX.CFB.read(base64, { type: 'base64' });
  const out: ZipEntry[] = [];
  cfb.FileIndex.forEach((file: { type: number; name: string; content?: ArrayLike<number> }, i: number) => {
    if (file.type !== 2 || !file.content) return;
    const full = cfb.FullPaths[i] ?? file.name;
    const path = fixName(full.replace(/^Root Entry\//, ''));
    if (path.startsWith('\u0001') || path.endsWith('/') || path.startsWith('__MACOSX/')) return;
    out.push({ path, bytes: Uint8Array.from(file.content as ArrayLike<number>) });
  });
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
