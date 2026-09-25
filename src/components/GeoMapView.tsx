import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Camera, Map, Marker, type CameraRef, type ViewStateChangeEvent } from '@maplibre/maplibre-react-native';
import Supercluster, { type PointFeature } from 'supercluster';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { OSM_RASTER_STYLE } from '../utils/geoMapStyle';
import GeoOfflineRegionsSheet from './GeoOfflineRegionsSheet';

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

type PointProps = { pointId: string; title: string };

// The FIRST slice's plain pins now go through supercluster: a point
// stands alone once the map is zoomed in past where its neighbours would
// collide with it, and a bubble with a count stands in for a knot of
// them everywhere else - tapping one flies the camera in rather than
// trying to show every point inside it at once. See
// `project_map_view_plan` for the rest of what is still ahead
// (offline regions, the browser build).
export default function GeoMapView({
  points,
  onPressPoint,
}: {
  points: GeoMapPoint[];
  onPressPoint: (id: string) => void;
}) {
  const theme = useTheme();
  const cameraRef = useRef<CameraRef>(null);
  const first = points[0];
  const initialZoom = first ? 11 : DEFAULT_ZOOM;
  const initialCenter: [number, number] = first ? [first.lng, first.lat] : DEFAULT_CENTER;
  const [view, setView] = useState<{ zoom: number; bounds: [number, number, number, number] }>({
    zoom: initialZoom,
    // Wide enough that nothing clusters away before the map's own first
    // onRegionDidChange reports the real bounds a moment later.
    bounds: [initialCenter[0] - 5, initialCenter[1] - 5, initialCenter[0] + 5, initialCenter[1] + 5],
  });

  const index = useMemo(() => {
    const sc = new Supercluster<PointProps>({ radius: 50, maxZoom: 17 });
    const features: PointFeature<PointProps>[] = points.map((p) => ({
      type: 'Feature',
      properties: { pointId: p.id, title: p.title },
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
    }));
    sc.load(features);
    return sc;
  }, [points]);

  const clusters = useMemo(
    () => index.getClusters(view.bounds, Math.round(view.zoom)),
    [index, view.bounds, view.zoom]
  );

  function handleRegionChange(event: { nativeEvent: ViewStateChangeEvent }) {
    setView({ zoom: event.nativeEvent.zoom, bounds: event.nativeEvent.bounds });
  }

  function flyTo(center: [number, number], zoom: number) {
    cameraRef.current?.flyTo({ center, zoom, duration: 400 });
  }

  const [offlineSheetVisible, setOfflineSheetVisible] = useState(false);

  return (
    <View style={styles.fill}>
      <Map style={styles.fill} mapStyle={OSM_RASTER_STYLE} onRegionDidChange={handleRegionChange}>
        <Camera ref={cameraRef} initialViewState={{ center: initialCenter, zoom: initialZoom }} />
        {clusters.map((feature) => {
          const [lng, lat] = feature.geometry.coordinates;
          if ('cluster' in feature.properties) {
            const { cluster_id: clusterId, point_count: count } = feature.properties;
            return (
              <Marker
                key={`c${clusterId}`}
                lngLat={[lng, lat]}
                onPress={() => flyTo([lng, lat], Math.min(20, index.getClusterExpansionZoom(clusterId)))}
              >
                <View style={[styles.cluster, { backgroundColor: theme.accent }]}>
                  <Text style={[styles.clusterLabel, { color: theme.onAccent }]}>{count}</Text>
                </View>
              </Marker>
            );
          }
          const point = feature.properties;
          return (
            <Marker key={point.pointId} lngLat={[lng, lat]} onPress={() => onPressPoint(point.pointId)}>
              <View style={styles.pinGroup}>
                <View style={[styles.pin, { backgroundColor: theme.accent }]}>
                  <Ionicons name="location" size={16} color={theme.onAccent} />
                </View>
                {view.zoom >= LABEL_MIN_ZOOM && (
                  <View style={[styles.pinLabel, { backgroundColor: theme.raised, borderColor: theme.edge.hairline }]}>
                    <Text style={[styles.pinLabelText, { color: theme.ink.primary }]} numberOfLines={1}>
                      {point.title}
                    </Text>
                  </View>
                )}
              </View>
            </Marker>
          );
        })}
      </Map>
      {points.length === 0 && (
        <View style={styles.emptyHint} pointerEvents="none">
          <Text style={[styles.emptyHintText, { color: theme.ink.primary }]}>
            Немає точок із координатами - вставте посилання Google Maps або введіть координати вручну
          </Text>
        </View>
      )}
      <Pressable
        style={[styles.offlineButton, { backgroundColor: theme.raised, borderColor: theme.edge.hairline }]}
        onPress={() => setOfflineSheetVisible(true)}
      >
        <Ionicons name="cloud-download-outline" size={20} color={theme.ink.primary} />
      </Pressable>
      <GeoOfflineRegionsSheet
        visible={offlineSheetVisible}
        currentBounds={view.bounds}
        onClose={() => setOfflineSheetVisible(false)}
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
  pin: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  pinLabel: {
    marginTop: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    maxWidth: 140,
  },
  pinLabelText: {
    fontSize: 11,
  },
  cluster: {
    minWidth: 34,
    height: 34,
    borderRadius: 17,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  clusterLabel: {
    fontSize: 13,
    fontWeight: '700',
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
});
