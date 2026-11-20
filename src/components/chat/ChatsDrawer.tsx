import { useEffect, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Ionicons } from '../icons/Ionicons';
import { useSoft } from '../../theme/soft';
import { SOFT_MEDIUM, SOFT_SEMIBOLD } from '../../utils/fonts';
import type { ChatSummary, ChatTheme } from '../../utils/assistant';

// THE OTHER CONVERSATIONS, FROM INSIDE ONE (2026-10-29, the user's Claude screenshot as the reference, sketch
// JwVdGx2hGt9KFBjMYbDSNA): a drawer from the left OVER the conversation - it stays where it is, only dimmed (moving the
// living conversation aside every frame is what made the dock stall). «Усі розмови», the themes, the latest ones with the one
// open now marked, and «Нова розмова» floating at the foot.
const RECENT = 8;

export default function ChatsDrawer({
  visible,
  onClose,
  chats,
  themes,
  currentId,
  onOpenChat,
  onAll,
  onTheme,
  onNew,
}: {
  visible: boolean;
  onClose: () => void;
  chats: ChatSummary[];
  themes: ChatTheme[];
  currentId?: string;
  onOpenChat: (id: string) => void;
  onAll: () => void;
  // A theme's id, or null for «Без теми».
  onTheme: (id: string | null) => void;
  onNew: () => void;
}) {
  const S = useSoft();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const W = Math.min(360, Math.round(width * 0.78));
  const p = useSharedValue(0);
  // Drawn until it has slid out again.
  const [shown, setShown] = useState(visible);
  useEffect(() => {
    if (visible) setShown(true);
    p.value = withTiming(visible ? 1 : 0, { duration: visible ? 240 : 200, easing: Easing.out(Easing.cubic) }, (done) => {
      if (done && !visible) runOnJS(setShown)(false);
    });
  }, [visible, p]);
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);
  const panel = useAnimatedStyle(() => ({ transform: [{ translateX: (p.value - 1) * (W + 24) }] }));
  const dim = useAnimatedStyle(() => ({ opacity: p.value }));
  if (!shown) return null;

  const real = chats.filter((c) => c.count > 0);
  const themed = (id: string) => real.some((c) => c.themeId === id);
  const row = (key: string, lead: React.ReactNode, label: string, onPress: () => void, current = false) => (
    <Pressable key={key} onPress={onPress} style={[styles.row, current && { backgroundColor: S.fillSolid }]} accessibilityLabel={label}>
      <View style={styles.lead}>{lead}</View>
      <Text style={[styles.rowText, { color: S.ink }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
  const bubble = <Ionicons name="chatbubble-outline" size={21} color={S.ink2} />;
  const dot = (color: string | null) => <View style={[styles.dot, color ? { backgroundColor: color } : { borderWidth: 1.5, borderColor: S.ink3 }]} />;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={visible ? 'auto' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)' }, dim]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Закрити розмови" />
      </Animated.View>
      <Animated.View style={[styles.panel, { width: W, backgroundColor: S.bg === 'transparent' ? S.card : S.bg, borderColor: S.line, paddingTop: insets.top + 10 }, panel]}>
        <View style={styles.head}>
          <Text style={[styles.title, { color: S.ink }]}>Розмови</Text>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: insets.bottom + 96 }}>
          {row('all', <Ionicons name="chatbubbles-outline" size={21} color={S.ink2} />, 'Усі розмови', onAll)}
          <Text style={[styles.section, { color: S.ink3 }]}>Теми</Text>
          {themes.filter((t) => themed(t.id)).map((t) => row(t.id, dot(t.color), t.name, () => onTheme(t.id)))}
          {row('none', dot(null), 'Без теми', () => onTheme(null))}
          <Text style={[styles.section, { color: S.ink3 }]}>Нещодавні</Text>
          {real.slice(0, RECENT).map((c) => row(c.id, bubble, c.title, () => onOpenChat(c.id), c.id === currentId))}
        </ScrollView>
        <View style={[styles.newRow, { bottom: insets.bottom + 22 }]} pointerEvents="box-none">
          <Pressable onPress={onNew} style={[styles.newPill, { backgroundColor: S.ink }]} accessibilityLabel="Нова розмова">
            <Ionicons name="add" size={20} color={S.bg === 'transparent' ? S.card : S.bg} />
            <Text style={[styles.newText, { color: S.bg === 'transparent' ? S.card : S.bg }]}>Нова розмова</Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { position: 'absolute', left: 0, top: 0, bottom: 0, borderTopRightRadius: 32, borderBottomRightRadius: 32, borderRightWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  head: { height: 56, justifyContent: 'center', paddingHorizontal: 22 },
  title: { fontSize: 26, fontFamily: SOFT_SEMIBOLD },
  section: { fontSize: 14.5, fontFamily: SOFT_MEDIUM, paddingHorizontal: 14, paddingTop: 20, paddingBottom: 6 },
  row: { height: 48, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 14, borderRadius: 16 },
  lead: { width: 24, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, fontSize: 16.5, fontFamily: SOFT_MEDIUM },
  dot: { width: 11, height: 11, borderRadius: 6 },
  newRow: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  newPill: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 50, paddingHorizontal: 22, borderRadius: 25 },
  newText: { fontSize: 16, fontFamily: SOFT_SEMIBOLD },
});
