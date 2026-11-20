// OFFLINE MAPS for the Mac (the user's "variant 3").
//
// A region is cut out of Protomaps' daily build of the whole planet - one
// file of ~140 GB that is read by byte ranges, never downloaded: only the
// tiles inside the region's box are asked for, which is exactly the use
// Protomaps documents ("to download a cutout of a specific region ... see
// the extract command"). OpenFreeMap's terms forbid automated collection
// from their servers without permission; this reads nothing from them.
//
// What is kept, under userData/offline-maps:
//   regions.json                  the list: id, name, box, zooms, size, date
//   regions/<id>/<z>/<x>/<y>.mvt  the tiles, one file each (decompressed)
//   assets/fonts/<stack>/<range>.pbf, assets/sprites/light*.{json,png}
//   assets/lib/maplibre-gl.{js,css}  the map library itself, so the map
//                                    opens with no network at all
//
// And served, through the shell's own localhost server, as
//   /__desktop/offline/regions        GET list, POST start, DELETE ?id=
//   /__desktop/offline/estimate       POST { bbox, maxZoom } -> tiles, bytes
//   /__desktop/offline/status         GET the download in progress
//   /__desktop/offline/cancel         POST
//   /__desktop/offline/style.json     a Protomaps "light" style on the above
//   /__desktop/offline/tiles/z/x/y.mvt
//   /__desktop/offline/assets/...

const fs = require('fs');
const path = require('path');

const BUILD_BASE = 'https://build.protomaps.com/';
const ASSETS_BASE = 'https://protomaps.github.io/basemaps-assets/';
const MAPLIBRE_VERSION = '4.7.1';
const FONT_STACKS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'];
// Latin, Latin-1/extended, Cyrillic, general punctuation - what Ukrainian
// and the map's own labels need.
const FONT_RANGES = ['0-255', '256-511', '512-767', '768-1023', '1024-1279', '1280-1535', '7680-7935', '8192-8447', '8448-8703'];
const SPRITES = ['light.json', 'light.png', 'light@2x.json', 'light@2x.png'];
const CONCURRENCY = 16;

let root = null;
let pm = null; // { PMTiles, FetchSource }
let basemaps = null;
let archive = null; // the planet build, opened once
let job = null; // the download in progress

function dir(...parts) {
  return path.join(root, ...parts);
}

function readRegions() {
  try {
    return JSON.parse(fs.readFileSync(dir('regions.json'), 'utf8'));
  } catch {
    return [];
  }
}

function writeRegions(list) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(dir('regions.json'), JSON.stringify(list, null, 2));
}

// ---- the planet build -----------------------------------------------------

async function openArchive() {
  if (archive) return archive;
  // The newest daily build that answers - today's may not be up yet.
  for (let back = 0; back < 10; back++) {
    const day = new Date(Date.now() - back * 864e5).toISOString().slice(0, 10).replace(/-/g, '');
    const url = `${BUILD_BASE}${day}.pmtiles`;
    try {
      const head = await fetch(url, { method: 'HEAD' });
      if (!head.ok) continue;
      const tiles = new pm.PMTiles(new pm.FetchSource(url));
      await tiles.getHeader();
      archive = { tiles, day };
      return archive;
    } catch {
      // try the day before
    }
  }
  throw new Error('Не вдалося дістатися до карт Protomaps. Потрібен інтернет.');
}

// ---- tiles in a box ---------------------------------------------------------

function lngToX(lng, z) {
  return Math.floor(((lng + 180) / 360) * 2 ** z);
}
function latToY(lat, z) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

// bbox = [west, south, east, north]
function tileRanges(bbox, maxZoom) {
  const [w, s, e, n] = bbox;
  const out = [];
  for (let z = 0; z <= maxZoom; z++) {
    const x0 = Math.max(0, lngToX(w, z));
    const x1 = Math.min(2 ** z - 1, lngToX(e, z));
    const y0 = Math.max(0, latToY(n, z));
    const y1 = Math.min(2 ** z - 1, latToY(s, z));
    out.push({ z, x0, x1, y0, y1, count: (x1 - x0 + 1) * (y1 - y0 + 1) });
  }
  return out;
}

function* eachTile(ranges) {
  for (const r of ranges) {
    for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) yield [r.z, x, y];
  }
}

