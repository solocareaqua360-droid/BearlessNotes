import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from './icons/Ionicons';
import { useTheme } from '../theme/ThemeProvider';
import { useSoft } from '../theme/soft';
import { MAP_STYLE_URL } from '../utils/geoMapStyle';
import { isDesktopShell } from '../utils/desktopBridge.web';
import { confirm } from './surfaces/Ask';
import { SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';
import type { GeoMapPoint } from './GeoMapView';

export type { GeoMapPoint } from './GeoMapView';

// THE MAP IN THE BROWSER AND ON THE MAC. The phone's is MapLibre's native
// module, which has no browser build; the browser has `maplibre-gl`, the
// same engine for the web - the same online style (OpenFreeMap's Liberty,
// see geoMapStyle), the same clustering idea, the same "a name beside a pin
// once you are close enough" rule.
//
// On the Mac there is also an OFFLINE map (desktop/offline.js): regions cut
// out of Protomaps' planet build and kept on disk, drawn in Protomaps' own
// "light" style. It is used by itself when the network is gone, and can be
// switched to by hand to see what is kept. The map library itself is kept
// too once a region has been downloaded, or with no network there would be
// no map to draw anything on.
const VERSION = '4.7.1';
const CDN_SCRIPT = `https://cdn.jsdelivr.net/npm/maplibre-gl@${VERSION}/dist/maplibre-gl.js`;
const CDN_STYLESHEET = `https://cdn.jsdelivr.net/npm/maplibre-gl@${VERSION}/dist/maplibre-gl.css`;
const LOCAL = '/__desktop/offline';

const DEFAULT_CENTER: [number, number] = [30.5238, 50.4547];
const DEFAULT_ZOOM = 5;
// As on the phone: past this zoom a pin carries its name.
const LABEL_MIN_ZOOM = 13;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MapLibre = any;

type Region = { id: string; name: string; bbox: [number, number, number, number]; maxZoom: number; bytes: number; createdAt: number };
type Job = { id: string; name: string; state: 'running' | 'done' | 'error' | 'cancelled'; done: number; total: number; bytes: number; error: string | null } | null;

const DETAIL: { zoom: number; label: string }[] = [
  { zoom: 12, label: 'Міста й дороги' },
  { zoom: 14, label: 'Вулиці' },
  { zoom: 15, label: 'Будинки' },
];

function megabytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} ГБ`;
  return `${Math.max(1, Math.round(bytes / 1e6))} МБ`;
}

async function kept(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { method: 'HEAD' })).ok;
  } catch {
    return false;
  }
}

let loading: Promise<MapLibre> | null = null;
function loadMapLibre(): Promise<MapLibre> {
  const existing = (window as unknown as { maplibregl?: MapLibre }).maplibregl;
  if (existing) return Promise.resolve(existing);
  if (loading) return loading;
  loading = (async () => {
    // The copy kept on this Mac first - it is there with no network.
    const local = isDesktopShell() && (await kept(`${LOCAL}/assets/lib/maplibre-gl.js`));
    const script = local ? `${LOCAL}/assets/lib/maplibre-gl.js` : CDN_SCRIPT;
    const sheet = local ? `${LOCAL}/assets/lib/maplibre-gl.css` : CDN_STYLESHEET;
    if (!document.querySelector('link[data-maplibre]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = sheet;
      link.setAttribute('data-maplibre', '1');
      document.head.appendChild(link);
    }
    return new Promise<MapLibre>((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = script;
      tag.async = true;
      tag.onload = () => resolve((window as unknown as { maplibregl: MapLibre }).maplibregl);
      tag.onerror = () => {
        loading = null;
        reject(new Error('maplibre-gl did not load'));
      };
      document.head.appendChild(tag);
    });
  })();
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

function regionsGeoJson(regions: Region[]) {
  return {
    type: 'FeatureCollection',
    features: regions.map((r) => {
      const [w, s, e, n] = r.bbox;
      return {
        type: 'Feature',
        properties: { name: r.name },
        geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
      };
    }),
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
  const S = useSoft();
  // The pins in the soft style's warm accent, as the rest of the app wears.
  const pin = S.accent;
  const desktop = isDesktopShell();
  const host = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibre>(null);
  const pressRef = useRef(onPressPoint);
  pressRef.current = onPressPoint;
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const [failed, setFailed] = useState(false);
  // Which map is drawn: the live one, or the regions kept on this Mac.
  const [offline, setOffline] = useState(false);
  const offlineRef = useRef(offline);
  offlineRef.current = offline;
  const [regions, setRegions] = useState<Region[]>([]);
  const regionsRef = useRef(regions);
  regionsRef.current = regions;
  const [panel, setPanel] = useState(false);

  const refreshRegions = () =>
    fetch(`${LOCAL}/regions`)
      .then((r) => r.json())
      .then((d) => setRegions((d.regions ?? []) as Region[]))
      .catch(() => {});

  useEffect(() => {
    if (desktop) refreshRegions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The app's own layers - points, clusters, names, house numbers, and the
  // outlines of kept regions. A style change wipes a map's layers, so this
  // runs on every style load.
  function addOwnLayers(m: MapLibre) {
    if (m.getSource('openmaptiles') && !m.getLayer('bearless-housenumber')) {
      // House numbers from zoom 17, as on the phone (GeoHouseNumbers): the
      // data has them, OpenFreeMap's style draws none.
      m.addLayer({
        id: 'bearless-housenumber',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'housenumber',
        minzoom: 17,
        layout: { 'text-field': ['get', 'housenumber'], 'text-font': ['Noto Sans Regular'], 'text-size': 11 },
        paint: { 'text-color': '#666', 'text-halo-color': '#ffffff', 'text-halo-width': 1, 'text-halo-blur': 0.5 },
      });
    }
    if (!m.getSource('regions')) {
      m.addSource('regions', { type: 'geojson', data: regionsGeoJson(regionsRef.current) });
      m.addLayer({
        id: 'regions-outline',
        type: 'line',
        source: 'regions',
        layout: { visibility: 'none' },
        paint: { 'line-color': pin, 'line-width': 2, 'line-dasharray': [2, 2] },
      });
    }
    if (m.getSource('points')) return;
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
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Medium'], 'text-size': 13 },
      paint: { 'text-color': '#FFFFFF' },
    });
    // A point on its own.
    m.addLayer({
      id: 'point',
      type: 'circle',
      source: 'points',
      filter: ['!', ['has', 'point_count']],
      paint: { 'circle-color': pin, 'circle-radius': 8, 'circle-stroke-width': 3, 'circle-stroke-color': '#FFFFFF' },
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
  }

  useEffect(() => {
    let cancelled = false;
    loadMapLibre()
      .then((maplibregl) => {
        if (cancelled || !host.current) return;
        const first = pointsRef.current;
        // No network: the kept map from the start.
        const startOffline = desktop && !navigator.onLine;
        if (startOffline) setOffline(true);
        const m = new maplibregl.Map({
          container: host.current,
          style: startOffline ? `${LOCAL}/style.json` : MAP_STYLE_URL,
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          attributionControl: { compact: true },
        });
        map.current = m;
        // For inspecting the live map from the shell's devtools.
        (window as unknown as { __mindevaMap?: MapLibre }).__mindevaMap = m;
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

        m.on('style.load', () => addOwnLayers(m));
        // The live style could not be had (no network): the kept one.
        m.on('error', (e: MapLibre) => {
          if (!desktop || offlineRef.current || m.isStyleLoaded()) return;
          const msg = String(e?.error?.message ?? '');
          if (/fetch|network|style/i.test(msg)) {
            setOffline(true);
            m.setStyle(`${LOCAL}/style.json`);
          }
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
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
    // The map is built once; points, regions and the style are kept up to
    // date below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // New points, or one renamed or moved, without building the map again.
  useEffect(() => {
    const source = map.current?.getSource?.('points');
    if (source) source.setData(toGeoJson(points));
  }, [points]);

  // The outlines of what is kept: shown while the panel is open or the kept
  // map is the one drawn.
  useEffect(() => {
    const m = map.current;
    const source = m?.getSource?.('regions');
    if (source) source.setData(regionsGeoJson(regions));
    if (m?.getLayer?.('regions-outline')) m.setLayoutProperty('regions-outline', 'visibility', panel || offline ? 'visible' : 'none');
  }, [regions, panel, offline]);

  function switchStyle(toOffline: boolean) {
    setOffline(toOffline);
    map.current?.setStyle(toOffline ? `${LOCAL}/style.json` : MAP_STYLE_URL);
  }

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
      {desktop && (
        <View style={styles.corner} pointerEvents="box-none">
          <Pressable
            onPress={() => setPanel((v) => !v)}
            style={[styles.cornerButton, { backgroundColor: S.card, boxShadow: S.shadow }]}
            accessibilityLabel="Офлайн-регіони"
          >
            <Ionicons name="cloud-download-outline" size={17} color={panel ? S.accent : S.ink} />
            <Text style={[styles.cornerLabel, { color: S.ink }]}>Офлайн</Text>
          </Pressable>
          {regions.length > 0 && (
            <Pressable
              onPress={() => switchStyle(!offline)}
              style={[styles.cornerButton, { backgroundColor: offline ? S.ink : S.card, boxShadow: S.shadow }]}
              accessibilityLabel={offline ? 'Жива мапа' : 'Збережена мапа'}
            >
              <Ionicons name="layers-outline" size={17} color={offline ? S.bg : S.ink} />
              <Text style={[styles.cornerLabel, { color: offline ? S.bg : S.ink }]}>
                {offline ? 'Збережена' : 'Жива'}
              </Text>
            </Pressable>
          )}
        </View>
      )}
      {desktop && panel && (
        <OfflinePanel
          regions={regions}
          onChanged={refreshRegions}
          viewBounds={() => {
            const b = map.current?.getBounds?.();
            return b ? ([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] as [number, number, number, number]) : null;
          }}
          onShow={(r) => map.current?.fitBounds([[r.bbox[0], r.bbox[1]], [r.bbox[2], r.bbox[3]]], { padding: 40 })}
          onClose={() => setPanel(false)}
        />
      )}
    </View>
  );
}

// ---- the panel: what is kept, and keeping more -------------------------------

function OfflinePanel({
  regions,
  onChanged,
  viewBounds,
  onShow,
  onClose,
}: {
  regions: Region[];
  onChanged: () => void;
  viewBounds: () => [number, number, number, number] | null;
  onShow: (r: Region) => void;
  onClose: () => void;
}) {
  const S = useSoft();
  const [name, setName] = useState('');
  const [detail, setDetail] = useState(14);
  const [estimate, setEstimate] = useState<{ tiles: number; bytes: number } | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [job, setJob] = useState<Job>(null);
  const [error, setError] = useState<string | null>(null);
  const wasRunning = useRef(false);

  // A download in progress, followed; the list refreshed when it ends.
  useEffect(() => {
    let alive = true;
    const tick = () =>
      fetch(`${LOCAL}/status`)
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return;
          const next = d.job as Job;
          setJob(next);
          const running = next?.state === 'running';
          if (wasRunning.current && !running) onChanged();
          wasRunning.current = running;
        })
        .catch(() => {});
    tick();
    const timer = setInterval(tick, 800);
    return () => {
      alive = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function measure(zoom: number) {
    const bbox = viewBounds();
    if (!bbox) return;
    setEstimating(true);
    setError(null);
    try {
      const res = await fetch(`${LOCAL}/estimate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bbox, maxZoom: zoom }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Не вдалося порахувати');
      setEstimate(body);
    } catch (e) {
      setError(String((e as Error).message));
      setEstimate(null);
    } finally {
      setEstimating(false);
    }
  }

  async function download() {
    const bbox = viewBounds();
    if (!bbox) return;
    setError(null);
    const res = await fetch(`${LOCAL}/regions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() || 'Регіон', bbox, maxZoom: detail }),
    });
    const body = await res.json();
    if (!res.ok) setError(body.error || 'Не вдалося почати');
    setEstimate(null);
    setName('');
  }

  async function remove(region: Region) {
    const yes = await confirm({ title: `Видалити «${region.name}» з цього Mac?`, confirmLabel: 'Видалити' });
    if (!yes) return;
    await fetch(`${LOCAL}/regions?id=${region.id}`, { method: 'DELETE' });
    onChanged();
  }

  const running = job?.state === 'running';
  return (
    <View style={[styles.panel, { backgroundColor: S.card, boxShadow: S.popShadow }]}>
      <View style={styles.panelHead}>
        <Text style={[styles.panelTitle, { color: S.ink }]}>Офлайн-регіони</Text>
        <Pressable hitSlop={8} onPress={onClose} accessibilityLabel="Закрити">
          <Ionicons name="close" size={18} color={S.ink2} />
        </Pressable>
      </View>

      <ScrollView style={styles.panelList} contentContainerStyle={{ gap: 4 }}>
        {regions.length === 0 && !running && (
          <Text style={[styles.hint, { color: S.ink3 }]}>Поки нічого не збережено на цьому Mac.</Text>
        )}
        {regions.map((r) => (
          <View key={r.id} style={styles.regionRow}>
            <Pressable style={styles.regionMain} onPress={() => onShow(r)}>
              <Ionicons name="map-outline" size={15} color={S.ink2} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.regionName, { color: S.ink }]} numberOfLines={1}>
                  {r.name}
                </Text>
                <Text style={[styles.regionMeta, { color: S.ink3 }]}>
                  {megabytes(r.bytes)} · {DETAIL.find((d) => d.zoom === r.maxZoom)?.label ?? `до ${r.maxZoom}`}
                </Text>
              </View>
            </Pressable>
            <Pressable hitSlop={6} onPress={() => remove(r)} accessibilityLabel="Видалити регіон">
              <Ionicons name="trash-outline" size={15} color={S.ink3} />
            </Pressable>
          </View>
        ))}
      </ScrollView>

      {running && job && (
        <View style={styles.progressBox}>
          <Text style={[styles.regionName, { color: S.ink }]} numberOfLines={1}>
            {job.name}: {Math.floor((job.done / Math.max(1, job.total)) * 100)}% · {megabytes(job.bytes)}
          </Text>
          <View style={[styles.bar, { backgroundColor: S.fill }]}>
            <View style={[styles.barFill, { backgroundColor: S.accent, width: `${(job.done / Math.max(1, job.total)) * 100}%` }]} />
          </View>
          <Pressable onPress={() => fetch(`${LOCAL}/cancel`, { method: 'POST' })}>
            <Text style={[styles.link, { color: S.ink2 }]}>Скасувати</Text>
          </Pressable>
        </View>
      )}
      {job?.state === 'error' && <Text style={[styles.hint, { color: '#C8452F' }]}>{job.error}</Text>}

      {!running && (
        <View style={styles.newBox}>
          <Text style={[styles.section, { color: S.ink3 }]}>Зберегти те, що зараз на екрані</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Назва, напр. «Запоріжжя»"
            placeholderTextColor={S.ink3}
            style={[styles.input, { color: S.ink, backgroundColor: S.fill }]}
          />
          <View style={styles.chips}>
            {DETAIL.map((d) => (
              <Pressable
                key={d.zoom}
                onPress={() => {
                  setDetail(d.zoom);
                  setEstimate(null);
                }}
                style={[styles.chip, { backgroundColor: detail === d.zoom ? S.ink : S.fill }]}
              >
                <Text style={[styles.chipLabel, { color: detail === d.zoom ? S.bg : S.ink2 }]}>{d.label}</Text>
              </Pressable>
            ))}
          </View>
          {estimate ? (
            <Text style={[styles.hint, { color: S.ink2 }]}>
              ≈ {megabytes(estimate.bytes)} ({estimate.tiles.toLocaleString('uk-UA')} плиток)
            </Text>
          ) : (
            <Pressable onPress={() => measure(detail)} disabled={estimating}>
              <Text style={[styles.link, { color: S.ink2 }]}>{estimating ? 'Рахую…' : 'Скільки займе?'}</Text>
            </Pressable>
          )}
          {!!error && <Text style={[styles.hint, { color: '#C8452F' }]}>{error}</Text>}
          <Pressable onPress={download} style={[styles.primary, { backgroundColor: S.ink }]}>
            <Ionicons name="cloud-download-outline" size={16} color={S.chrome} />
            <Text style={[styles.primaryLabel, { color: S.chrome }]}>Завантажити</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  text: { fontSize: 14, textAlign: 'center' },
  corner: { position: 'absolute', top: 12, left: 12, flexDirection: 'row', gap: 8 },
  cornerButton: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 16 },
  cornerLabel: { fontSize: 13, fontFamily: SOFT_MEDIUM },
  panel: { position: 'absolute', top: 54, left: 12, width: 300, maxHeight: '80%', borderRadius: 18, padding: 14, gap: 10 },
  panelHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  panelTitle: { fontSize: 15, fontFamily: SOFT_SEMIBOLD },
  panelList: { flexGrow: 0, maxHeight: 200 },
  regionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  regionMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  regionName: { fontSize: 13.5, fontFamily: SOFT_MEDIUM },
  regionMeta: { fontSize: 12, fontFamily: SOFT_REGULAR },
  progressBox: { gap: 6 },
  bar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  newBox: { gap: 8 },
  section: { fontSize: 12, fontFamily: SOFT_MEDIUM },
  input: { height: 34, borderRadius: 10, paddingHorizontal: 10, fontSize: 13.5, fontFamily: SOFT_REGULAR, outlineStyle: 'none' } as never,
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { height: 28, paddingHorizontal: 10, borderRadius: 14, justifyContent: 'center' },
  chipLabel: { fontSize: 12.5, fontFamily: SOFT_MEDIUM },
  hint: { fontSize: 12.5, fontFamily: SOFT_REGULAR },
  link: { fontSize: 12.5, fontFamily: SOFT_MEDIUM, textDecorationLine: 'underline' },
  primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 36, borderRadius: 18 },
  primaryLabel: { fontSize: 13.5, fontFamily: SOFT_SEMIBOLD },
});
