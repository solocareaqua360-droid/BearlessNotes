import { useEffect, useState } from 'react';
import { Image, ImageStyle, StyleProp } from 'react-native';
import { StaticMapImageManager } from '@maplibre/maplibre-react-native';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { MAP_STYLE_URL } from '../utils/geoMapStyle';

// A geo point's own little picture, wherever any other link already
// shows one - see ItemCards' LinkRow/LinkGridCell. Generated from the
// point's own coordinates through MapLibre's built-in static-image
// call (the same OSM style the live map uses, so no new service and no
// key), not stored anywhere: a snapshot can always be redrawn from the
// lat/lng that made it, so there is nothing here worth writing to
// Firestore or backing up - only worth keeping on THIS device, for as
// long as the app process lives.
//
// KEPT ON THE PHONE (2026-10-28, the user: «в офлайн мініатюри не підвантажуються»): kept for the process only, every
// picture was drawn again from the network after a restart - with no network, every point stood blank. Each picture is
// now copied into the app's own folder under a name made from what it shows, so after the first time it is a file on
// the phone and needs no network at all. A point never drawn while online still has nothing to show offline.
const cache = new Map<string, string>();
const inFlight = new Map<string, Promise<string>>();
const DIR = LegacyFileSystem.documentDirectory ? `${LegacyFileSystem.documentDirectory}geoThumbs/` : null;
let dirReady: Promise<void> | null = null;

function keyFor(lat: number, lng: number, width: number, height: number, zoom: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)},${width}x${height},z${zoom.toFixed(2)}`;
}

function fileOf(key: string): string | null {
  if (!DIR) return null;
  let h = 5381;
  for (let i = 0; i < key.length; i += 1) h = ((h << 5) + h + key.charCodeAt(i)) | 0;
  return `${DIR}g${(h >>> 0).toString(36)}_${key.length}.png`;
}

// The kept file if there is one; otherwise drawn from the map and kept.
async function pictureFor(key: string, draw: () => Promise<string>): Promise<string> {
  const file = fileOf(key);
  if (file) {
    const info = await LegacyFileSystem.getInfoAsync(file).catch(() => null);
    if (info?.exists) return file;
  }
  const tmp = await draw();
  if (!file || !DIR) return tmp;
  try {
    dirReady ??= LegacyFileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
    await dirReady;
    await LegacyFileSystem.copyAsync({ from: tmp, to: file });
    return file;
  } catch {
    return tmp;
  }
}

export default function GeoThumbnail({
  lat,
  lng,
  width,
  height,
  style,
  zoom = 15,
}: {
  lat: number;
  lng: number;
  width: number;
  height: number;
  style?: StyleProp<ImageStyle>;
  // A collection's cover shows all its points at once - farther out than one point's own picture.
  zoom?: number;
}) {
  const key = keyFor(lat, lng, width, height, zoom);
  const [uri, setUri] = useState<string | null>(cache.get(key) ?? null);

  useEffect(() => {
    if (uri) return;
    let cancelled = false;
    const cached = cache.get(key);
    if (cached) {
      setUri(cached);
      return;
    }
    const pending =
      inFlight.get(key) ??
      pictureFor(key, () =>
        StaticMapImageManager.createImage({
          center: [lng, lat],
          zoom,
          mapStyle: MAP_STYLE_URL,
          width,
          height,
          output: 'file',
        })
      );
    inFlight.set(key, pending);
    pending
      .then((fileUri) => {
        cache.set(key, fileUri);
        if (!cancelled) setUri(fileUri);
      })
      .catch(() => {
        // Left blank rather than retried on every re-render - the plain
        // icon LinkRow/LinkGridCell already fall back to is a perfectly
        // fine result for a point with no network to draw tiles from.
      })
      .finally(() => inFlight.delete(key));
    return () => {
      cancelled = true;
    };
  }, [key, lat, lng, width, height, zoom, uri]);

  if (!uri) return null;
  return <Image source={{ uri }} style={style} resizeMode="cover" />;
}
