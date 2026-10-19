import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '../icons/Ionicons';
import { RADIUS, TYPE, useDeskColors } from '../../theme/desktopTheme';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../../utils/fonts';
import { useStyles, useTheme } from '../../theme/ThemeProvider';
import type { Theme } from '../../theme/tokens';
import { CARD_COLORS, cardSwatch } from '../../constants/cardPalette';
import { FIELD_LABELS, FIELD_ORDER } from '../SortMenuRows';
import type { SortField, SortPref } from '../../utils/sortItems';

// THE EXPLORER'S INSPECTOR (the Mac's frame B, 2026-10-19, the sketch's screen 5): what the «⋯» used to hide, as
// live controls that SHOW their state - the view as a segment, the order as a row of choices, the switches as
// switches - then the folder the explorer stands in (or the one chosen with a click), then the actions. One column,
// no tabs: the explorer has nothing to insert and nothing to format.
export type ExplorerView = 'list' | 'grid' | 'canvas';
export type ExplorerPanelProps = {
  view: ExplorerView;
  onView: (v: ExplorerView) => void;
  sortPref: SortPref;
  onSort: (field: SortField) => void;
  byKind: boolean;
  onByKind: () => void;
  chipsOn: boolean;
  onChips: () => void;
  style: 'clean' | 'modern';
  onStyle: (s: 'clean' | 'modern') => void;
  // The folder in the panel: the one chosen with a click, else the one the explorer stands in.
  folder: { label: string; sub: string; chosen: boolean; colorId?: string; onColor?: (id: string) => void; onOpen?: () => void; pin?: { on: boolean; onToggle: () => void } } | null;
  // A thing chosen with a click (a note, a board, a file…).
  chosen: { title: string; kind: string; facts?: { label: string; value: string }[]; onOpen: () => void } | null;
  onNewFolder: () => void;
  onNewShortcut: () => void;
  candidates: number;
  onCleanup: () => void;
  binned: number;
  onBin: () => void;
};

export default function ExplorerPanel(p: ExplorerPanelProps) {
  const styles = useStyles(makeStyles);
  const D = useDeskColors();
  const scheme = useTheme().scheme;

  const seg = <T extends string>(items: { id: T; label: string }[], current: T, onPick: (id: T) => void) => (
    <View style={[styles.seg, { backgroundColor: D.fill }]}>
      {items.map((it) => (
        <Pressable key={it.id} onPress={() => onPick(it.id)} style={[styles.segItem, it.id === current && { backgroundColor: D.card, boxShadow: D.soft.shadow }]}>
          <Text style={[styles.segText, { color: it.id === current ? D.ink : D.ink2 }, it.id === current && { fontFamily: FONT_SEMIBOLD }]}>{it.label}</Text>
        </Pressable>
      ))}
    </View>
  );
  const toggleRow = (label: string, on: boolean, onPress: () => void) => (
    <Pressable key={label} onPress={onPress} style={styles.line}>
      <Text style={[styles.lineLabel, { color: D.ink2 }]}>{label}</Text>
      <View style={[styles.toggle, { backgroundColor: on ? D.ink : D.line }]}>
        <View style={[styles.knob, { backgroundColor: D.card }, on && { left: 16 }]} />
      </View>
    </Pressable>
  );
  const action = (key: string, icon: string, label: string, onPress: () => void, badge?: string) => (
    <Pressable key={key} onPress={onPress} style={(state) => [styles.act, (state as { hovered?: boolean }).hovered && { backgroundColor: D.fill }]}>
      <Ionicons name={icon as never} size={15} color={D.ink2} />
      <Text style={[styles.actLabel, { color: D.ink }]}>{label}</Text>
      {!!badge && <Text style={[styles.badge, { color: D.ink3 }]}>{badge}</Text>}
    </Pressable>
  );
  const head = (label: string) => <Text style={[styles.head, { color: D.ink3 }]}>{label}</Text>;
  const card = (children: React.ReactNode, tight?: boolean) => (
    <View style={[styles.card, { backgroundColor: D.card, borderColor: D.line }, tight && { paddingHorizontal: 6 }]}>{children}</View>
  );

  return (
    <ScrollView style={styles.host} contentContainerStyle={styles.content}>
      {head('Вигляд')}
      {seg<ExplorerView>(
        [
          { id: 'list', label: 'Список' },
          { id: 'grid', label: 'Сітка' },
          { id: 'canvas', label: 'Полотно' },
        ],
        p.view,
        p.onView
      )}
      {head('Порядок')}
      {card(
        <>
          <View style={styles.orderRow}>
            {FIELD_ORDER.map((field) => {
              const on = p.sortPref.field === field;
              return (
                <Pressable key={field} onPress={() => p.onSort(field)} style={[styles.chip, { backgroundColor: on ? D.ink : D.fill }]}>
                  <Text style={[styles.chipText, { color: on ? D.card : D.ink2 }]}>{on ? `${FIELD_LABELS[field]} ${p.sortPref.dir === 'asc' ? '↑' : '↓'}` : FIELD_LABELS[field]}</Text>
                </Pressable>
              );
            })}
          </View>
          {toggleRow('Групувати за типом', p.byKind, p.onByKind)}
          {toggleRow('Фільтри (тип, проєкт)', p.chipsOn, p.onChips)}
        </>
      )}
      {head('Стиль провідника')}
      {seg<'clean' | 'modern'>(
        [
          { id: 'clean', label: 'Чистий' },
          { id: 'modern', label: 'Модерний' },
        ],
        p.style,
        p.onStyle
      )}

      {p.chosen && (
        <>
          {head('Обране')}
          {card(
            <>
              <View style={styles.fact}>
                <Text style={[styles.factLabel, { color: D.ink3 }]}>{p.chosen.kind}</Text>
                <Text style={[styles.factValue, { color: D.ink }]} numberOfLines={3}>
                  {p.chosen.title}
                </Text>
              </View>
              {(p.chosen.facts ?? []).map((f) => (
                <View key={f.label} style={styles.fact}>
                  <Text style={[styles.factLabel, { color: D.ink3 }]}>{f.label}</Text>
                  <Text style={[styles.factValue, { color: D.ink }]} numberOfLines={2}>
                    {f.value}
                  </Text>
                </View>
              ))}
              <Pressable onPress={p.chosen.onOpen} style={[styles.primary, { backgroundColor: D.ink }]}>
                <Text style={[styles.primaryText, { color: D.card }]}>Відкрити</Text>
                <Text style={[styles.primaryKey, { color: D.card }]}>↩</Text>
              </Pressable>
            </>
          )}
        </>
      )}

      {p.folder && (
        <>
          {head(p.folder.chosen ? 'Обрана папка' : 'Ця папка')}
          {card(
            <>
              <View style={styles.fact}>
                <Text style={[styles.factValue, { color: D.ink }]} numberOfLines={2}>
                  {p.folder.label}
                </Text>
                <Text style={[styles.factSub, { color: D.ink3 }]}>{p.folder.sub}</Text>
              </View>
              {!!p.folder.onColor && (
                <View style={styles.fact}>
                  <Text style={[styles.factLabel, { color: D.ink3 }]}>Колір картки</Text>
                  <View style={styles.swatches}>
                    {CARD_COLORS.map((c) => {
                      const sw = cardSwatch(c.id, scheme);
                      const on = p.folder?.colorId === c.id;
                      return (
                        <Pressable
                          key={c.id}
                          onPress={() => p.folder?.onColor?.(c.id)}
                          accessibilityLabel={c.name}
                          style={[styles.swatch, { backgroundColor: sw?.bg ?? D.fill, borderColor: on ? D.ink : 'transparent' }]}
                        />
                      );
                    })}
                  </View>
                </View>
              )}
              {!!p.folder.pin && action('pin', 'pin-outline', p.folder.pin.on ? 'Відкріпити з бічної панелі' : 'Закріпити в бічній панелі', p.folder.pin.onToggle)}
              {!!p.folder.onOpen && (
                <Pressable onPress={p.folder.onOpen} style={[styles.primary, { backgroundColor: D.ink }]}>
                  <Text style={[styles.primaryText, { color: D.card }]}>Відкрити</Text>
                  <Text style={[styles.primaryKey, { color: D.card }]}>↩</Text>
                </Pressable>
              )}
            </>
          )}
        </>
      )}

      {head('Дії')}
      {card(
        <>
          {action('folder', 'folder-open-outline', 'Нова папка', p.onNewFolder)}
          {action('shortcut', 'rocket-outline', 'Новий ярлик…', p.onNewShortcut)}
          {p.candidates > 0 && action('cleanup', 'sparkles-outline', 'Кандидати на очищення', p.onCleanup, String(p.candidates))}
          {action('bin', 'trash-outline', 'Кошик', p.onBin, p.binned > 0 ? String(p.binned) : undefined)}
        </>,
        true
      )}
    </ScrollView>
  );
}

