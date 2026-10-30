import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '../icons/Ionicons';
import { RADIUS, TYPE, useDeskColors } from '../../theme/desktopTheme';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../../utils/fonts';
import { useStyles } from '../../theme/ThemeProvider';
import type { Theme } from '../../theme/tokens';

// THE PANEL OF A BASE OF ONE'S OWN (the Mac's frame B, 2026-10-30, the user's: «на Mac місця предостатньо - все винести, не закопувати в меню»):
// the saved views as a list that is always there (one click to change the view) and, under it, the same parameters the phone keeps in
// its window (sort, filter, group, representation), docked. The top pill and its window stay (gradual migration) - this only adds.
export type PanelView = { id: string | null; name: string; icon: string; active: boolean; onPress: () => void };

export default function CustomBasePanel({
  title,
  count,
  views,
  onNewView,
  children,
}: {
  title: string;
  count: string;
  views: PanelView[];
  onNewView: () => void;
  // The parameters, as the screen draws them.
  children: ReactNode;
}) {
  const styles = useStyles(makeStyles);
  const D = useDeskColors();
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: D.ink }]} numberOfLines={1}>
        {title}
      </Text>
      <Text style={[styles.sub, { color: D.ink3 }]}>{count}</Text>
      <Text style={[styles.head, { color: D.ink3 }]}>Вигляди</Text>
      <View style={[styles.card, { backgroundColor: D.card, borderColor: D.line, paddingHorizontal: 6 }]}>
        {views.map((view) => (
          <Pressable
            key={view.id ?? '__current__'}
            onPress={view.onPress}
            style={(state) => [styles.row, view.active && { backgroundColor: D.fill }, !view.active && (state as { hovered?: boolean }).hovered && { backgroundColor: D.fill }]}
          >
            <Ionicons name={view.icon as never} size={15} color={view.active ? D.ink : D.ink2} />
            <Text style={[styles.rowLabel, { color: D.ink }, view.active && { fontFamily: FONT_SEMIBOLD }]} numberOfLines={1}>
              {view.name}
            </Text>
            {view.active && <Ionicons name="checkmark" size={15} color={D.ink} />}
          </Pressable>
        ))}
        <Pressable onPress={onNewView} style={(state) => [styles.row, (state as { hovered?: boolean }).hovered && { backgroundColor: D.fill }]}>
          <Ionicons name={'add-circle-outline' as never} size={15} color={D.ink2} />
          <Text style={[styles.rowLabel, { color: D.ink2 }]}>Зберегти поточний як вигляд…</Text>
        </Pressable>
      </View>
      <Text style={[styles.head, { color: D.ink3 }]}>Параметри</Text>
      <View style={[styles.card, { backgroundColor: D.card, borderColor: D.line, paddingHorizontal: 6, paddingVertical: 4 }]}>{children}</View>
    </ScrollView>
  );
}

const makeStyles = (_t: Theme) =>
  StyleSheet.create({
    content: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 24, gap: 8 },
    title: { fontSize: TYPE.lg, fontFamily: FONT_SEMIBOLD },
    sub: { fontSize: TYPE.xs, fontFamily: FONT_REGULAR },
    head: { fontSize: TYPE.xs, fontFamily: FONT_SEMIBOLD, textTransform: 'uppercase', letterSpacing: 0.4, paddingHorizontal: 4, paddingTop: 8 },
    card: { borderRadius: RADIUS.panel, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 6 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 34, paddingHorizontal: 8, borderRadius: RADIUS.control },
    rowLabel: { flex: 1, fontSize: TYPE.sm, fontFamily: FONT_REGULAR },
  });
