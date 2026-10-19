import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '../icons/Ionicons';
import { RADIUS, TYPE, useDeskColors } from '../../theme/desktopTheme';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../../utils/fonts';
import { useStyles } from '../../theme/ThemeProvider';
import type { Theme } from '../../theme/tokens';
import BlockMiniature from '../BlockMiniature';
import { INSERT_GROUPS, TILE_LABELS, type TileKey } from './insertCatalogue';

// THE NOTE'S RIGHT PANEL (the Mac's frame B, 2026-10-20, after Craft's «Insert · Format · Style · Info»): tabs on top -
// «Вставити» (what a block can become or hold, drawn as pictures of the result), «Інфо» (where the note stands, its
// links), «Джерела» (the files, photos, links and records to drag in). The tab's content comes in as props: this
// only draws the frame and the insert catalogue.
export type InspectorTab = 'insert' | 'format' | 'info' | 'refs';

export default function NoteInspector({
  tab,
  onTab,
  onInsert,
  format,
  info,
  refs,
}: {
  tab: InspectorTab;
  onTab: (t: InspectorTab) => void;
  onInsert: (key: TileKey) => void;
  format: ReactNode;
  info: ReactNode;
  refs: ReactNode;
}) {
  const styles = useStyles(makeStyles);
  const D = useDeskColors();
  const [query, setQuery] = useState('');
  const labelOf = useMemo(() => new Map(Object.entries(TILE_LABELS)), []);
  const needle = query.trim().toLowerCase();
  const groups = useMemo(
    () =>
      INSERT_GROUPS.map((g) => ({
        title: g.title,
        keys: g.keys.filter((k) => !needle || (labelOf.get(k) ?? '').toLowerCase().includes(needle)),
      })).filter((g) => g.keys.length > 0),
    [needle, labelOf]
  );
  const tabs: { id: InspectorTab; label: string }[] = [
    { id: 'insert', label: 'Вставити' },
    { id: 'format', label: 'Формат' },
    { id: 'info', label: 'Інфо' },
    { id: 'refs', label: 'Джерела' },
  ];
  return (
    <View style={styles.host}>
      <View style={[styles.tabs, { borderBottomColor: D.line }]}>
        {tabs.map((t) => (
          <Pressable key={t.id} onPress={() => onTab(t.id)} style={[styles.tab, t.id === tab && { backgroundColor: D.fill }]}>
            <Text style={[styles.tabText, { color: t.id === tab ? D.ink : D.ink2 }, t.id === tab && { fontFamily: FONT_SEMIBOLD }]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      {tab === 'insert' ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
          <Text style={[styles.hint, { color: D.ink3 }]}>Клацни — вставиться там, де каретка.</Text>
          <View style={[styles.search, { backgroundColor: D.card, borderColor: D.line }]}>
            <Ionicons name="search-outline" size={15} color={D.ink3} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Знайти блок"
              placeholderTextColor={D.ink3}
              style={[styles.searchInput, { color: D.ink }]}
              onSubmitEditing={() => {
                const first = groups[0]?.keys[0];
                if (first) onInsert(first);
              }}
            />
          </View>
          {groups.length === 0 && <Text style={[styles.hint, { color: D.ink3 }]}>Нічого не знайшов.</Text>}
          {groups.map((g) => (
            <View key={g.title} style={{ gap: 8 }}>
              <Text style={[styles.group, { color: D.ink3 }]}>{g.title}</Text>
              <View style={styles.tiles}>
                {g.keys.map((k) => (
                  <Pressable key={k} onPress={() => onInsert(k)} style={styles.tile} accessibilityLabel={labelOf.get(k)}>
                    {(state) => (
                      <>
                        <View style={[styles.pic, { backgroundColor: D.card, borderColor: (state as { hovered?: boolean }).hovered ? D.ink3 : D.line }]}>
                          <BlockMiniature kind={k} width={92} />
                        </View>
                        <Text style={[styles.label, { color: D.ink2 }]} numberOfLines={2}>
                          {labelOf.get(k)}
                        </Text>
                      </>
                    )}
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      ) : tab === 'format' ? (
        <View style={{ flex: 1 }}>{format}</View>
      ) : tab === 'info' ? (
        <View style={{ flex: 1, paddingTop: 12 }}>{info}</View>
      ) : (
        <View style={{ flex: 1 }}>{refs}</View>
      )}
    </View>
  );
}

const makeStyles = (_t: Theme) =>
  StyleSheet.create({
    host: { flex: 1 },
    tabs: { flexDirection: 'row', gap: 2, paddingHorizontal: 12, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
    tab: { paddingHorizontal: 10, height: 28, borderRadius: RADIUS.control, justifyContent: 'center' },
    tabText: { fontSize: TYPE.sm, fontFamily: FONT_REGULAR },
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
