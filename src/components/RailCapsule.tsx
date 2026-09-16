import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassPortal } from './GlassPortal';
import GlassDrop, { GlassIcon } from './GlassDrop';
import { useTheme } from '../theme/ThemeProvider';
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
//
// The glass itself - blur, tint, the specular and the two edges - is
// GlassDrop's now, so this capsule looks like every other drop in the
// app and follows the theme with them.
export type RailButton = {
  icon: keyof typeof Ionicons.glyphMap;
  // A small plus (or any glyph) hung off the icon's corner, for a button
  // that ADDS the thing its icon shows. Ionicons has no "document with a
  // plus", and the other family's do exist but are drawn heavier and
  // squarer than anything else here - so the plus is composed, the way
  // this app already composes it on the empty-state icon.
  badge?: keyof typeof Ionicons.glyphMap;
  // How many of the things behind this button are in force, drawn as a
  // small numeral in the same corner the badge uses. One button that
  // opens three settings cannot say "one of us is on" by lighting up, so
  // it says how many. Zero draws nothing.
  count?: number;
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

export default function RailCapsule({
  buttons,
  bottom,
  // Which edge the rail stands on. Right everywhere, except a screen drawn
  // inside another's LEFT pane: there the outer edge of the window is the
  // left one, and a rail against the divider in the middle of the screen
  // is a rail in the way of both halves.
  side = 'right',
}: {
  buttons: RailButton[];
  bottom: number;
  side?: 'left' | 'right';
}) {
  const theme = useTheme();
  if (buttons.length === 0) return null;
  return (
    <GlassPortal>
      <GlassDrop
        style={[styles.capsule, side === 'left' ? styles.capsuleLeft : styles.capsuleRight, { bottom }]}
      >
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
              <GlassIcon name={button.icon} size={button.size ?? 24} />
              {!!button.badge && (
                <View style={styles.badge}>
                  <GlassIcon name={button.badge} size={14} />
                </View>
              )}
              {!!button.count && (
                <View style={styles.count}>
                  <Text style={[styles.countLabel, { color: theme.glass.ink }]}>{button.count}</Text>
                </View>
              )}
            </Pressable>
          </View>
        ))}
      </GlassDrop>
    </GlassPortal>
  );
}

const styles = StyleSheet.create({
  // The same numbers as every screen's own top capsule: 19 + a 24px icon
  // + 19 across, inside a 1px border, 18 between buttons.
  // The shape and where it stands; the glass is GlassDrop's.
  capsule: {
    position: 'absolute',
    alignItems: 'center',
    paddingVertical: 18,
    paddingHorizontal: 19,
    zIndex: 20,
  },
  capsuleRight: {
    right: RAIL_RIGHT,
  },
  capsuleLeft: {
    left: RAIL_RIGHT,
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
  // The corner plus, drawn and nothing else - the disc it sat on was a
  // filled shape among outlines, which is exactly what the heavier icons
  // it replaced were doing wrong.
  badge: {
    position: 'absolute',
    right: -7,
    bottom: -6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The numeral sits where the plus does, and like the plus it has no
  // disc behind it - a filled shape among outlines is exactly what the
  // heavier icons this app dropped were doing wrong.
  count: {
    position: 'absolute',
    right: -8,
    bottom: -7,
    minWidth: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countLabel: {
    fontSize: 11,
    lineHeight: 13,
    fontWeight: '700',
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
