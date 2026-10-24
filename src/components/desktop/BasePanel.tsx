import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '../icons/Ionicons';
import { RADIUS, TYPE, useDeskColors } from '../../theme/desktopTheme';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../../utils/fonts';
import { useStyles } from '../../theme/ThemeProvider';
import type { Theme } from '../../theme/tokens';
import { FIELD_LABELS, FIELD_ORDER } from '../SortMenuRows';
import type { SortField, SortPref } from '../../utils/sortItems';
import { MenuOnLight } from '../MenuLabel';

// THE BASE'S PANEL (the Mac's frame B, 2026-10-21): what the bases' pill and its «⋯» keep (the view, the order, the smart
// folders, choosing, the screen's own rows) as live controls in the right panel, one column, the same dress as the explorer's.
// The pill stays for now (gradual migration): this only adds the panel, it removes nothing.
export default function BasePanel({
  title,
  count,
  shape,
  sortPref,
  onSort,
  tags,
  select,
  folder,
  extra,
}: {
  title?: string;
  count: string;
  shape?: { icon: string; onToggle: () => void };
  sortPref: SortPref;
  onSort: (field: SortField) => void;
  tags?: { on: boolean; onOpen: () => void };
  select?: { on: boolean; onToggle: () => void };
  folder?: { label: string; onPress: () => void };
  // The screen's own rows (menuRows), drawn as they are.
  extra?: ReactNode;
}) {
  const styles = useStyles(makeStyles);
  const D = useDeskColors();
  const head = (label: string) => <Text style={[styles.head, { color: D.ink3 }]}>{label}</Text>;
  const action = (key: string, icon: string, label: string, onPress: () => void, on?: boolean) => (
    <Pressable key={key} onPress={onPress} style={(state) => [styles.act, (state as { hovered?: boolean }).hovered && { backgroundColor: D.fill }]}>
      <Ionicons name={icon as never} size={15} color={D.ink2} />
      <Text style={[styles.actLabel, { color: D.ink }]}>{label}</Text>
      {on && <Ionicons name="checkmark" size={15} color={D.ink} />}
    </Pressable>
  );
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
      {!!title && <Text style={[styles.title, { color: D.ink }]}>{title}</Text>}
      <Text style={[styles.sub, { color: D.ink3 }]}>{count}</Text>
      {head('Порядок')}
      <View style={[styles.card, { backgroundColor: D.card, borderColor: D.line }]}>
        <View style={styles.orderRow}>
          {FIELD_ORDER.map((field) => {
            const on = sortPref.field === field;
            return (
              <Pressable key={field} onPress={() => onSort(field)} style={[styles.chip, { backgroundColor: on ? D.ink : D.fill }]}>
                <Text style={[styles.chipText, { color: on ? D.card : D.ink2 }]}>{on ? `${FIELD_LABELS[field]} ${sortPref.dir === 'asc' ? '↑' : '↓'}` : FIELD_LABELS[field]}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      {/* An empty card is not drawn (the stickers had a bare white bar under this heading). */}
      {(!!shape || !!tags || !!select || !!folder) && (
        <>
          {head('Вигляд і добір')}
          <View style={[styles.card, { backgroundColor: D.card, borderColor: D.line, paddingHorizontal: 6 }]}>
            {!!shape && action('shape', shape.icon, 'Змінити вигляд', shape.onToggle)}
            {!!tags && action('tags', 'pricetag-outline', 'Смартпапки', tags.onOpen, tags.on)}
            {!!select && action('select', 'checkmark-circle-outline', 'Вибрати кілька', select.onToggle, select.on)}
            {!!folder && action('folder', 'folder-open-outline', folder.label, folder.onPress)}
          </View>
        </>
      )}
      {!!extra && (
        <>
          {head('Ще')}
          <MenuOnLight.Provider value>
            <View style={[styles.card, { backgroundColor: D.card, borderColor: D.line, paddingHorizontal: 6 }]}>{extra}</View>
          </MenuOnLight.Provider>
        </>
      )}
    </ScrollView>
  );
}

const makeStyles = (_t: Theme) =>
  StyleSheet.create({
    content: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 24, gap: 8 },
    title: { fontSize: TYPE.lg, fontFamily: FONT_SEMIBOLD },
    sub: { fontSize: TYPE.xs, fontFamily: FONT_REGULAR },
    head: { fontSize: TYPE.xs, fontFamily: FONT_SEMIBOLD, textTransform: 'uppercase', letterSpacing: 0.4, paddingHorizontal: 4, paddingTop: 8 },
    card: { borderRadius: RADIUS.panel, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 6 },
    orderRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 8 },
    chip: { borderRadius: 999, paddingHorizontal: 10, height: 26, justifyContent: 'center' },
    chipText: { fontSize: TYPE.xs, fontFamily: FONT_SEMIBOLD },
    act: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 32, paddingHorizontal: 8, borderRadius: RADIUS.control },
    actLabel: { flex: 1, fontSize: TYPE.sm, fontFamily: FONT_REGULAR },
  });
