import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type LayoutChangeEvent } from 'react-native';
import {
  Camera,
  Map,
  type CameraRef,
  type LngLatBounds,
  type MapRef,
} from '@maplibre/maplibre-react-native';
import { Ionicons } from '@expo/vector-icons';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import GlassLayer from './GlassLayer';
import GeoAreaFrame, { type ScreenFrame } from './GeoAreaFrame';
import { OSM_RASTER_STYLE } from '../utils/geoMapStyle';
import { searchPlace } from '../utils/geoPlaceSearch';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { SHEET_FRAME, SHEET_WINDOW } from '../constants/glass';
import { notify } from './surfaces/Ask';

// Draw a rectangle on the map by hand for the offline download - the
// user's own ask: not "whatever the screen happens to show" but a
// deliberate area, plus a way to jump straight to a named place first
// (searchPlace's own boundingbox) rather than panning/zooming to find it.
// A dedicated full-screen picker rather than reusing GeoMapView's live
// map directly: GeoOfflineRegionsSheet already owns a GlassLayer of its
// own, and letting the sheet's own "adding" step (name, detail level)
// survive underneath while this one is open was simpler as two stacked
// layers than as one map juggling both jobs.
export default function GeoAreaPicker({
  visible,
  initialBounds,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  // Roughly what to open centred on - the live map's own bounds at the
  // moment "Вибрати ділянку" was pressed.
  initialBounds: LngLatBounds | null;
  onCancel: () => void;
  onConfirm: (bounds: LngLatBounds) => void;
}) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const mapRef = useRef<MapRef>(null);
  const cameraRef = useRef<CameraRef>(null);
  const [mapSize, setMapSize] = useState<{ width: number; height: number } | null>(null);
  const [frame, setFrame] = useState<ScreenFrame | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [confirming, setConfirming] = useState(false);

  function handleMapLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    setMapSize({ width, height });
    setFrame((prev) => prev ?? defaultFrame(width, height));
  }

  async function handleSearch() {
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    try {
      const found = await searchPlace(q);
      if (!found) {
        notify('Місце не знайдено', 'Спробуйте іншу назву.');
        return;
      }
      cameraRef.current?.fitBounds(found.bounds, {
        padding: { top: 40, left: 40, right: 40, bottom: 40 },
        duration: 800,
      });
    } finally {
      setSearching(false);
    }
  }

  async function handleConfirm() {
    if (!frame || !mapRef.current || confirming) return;
    setConfirming(true);
    try {
      const [westLng, northLat] = await mapRef.current.unproject([frame.x0, frame.y0]);
      const [eastLng, southLat] = await mapRef.current.unproject([frame.x1, frame.y1]);
      onConfirm([westLng, southLat, eastLng, northLat]);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <GlassLayer visible={visible} onClose={onCancel} intensity={60}>
      <View style={styles.frame} pointerEvents="box-none">
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>Виберіть ділянку</Text>
            <Pressable hitSlop={8} onPress={onCancel}>
              <Ionicons name="close" size={22} color={theme.ink.muted} />
            </Pressable>
          </View>
          <View style={styles.searchRow}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={handleSearch}
              placeholder="Знайти місто чи місце"
              placeholderTextColor={theme.ink.faint}
              returnKeyType="search"
              style={styles.searchInput}
            />
            <Pressable style={({ pressed }) => [styles.searchButton, pressed && styles.pressed]} onPress={handleSearch}>
              {searching ? (
                <ActivityIndicator size="small" color={theme.onAccent} />
              ) : (
                <Ionicons name="search" size={18} color={theme.onAccent} />
              )}
            </Pressable>
          </View>
          <Text style={styles.hint}>Перетягніть рамку чи її кути, або спершу знайдіть місце</Text>
          <View style={styles.mapWrap} onLayout={handleMapLayout}>
            <Map ref={mapRef} style={styles.fill} mapStyle={OSM_RASTER_STYLE}>
              <Camera
                ref={cameraRef}
                initialViewState={initialBounds ? { bounds: initialBounds } : { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM }}
              />
            </Map>
            {frame && mapSize && <GeoAreaFrame frame={frame} bounds={mapSize} onChange={setFrame} />}
          </View>
          <View style={styles.buttons}>
            <Pressable style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]} onPress={onCancel}>
              <Text style={styles.cancelLabel}>Скасувати</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.saveButton, !frame && styles.saveButtonDisabled, pressed && styles.pressed]}
              disabled={!frame || confirming}
              onPress={handleConfirm}
            >
              {confirming ? (
                <ActivityIndicator size="small" color={theme.onAccent} />
              ) : (
                <Text style={styles.saveLabel}>Використати ділянку</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </GlassLayer>
  );
}

// Kyiv, zoomed out to the country - the same fallback every other geo
// picker in this app opens on with nothing to centre on yet.
const DEFAULT_CENTER: [number, number] = [30.5238, 50.4547];
const DEFAULT_ZOOM = 5;

const FRAME_MARGIN = 36;

function defaultFrame(width: number, height: number): ScreenFrame {
  const x0 = Math.min(FRAME_MARGIN, width * 0.15);
  const y0 = Math.min(FRAME_MARGIN, height * 0.15);
  return { x0, y0, x1: width - x0, y1: height - y0 };
}

const makeStyles = (t: Theme) => StyleSheet.create({
  frame: SHEET_FRAME,
  card: {
    ...SHEET_WINDOW,
    height: '85%',
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
  searchRow: {
    flexDirection: 'row',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    backgroundColor: t.field.fill,
    borderWidth: 1,
    borderColor: t.edge.hairline,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    color: t.ink.primary,
  },
  searchButton: {
    width: 44,
    borderRadius: 14,
    backgroundColor: t.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    fontSize: 12,
    fontFamily: FONT_REGULAR,
    color: t.ink.muted,
    marginTop: -2,
  },
  mapWrap: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: t.field.fill,
  },
  fill: {
    flex: 1,
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
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
