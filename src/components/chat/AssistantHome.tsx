import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Ionicons } from '../icons/Ionicons';
import { useSoft } from '../../theme/soft';
import { SOFT_BOLD, SOFT_MEDIUM, SOFT_SEMIBOLD } from '../../utils/fonts';
import EdgeFade from '../EdgeFade';
import { CHROME_TOP } from '../../constants/rail';
import TopNavBar, { TOP_NAV_H } from '../TopNavBar';
import type { ChatSummary, ChatTheme } from '../../utils/assistant';

// THE AI'S FIRST SCREEN (features.aiHome, 2026-10-29, sketch P7vugFh1mrFwyNHjK6bnx3): the themes as rows, «Без теми», then the
// latest conversations - the app's dock and «+» under it (the screen publishes them). While a new message is being written
// (`composing`) the list is gone altogether - nothing behind the field to flicker or distract (the user: «все інше або зникає»)
// and a conversation the draft looks like stands at the top with «Продовжити там».
// `level`: null = the whole list; a theme's id, or NO_THEME, = that theme's conversations.
export const NO_THEME = '\u0000none';
const RECENT = 8;

export default function AssistantHome({
  chats,
  themes,
  level,
  onLevel,
  onOpenChat,
  composing,
  similar,
  onContinue,
  focused,
  onHoldTheme,
  onHoldChat,
}: {
  chats: ChatSummary[];
  themes: ChatTheme[];
  level: string | null;
  onLevel: (level: string | null) => void;
  onOpenChat: (id: string) => void;
  composing: boolean;
  similar: ChatSummary | null;
  onContinue: (id: string) => void;
  focused: boolean;
  onHoldTheme: (theme: ChatTheme) => void;
  onHoldChat: (chat: ChatSummary) => void;
}) {
  const S = useSoft();
  const insets = useSafeAreaInsets();
  const themeOf = (id?: string) => themes.find((t) => t.id === id);
  const real = chats.filter((c) => c.count > 0);
  const countIn = (id: string) => real.filter((c) => (id === NO_THEME ? !themeOf(c.themeId) : c.themeId === id)).length;
  const levelTheme = level && level !== NO_THEME ? themeOf(level) : null;
  const title = level === null ? 'Розмови' : levelTheme ? levelTheme.name : 'Без теми';
  const shown = level === null ? real.slice(0, RECENT) : real.filter((c) => (level === NO_THEME ? !themeOf(c.themeId) : c.themeId === level));
  const top = insets.top + CHROME_TOP;
  const when = (t: number) => new Date(t).toLocaleString('uk-UA', { day: 'numeric', month: 'short' });

  const row = (key: string, lead: React.ReactNode, name: string, sub: string | null, right: string | null, onPress: () => void, last: boolean, onLongPress?: () => void) => (
    <Pressable key={key} onPress={onPress} onLongPress={onLongPress} delayLongPress={350} style={[styles.row, sub ? styles.rowTall : null]}>
      <View style={styles.lead}>{lead}</View>
      <View style={styles.text}>
        <Text style={[styles.name, { color: S.ink }]} numberOfLines={1}>
          {name}
        </Text>
        {!!sub && (
          <Text style={[styles.sub, { color: S.ink3 }]} numberOfLines={1}>
            {sub}
          </Text>
        )}
      </View>
      {!!right && <Text style={[styles.count, { color: S.ink3 }]}>{right}</Text>}
      <Ionicons name="chevron-forward" size={17} color={S.ink3} />
      {!last && <View style={[styles.line, { backgroundColor: S.line }]} />}
    </Pressable>
  );
  const dot = (color: string, hollow = false) => (
    <View style={[styles.dot, hollow ? { borderWidth: 1.5, borderColor: S.ink3 } : { backgroundColor: color }]} />
  );
  const chatRow = (c: ChatSummary, last: boolean) => {
    const t = themeOf(c.themeId);
    return row(
      c.id,
      <Ionicons name="chatbubble-outline" size={20} color={S.ink2} />,
      c.title,
      [when(c.updatedAt), level === null && t ? t.name : null].filter(Boolean).join(' · '),
      null,
      () => onOpenChat(c.id),
      last,
      () => onHoldChat(c)
    );
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <ScrollView
        contentContainerStyle={{ paddingTop: top + TOP_NAV_H + 6, paddingBottom: insets.bottom + 140, paddingHorizontal: 20 }}
        keyboardShouldPersistTaps="handled"
      >
        {composing ? (
          // Writing: only what the draft looks like, at the top.
          similar ? (
            <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(140)}>
              <Text style={[styles.caption, { color: S.ink3 }]}>Схожа розмова</Text>
              <View style={[styles.card, { backgroundColor: S.card, borderColor: S.line }]}>
                <View style={styles.cardHead}>
                  {dot(themeOf(similar.themeId)?.color ?? S.ink3, !themeOf(similar.themeId))}
                  <Text style={[styles.cardTitle, { color: S.ink }]} numberOfLines={1}>
                    {similar.title}
                  </Text>
                </View>
                <Text style={[styles.sub, styles.cardSub, { color: S.ink3 }]} numberOfLines={1}>
                  {[when(similar.updatedAt), themeOf(similar.themeId)?.name].filter(Boolean).join(' · ')}
                </Text>
                <Pressable onPress={() => onContinue(similar.id)} style={[styles.pill, { backgroundColor: S.ink }]}>
                  <Text style={[styles.pillText, { color: S.bg === 'transparent' ? S.card : S.bg }]}>Продовжити там</Text>
                </Pressable>
              </View>
            </Animated.View>
          ) : null
        ) : level === null ? (
          <>
            <Text style={[styles.head, { color: S.ink }]}>Теми</Text>
            {themes.map((t) => row(t.id, dot(t.color), t.name, null, String(countIn(t.id) || ''), () => onLevel(t.id), false, () => onHoldTheme(t)))}
            {row('none', dot('', true), 'Без теми', null, String(countIn(NO_THEME) || ''), () => onLevel(NO_THEME), true)}
            {themes.length === 0 && (
              <Text style={[styles.hint, { color: S.ink3 }]}>Тему можна дати розмові, щойно вона почнеться, або через «⋯».</Text>
            )}
            {shown.length > 0 && <Text style={[styles.head, styles.headGap, { color: S.ink }]}>Останні</Text>}
            {shown.map((c, i) => chatRow(c, i === shown.length - 1))}
          </>
        ) : (
          <>
            {shown.map((c, i) => chatRow(c, i === shown.length - 1))}
            {shown.length === 0 && <Text style={[styles.hint, { color: S.ink3 }]}>Тут ще немає розмов.</Text>}
          </>
        )}
      </ScrollView>
      <EdgeFade edge="top" color={S.bg} height={top + TOP_NAV_H} bar />
      {/* The app's own bar (TopNavBar): the dock's desks stand only under it. The name, «‹» inside a theme and «⋯» are its. */}
      {focused && (
        <TopNavBar
          title={{
            icon: level === null || composing ? 'chatbubble-outline' : 'chevron-back',
            label: composing ? 'Нова розмова' : title,
            onPress: level !== null && !composing ? () => onLevel(null) : undefined,
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', left: 20, right: 12, height: TOP_NAV_H, flexDirection: 'row', alignItems: 'center' },
  barTitle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 0 },
  barText: { fontSize: 17, fontFamily: SOFT_SEMIBOLD, flexShrink: 1 },
  barButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  head: { fontSize: 20, fontFamily: SOFT_BOLD, marginBottom: 4 },
  headGap: { marginTop: 24 },
  caption: { fontSize: 13, fontFamily: SOFT_MEDIUM, marginBottom: 8, marginLeft: 4 },
  row: { height: 52, flexDirection: 'row', alignItems: 'center', gap: 14 },
  rowTall: { height: 62 },
  lead: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: 16, fontFamily: SOFT_MEDIUM },
  sub: { fontSize: 13, fontFamily: SOFT_MEDIUM },
  count: { fontSize: 15, fontFamily: SOFT_MEDIUM, fontVariant: ['tabular-nums'] },
  line: { position: 'absolute', left: 38, right: 0, bottom: 0, height: StyleSheet.hairlineWidth },
  dot: { width: 12, height: 12, borderRadius: 6 },
  hint: { fontSize: 13.5, lineHeight: 19, marginTop: 10, marginLeft: 38 },
  card: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 4 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle: { flex: 1, fontSize: 16, fontFamily: SOFT_SEMIBOLD },
  cardSub: { marginLeft: 22 },
  pill: { alignSelf: 'flex-start', marginTop: 10, height: 36, paddingHorizontal: 16, borderRadius: 18, justifyContent: 'center' },
  pillText: { fontSize: 14, fontFamily: SOFT_SEMIBOLD },
});

// THE THEME, OFFERED IN THE CONVERSATION (features.aiHome): quiet chips under the first message - only a mark, nothing moves and
// the answer does not wait. The themes it looks like first, then «Нова тема…», then «Без теми» (which only puts the chips away).
export function ThemeChips({
  likely,
  themes,
  onPick,
  onNew,
  onSkip,
}: {
  likely: ChatTheme[];
  themes: ChatTheme[];
  onPick: (id: string) => void;
  onNew: () => void;
  onSkip: () => void;
}) {
  const S = useSoft();
  const order = [...likely, ...themes.filter((t) => !likely.includes(t))].slice(0, 3);
  const chip = (key: string, label: string, onPress: () => void, color?: string, strong?: boolean) => (
    <Pressable key={key} onPress={onPress} style={[chipStyles.chip, { borderColor: strong ? S.accent : S.line, backgroundColor: S.card }]}>
      {!!color && <View style={[chipStyles.dot, { backgroundColor: color }]} />}
      <Text style={[chipStyles.label, { color: S.ink }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
  return (
    <Animated.View entering={FadeIn.duration(200)} style={chipStyles.row}>
      <Text style={[chipStyles.caption, { color: S.ink3 }]}>Тема:</Text>
      {order.map((t, i) => chip(t.id, likely.includes(t) && i === 0 ? `${t.name}?` : t.name, () => onPick(t.id), t.color, likely.includes(t) && i === 0))}
      {chip('new', 'Нова тема…', onNew)}
      {chip('skip', 'Без теми', onSkip)}
    </Animated.View>
  );
}

const chipStyles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, alignSelf: 'flex-end', justifyContent: 'flex-end', maxWidth: '100%' },
  caption: { fontSize: 13, fontFamily: SOFT_MEDIUM },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 12, borderRadius: 15, borderWidth: 1 },
  dot: { width: 9, height: 9, borderRadius: 4.5 },
  label: { fontSize: 13, fontFamily: SOFT_MEDIUM, maxWidth: 160 },
});
