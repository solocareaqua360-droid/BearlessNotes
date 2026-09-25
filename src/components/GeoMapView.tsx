import { StyleSheet, Text, View } from 'react-native';
import { Camera, Map, Marker } from '@maplibre/maplibre-react-native';
import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';

// OpenStreetMap's own public tile server - free, no key, the same choice
// discussed with the user for exactly this reason. It is meant for light,
// occasional use rather than a busy production app; swapping in a
// dedicated tile provider (or a proper vector style once offline regions
// are built) is follow-up work, not a rebuild of this file.
const OSM_RASTER_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

// Kyiv, zoomed out to the country - a reasonable place to open with no
// points of the user's own yet, rather than the middle of the ocean
// MapLibre would otherwise default to.
const DEFAULT_CENTER: [number, number] = [30.5238, 50.4547];
const DEFAULT_ZOOM = 5;

export type GeoMapPoint = { id: string; title: string; lat: number; lng: number };

// The FIRST, minimal slice - see the memory `project_map_view_plan`. Plain
// pins, one per point, no clustering and no zoom-based labels yet:
// verifying the map itself renders and a pin opens its record is the
// thing to confirm before building anything on top of it.
export default function GeoMapView({
  points,
  onPressPoint,
}: {
  points: GeoMapPoint[];
  onPressPoint: (id: string) => void;
}) {
  const theme = useTheme();
  const first = points[0];
  return (
    <View style={styles.fill}>
      <Map style={styles.fill} mapStyle={OSM_RASTER_STYLE}>
        <Camera
          initialViewState={
            first ? { center: [first.lng, first.lat], zoom: 11 } : { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM }
          }
        />
        {points.map((point) => (
          <Marker key={point.id} lngLat={[point.lng, point.lat]} onPress={() => onPressPoint(point.id)}>
            <View style={[styles.pin, { backgroundColor: theme.accent }]}>
              <Ionicons name="location" size={16} color={theme.onAccent} />
            </View>
          </Marker>
        ))}
      </Map>
      {points.length === 0 && (
        <View style={styles.emptyHint} pointerEvents="none">
          <Text style={[styles.emptyHintText, { color: theme.ink.primary }]}>
            Немає точок із координатами - вставте посилання Google Maps або введіть координати вручну
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
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
});
