import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '../icons/Ionicons';
import { RADIUS, TYPE, useDeskColors } from '../../theme/desktopTheme';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../../utils/fonts';
import { useStyles } from '../../theme/ThemeProvider';
import type { Theme } from '../../theme/tokens';
import BlockMiniature from '../BlockMiniature';

// THE BOARD'S RIGHT PANEL (the Mac's frame B, 2026-10-20, the sketch 44M5j7nFwLiaonUGLZyr4u): what the phone kept in the
// «+» sheet, the layers drawer and the dock's selection buttons stands in one column with tabs - Вставити (the kinds of
// card as pictures), Шари, Обране (what to do with what is chosen), Інфо, and one tab per open database window. A tab
// whose content is not given is not drawn. Everything here only DRAWS; the board owns the functions.
export type BoardTab = 'insert' | 'layers' | 'selected' | 'info' | string;

export type InsertGroup = { title: string; tiles: { key: string; label: string; onPress: () => void }[] };

// A tile's picture: the shared miniatures (blockMiniatures.json), the board's own kinds prefixed «b-».
const PICTURE: Record<string, string> = {
  doc: 'b-doc', sticky: 'b-sticky', block: 'b-block', link: 'link', video: 'b-video', geo: 'b-geo', image: 'image', file: 'file',
  board: 'b-board', existing: 'existing', project: 'b-project', tasks: 'b-tasks', window: 'b-dbwin', outline: 'b-maptext',
  'outline-cards': 'b-mapcards', column: 'b-column', strip: 'b-strip', week: 'b-week', area: 'b-area', shape: 'b-shape',
};

export default function BoardPanel({
  tab,
  onTab,
  groups,
  layers,
  selected,
  selectedBadge,
  info,
  dbTabs,
}: {
  tab: BoardTab;
  onTab: (t: BoardTab) => void;
  groups: InsertGroup[];
  layers?: ReactNode;
  selected?: ReactNode;
  // «Обране» carries a dot while something is chosen.
  selectedBadge?: boolean;
  info?: ReactNode;
  dbTabs?: { id: string; label: string; node: ReactNode; onClose: () => void }[];
}) {
  const styles = useStyles(makeStyles);
  const D = useDeskColors();
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () => groups.map((g) => ({ ...g, tiles: g.tiles.filter((t) => !needle || t.label.toLowerCase().includes(needle)) })).filter((g) => g.tiles.length > 0),
    [groups, needle]
  );
  const tabs: { id: string; label: string; badge?: boolean; close?: () => void }[] = [
    { id: 'insert', label: 'Вставити' },
    ...(layers ? [{ id: 'layers', label: 'Шари' }] : []),
    ...(selected ? [{ id: 'selected', label: 'Обране', badge: selectedBadge }] : []),
    ...(info ? [{ id: 'info', label: 'Інфо' }] : []),
    ...(dbTabs ?? []).map((d) => ({ id: d.id, label: d.label, close: d.onClose })),
  ];
  const db = (dbTabs ?? []).find((d) => d.id === tab);
  return (
    <View style={styles.host}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.tabsScroll, { borderBottomColor: D.line }]} contentContainerStyle={styles.tabs}>
        {tabs.map((t) => (
          <Pressable key={t.id} onPress={() => onTab(t.id)} style={[styles.tab, t.id === tab && { backgroundColor: D.fill }]}>
            <Text style={[styles.tabText, { color: t.id === tab ? D.ink : D.ink2 }, t.id === tab && { fontFamily: FONT_SEMIBOLD }]} numberOfLines={1}>
              {t.label}
            </Text>
            {t.badge && <View style={[styles.dot, { backgroundColor: '#D9793F' }]} />}
            {!!t.close && (
              <Pressable hitSlop={6} onPress={t.close}>
                <Ionicons name="close" size={13} color={D.ink3} />
              </Pressable>
            )}
          </Pressable>
        ))}
      </ScrollView>
      {tab === 'insert' ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
          <Text style={[styles.hint, { color: D.ink3 }]}>Клацни — з'явиться посеред поля.</Text>
          <View style={[styles.search, { backgroundColor: D.card, borderColor: D.line }]}>
            <Ionicons name="search-outline" size={15} color={D.ink3} />
            <TextInput value={query} onChangeText={setQuery} placeholder="Знайти картку" placeholderTextColor={D.ink3} style={[styles.searchInput, { color: D.ink }]} />
          </View>
          {shown.length === 0 && <Text style={[styles.hint, { color: D.ink3 }]}>Нічого не знайшов.</Text>}
          {shown.map((g) => (
            <View key={g.title} style={{ gap: 8 }}>
              <Text style={[styles.group, { color: D.ink3 }]}>{g.title}</Text>
              <View style={styles.tiles}>
                {g.tiles.map((t) => (
                  <Pressable key={t.key} onPress={t.onPress} style={styles.tile} accessibilityLabel={t.label}>
                    {(state) => (
                      <>
                        <View style={[styles.pic, { backgroundColor: D.card, borderColor: (state as { hovered?: boolean }).hovered ? D.ink3 : D.line }]}>
                          <BlockMiniature kind={PICTURE[t.key] ?? 'b-doc'} width={92} />
                        </View>
                        <Text style={[styles.label, { color: D.ink2 }]} numberOfLines={2}>
                          {t.label}
                        </Text>
                      </>
                    )}
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      ) : tab === 'layers' ? (
        <View style={{ flex: 1 }}>{layers}</View>
      ) : tab === 'selected' ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
          {selected}
        </ScrollView>
      ) : tab === 'info' ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
          {info}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>{db?.node}</View>
      )}
    </View>
  );
}

const makeStyles = (_t: Theme) =>
  StyleSheet.create({
    host: { flex: 1 },
    tabsScroll: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth },
    tabs: { flexDirection: 'row', gap: 2, paddingHorizontal: 10, paddingBottom: 10 },
    tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 28, borderRadius: RADIUS.control },
    tabText: { fontSize: TYPE.sm, fontFamily: FONT_REGULAR, maxWidth: 130 },
    dot: { width: 6, height: 6, borderRadius: 3 },
    content: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 24, gap: 12 },
    hint: { fontSize: TYPE.xs, fontFamily: FONT_REGULAR },
    search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: RADIUS.control, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, height: 34 },
    searchInput: { flex: 1, fontSize: TYPE.sm, fontFamily: FONT_REGULAR, outlineStyle: 'none' } as never,
    group: { fontSize: TYPE.xs, fontFamily: FONT_SEMIBOLD, textTransform: 'uppercase', letterSpacing: 0.4, paddingHorizontal: 2 },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    tile: { width: 96, gap: 5 },
    pic: { width: 96, height: 68, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
    label: { fontSize: 11.5, fontFamily: FONT_REGULAR, textAlign: 'center', lineHeight: 14 },
  });

