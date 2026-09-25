import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Camera, Map, Marker, type PressEvent } from '@maplibre/maplibre-react-native';
import { Ionicons } from '@expo/vector-icons';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import GlassLayer from './GlassLayer';
import { MAP_STYLE_URL } from '../utils/geoMapStyle';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { SHEET_FRAME, SHEET_WINDOW } from '../constants/glass';
import type { LatLng } from '../utils/geoCoordinates';

// Tap the map, place the point - shared by the two places that ended up
// wanting the exact same thing: GeoPointEntrySheet's own "Мапа" tab (a
// point with no reliable coordinates to start from - a link that only
// geocoded to street level, refused as too imprecise to save outright),
// and the detail sheet's "Неточність" button (a point already saved
// that turned out to be off, the user's own next request once that
// refusal started happening). One component, so a tap means the same
// thing and looks the same in both.
export default function GeoPointMapPicker({
  visible,
  initialPoint,
  initialCenter,
  onCancel,
  onSave,
}: {
  visible: boolean;
  // Already has a point - a marker starts there, ready to drag/retap
  // rather than empty.
  initialPoint?: LatLng | null;
  // No point yet, but roughly where to look - see
  // linkPreview's approximateMapsCenter.
  initialCenter?: LatLng | null;
  onCancel: () => void;
  onSave: (point: LatLng) => void;
}) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const [point, setPoint] = useState<LatLng | null>(initialPoint ?? null);

  useEffect(() => {
    if (visible) setPoint(initialPoint ?? null);
  }, [visible, initialPoint]);

  const center = initialPoint ?? initialCenter ?? DEFAULT_CENTER;

  return (
    <GlassLayer visible={visible} onClose={onCancel} intensity={60}>
      <View style={styles.frame} pointerEvents="box-none">
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>Вкажіть точку на мапі</Text>
            <Pressable hitSlop={8} onPress={onCancel}>
              <Ionicons name="close" size={22} color={theme.ink.muted} />
            </Pressable>
          </View>
          <Text style={styles.hint}>Торкніться мапи, щоб поставити чи перемістити точку</Text>
          <View style={styles.mapWrap}>
            <Map
              style={styles.fill}
              mapStyle={MAP_STYLE_URL}
              onPress={(e: { nativeEvent: PressEvent }) => {
                const [lng, lat] = e.nativeEvent.lngLat;
                setPoint({ lat, lng });
              }}
            >
              <Camera initialViewState={{ center: [center.lng, center.lat], zoom: initialPoint ? 16 : 14 }} />
              {point && (
                <Marker lngLat={[point.lng, point.lat]}>
                  <View style={[styles.pin, { backgroundColor: theme.accent }]}>
                    <Ionicons name="location" size={16} color={theme.onAccent} />
                  </View>
                </Marker>
              )}
            </Map>
          </View>
          <View style={styles.buttons}>
            <Pressable style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]} onPress={onCancel}>
              <Text style={styles.cancelLabel}>Скасувати</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.saveButton, !point && styles.saveButtonDisabled, pressed && styles.pressed]}
              disabled={!point}
              onPress={() => point && onSave(point)}
            >
              <Text style={styles.saveLabel}>Зберегти</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </GlassLayer>
  );
}

// Kyiv, zoomed out to the country - the same fallback GeoMapView and
// GeoPointEntrySheet already open on with nothing of the user's own yet
// to centre on.
const DEFAULT_CENTER: LatLng = { lat: 50.4547, lng: 30.5238 };

const makeStyles = (t: Theme) => StyleSheet.create({
  frame: SHEET_FRAME,
  card: {
    ...SHEET_WINDOW,
    backgroundColor: t.raised,
    borderWidth: 1,
    borderColor: t.edge.hairline,
    padding: 20,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    flex: 1,
    fontSize: 19,
    fontFamily: FONT_BOLD,
    color: t.ink.primary,
  },
  hint: {
    fontSize: 12,
    fontFamily: FONT_REGULAR,
    color: t.ink.muted,
    marginTop: -6,
  },
  mapWrap: {
    height: 320,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: t.field.fill,
  },
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
  buttons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  pressed: {
    opacity: 0.7,
  },
  cancelButton: {
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  cancelLabel: {
    fontSize: 16,
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.muted,
  },
  saveButton: {
    backgroundColor: t.accent,
    borderRadius: 18,
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  saveButtonDisabled: {
    opacity: 0.4,
  },
  saveLabel: {
    fontSize: 16,
    fontFamily: FONT_SEMIBOLD,
    color: t.onAccent,
  },
});
