import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import GlassLayer from './GlassLayer';
import { SHEET_FRAME, SHEET_WINDOW } from '../constants/glass';
import type { LatLng } from '../utils/geoCoordinates';

// MapLibre's native module has no browser build - see GeoMapView.web.
// Same plain "not here yet" message rather than a silently missing
// button.
export default function GeoPointMapPicker({
  visible,
  onCancel,
}: {
  visible: boolean;
  initialPoint?: LatLng | null;
  initialCenter?: LatLng | null;
  onCancel: () => void;
  onSave: (point: LatLng) => void;
}) {
  const theme = useTheme();
  return (
    <GlassLayer visible={visible} onClose={onCancel} intensity={60}>
      <View style={SHEET_FRAME} pointerEvents="box-none">
        <View style={[SHEET_WINDOW, styles.card, { backgroundColor: theme.raised, borderColor: theme.edge.hairline }]}>
          <Text style={[styles.text, { color: theme.ink.muted }]}>
            Вказати точку на мапі поки що можна лише на телефоні - версія для браузера ще не готова.
          </Text>
          <Pressable onPress={onCancel}>
            <Text style={[styles.close, { color: theme.accent }]}>Закрити</Text>
          </Pressable>
        </View>
      </View>
    </GlassLayer>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    padding: 20,
    gap: 12,
  },
  text: {
    fontSize: 14,
    textAlign: 'center',
  },
  close: {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
});