// How much a region will take: the tile count exactly, the bytes from a
// sample of its deepest tiles (the deepest level is most of any region).
async function estimate(bbox, maxZoom) {
  const { tiles } = await openArchive();
  const ranges = tileRanges(bbox, maxZoom);
  const total = ranges.reduce((a, r) => a + r.count, 0);
  const deepest = ranges[ranges.length - 1];
  const samples = [];
  for (let i = 0; i < 24; i++) {
    const x = deepest.x0 + Math.floor(Math.random() * (deepest.x1 - deepest.x0 + 1));
    const y = deepest.y0 + Math.floor(Math.random() * (deepest.y1 - deepest.y0 + 1));
    samples.push([deepest.z, x, y]);
  }
  const sizes = await Promise.all(
    samples.map(([z, x, y]) =>
      tiles
        .getZxy(z, x, y)
        .then((t) => (t ? t.data.byteLength : 0))
        .catch(() => 0)
    )
  );
  const avg = sizes.reduce((a, b) => a + b, 0) / sizes.length;
  const bytes = Math.round(avg * total * 1.05);
  return { tiles: total, bytes };
}

// ---- assets: fonts, sprites, the map library --------------------------------

async function fetchTo(url, file) {
  if (fs.existsSync(file)) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.part', bytes);
  fs.renameSync(file + '.part', file);
}

async function ensureAssets() {
  const jobs = [];
  for (const stack of FONT_STACKS) {
    for (const range of FONT_RANGES) {
      jobs.push(
        fetchTo(`${ASSETS_BASE}fonts/${encodeURIComponent(stack)}/${range}.pbf`, dir('assets', 'fonts', stack, `${range}.pbf`))
      );
    }
  }
  for (const name of SPRITES) jobs.push(fetchTo(`${ASSETS_BASE}sprites/v4/${name}`, dir('assets', 'sprites', name)));
  jobs.push(
    fetchTo(`https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`, dir('assets', 'lib', 'maplibre-gl.js')),
    fetchTo(`https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`, dir('assets', 'lib', 'maplibre-gl.css'))
  );
  await Promise.all(jobs);
}

// ---- the download -----------------------------------------------------------