// ---------------------------------------------------------------------------------------------------------------
// «ОБРАНЕ»: what to do with what is chosen on the board. The rows are the phone's dock actions, drawn as a list (a glyph
// named «mc:…» is MaterialCommunityIcons', any other Ionicons'); the alignments are two rows of picture buttons and
// «Розкласти сіткою» (they lived in a menu that only showed when two cards were chosen); a chosen shape has its own
// properties instead (the phone's floating capsule).
import { MaterialCommunityIcons } from '@expo/vector-icons';

export type SelectionAction = { key: string; icon: string; label: string; onPress: () => void; active?: boolean };
export type ShapeProps = {
  kind: string;
  text: string;
  sizeLabel: string;
  filled: boolean;
  canFill: boolean;
  colour?: string;
  colours: string[];
  onText: () => void;
  onSize: (step: -1 | 1) => void;
  onFill: () => void;
  onColour: (c: string | undefined) => void;
  onDelete: () => void;
};

const ALIGN: { kind: 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom'; label: string; icon: string }[] = [
  { kind: 'left', label: 'Ліворуч', icon: 'align-horizontal-left' },
  { kind: 'centerX', label: 'По центру (гор.)', icon: 'align-horizontal-center' },
  { kind: 'right', label: 'Праворуч', icon: 'align-horizontal-right' },
  { kind: 'top', label: 'Вгору', icon: 'align-vertical-top' },
  { kind: 'centerY', label: 'По центру (верт.)', icon: 'align-vertical-center' },
  { kind: 'bottom', label: 'Вниз', icon: 'align-vertical-bottom' },
];

