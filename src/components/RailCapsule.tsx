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
  // A small plus (or any glyph) hung off the icon's corner, for a button
  // that ADDS the thing its icon shows. Ionicons has no "document with a
  // plus", and the other family's do exist but are drawn heavier and
  // squarer than anything else here - so the plus is composed, the way
  // this app already composes it on the empty-state icon.
  badge?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  // Held down - the sticker, on the button that makes a document.
  onLongPress?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  // The button whose mode is in force (select mode on): drawn lit.
  active?: boolean;
  // Nothing to do right now (no page to go back to): dimmed, inert.
  disabled?: boolean;
  // Bigger glyph, for the create capsule whose plus used to be 28.
  size?: number;
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
        {/* One flat column with one gap between everything - the hairline
            is a sibling of the buttons, not part of the next one, or it
            hugs the button above it instead of standing midway. */}
        {buttons.map((button, index) => (
          <View key={button.icon + index} style={styles.slot}>
            {index > 0 && <View style={styles.divider} />}
            <Pressable
              hitSlop={8}
              onPress={button.onPress}
              onLongPress={button.onLongPress}
              onPressIn={button.onPressIn}
              onPressOut={button.onPressOut}
              delayLongPress={400}
              disabled={button.disabled}
              style={[styles.button, button.active && styles.buttonActive, button.disabled && styles.buttonDisabled]}
            >
              <Ionicons name={button.icon} size={button.size ?? 24} color="#fff" />
              {!!button.badge && (
                <View style={styles.badge}>
                  <Ionicons name={button.badge} size={11} color="#fff" />
                </View>
              )}
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
    // The same 18 above the line as the slot's gap puts below it.
    marginTop: 18,
  },
  button: {
    width: 24,
    height: 24,
    // The badge hangs past the glyph's own box.
    overflow: 'visible',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  // The corner plus: its own small disc, so the glyph under it stays
  // readable whatever the capsule is standing on.
  badge: {
    position: 'absolute',
    right: -7,
    bottom: -5,
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: 'rgba(120,120,120,0.95)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.35,
  },
  buttonActive: {
    // Lit, not filled: the mode in force reads as a glow behind the glyph.
    backgroundColor: 'rgba(255,255,255,0.28)',
    transform: [{ scale: 1.35 }],
  },
});
