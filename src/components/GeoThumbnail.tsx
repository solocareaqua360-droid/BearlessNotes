import { useEffect, useState } from 'react';
import { Image, ImageStyle, StyleProp } from 'react-native';
import { StaticMapImageManager } from '@maplibre/maplibre-react-native';
import { MAP_STYLE_URL } from '../utils/geoMapStyle';

// A geo point's own little picture, wherever any other link already
// shows one - see ItemCards' LinkRow/LinkGridCell. Generated from the
// point's own coordinates through MapLibre's built-in static-image
// call (the same OSM style the live map uses, so no new service and no
// key), not stored anywhere: a snapshot can always be redrawn from the
// lat/lng that made it, so there is nothing here worth writing to
// Firestore or backing up - only worth keeping on THIS device, for as
// long as the app process lives.
const cache = new Map<string, string>();
const inFlight = new Map<string, Promise<string>>();

function keyFor(lat: number, lng: number, width: number, height: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)},${width}x${height}`;
}

export default function GeoThumbnail({
  lat,
  lng,
  width,
  height,
  style,
}: {
  lat: number;
  lng: number;
  width: number;
  height: number;
  style?: StyleProp<ImageStyle>;
}) {
  const key = keyFor(lat, lng, width, height);
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
      StaticMapImageManager.createImage({
        center: [lng, lat],
        zoom: 15,
        mapStyle: MAP_STYLE_URL,
        width,
        height,
        output: 'file',
      });
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
  }, [key, lat, lng, width, height, uri]);

  if (!uri) return null;
  return <Image source={{ uri }} style={style} resizeMode="cover" />;
}
