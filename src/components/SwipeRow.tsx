import { ReactNode, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { interpolate, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Ionicons } from './icons/Ionicons';
import { hapticPickUp } from '../utils/haptics';

// A ROW THAT ANSWERS TO THE FINGER - «Справи» v2 (the user's sketch
// «Відкрита справа», 2026-10-09). In a list a task is only its words; what
// can be done with it lies under it:
//   a short swipe opens two buttons on the side it came from, a tap on one
//   does it, letting go without one brings the row back;
//   a long swipe (past half the row) fills the row with the main action's
//   colour, gives one tick of haptics, and letting go DOES it.
// Right is forward (today, start, done), left is "put it off". A long swipe
// never deletes - deleting is a button, on purpose.
//
// Only a sideways move starts it: a finger that went up or down first is
// the list's scroll (failOffsetY), and the screen's edges belong to
// Android's own back gesture, which takes them before the app sees them.
// The worklets read shared values and numbers only (see the memory
// reanimated_worklet_closure: a worklet copies every object it names).

export type SwipeAction = { key: string; label: string; icon: string; color: string; onPress: () => void };

const BUTTON_W = 78;

export default function SwipeRow({
  id,
  openId,
  onOpenChange,
  leading,
  trailing,
  longLeading,
  longTrailing,
  enabled = true,
  children,
}: {
  id: string;
  // Which row stands open; opening one closes the rest.
  openId: string | null;
  onOpenChange: (id: string | null) => void;
  leading: SwipeAction[];
  trailing: SwipeAction[];
  longLeading?: SwipeAction;
  longTrailing?: SwipeAction;
  enabled?: boolean;
  children: ReactNode;
}) {
  const tx = useSharedValue(0);
  const width = useSharedValue(1);
  const armed = useSharedValue(0);
  // Where the card stood when the finger came down (an open row starts from its open place, not from 0).
  const startX = useSharedValue(0);
  // AT REST, the card's place is a plain style React knows (not only the UI thread's transform): React hit-tests by its
  // own idea of where the card is, and with the animated one alone it still thought the card covered the buttons
  // (reanimated_ui_props_dead_press) - a tap on «Завтра» opened the task. A new touch hands the card back to the animation.
  const [still, setStill] = useState<number | null>(null);
  const leadW = leading.length * BUTTON_W;
  const trailW = trailing.length * BUTTON_W;
  const hasLongL = longLeading ? 1 : 0;
  const hasLongR = longTrailing ? 1 : 0;

  // Read at the moment of the gesture, never captured by a worklet.
  const live = useRef({ longLeading, longTrailing, onOpenChange, id });
  live.current = { longLeading, longTrailing, onOpenChange, id };
  const fireLong = (side: number) => {
    const action = side > 0 ? live.current.longLeading : live.current.longTrailing;
    live.current.onOpenChange(null);
    action?.onPress();
  };
  const opened = (open: number) => live.current.onOpenChange(open ? live.current.id : null);
  const tick = () => hapticPickUp();

  // Another row opened: this one goes back.
  useEffect(() => {
    if (openId !== id && tx.value !== 0) {
      setStill(null);
      tx.value = withTiming(0, { duration: 180 });
    }
  }, [openId, id, tx]);

  const pan = Gesture.Pan()
    .enabled(enabled)
    .activeOffsetX([-14, 14])
    .failOffsetY([-12, 12])
    .onStart(() => {
      'worklet';
      startX.value = tx.value;
      runOnJS(setStill)(null);
    })
    .onUpdate((e) => {
      'worklet';
      let next = startX.value + e.translationX;
      // An open row swiped back only CLOSES (the user, 2026-10-26: swiping the open «Сьогодні / Завтра» away brought up
      // the delete side at once, even over the card): it stops at its place, the other side needs a gesture of its own.
      if (startX.value > 0 && next < 0) next = 0;
      if (startX.value < 0 && next > 0) next = 0;
      if (next > 0 && leadW === 0) next = 0;
      if (next < 0 && trailW === 0) next = 0;
      tx.value = next;
      const half = width.value * 0.5;
      const past = (next > half && hasLongL === 1) || (next < -half && hasLongR === 1) ? 1 : 0;
      if (past !== armed.value) {
        armed.value = past;
        if (past === 1) runOnJS(tick)();
      }
    })
    .onEnd(() => {
      'worklet';
      const half = width.value * 0.5;
      if (tx.value > half && hasLongL === 1) {
        tx.value = withTiming(width.value, { duration: 160 }, () => {
          tx.value = 0;
        });
        armed.value = 0;
        runOnJS(fireLong)(1);
        return;
      }
      if (tx.value < -half && hasLongR === 1) {
        tx.value = withTiming(-width.value, { duration: 160 }, () => {
          tx.value = 0;
        });
        armed.value = 0;
        runOnJS(fireLong)(-1);
        return;
      }
      armed.value = 0;
      if (tx.value > leadW * 0.5) {
        tx.value = withTiming(leadW, { duration: 160 }, (done) => {
          if (done) runOnJS(setStill)(leadW);
        });
        runOnJS(opened)(1);
      } else if (tx.value < -trailW * 0.5) {
        tx.value = withTiming(-trailW, { duration: 160 }, (done) => {
          if (done) runOnJS(setStill)(-trailW);
        });
        runOnJS(opened)(1);
      } else {
        tx.value = withTiming(0, { duration: 160 });
        runOnJS(opened)(0);
      }
    });

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));
  const leadFill = useAnimatedStyle(() => ({ opacity: armed.value === 1 && tx.value > 0 ? 1 : 0 }));
  const trailFill = useAnimatedStyle(() => ({ opacity: armed.value === 1 && tx.value < 0 ? 1 : 0 }));
  const leadShow = useAnimatedStyle(() => ({ opacity: tx.value > 2 ? interpolate(tx.value, [0, 24], [0, 1]) : 0 }));
  const trailShow = useAnimatedStyle(() => ({ opacity: tx.value < -2 ? interpolate(-tx.value, [0, 24], [0, 1]) : 0 }));

  const close = () => {
    setStill(null);
    tx.value = withTiming(0, { duration: 160 });
    onOpenChange(null);
  };
  // OPEN, the buttons stand ABOVE the card (2026-10-26: a tap on «Завтра» opened the task's note instead). The card's
  // slide is a UI-thread transform, and React still hit-tests it where it stood before the swipe
  // (reanimated_ui_props_dead_press) - over the buttons. Raised while open (and only then: closed, they are see-through
  // and must not catch a touch), they get the tap; nothing is hidden, the card has moved off them.


  return (
    <View
      style={styles.wrap}
      onLayout={(e) => {
        width.value = e.nativeEvent.layout.width;
      }}
    >
      <Animated.View style={[styles.side, styles.left, leadShow]}>
        {leading.map((a) => (
          <Pressable
            key={a.key}
            style={[styles.button, { backgroundColor: a.color }]}
            onPress={() => {
              close();
              a.onPress();
            }}
          >
            <Ionicons name={a.icon as never} size={19} color="#fff" />
            <Text style={styles.label} numberOfLines={1}>
              {a.label}
            </Text>
          </Pressable>
        ))}
      </Animated.View>
      <Animated.View style={[styles.side, styles.right, trailShow]}>
        {trailing.map((a) => (
          <Pressable
            key={a.key}
            style={[styles.button, { backgroundColor: a.color }]}
            onPress={() => {
              close();
              a.onPress();
            }}
          >
            <Ionicons name={a.icon as never} size={19} color="#fff" />
            <Text style={styles.label} numberOfLines={1}>
              {a.label}
            </Text>
          </Pressable>
        ))}
      </Animated.View>
      {longLeading && (
        <Animated.View pointerEvents="none" style={[styles.fill, { backgroundColor: longLeading.color }, leadFill]}>
          <Ionicons name={longLeading.icon as never} size={20} color="#fff" />
          <Text style={styles.fillText}>{longLeading.label}</Text>
        </Animated.View>
      )}
      {longTrailing && (
        <Animated.View
          pointerEvents="none"
          style={[styles.fill, styles.fillRight, { backgroundColor: longTrailing.color }, trailFill]}
        >
          <Text style={styles.fillText}>{longTrailing.label}</Text>
          <Ionicons name={longTrailing.icon as never} size={20} color="#fff" />
        </Animated.View>
      )}
      <GestureDetector gesture={pan}>
        <Animated.View style={still !== null ? { transform: [{ translateX: still }] } : rowStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  // Not clipped itself, so the card keeps its soft shadow; what lies
  // under the card is rounded on its own and hidden until a swipe.
  wrap: {
    position: 'relative',
  },
  side: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    borderRadius: 18,
    overflow: 'hidden',
  },
  left: {
    left: 0,
  },
  right: {
    right: 0,
  },
  button: {
    width: BUTTON_W,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  label: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  fill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 22,
  },
  fillRight: {
    justifyContent: 'flex-end',
  },
  fillText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