const makeStyles = (_t: Theme) =>
  StyleSheet.create({
    host: { flex: 1 },
    content: { paddingHorizontal: 16, paddingBottom: 24, gap: 8 },
    head: { fontSize: TYPE.xs, fontFamily: FONT_SEMIBOLD, textTransform: 'uppercase', letterSpacing: 0.4, paddingHorizontal: 4, paddingTop: 8 },
    seg: { flexDirection: 'row', borderRadius: 10, padding: 3 },
    segItem: { flex: 1, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
    segText: { fontSize: TYPE.sm, fontFamily: FONT_REGULAR },
    card: { borderRadius: RADIUS.panel, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 6 },
    orderRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 8 },
    chip: { borderRadius: 999, paddingHorizontal: 10, height: 26, justifyContent: 'center' },
    chipText: { fontSize: TYPE.xs, fontFamily: FONT_SEMIBOLD },
    line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
    lineLabel: { fontSize: TYPE.sm, fontFamily: FONT_REGULAR },
    toggle: { width: 34, height: 20, borderRadius: 10, justifyContent: 'center' },
    knob: { position: 'absolute', left: 2, width: 16, height: 16, borderRadius: 8, boxShadow: '0 1px 2px rgba(0,0,0,0.2)' },
    fact: { paddingVertical: 7, gap: 2 },
    factLabel: { fontSize: TYPE.xs, fontFamily: FONT_REGULAR },
    factValue: { fontSize: TYPE.sm, fontFamily: FONT_SEMIBOLD },
    factSub: { fontSize: TYPE.xs, fontFamily: FONT_REGULAR },
    swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 4 },
    swatch: { width: 24, height: 24, borderRadius: 12, borderWidth: 2 },
    primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 30, borderRadius: RADIUS.control, marginVertical: 8 },
    primaryText: { fontSize: TYPE.sm, fontFamily: FONT_SEMIBOLD },
    primaryKey: { fontSize: TYPE.xs, fontFamily: FONT_REGULAR, opacity: 0.7 },
    act: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 32, paddingHorizontal: 8, borderRadius: RADIUS.control },
    actLabel: { flex: 1, fontSize: TYPE.sm, fontFamily: FONT_REGULAR },
    badge: { fontSize: TYPE.xs, fontFamily: FONT_SEMIBOLD },
  });
