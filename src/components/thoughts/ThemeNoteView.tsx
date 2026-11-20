import { useEffect, useMemo } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassPortal } from '../GlassPortal';
import { Ionicons } from '../icons/Ionicons';
import { useSoft } from '../../theme/soft';
import { SOFT_BOLD, SOFT_REGULAR, SOFT_SEMIBOLD } from '../../utils/fonts';
import { hueOf, type Thought, type ThoughtTheme } from '../../hooks/useThoughts';
import { boardToStructure, type StructNode } from '../../utils/structureTree';
import { TOP_NAV_H } from '../TopNavBar';
import { CHROME_TOP } from '../../constants/rail';
import { DOCK_BOTTOM } from '../../navigation/dockGeometry';
import type { BoardCard, BoardConnection } from '../../types';
import { FEELINGS } from './feelings';
import { cardTitle } from './thoughtText';
import { readable } from './ThoughtCapture';
import ThemeBoardStrip from './ThemeBoardStrip';

// A THOUGHT CARD'S WORDS AS THE TREE READS THEM: the first line its name, the rest its text.
function thoughtText(t: Thought): string {
  const title = cardTitle(t);
  const words = readable(t.felt).trim();
  if (title) return words ? `${title}\n${words}` : title;
  if (words) return words;
  return t.images?.length ? '[фото]' : 'Думка';
}

// THE THEME READ AS A NOTE (sketch artboard «Тема як нотатка»), the way the AI chat's «Матеріали» read its board: the
// same tree (utils/structureTree) - branches along the arrows, a second arrow into a card as «див. також», all that is
// joined to nothing under «Без зв'язків». Only for reading: the board is where it is changed; the round button goes back.
export default function ThemeNoteView({
  visible,
  theme,
  cards,
  connections,
  thoughtsById,
  onClose,
}: {
  visible: boolean;
  theme: ThoughtTheme;
  cards: BoardCard[];
  connections: BoardConnection[];
  thoughtsById: Map<string, Thought>;
  onClose: () => void;
}) {
  const S = useSoft();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  const nodes = useMemo<StructNode[]>(() => {
    if (!visible) return [];
    const read = cards.map((c) => {
      const t = c.type === 'thought' && c.thoughtId ? thoughtsById.get(c.thoughtId) : undefined;
      return t ? { ...c, type: 'paragraph' as const, text: thoughtText(t) } : c;
    });
    return boardToStructure(read, connections);
  }, [visible, cards, connections, thoughtsById]);
  const feelOf = useMemo(() => {
    const m = new Map<string, number[]>();
    cards.forEach((c) => {
      const f = c.thoughtId ? thoughtsById.get(c.thoughtId)?.feel : undefined;
      if (f) m.set(c.id, [...FEELINGS[f].c]);
    });
    return m;
  }, [cards, thoughtsById]);
  const titleOf = useMemo(() => new Map(nodes.map((n) => [n.id, n.title])), [nodes]);

  if (!visible) return null;
  const barTop = insets.top + CHROME_TOP;
  return (
    <GlassPortal priority={16} name="themeNote">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: S.bg === 'transparent' ? '#F6F5F2' : S.bg }]}>
        <ScrollView contentContainerStyle={{ paddingTop: barTop + TOP_NAV_H + 72, paddingBottom: insets.bottom + 120, paddingHorizontal: 24, gap: 18 }}>
          <Text style={[styles.h1, { color: S.ink }]}>{theme.name}</Text>
          <View style={[styles.frame, { borderColor: S.line }]}>
            <Text style={[styles.label, { color: S.ink3 }]}>Висновок теми</Text>
            <Text style={[styles.body, { color: theme.conclusion ? S.ink : S.ink3 }]}>{theme.conclusion || 'Що з цього ти вже точно знаєш?'}</Text>
          </View>
          {nodes.length === 0 && <Text style={[styles.body, { color: S.ink3 }]}>Тут ще немає думок.</Text>}
          {nodes.map((n) => {
            const c = feelOf.get(n.id);
            const also = n.seeAlso.map((id) => titleOf.get(id)).filter(Boolean);
            const head = n.depth === 1;
            return (
              <View key={n.id} style={{ gap: 4, marginLeft: (n.depth - 1) * 18, marginTop: head ? 6 : 0 }}>
                <View style={styles.row}>
                  {!n.synthetic && <View style={[head ? styles.dot : styles.dotSmall, { backgroundColor: c ? `rgb(${c.join(',')})` : S.ink3 }]} />}
                  <Text style={[head ? styles.h2 : styles.h3, { color: n.synthetic ? S.ink3 : S.ink }]}>{n.title}</Text>
                </View>
                {n.body.map((line, i) => (
                  <Text key={i} style={[styles.body, { color: S.ink2, marginLeft: 20 }]}>
                    {line}
                  </Text>
                ))}
                {also.length > 0 && <Text style={[styles.also, { color: S.ink3, marginLeft: 20 }]}>{`див. також: ${also.join('; ')}`}</Text>}
              </View>
            );
          })}
        </ScrollView>
        <View style={[styles.bar, { top: barTop, backgroundColor: S.card, boxShadow: S.popShadow }]}>
          <View style={[styles.barDot, { backgroundColor: hueOf(theme, S.dark).to }]} />
          <Text style={[styles.barTitle, { color: S.ink }]} numberOfLines={1}>
            {theme.name}
          </Text>
        </View>
        <ThemeBoardStrip theme={theme} top={barTop + TOP_NAV_H + 10} mode="note" onMode={(m) => m === 'board' && onClose()} />
        <Pressable
          onPress={onClose}
          accessibilityLabel="До дошки"
          style={[styles.round, { bottom: insets.bottom + DOCK_BOTTOM + 4, backgroundColor: S.ink }]}
        >
          <Ionicons name={'easel-outline' as never} size={22} color={S.card} />
        </Pressable>
      </View>
    </GlassPortal>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', left: 20, right: 20, height: TOP_NAV_H, borderRadius: TOP_NAV_H / 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 20 },
  barDot: { width: 12, height: 12, borderRadius: 6 },
  barTitle: { fontSize: 17, fontFamily: SOFT_SEMIBOLD, letterSpacing: -0.2, flexShrink: 1 },
  h1: { fontSize: 32, lineHeight: 38, fontFamily: SOFT_BOLD },
  frame: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, gap: 4 },
  label: { fontSize: 11.5, fontFamily: SOFT_BOLD, letterSpacing: 0.5, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 8 },
  dotSmall: { width: 8, height: 8, borderRadius: 4, marginTop: 7 },
  h2: { flex: 1, fontSize: 19, lineHeight: 25, fontFamily: SOFT_BOLD },
  h3: { flex: 1, fontSize: 16, lineHeight: 22, fontFamily: SOFT_SEMIBOLD },
  body: { fontSize: 15, lineHeight: 21, fontFamily: SOFT_REGULAR },
  also: { fontSize: 13, fontFamily: SOFT_REGULAR },
  round: { position: 'absolute', right: 20, width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
});
