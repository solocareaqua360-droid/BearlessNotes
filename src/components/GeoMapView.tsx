import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  Camera,
  GeoJSONSource,
  Layer,
  LocationManager,
  Map,
  Marker,
  UserLocation,
  type CameraRef,
  type GeoJSONSourceRef,
  type MapRef,
  type ViewStateChangeEvent,
} from '@maplibre/maplibre-react-native';
import { Ionicons } from './icons/Ionicons';
import { useTheme } from '../theme/ThemeProvider';
import { MAP_STYLE_URL } from '../utils/geoMapStyle';
import GeoOfflineRegionsSheet from './GeoOfflineRegionsSheet';
import GeoHouseNumbers from './GeoHouseNumbers';
import { notify } from './surfaces/Ask';
import {
  distanceMeters,
  formatDecimalLatLng,
  formatMgrs,
  parseCoordinatesText,
  type LatLng,
} from '../utils/geoCoordinates';
import { extractMapsCoordinates, isMapsUrl } from '../utils/linkPreview';

// Kyiv, zoomed out to the country - a reasonable place to open with no
// points of the user's own yet, rather than the middle of the ocean
// MapLibre would otherwise default to.
const DEFAULT_CENTER: [number, number] = [30.5238, 50.4547];
const DEFAULT_ZOOM = 5;

// Past this zoom a pin earns its name next to it - below it, with more
// than a couple of points on screen the labels would already be reading
// as noise before they even had a chance to overlap. The practical
// answer to overlap agreed with the user: two points close enough for
// their names to collide are close enough that clustering has already
// folded them into one bubble by then anyway.
const LABEL_MIN_ZOOM = 13;

export type GeoMapPoint = { id: string; title: string; lat: number; lng: number };

// Clusters: a point stands alone once the map is zoomed in past where its neighbours would collide with it, and a bubble
// with a count stands in for a knot of them everywhere else - tapping one flies the camera in.
// How close a chosen point is shown: the street and the blocks around it.
const FOCUS_ZOOM = 14;

