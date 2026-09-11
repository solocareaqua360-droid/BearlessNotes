import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { GlassPortal } from './GlassPortal';
import { useBlurTarget } from './GlassTarget';
import { GLASS_ISLAND } from '../constants/glass';
import { NAV_BOTTOM, NAV_BUTTON, NAV_GAP, NAV_PADDING, RAIL_RIGHT } from '../constants/rail';

const ICON_BY_ROUTE: Record<string, keyof typeof Ionicons.glyphMap> = {
  Документи: 'document-text-outline',
  Календар: 'calendar-outline',
  Дошки: 'apps-outline',
  Більше: 'ellipsis-horizontal-outline',
};

// The navigation island. It used to lie across the bottom of the screen;
// it now stands on its end at the right edge, at the foot of the rail
// every other floating control shares (see constants/rail).
//
// Drawn through the portal, like every other piece of glass: the blur has
// to sit outside the view it blurs, and the screens are what the blur
// target wraps.
export default function FloatingIslandTabBar({ state, navigation }: BottomTabBarProps) {
  const blurTarget = useBlurTarget();

  return (
    <GlassPortal>
      <View style={styles.wrap} pointerEvents="box-none">
        <View style={styles.island}>
          <BlurView
            intensity={60}
            tint="dark"
            blurMethod="dimezisBlurView"
            blurTarget={blurTarget ?? undefined}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          {state.routes.map((route, index) => {
            const focused = state.index === index;
            const icon = ICON_BY_ROUTE[route.name] ?? 'ellipse-outline';
            return (
              <Pressable
                key={route.key}
                style={[styles.button, focused && styles.buttonActive]}
                onPress={() => {
                  const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                  if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
                }}
              >
                <Ionicons name={icon} size={20} color={focused ? '#171310' : 'rgba(255,255,255,0.75)'} />
              </Pressable>
            );
          })}
        </View>
      </View>
    </GlassPortal>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: RAIL_RIGHT,
    bottom: NAV_BOTTOM,
  },
  island: {
    gap: NAV_GAP,
    backgroundColor: GLASS_ISLAND,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    // A capsule now, not a rounded square - and the blur is clipped to it,
    // so its edge stays a clean line.
    borderRadius: 999,
    overflow: 'hidden',
    padding: NAV_PADDING,
    elevation: 6,
  },
  button: {
    width: NAV_BUTTON,
    height: NAV_BUTTON,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonActive: {
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
});
