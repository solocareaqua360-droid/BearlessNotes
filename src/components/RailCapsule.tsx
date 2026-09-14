import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { GlassPortal } from './GlassPortal';
import { useBlurTarget } from './GlassTarget';
import { GLASS_ISLAND } from '../constants/glass';
import { RAIL_RIGHT } from '../constants/rail';

// One capsule of the right-hand rail: a stack of icon buttons in the
// glass, with a hairline between each pair. The top capsule of every
// screen has been built by hand so far; this is the same shape, made
// once, for the ACTIONS capsule that the rail gained when the folder
// button left - what a screen can do to its list (sort it, choose in it),
// grouped by role the way the iPhone Fold's rail groups its buttons.
//
// Drawn through the portal like every other piece of glass: the blur
// that fills it cannot live inside the view it blurs.
export type RailButton = {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  // The button whose mode is in force (select mode on): drawn lit.
  active?: boolean;
};

export default function RailCapsule({ buttons, bottom }: { buttons: RailButton[]; bottom: number }) {
  const blurTarget = useBlurTarget();
  if (buttons.length === 0) return null;
  return (
    <GlassPortal>
      <View style={[styles.capsule, { bottom }]}>
        <BlurView
          intensity={60}
          tint="dark"
          blurMethod="dimezisBlurView"
          blurTarget={blurTarget ?? undefined}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        {buttons.map((button, index) => (
          <View key={button.icon + index} style={styles.slot}>
            {index > 0 && <View style={styles.divider} />}
            <Pressable hitSlop={8} onPress={button.onPress} style={[styles.button, button.active && styles.buttonActive]}>
              <Ionicons name={button.icon} size={24} color="#fff" />
            </Pressable>
          </View>
        ))}
      </View>
    </GlassPortal>
  );
}

const styles = StyleSheet.create({
  // The same numbers as every screen's own top capsule: 19 + a 24px icon
  // + 19 across, inside a 1px border, 18 between buttons.
  capsule: {
    position: 'absolute',
    right: RAIL_RIGHT,
    alignItems: 'center',
    paddingVertical: 18,
    paddingHorizontal: 19,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: GLASS_ISLAND,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    zIndex: 20,
  },
  slot: {
    alignItems: 'center',
    gap: 18,
  },
  divider: {
    width: 20,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.3)',
    marginBottom: 18,
  },
  button: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  buttonActive: {
    // Lit, not filled: the mode in force reads as a glow behind the glyph.
    backgroundColor: 'rgba(255,255,255,0.28)',
    transform: [{ scale: 1.35 }],
  },
});
