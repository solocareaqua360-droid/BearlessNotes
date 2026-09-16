import { useRef } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import GlassDrop, { GlassIcon } from './GlassDrop';
import { useTheme } from '../theme/ThemeProvider';
import type { CardCarry } from '../hooks/useCardCarry';

// The floating card, and the SECOND finger's own gesture - see
// useCardCarry's own comment for why the second finger lives here rather
// than on the card being carried. Mounted once per screen, always
// present but effectively invisible (no ghost, gesture requires 2
// pointers so a single scrolling finger never reaches it) until a carry
// is under way.
export default function CardCarryOverlay<T extends { id: string }>({
  carry,
  label,
  icon,
  onEnterFolder,
}: {
  carry: CardCarry<T>;
  // Stepping into a folder - or back out of one, by tapping a crumb -
  // with the SECOND finger, while the card stays lifted under the first.
  onEnterFolder: (path: string) => void;
  // What the ghost says - kept to a title, so this stays one component
  // for every kind of card rather than a full clone of each one's visual.
  label: (item: T) => string;
  icon: keyof typeof Ionicons.glyphMap;
}) {
  const theme = useTheme();
  const ghost = carry.ghost;
  // translationY is CUMULATIVE since the second finger touched down, so
  // only the change since the last frame is a scroll amount - the same
  // "diff a running total" the app already does for the drop-line spring
  // in the editor's own drag (see DocumentEditorScreen's handleDragUpdate).
  const lastY = useRef(0);

  // ONE finger here, not two - the mistake the first version made. The
  // carried finger is owned by the card's own gesture on another view and
  // its touch began before this overlay existed, so it never reaches this
  // one at all: from here the SECOND physical finger is the only touch
  // there is. Asking for two meant this gesture could never satisfy its
  // own minPointers and so never fired ("реакції на другий палець немає").
  // Requiring one is safe precisely because the overlay is only touchable
  // while a card is being carried - there is nothing else to fight for it.
  const secondFinger = Gesture.Pan()
    .minPointers(1)
    .maxPointers(1)
    .runOnJS(true)
    .onStart(() => {
      lastY.current = 0;
    })
    .onUpdate((e) => {
      // How far DOWN the finger moved since the last frame - the screen
      // wiring decides what that means for its own ScrollView.
      carry.scrollBy(e.translationY - lastY.current);
      lastY.current = e.translationY;
    });

  // The same finger, standing still: a TAP on a folder row steps into it,
  // a tap on a crumb steps back out - without the carried card being put
  // down. Composed Simultaneous rather than raced: a Pan needs real
  // movement before it activates, so the two never both fire for one
  // touch, and both are gesture-handler recognizers on this same view -
  // the composition that arbitrates properly (unlike one holding a native
  // Pressable, which is what went wrong on the card itself).
  const secondFingerTap = Gesture.Tap()
    .maxDuration(400)
    .maxDistance(12)
    .runOnJS(true)
    .onEnd((e, success) => {
      if (success) carry.hitTargetAt(e.absoluteX, e.absoluteY, onEnterFolder);
    });

  const style = useAnimatedStyle(() =>
    ghost ? { left: ghost.x, top: ghost.y, opacity: 1 } : { left: 0, top: 0, opacity: 0 }
  );

  return (
    <GestureDetector gesture={Gesture.Simultaneous(secondFinger, secondFingerTap)}>
      <Animated.View style={StyleSheet.absoluteFill} pointerEvents={ghost ? 'auto' : 'none'}>
        {ghost && (
          <Animated.View style={[styles.ghostWrap, style]} pointerEvents="none">
            <GlassDrop radius={16} lift="shadow" style={styles.ghost}>
              <GlassIcon name={icon} size={16} />
              <Text style={[styles.label, { color: theme.glass.ink }]} numberOfLines={1}>
                {label(ghost.item)}
              </Text>
            </GlassDrop>
          </Animated.View>
        )}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  ghostWrap: {
    position: 'absolute',
    // A lifted card reads as smaller than the row it came from - it is
    // now a thing being carried, not a thing being read - so it does not
    // try to fill the row's original height, only stand at its top-left,
    // sized to its own label rather than the card it left.
    transform: [{ scale: 1.04 }],
  },
  ghost: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    maxWidth: 160,
  },
});
