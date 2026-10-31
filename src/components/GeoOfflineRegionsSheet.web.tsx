import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import GlassLayer from './GlassLayer';
import { SHEET_FRAME, SHEET_WINDOW } from '../constants/glass';

// MapLibre's OfflineManager is part of the native module - no browser
// build (see GeoMapView.web). Deliberately not importing utils/
// geoOfflinePacks at all here, so its own `OfflineManager` import never
// reaches the web bundle in the first place.
export default function GeoOfflineRegionsSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  currentBounds: [number, number, number, number] | null;
  onClose: () => void;
}) {
  const theme = useTheme();
  return (
    <GlassLayer visible={visible} onClose={onClose} intensity={60}>
      <View style={SHEET_FRAME} pointerEvents="box-none">
        <View style={[SHEET_WINDOW, styles.card, { backgroundColor: theme.raised, borderColor: theme.edge.hairline }]}>
          <Text style={[styles.text, { color: theme.ink.muted }]}>
            Офлайн-завантаження районів поки що доступне лише на телефоні.
          </Text>
          <Pressable onPress={onClose}>
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
