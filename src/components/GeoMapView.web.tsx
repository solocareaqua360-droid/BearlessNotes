import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { useSoft } from '../theme/soft';
import { MAP_STYLE_URL } from '../utils/geoMapStyle';
import type { GeoMapPoint } from './GeoMapView';

export type { GeoMapPoint } from './GeoMapView';

// THE MAP IN THE BROWSER AND ON THE MAC. The phone's is MapLibre's native
// module, which has no browser build; the browser has `maplibre-gl`, the
// same engine for the web - the same style (OpenFreeMap's Liberty, see
// geoMapStyle), the same clustering idea, the same "a name beside a pin
// once you are close enough" rule.
//
// Loaded from the CDN when the map is first opened rather than installed:
// a new package.json dependency moves the phone's update fingerprint, and
// a map needs the network for its tiles anyway.
const VERSION = '4.7.1';
const SCRIPT = `https://cdn.jsdelivr.net/npm/maplibre-gl@${VERSION}/dist/maplibre-gl.js`;
const STYLESHEET = `https://cdn.jsdelivr.net/npm/maplibre-gl@${VERSION}/dist/maplibre-gl.css`;

const DEFAULT_CENTER: [number, number] = [30.5238, 50.4547];
const DEFAULT_ZOOM = 5;
// As on the phone: past this zoom a pin carries its name.
const LABEL_MIN_ZOOM = 13;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MapLibre = any;

let loading: Promise<MapLibre> | null = null;
function loadMapLibre(): Promise<MapLibre> {
  const existing = (window as unknown as { maplibregl?: MapLibre }).maplibregl;
  if (existing) return Promise.resolve(existing);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${STYLESHEET}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = STYLESHEET;
      document.head.appendChild(link);
    }
    const script = document.createElement('script');
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => resolve((window as unknown as { maplibregl: MapLibre }).maplibregl);
    script.onerror = () => {
      loading = null;
      reject(new Error('maplibre-gl did not load'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

function toGeoJson(points: GeoMapPoint[]) {
  return {
    type: 'FeatureCollection',
    features: points.map((p) => ({
      type: 'Feature',
      properties: { pointId: p.id, title: p.title },
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
    })),
  };
}

export default function GeoMapView({
  points,
  onPressPoint,
}: {
  points: GeoMapPoint[];
  onPressPoint: (id: string) => void;
}) {
  const theme = useTheme();
  // The pins in the soft style's warm accent, as the rest of the app wears.
  const pin = useSoft().accent;
  const host = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibre>(null);
  const pressRef = useRef(onPressPoint);
  pressRef.current = onPressPoint;
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadMapLibre()
      .then((maplibregl) => {
        if (cancelled || !host.current) return;
        const first = pointsRef.current;
        const m = new maplibregl.Map({
          container: host.current,
          style: MAP_STYLE_URL,
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          attributionControl: { compact: true },
        });
        map.current = m;
        m.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
        m.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), 'top-right');

        // Everything the user has, in view at once.
        if (first.length === 1) {
          m.jumpTo({ center: [first[0].lng, first[0].lat], zoom: 13 });
        } else if (first.length > 1) {
          const bounds = new maplibregl.LngLatBounds();
          first.forEach((p) => bounds.extend([p.lng, p.lat]));
          m.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 0 });
        }

        m.on('load', () => {
          // House numbers from zoom 17, as on the phone (GeoHouseNumbers):
          // the data has them, OpenFreeMap's style draws none.
          m.addLayer({
            id: 'bearless-housenumber',
            type: 'symbol',
            source: 'openmaptiles',
            'source-layer': 'housenumber',
            minzoom: 17,
            layout: { 'text-field': ['get', 'housenumber'], 'text-font': ['Noto Sans Regular'], 'text-size': 11 },
            paint: { 'text-color': '#666', 'text-halo-color': '#ffffff', 'text-halo-width': 1, 'text-halo-blur': 0.5 },
          });
          m.addSource('points', {
            type: 'geojson',
            data: toGeoJson(pointsRef.current),
            cluster: true,
            clusterRadius: 50,
            clusterMaxZoom: 16,
          });
          // A knot of points: a bubble with how many are in it.
          m.addLayer({
            id: 'clusters',
            type: 'circle',
            source: 'points',
            filter: ['has', 'point_count'],
            paint: {
              'circle-color': pin,
              'circle-radius': ['step', ['get', 'point_count'], 16, 10, 20, 50, 26],
              'circle-stroke-width': 3,
              'circle-stroke-color': '#FFFFFF',
            },
          });
          m.addLayer({
            id: 'cluster-count',
            type: 'symbol',
            source: 'points',
            filter: ['has', 'point_count'],
            layout: {
              'text-field': ['get', 'point_count_abbreviated'],
              'text-font': ['Noto Sans Bold'],
              'text-size': 13,
            },
            paint: { 'text-color': '#FFFFFF' },
          });
          // A point on its own.
          m.addLayer({
            id: 'point',
            type: 'circle',
            source: 'points',
            filter: ['!', ['has', 'point_count']],
            paint: {
              'circle-color': pin,
              'circle-radius': 8,
              'circle-stroke-width': 3,
              'circle-stroke-color': '#FFFFFF',
            },
          });
          m.addLayer({
            id: 'point-label',
            type: 'symbol',
            source: 'points',
            minzoom: LABEL_MIN_ZOOM,
            filter: ['!', ['has', 'point_count']],
            layout: {
              'text-field': ['get', 'title'],
              'text-font': ['Noto Sans Regular'],
              'text-size': 13,
              'text-offset': [0, 1.3],
              'text-anchor': 'top',
              'text-max-width': 12,
            },
            paint: { 'text-color': '#1F1D1A', 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.5 },
          });

          // A bubble opens up to where its points come apart.
          m.on('click', 'clusters', (e: MapLibre) => {
            const feature = e.features?.[0];
            if (!feature) return;
            const source = m.getSource('points');
            Promise.resolve(source.getClusterExpansionZoom(feature.properties.cluster_id)).then((zoom: number) =>
              m.easeTo({ center: feature.geometry.coordinates, zoom })
            );
          });
          m.on('click', 'point', (e: MapLibre) => {
            const id = e.features?.[0]?.properties?.pointId;
            if (id) pressRef.current(String(id));
          });
          for (const layer of ['clusters', 'point']) {
            m.on('mouseenter', layer, () => (m.getCanvas().style.cursor = 'pointer'));
            m.on('mouseleave', layer, () => (m.getCanvas().style.cursor = ''));
          }
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
    // The map is built once; the points are kept up to date below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // New points, or one renamed or moved, without building the map again.
  useEffect(() => {
    const source = map.current?.getSource?.('points');
    if (source) source.setData(toGeoJson(points));
  }, [points]);

  // A splitter drag or a panel opening changes the map's box, and a
  // maplibre map only redraws its canvas to a new size when told.
  useEffect(() => {
    const node = host.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => map.current?.resize());
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  if (failed) {
    return (
      <View style={[styles.fill, styles.center]}>
        <Text style={[styles.text, { color: theme.ink.muted }]}>
          Мапа не завантажилась - потрібен інтернет. Точок із координатами: {points.length}.
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.fill}>
      <div ref={host} style={{ position: 'absolute', inset: 0 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  text: {
    fontSize: 14,
    textAlign: 'center',
  },
});
