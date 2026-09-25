import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { GeoMapPoint } from './GeoMapView';

export type { GeoMapPoint } from './GeoMapView';

// MapLibre's NATIVE module (Android/iOS) has no browser build at all - see
// the desktop parity ledger. The browser's own map is `maplibre-gl`, a
// separate library with the same underlying styles and offline-region
// idea, not yet built - a real gap, not a permanent one, so this says so
// plainly rather than showing nothing (the "errors must reach the
// screen" rule this app already follows for Google Drive's own two
// windows).
export default function GeoMapView({ points }: { points: GeoMapPoint[]; onPressPoint: (id: string) => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.fill, styles.center]}>
      <Text style={[styles.text, { color: theme.ink.muted }]}>
        Мапа поки що доступна лише на телефоні - версія для браузера ще не готова.
        {points.length > 0 ? ` Точок із координатами: ${points.length}.` : ''}
      </Text>
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
