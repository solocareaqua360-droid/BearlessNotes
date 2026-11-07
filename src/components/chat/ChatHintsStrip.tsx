import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSoft } from '../../theme/soft';
import { SOFT_SEMIBOLD } from '../../utils/fonts';
import HintTile from './HintTile';
import type { HintKind } from './HintPicture';

export const HINTS_STRIP_H = 150;
export const ANSWER_HINTS: { kind: HintKind; label: string }[] = [
  { kind: 'table', label: 'Таблицею' },
  { kind: 'board', label: 'Дошкою' },
  { kind: 'short', label: 'Коротше' },
  { kind: 'plan', label: 'Як план' },
  { kind: 'more', label: 'Детальніше' },
  { kind: 'simple', label: 'Простіше' },
];

// THE HINTS UNDER THE CHAT (sketch fin4): the «?» in the dock lifts the conversation by HINTS_STRIP_H (the host pads its list)
// and this band rises from behind the dock into the room - a tile is a request, sent as it is. It slides back the same way.
export default function ChatHintsStrip({ visible, onPick, bottom }: { visible: boolean; onPick: (kind: HintKind) => void; bottom: number }) {
  const S = useSoft();
  const p = useSharedValue(visible ? 1 : 0);
  useEffect(() => {
    p.value = withTiming(visible ? 1 : 0, { duration: 240, easing: Easing.out(Easing.cubic) });
  }, [visible, p]);
  const style = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ translateY: (1 - p.value) * 60 }] }));
  return (
    <Animated.View pointerEvents={visible ? 'auto' : 'none'} style={[styles.band, { bottom, backgroundColor: S.bg }, style]}>
      <View style={[styles.rule, { backgroundColor: S.line }]} />
      <Text style={[styles.head, { color: S.ink2 }]}>ЩО ЗРОБИТИ З ВІДПОВІДДЮ</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tiles}>
        {ANSWER_HINTS.map((h) => (
          <HintTile key={h.kind} kind={h.kind} label={h.label} onPress={() => onPick(h.kind)} />
        ))}
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  band: { position: 'absolute', left: 0, right: 0, height: HINTS_STRIP_H, paddingTop: 10 },
  rule: { position: 'absolute', left: 10, right: 10, top: 0, height: StyleSheet.hairlineWidth },
  head: { fontSize: 11.5, letterSpacing: 0.4, fontFamily: SOFT_SEMIBOLD, paddingHorizontal: 14, paddingBottom: 8 },
  tiles: { gap: 8, paddingHorizontal: 14, paddingBottom: 8 },
});