// «240 м», «1,9 км», «12 км».
function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} м`;
  const km = meters / 1000;
  return `${(km < 10 ? km.toFixed(1) : Math.round(km).toString()).replace('.', ',')} км`;
}

export default function GeoMapView({
  points,
  onPressPoint,
  focusId,
  bare,
  searchText = '',
  onAddAt,
  onFound,
  bottomInset = 24,
  offlineOpen,
  onOfflineClose,
  rulerOn = false,
  onRulerChange,
  snapshotRef,
}: {
  points: GeoMapPoint[];
  onPressPoint: (id: string) => void;
  // The point to centre on (a collection's chosen one): the camera flies there and its pin is drawn larger.
  focusId?: string | null;
  // Inside a small window: no offline / locate buttons.
  bare?: boolean;
  // What the screen's search (the dock's) holds: read as coordinates, it puts a pin there with a card offering to add a
  // point (2026-10-28, the user: «пошук за координатами і потенційне додавання цієї точки»; ONE search on the screen -
  // «2 пошуки на екрані будуть плутати»). Anything else is the screen's own name search and the map ignores it.
  searchText?: string;
  onAddAt?: (point: LatLng) => void;
  // The place found (search or a pin held on the map), or null - the screen turns its «+» into «Зберегти» meanwhile.
  onFound?: (point: LatLng | null) => void;
  // How far from the bottom the found place's card stands (the dock is over the map).
  bottomInset?: number;
  // The offline regions window, opened from the screen's «⋯» (2026-10-28: the round download button left the map).
  // Given, the map has no download button of its own.
  offlineOpen?: boolean;
  onOfflineClose?: () => void;
  // «Рулетка» (the dock's tool): while on, a tap on the map adds a point and the distances are shown; the screen turns it
  // on and off (onRulerChange - the found-place card's «Звідси» turns it on too).
  rulerOn?: boolean;
  onRulerChange?: (on: boolean) => void;
  // «Знімок»: filled with a function that photographs what the map shows now (its layers - points, ruler - included) to
  // a file, for the screen's dock button.
  snapshotRef?: { current: (() => Promise<string | null>) | null };
}) {
  const theme = useTheme();
  const cameraRef = useRef<CameraRef>(null);
  // Opened on a chosen point (a collection's window, its full screen): it is where the map starts, at the zoom a focus
  // flies to - a map built centred on the FIRST point and then asked to fly before its camera was ready stayed there.
  const focused = focusId ? points.find((x) => x.id === focusId) : undefined;
  const first = focused ?? points[0];
  const initialZoom = focused ? FOCUS_ZOOM : first ? 11 : DEFAULT_ZOOM;
  const initialCenter: [number, number] = first ? [first.lng, first.lat] : DEFAULT_CENTER;
  const [view, setView] = useState<{ zoom: number; bounds: [number, number, number, number] }>({
    zoom: initialZoom,
    // Wide enough that nothing clusters away before the map's own first
    // onRegionDidChange reports the real bounds a moment later.
    bounds: [initialCenter[0] - 5, initialCenter[1] - 5, initialCenter[0] + 5, initialCenter[1] + 5],
  });

  // THE POINTS ARE DRAWN BY THE MAP ITSELF (2026-10-28, before the points import: each pin used to be a React view of
  // its own, fine for seven, a stutter for hundreds). One GeoJSON source the map clusters on its own, and two layers
  // over it - so a thousand points cost what ten do. The focused point (a collection's chosen one) is still a view, on
  // top, because it is one.
  const sourceRef = useRef<GeoJSONSourceRef>(null);
  const mapRef = useRef<MapRef>(null);
  if (snapshotRef)
    snapshotRef.current = async () => {
      try {
        return (await mapRef.current?.createStaticMapImage({ output: 'file' })) ?? null;
      } catch {
        return null;
      }
    };
  const shape = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: points
        .filter((p) => p.id !== focusId)
        .map((p) => ({
          type: 'Feature',
          id: p.id,
          properties: { pointId: p.id, title: p.title },
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        })),
    }),
    [points, focusId]
  );

  function handleRegionChange(event: { nativeEvent: ViewStateChangeEvent }) {
    setView({ zoom: event.nativeEvent.zoom, bounds: event.nativeEvent.bounds });
  }

  function flyTo(center: [number, number], zoom: number) {
    cameraRef.current?.flyTo({ center, zoom, duration: 400 });
  }
  useEffect(() => {
    if (!focusId) return;
    const p = points.find((x) => x.id === focusId);
    // Always the same distance (2026-10-15): «at least 14» only ever zoomed IN, and a second point opened onto an
    // empty field with nothing around it to say where it is.
    if (p) flyTo([p.lng, p.lat], FOCUS_ZOOM);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  const [offlineSheetVisible, setOfflineSheetVisible] = useState(false);

  // THE SEARCH (the dock's, see `searchText`): decimal degrees, degrees-minutes-seconds, MGRS - read on the phone, so it
  // works offline - or a Maps link. Read once typing settles, so a half-typed number does not fly the map about. The
  // place found gets a temporary pin and a card; nothing is saved until «Додати точку» (which asks the name).
  const [found, setFound] = useState<LatLng | null>(null);
  // THE RULER (2026-10-28, sketch NhS6SVqj1GGGYdsZPYwP7K): the points measured, in order. Kept when the ruler is turned
  // off - its lines stay on the map until «Очистити», so they go into a snapshot - and drawn by the map itself.
  const [ruler, setRuler] = useState<LatLng[]>([]);
  const rulerShape = useMemo<GeoJSON.FeatureCollection>(() => {
    const features: GeoJSON.Feature[] = [];
    if (ruler.length > 1) {
      features.push({ type: 'Feature', properties: { kind: 'line' }, geometry: { type: 'LineString', coordinates: ruler.map((p) => [p.lng, p.lat]) } });
      for (let i = 1; i < ruler.length; i++) {
        const a = ruler[i - 1];
        const b = ruler[i];
        features.push({
          type: 'Feature',
          properties: { kind: 'label', label: formatDistance(distanceMeters(a, b)) },
          geometry: { type: 'Point', coordinates: [(a.lng + b.lng) / 2, (a.lat + b.lat) / 2] },
        });
      }
    }
    ruler.forEach((p) => features.push({ type: 'Feature', properties: { kind: 'vertex' }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } }));
    return { type: 'FeatureCollection', features };
  }, [ruler]);
  const rulerTotal = ruler.reduce((sum, p, i) => (i ? sum + distanceMeters(ruler[i - 1], p) : 0), 0);
  const [resolving, setResolving] = useState(false);
  useEffect(() => {
    const text = searchText.trim();
    if (!text) {
      setFound(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      let point = parseCoordinatesText(text);
      if (!point && isMapsUrl(text)) {
        setResolving(true);
        try {
          point = await extractMapsCoordinates(text);
        } finally {
          if (!cancelled) setResolving(false);
        }
      }
      if (cancelled) return;
      setFound(point);
      if (point) {
        Keyboard.dismiss();
        flyTo([point.lng, point.lat], 15);
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);
  useEffect(() => {
    onFound?.(found);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found]);
  useEffect(() => () => onFound?.(null), []);
  // Saved: a point of the user's own now stands on the pin, so the pin (and the «Зберегти» it offered) goes.
  useEffect(() => {
    if (found && points.some((p) => distanceMeters(found, p) < 1)) setFound(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points]);
  // A point of the user's own already standing near the place found - so a second one is not made by mistake.
  const nearest = useMemo(() => {
    if (!found) return null;
    let best: { point: GeoMapPoint; meters: number } | null = null;
    points.forEach((p) => {
      const meters = distanceMeters(found, p);
      if (meters <= 500 && (!best || meters < best.meters)) best = { point: p, meters };
    });
    return best as { point: GeoMapPoint; meters: number } | null;
  }, [found, points]);
  const foundMgrs = found ? formatMgrs(found) : null;
  const [locationEnabled, setLocationEnabled] = useState(false);
  const [locating, setLocating] = useState(false);

  // Permission is asked here, on the first tap of this button, not on
  // opening the map or anywhere else in the app - the user's own
  // condition ("тільки в використанні самої мапи"). Granted once, the
  // live puck (<UserLocation>) keeps updating on its own; this call
  // additionally centres the camera there once, as a one-time jump
  // rather than a permanent follow that would fight free panning.
  async function handleLocateMe() {
    if (locating) return;
    setLocating(true);
    try {
      const granted = locationEnabled || (await LocationManager.requestPermissions());
      if (!granted) {
        notify('Немає доступу до місцеположення', 'Дозвольте доступ у налаштуваннях телефону, щоб бачити себе на мапі.');
        return;
      }
      setLocationEnabled(true);
      const position = await LocationManager.getCurrentPosition();
      if (position) flyTo([position.coords.longitude, position.coords.latitude], 15);
    } finally {
      setLocating(false);
    }
  }

  return (
    <View style={styles.fill}>
      <Map
        ref={mapRef}
        style={styles.fill}
        mapStyle={MAP_STYLE_URL}
        onRegionDidChange={handleRegionChange}
        // A finger held on the map drops the same temporary pin a typed coordinate does; a tap elsewhere lifts it.
        onLongPress={
          onAddAt
            ? (e) => {
                const [lng, lat] = e.nativeEvent.lngLat;
                setFound({ lat, lng });
                // Brought to the middle, at the same zoom, so the card below does not cover it.
                flyTo([lng, lat], view.zoom);
              }
            : undefined
        }
        onPress={(e) => {
          if (rulerOn) {
            const [lng, lat] = e.nativeEvent.lngLat;
            setRuler((prev) => [...prev, { lat, lng }]);
            return;
          }
          if (onAddAt && found) setFound(null);
        }}
        // TextureView, not the default GLSurfaceView (2026-10-28, the user: the bar, the dock and the «⋯» menu over the
        // map were see-through, and the map seemed to slide out of the opening menu): a SurfaceView is drawn outside the
        // view tree, so the app's blur cannot see it - the glass over it showed nothing, and the growing menu panel
        // carried a raw piece of map. A TextureView is part of the tree, so the shared blur blurs it like any screen.
        androidView="texture"
      >
        <Camera ref={cameraRef} initialViewState={{ center: initialCenter, zoom: initialZoom }} />
        <GeoHouseNumbers />
        {locationEnabled && <UserLocation accuracy />}
        <GeoJSONSource
          id="bearless-points"
          ref={sourceRef}
          data={shape}
          cluster
          clusterRadius={50}
          clusterMaxZoom={16}
          onPress={async (e) => {
            const feature = e.nativeEvent.features[0];
            if (!feature) return;
            e.stopPropagation?.();
            const props = (feature.properties ?? {}) as { cluster_id?: number; pointId?: string };
            const [lng, lat] = (feature.geometry as GeoJSON.Point).coordinates;
            if (props.cluster_id != null) {
              const zoom = await sourceRef.current?.getClusterExpansionZoom(props.cluster_id).catch(() => null);
              flyTo([lng, lat], Math.min(20, zoom ?? view.zoom + 2));
            } else if (props.pointId) onPressPoint(props.pointId);
          }}
        >
          <Layer
            id="bearless-clusters"
            type="circle"
            filter={['has', 'point_count']}
            paint={{ 'circle-color': theme.accent, 'circle-radius': 17, 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' }}
          />
          <Layer
            id="bearless-cluster-count"
            type="symbol"
            filter={['has', 'point_count']}
            layout={{ 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-allow-overlap': true }}
            paint={{ 'text-color': theme.onAccent }}
          />
          <Layer
            id="bearless-points"
            type="circle"
            filter={['!', ['has', 'point_count']]}
            paint={{ 'circle-color': theme.accent, 'circle-radius': 11, 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' }}
          />
          <Layer
            id="bearless-point-dot"
            type="circle"
            filter={['!', ['has', 'point_count']]}
            paint={{ 'circle-color': theme.onAccent, 'circle-radius': 3.5 }}
          />
          <Layer
            id="bearless-point-labels"
            type="symbol"
            filter={['!', ['has', 'point_count']]}
            minzoom={LABEL_MIN_ZOOM}
            layout={{
              'text-field': ['get', 'title'],
              'text-font': ['Noto Sans Regular'],
              'text-size': 12,
              'text-offset': [0, 1.5],
              'text-anchor': 'top',
              'text-max-width': 10,
            }}
            paint={{ 'text-color': '#1c1c1e', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 }}
          />
        </GeoJSONSource>
        {focused && (
          <Marker lngLat={[focused.lng, focused.lat]} onPress={() => onPressPoint(focused.id)}>
            <View style={styles.pinGroup}>
              <View style={[styles.pin, styles.pinFocus, { backgroundColor: theme.accent }]}>
                <Ionicons name="location" size={20} color={theme.onAccent} />
              </View>
            </View>
          </Marker>
        )}
        {ruler.length > 0 && (
          <GeoJSONSource id="bearless-ruler" data={rulerShape}>
            <Layer
              id="bearless-ruler-casing"
              type="line"
              filter={['==', ['get', 'kind'], 'line']}
              layout={{ 'line-join': 'round', 'line-cap': 'round' }}
              paint={{ 'line-color': '#1c1c1e', 'line-width': 5 }}
            />
            <Layer
              id="bearless-ruler-line"
              type="line"
              filter={['==', ['get', 'kind'], 'line']}
              layout={{ 'line-join': 'round' }}
              paint={{ 'line-color': '#f1f0ec', 'line-width': 2.5, 'line-dasharray': [2, 1.6] }}
            />
            <Layer
              id="bearless-ruler-vertex"
              type="circle"
              filter={['==', ['get', 'kind'], 'vertex']}
              paint={{ 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-width': 2.5, 'circle-stroke-color': '#1c1c1e' }}
            />
            <Layer
              id="bearless-ruler-label"
              type="symbol"
              filter={['==', ['get', 'kind'], 'label']}
              layout={{ 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-allow-overlap': true, 'text-offset': [0, -1.1] }}
              paint={{ 'text-color': '#ffffff', 'text-halo-color': '#1c1c1e', 'text-halo-width': 3 }}
            />
          </GeoJSONSource>
        )}
        {found && (
          <Marker lngLat={[found.lng, found.lat]}>
            <View style={[styles.foundPin, { backgroundColor: theme.ink.primary, borderColor: theme.raised }]}>
              <Ionicons name="locate" size={18} color={theme.raised} />
            </View>
          </Marker>
        )}
      </Map>
      {points.length === 0 && (
        <View style={styles.emptyHint} pointerEvents="none">
          <Text style={[styles.emptyHintText, { color: theme.ink.primary }]}>
            Немає точок із координатами - вставте посилання Google Maps або введіть координати вручну
          </Text>
        </View>
      )}
      {!bare && (
      <>
      {offlineOpen === undefined && (
        <Pressable
          style={[styles.offlineButton, { backgroundColor: theme.raised, borderColor: theme.edge.hairline }]}
          onPress={() => setOfflineSheetVisible(true)}
        >
          <Ionicons name="cloud-download-outline" size={20} color={theme.ink.primary} />
        </Pressable>
      )}
      <Pressable
        style={[styles.offlineButton, offlineOpen === undefined && styles.locateButton, { backgroundColor: theme.raised, borderColor: theme.edge.hairline }]}
        onPress={handleLocateMe}
      >
        {locating ? (
          <ActivityIndicator size="small" color={theme.ink.primary} />
        ) : (
          <Ionicons name={locationEnabled ? 'locate' : 'locate-outline'} size={20} color={theme.ink.primary} />
        )}
      </Pressable>
      </>
      )}
      {resolving && (
        <View style={[styles.resolving, { backgroundColor: theme.raised, borderColor: theme.edge.hairline }]}>
          <ActivityIndicator size="small" color={theme.ink.primary} />
          <Text style={{ color: theme.ink.primary, fontSize: 13 }}>Читаю посилання…</Text>
        </View>
      )}
      {onAddAt && found && !rulerOn && (
        <View style={[styles.foundCard, { bottom: bottomInset + 12, backgroundColor: theme.raised, borderColor: theme.edge.hairline }]}>
          <Text style={[styles.foundCoords, { color: theme.ink.primary }]} selectable>
            {formatDecimalLatLng(found)}
          </Text>
          {foundMgrs && (
            <Text style={[styles.foundMgrs, { color: theme.ink.muted }]} selectable>
              MGRS {foundMgrs}
            </Text>
          )}
          {nearest && (
            <Pressable onPress={() => onPressPoint(nearest.point.id)} style={styles.nearRow}>
              <Ionicons name="location-outline" size={16} color={theme.ink.muted} />
              <Text style={[styles.nearText, { color: theme.ink.primary }]} numberOfLines={1}>
                Поруч ваша точка: {nearest.point.title} · {nearest.meters < 1000 ? `${Math.round(nearest.meters)} м` : `${(nearest.meters / 1000).toFixed(1)} км`}
              </Text>
            </Pressable>
          )}
          <View style={styles.foundActions}>
            <Pressable
              style={[styles.foundButton, { borderColor: theme.edge.hairline }]}
              onPress={() => {
                Clipboard.setStringAsync(formatDecimalLatLng(found)).catch(() => {});
                notify('Скопійовано', formatDecimalLatLng(found));
              }}
            >
              <Ionicons name="copy-outline" size={18} color={theme.ink.primary} />
              <Text style={[styles.foundButtonLabel, { color: theme.ink.primary }]}>Копіювати</Text>
            </Pressable>
            {onRulerChange && (
              <Pressable
                style={[styles.foundButton, { borderColor: theme.edge.hairline }]}
                onPress={() => {
                  setRuler([found]);
                  setFound(null);
                  onRulerChange(true);
                }}
              >
                <Ionicons name={"lc:ruler" as never} size={18} color={theme.ink.primary} />
                <Text style={[styles.foundButtonLabel, { color: theme.ink.primary }]}>Звідси</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}
      {rulerOn && (
        <View style={[styles.foundCard, { bottom: bottomInset + 12, backgroundColor: theme.raised, borderColor: theme.edge.hairline }]}>
          <Text style={[styles.foundCoords, { color: theme.ink.primary }]}>
            {ruler.length > 1 ? formatDistance(rulerTotal) : 'Рулетка'}
            <Text style={[styles.foundMgrs, { color: theme.ink.muted }]}>
              {ruler.length > 1 ? `  · ${ruler.length - 1} ${ruler.length === 2 ? 'відрізок' : ruler.length < 6 ? 'відрізки' : 'відрізків'}` : ''}
            </Text>
          </Text>
          <Text style={[styles.foundMgrs, { color: theme.ink.muted }]}>
            {ruler.length === 0 ? 'Торкніться мапи, щоб поставити першу точку.' : 'Торкніться мапи, щоб додати точку.'}
          </Text>
          <View style={styles.foundActions}>
            <Pressable
              style={[styles.foundButton, { borderColor: theme.edge.hairline }, ruler.length === 0 && { opacity: 0.4 }]}
              disabled={ruler.length === 0}
              onPress={() => setRuler((prev) => prev.slice(0, -1))}
            >
              <Ionicons name="arrow-undo-outline" size={18} color={theme.ink.primary} />
              <Text style={[styles.foundButtonLabel, { color: theme.ink.primary }]}>Крок назад</Text>
            </Pressable>
            <Pressable
              style={[styles.foundButton, { borderColor: theme.edge.hairline }, ruler.length === 0 && { opacity: 0.4 }]}
              disabled={ruler.length === 0}
              onPress={() => setRuler([])}
            >
              <Ionicons name="close" size={18} color={theme.ink.primary} />
              <Text style={[styles.foundButtonLabel, { color: theme.ink.primary }]}>Очистити</Text>
            </Pressable>
          </View>
        </View>
      )}
      <GeoOfflineRegionsSheet
        visible={offlineOpen ?? offlineSheetVisible}
        currentBounds={view.bounds}
        onClose={() => (onOfflineClose ? onOfflineClose() : setOfflineSheetVisible(false))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  pinGroup: {
    alignItems: 'center',
  },
  pinFocus: { width: 40, height: 40, borderRadius: 20, borderWidth: 3, borderColor: '#fff' },
  pin: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  emptyHint: {
    position: 'absolute',
    left: 24,
    right: 24,
    top: 24,
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  emptyHintText: {
    fontSize: 13,
    textAlign: 'center',
  },
  // Below where the "no points" hint's own box ends (it spans the full
  // width at top:24) - the two would otherwise sit on top of each other
  // when both show at once.
  offlineButton: {
    position: 'absolute',
    left: 16,
    top: 90,
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locateButton: {
    top: 140,
  },
  resolving: {
    position: 'absolute',
    top: 90,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
  },
  foundPin: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  foundCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    padding: 16,
    borderRadius: 22,
    borderWidth: 1,
    gap: 6,
  },
  foundCoords: {
    fontSize: 17,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  foundMgrs: {
    fontSize: 13,
  },
  nearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  nearText: {
    flex: 1,
    fontSize: 13,
  },
  foundActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  foundButton: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  foundButtonLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
});