export function BoardSelection({
  heading,
  actions,
  onClear,
  align,
  shape,
}: {
  heading: string;
  actions: SelectionAction[];
  onClear: () => void;
  align?: { onAlign: (k: (typeof ALIGN)[number]['kind']) => void; onGrid: () => void };
  shape?: ShapeProps;
}) {
  const styles = useStyles(makeSelStyles);
  const D = useDeskColors();
  const head = (t: string) => <Text style={[styles.head, { color: D.ink3 }]}>{t}</Text>;
  const card = (children: ReactNode, tight?: boolean) => (
    <View style={[styles.card, { backgroundColor: D.card, borderColor: D.line }, tight && { paddingHorizontal: 6 }]}>{children}</View>
  );
  const glyph = (icon: string, danger: boolean) =>
    icon.startsWith('mc:') ? (
      <MaterialCommunityIcons name={icon.slice(3) as never} size={16} color={danger ? '#B4452F' : D.ink2} />
    ) : (
      <Ionicons name={icon as never} size={16} color={danger ? '#B4452F' : D.ink2} />
    );
  const rows = actions.filter((a) => a.key !== 'cancel' && a.key !== 'align');
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.headRow}>
        <Text style={[styles.title, { color: D.ink }]}>{heading}</Text>
        <Pressable onPress={onClear} hitSlop={6}>
          <Text style={[styles.clear, { color: D.ink3 }]}>Зняти вибір</Text>
        </Pressable>
      </View>
      {shape && (
        <>
          {head('Фігура')}
          {card(
            <>
              <Pressable onPress={shape.onText} style={styles.line}>
                <Text style={[styles.lineLabel, { color: D.ink2 }]}>Текст</Text>
                <Text style={[styles.lineValue, { color: D.ink }]} numberOfLines={1}>
                  {shape.text || 'Додати…'}
                </Text>
              </Pressable>
              <View style={styles.line}>
                <Text style={[styles.lineLabel, { color: D.ink2 }]}>Розмір тексту</Text>
                <View style={[styles.stepper, { backgroundColor: D.fill }]}>
                  <Pressable onPress={() => shape.onSize(-1)} style={styles.stepBtn}>
                    <Ionicons name="remove" size={15} color={D.ink} />
                  </Pressable>
                  <Text style={[styles.stepLabel, { color: D.ink }]}>{shape.sizeLabel}</Text>
                  <Pressable onPress={() => shape.onSize(1)} style={styles.stepBtn}>
                    <Ionicons name="add" size={15} color={D.ink} />
                  </Pressable>
                </View>
              </View>
              {shape.canFill && (
                <Pressable onPress={shape.onFill} style={styles.line}>
                  <Text style={[styles.lineLabel, { color: D.ink2 }]}>Заливка</Text>
                  <View style={[styles.toggle, { backgroundColor: shape.filled ? D.ink : D.line }]}>
                    <View style={[styles.knob, { backgroundColor: D.card }, shape.filled && { left: 16 }]} />
                  </View>
                </Pressable>
              )}
            </>
          )}
          {head('Колір')}
          <View style={styles.swatches}>
            <Pressable onPress={() => shape.onColour(undefined)} style={[styles.swatch, { borderColor: !shape.colour ? D.ink : D.line, backgroundColor: D.card }]} />
            {shape.colours.map((c) => (
              <Pressable key={c} onPress={() => shape.onColour(c)} style={[styles.swatch, { backgroundColor: c, borderColor: shape.colour === c ? D.ink : 'transparent' }]} />
            ))}
          </View>
        </>
      )}
      {align && (
        <>
          {head('Вирівняти')}
          {card(
            <View style={styles.alignGrid}>
              {ALIGN.map((a) => (
                <Pressable key={a.kind} onPress={() => align.onAlign(a.kind)} accessibilityLabel={a.label} {...({ title: a.label } as object)} style={(state) => [styles.alignBtn, { backgroundColor: (state as { hovered?: boolean }).hovered ? D.line : D.fill }]}>
                  <MaterialCommunityIcons name={a.icon as never} size={19} color={D.ink2} />
                </Pressable>
              ))}
            </View>
          )}
          {card(
            <Pressable onPress={align.onGrid} style={(state) => [styles.act, (state as { hovered?: boolean }).hovered && { backgroundColor: D.fill }]}>
              <Ionicons name="grid-outline" size={16} color={D.ink2} />
              <Text style={[styles.actLabel, { color: D.ink }]}>Розкласти сіткою</Text>
            </Pressable>,
            true
          )}
        </>
      )}
      {rows.length > 0 && head('Дії')}
      {rows.length > 0 &&
        card(
          rows.map((a) => {
            const danger = a.key === 'delete';
            return (
              <Pressable key={a.key} onPress={a.onPress} style={(state) => [styles.act, a.active && { backgroundColor: D.fill }, (state as { hovered?: boolean }).hovered && { backgroundColor: D.fill }]}>
                {glyph(a.icon, danger)}
                <Text style={[styles.actLabel, { color: danger ? '#B4452F' : D.ink }]} numberOfLines={1}>
                  {a.label}
                </Text>
              </Pressable>
            );
          }),
          true
        )}
    </View>
  );
}

const makeSelStyles = (_t: Theme) =>
  StyleSheet.create({
    headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2 },
    title: { fontSize: TYPE.md, fontFamily: FONT_SEMIBOLD },
    clear: { fontSize: TYPE.xs, fontFamily: FONT_REGULAR },
    head: { fontSize: TYPE.xs, fontFamily: FONT_SEMIBOLD, textTransform: 'uppercase', letterSpacing: 0.4, paddingHorizontal: 2, paddingTop: 6 },
    card: { borderRadius: RADIUS.panel, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 6 },
    line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, gap: 10 },
    lineLabel: { fontSize: TYPE.sm, fontFamily: FONT_REGULAR },
    lineValue: { flex: 1, textAlign: 'right', fontSize: TYPE.sm, fontFamily: FONT_SEMIBOLD },
    stepper: { flexDirection: 'row', alignItems: 'center', borderRadius: 9, padding: 2 },
    stepBtn: { width: 28, height: 24, alignItems: 'center', justifyContent: 'center' },
    stepLabel: { minWidth: 34, textAlign: 'center', fontSize: TYPE.sm, fontFamily: FONT_SEMIBOLD },
    toggle: { width: 34, height: 20, borderRadius: 10, justifyContent: 'center' },
    knob: { position: 'absolute', left: 2, width: 16, height: 16, borderRadius: 8 },
    swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 2 },
    swatch: { width: 26, height: 26, borderRadius: 13, borderWidth: 2 },
    alignGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 8 },
    alignBtn: { width: '31.5%', height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
    act: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 34, paddingHorizontal: 8, borderRadius: RADIUS.control },
    actLabel: { flex: 1, fontSize: TYPE.sm, fontFamily: FONT_REGULAR },
  });
