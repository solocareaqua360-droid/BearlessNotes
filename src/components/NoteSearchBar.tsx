import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { Easing, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { Ionicons } from './icons/Ionicons';
import { useSoft } from '../theme/soft';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';

// SEARCH IN A NOTE (2026-10-24, the user: «як у файлах Word чи Excel» - see DocumentQuickLook's own search, the model for this
// one): a field where the dock stands, the count «3 з 7» and two arrows in it, and the round way out beside it. It GROWS OUT OF
// THE DOCK'S CAPSULE: it starts exactly where the capsule is, at its width, and widens to the field while the dock fades away
// under it (utils/dockAway); closing runs it back into the capsule's place before the dock returns. It rides the keyboard frame
// by frame (the note's own live keyboard height), never a jump after the keyboard has arrived.
export const SEARCH_BAR_H = 56;
const CIRCLE = 56;
const GAP = 10;

export default function NoteSearchBar({
  closing,
  query,
  onChangeQuery,
  count,
  index,
  onStep,
  onClose,
  onClosed,
  keyboard,
  restBottom,
  left,
  right,
  startWidth,
  windowWidth,
}: {
  // Set when the bar is to go: it runs back into the capsule and then calls onClosed.
  closing: boolean;
  query: string;
  onChangeQuery: (q: string) => void;
  count: number;
  index: number;
  onStep: (d: 1 | -1) => void;
  onClose: () => void;
  onClosed: () => void;
  // The keyboard's live height (0 when down).
  keyboard: SharedValue<number>;
  // Where the dock rests above the screen's bottom edge.
  restBottom: number;
  left: number;
  right: number;
  // The dock capsule's width - where the field starts.
  startWidth: number;
  windowWidth: number;
}) {
  const S = useSoft();
  const input = useRef<TextInput>(null);
  const p = useSharedValue(0);
  const fullWidth = Math.max(startWidth, windowWidth - left - right - CIRCLE - GAP);

  useEffect(() => {
    p.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) });
    // The caret once the field has widened, so the keyboard rises under a bar that already stands.
    const t = setTimeout(() => input.current?.focus(), 120);
    return () => clearTimeout(t);
  }, [p]);
  useEffect(() => {
    if (!closing) return;
    input.current?.blur();
    p.value = withTiming(0, { duration: 240, easing: Easing.in(Easing.cubic) }, (done) => {
      if (done) runOnJS(onClosed)();
    });
  }, [closing, p, onClosed]);

  const rise = useAnimatedStyle(() => ({ bottom: Math.max(restBottom, keyboard.value + 10) }));
  const field = useAnimatedStyle(() => ({ width: interpolate(p.value, [0, 1], [startWidth, fullWidth]) }));
  const inner = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0.35, 1], [0, 1], 'clamp') }));
  const circle = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0.2, 1], [0, 1], 'clamp'),
    transform: [{ scale: interpolate(p.value, [0, 1], [0.7, 1]) }],
  }));

  const counter = !query.trim() ? '' : count === 0 ? 'Не знайдено' : `${index + 1} з ${count}`;
  return (
    <Animated.View pointerEvents="box-none" style={[styles.row, { left, right }, rise]}>
      <Animated.View style={[styles.field, { backgroundColor: S.chrome, boxShadow: S.shadow } as never, field]}>
        <Animated.View style={[styles.fieldInner, inner]}>
          <Ionicons name="search-outline" size={19} color={S.ink2} />
          <TextInput
            ref={input}
            value={query}
            onChangeText={onChangeQuery}
            onSubmitEditing={() => onStep(1)}
            placeholder="Знайти в нотатці"
            placeholderTextColor={S.ink3}
            returnKeyType="search"
            submitBehavior="submit"
            autoCorrect={false}
            style={[styles.input, { color: S.ink }]}
          />
          {!!counter && <Text style={[styles.counter, { color: S.ink3 }]}>{counter}</Text>}
          {count > 0 && (
            <>
              <Pressable hitSlop={4} onPress={() => onStep(-1)} accessibilityLabel="Попередній збіг" style={[styles.step, { backgroundColor: S.fillSolid }]}>
                <Ionicons name="chevron-up" size={17} color={S.ink} />
              </Pressable>
              <Pressable hitSlop={4} onPress={() => onStep(1)} accessibilityLabel="Наступний збіг" style={[styles.step, { backgroundColor: S.ink }]}>
                <Ionicons name="chevron-down" size={17} color={S.chrome} />
              </Pressable>
            </>
          )}
        </Animated.View>
      </Animated.View>
      <View style={{ flex: 1 }} />
      <Animated.View style={circle}>
        <Pressable onPress={onClose} hitSlop={6} accessibilityLabel="Закрити пошук" style={[styles.circle, { backgroundColor: S.chrome, boxShadow: S.shadow } as never]}>
          <Ionicons name="close" size={20} color={S.ink} />
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { position: 'absolute', flexDirection: 'row', alignItems: 'center', zIndex: 60 },
  field: { height: SEARCH_BAR_H, borderRadius: SEARCH_BAR_H / 2, overflow: 'hidden' },
  fieldInner: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 18, paddingRight: 6 },
  input: { flex: 1, minWidth: 0, fontSize: 15, fontFamily: FONT_REGULAR, paddingVertical: 0 },
  counter: { fontSize: 12.5, fontFamily: FONT_SEMIBOLD },
  step: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  circle: { width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2, alignItems: 'center', justifyContent: 'center' },
});
