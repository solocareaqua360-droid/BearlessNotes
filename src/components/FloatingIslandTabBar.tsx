import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { getLastDatabaseRoute } from '../utils/lastDatabaseRoute';

const ACCENT = '#3B82F6';

const ICON_BY_ROUTE: Record<string, keyof typeof Ionicons.glyphMap> = {
  Документи: 'document-text-outline',
  Календар: 'calendar-outline',
  Більше: 'ellipsis-horizontal-outline',
};

// Replaces the default bottom tab bar with a single floating pill (see
// DocumentsWithIsland.dc.html) - "Пошук" isn't one of these buttons
// anymore (it moved to a top-right icon on DocumentsScreen, pushed as its
// own stack screen), so the Tab.Navigator here only ever has these three
// routes.
export default function FloatingIslandTabBar({ state, navigation }: BottomTabBarProps) {
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.island}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const icon = ICON_BY_ROUTE[route.name] ?? 'ellipse-outline';
          return (
            <Pressable
              key={route.key}
              style={[styles.button, focused && styles.buttonActive]}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (focused || event.defaultPrevented) return;
                // Tapping "Більше" from Документи/Календар jumps straight
                // into whichever database (Files/Photos/Links/Tasks) was
                // last open, instead of always landing on the hub - see
                // DatabaseIslandBar for the matching "step back to hub"
                // half of this, shown while already inside a database.
                const lastDatabase = route.name === 'Більше' ? getLastDatabaseRoute() : null;
                if (lastDatabase?.name === 'Links') {
                  navigation.navigate(lastDatabase.name, lastDatabase.params);
                } else if (lastDatabase) {
                  navigation.navigate(lastDatabase.name);
                } else {
                  navigation.navigate(route.name);
                }
              }}
            >
              <Ionicons name={icon} size={20} color={focused ? ACCENT : '#6B7280'} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 24,
    alignItems: 'center',
  },
  island: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: '#fff',
    borderRadius: 30,
    padding: 8,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  button: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonActive: {
    backgroundColor: '#EFF6FF',
  },
});