async function start({ name, bbox, maxZoom }) {
  if (job && job.state === 'running') throw new Error('Уже завантажується інший регіон.');
  const { tiles, day } = await openArchive();
  const id = `${Date.now().toString(36)}`;
  const ranges = tileRanges(bbox, maxZoom);
  const total = ranges.reduce((a, r) => a + r.count, 0);
  job = { id, name, state: 'running', done: 0, total, bytes: 0, error: null, cancelled: false };
  const current = job;
  const target = dir('regions', id);

  (async () => {
    try {
      await ensureAssets();
      const iterator = eachTile(ranges);
      const worker = async () => {
        for (;;) {
          if (current.cancelled) return;
          const next = iterator.next();
          if (next.done) return;
          const [z, x, y] = next.value;
          let tile = null;
          for (let attempt = 0; attempt < 3 && !tile; attempt++) {
            try {
              tile = (await tiles.getZxy(z, x, y)) || { data: null };
            } catch {
              await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
            }
          }
          if (tile && tile.data && tile.data.byteLength > 0) {
            const file = path.join(target, String(z), String(x), `${y}.mvt`);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, Buffer.from(tile.data));
            current.bytes += tile.data.byteLength;
          }
          current.done += 1;
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      if (current.cancelled) {
        fs.rmSync(target, { recursive: true, force: true });
        current.state = 'cancelled';
        return;
      }
      writeRegions([
        ...readRegions(),
        { id, name, bbox, maxZoom, bytes: current.bytes, tiles: current.done, build: day, createdAt: Date.now() },
      ]);
      current.state = 'done';
    } catch (e) {
      fs.rmSync(target, { recursive: true, force: true });
      current.state = 'error';
      current.error = String(e && e.message ? e.message : e);
    }
  })();
  return { id };
}

function remove(id) {
  if (!/^[a-z0-9]+$/.test(id)) return;
  fs.rmSync(dir('regions', id), { recursive: true, force: true });
  writeRegions(readRegions().filter((r) => r.id !== id));
}

// ---- serving ----------------------------------------------------------------

function styleFor(port) {
  const base = `http://localhost:${port}/__desktop/offline`;
  return {
    version: 8,
    glyphs: `${base}/assets/fonts/{fontstack}/{range}.pbf`,
    sprite: `${base}/assets/sprites/light`,
    sources: {
      protomaps: {
        type: 'vector',
        tiles: [`${base}/tiles/{z}/{x}/{y}.mvt`],
        maxzoom: 15,
        attribution: '© OpenStreetMap, Protomaps',
      },
    },
    layers: basemaps.layers('protomaps', basemaps.namedFlavor('light'), { lang: 'uk' }),
  };
}

const TYPES = { '.pbf': 'application/x-protobuf', '.json': 'application/json', '.png': 'image/png', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function sendFile(res, file, type) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Access-Control-Allow-Origin': '*' });
  fs.createReadStream(file).pipe(res);
}

// Answers the /__desktop/offline/* part of the shell's server; returns false
// for anything else.
async function handle(req, res, pathname, port, readBody) {
  const PREFIX = '/__desktop/offline';
  if (!pathname.startsWith(PREFIX)) return false;
  const sub = pathname.slice(PREFIX.length);
  const json = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body ?? {}));
  };
  try {
    if (sub === '/regions' && req.method === 'GET') return json(200, { regions: readRegions() }), true;
    if (sub === '/regions' && req.method === 'POST') {
      const body = await readBody(req);
      if (!Array.isArray(body.bbox) || body.bbox.length !== 4) return json(400, { error: 'bbox' }), true;
      const maxZoom = Math.max(8, Math.min(15, Number(body.maxZoom) || 14));
      return json(200, await start({ name: String(body.name || 'Регіон'), bbox: body.bbox, maxZoom })), true;
    }
    if (sub === '/regions' && req.method === 'DELETE') {
      remove(new URL(req.url, 'http://localhost').searchParams.get('id') || '');
      return json(200, { ok: true }), true;
    }
    if (sub === '/estimate' && req.method === 'POST') {
      const body = await readBody(req);
      const maxZoom = Math.max(8, Math.min(15, Number(body.maxZoom) || 14));
      return json(200, await estimate(body.bbox, maxZoom)), true;
    }
    if (sub === '/status') return json(200, { job }), true;
    if (sub === '/cancel' && req.method === 'POST') {
      if (job) job.cancelled = true;
      return json(200, { ok: true }), true;
    }
    if (sub === '/style.json') return json(200, styleFor(port)), true;
    const tile = /^\/tiles\/(\d+)\/(\d+)\/(\d+)\.mvt$/.exec(sub);
    if (tile) {
      const [, z, x, y] = tile;
      for (const region of readRegions()) {
        const file = dir('regions', region.id, z, x, `${y}.mvt`);
        if (fs.existsSync(file)) return sendFile(res, file, 'application/x-protobuf'), true;
      }
      // Nothing kept here: an empty tile, not an error - the map simply
      // shows no detail outside the downloaded regions.
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
      res.end();
      return true;
    }
    if (sub.startsWith('/assets/')) {
      const rel = sub.slice('/assets/'.length);
      const file = path.normalize(dir('assets', rel));
      if (!file.startsWith(dir('assets'))) return json(400, { error: 'path' }), true;
      // A range of letters not kept (a rare script in some name): an empty
      // set, not a 404. A missing glyph range fails the whole tile that
      // needs it - it drew as a flat grey square.
      if (rel.startsWith('fonts/') && rel.endsWith('.pbf') && !fs.existsSync(file)) {
        res.writeHead(200, { 'Content-Type': 'application/x-protobuf', 'Content-Length': 0, 'Access-Control-Allow-Origin': '*' });
        res.end();
        return true;
      }
      return sendFile(res, file, TYPES[path.extname(file)] || 'application/octet-stream'), true;
    }
    return json(404, { error: 'no such endpoint' }), true;
  } catch (e) {
    json(500, { error: String(e && e.message ? e.message : e) });
    return true;
  }
}

function init(userData) {
  root = path.join(userData, 'offline-maps');
  pm = require('pmtiles');
  basemaps = require('@protomaps/basemaps');
}

module.exports = { init, handle };
