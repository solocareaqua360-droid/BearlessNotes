import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { RADIUS, TYPE, useDeskColors } from '../../theme/desktopTheme';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../../utils/fonts';
import { useStyles } from '../../theme/ThemeProvider';
import type { Theme } from '../../theme/tokens';
import BlockMiniature from '../BlockMiniature';
import { BLOCK_ACTIONS, type BlockAction } from '../blockActions';
import { INSERT_GROUPS } from './NoteInspector';

// «/» ON THE MAC (frame B, 2026-10-20): a flat list under the caret - the same catalogue and the same pictures as the
// panel's «Вставити», cut into the same shelves, filtered by what is typed after the slash ("/чек" keeps the checkbox).
// Arrows and Enter walk and pick, Escape lets go and leaves the "/" as typed. One keydown listener on the window, in the
// capture phase and before the text field sees the key: the field must not also move its caret or make a new block.
export default function SlashPopup({
  query,
  anchor,
  onPick,
  onClose,
}: {
  query: string;
  anchor: { left: number; top: number };
  onPick: (action: BlockAction) => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const D = useDeskColors();
  const labelOf = useMemo(() => new Map(BLOCK_ACTIONS.map((a) => [a.key, a.label])), []);
  const needle = query.trim().toLowerCase();
  const groups = useMemo(
    () =>
      INSERT_GROUPS.map((g) => ({
        title: g.title,
        keys: g.keys.filter((k) => k !== 'scan' && (!needle || (labelOf.get(k) ?? '').toLowerCase().includes(needle))),
      })).filter((g) => g.keys.length > 0),
    [needle, labelOf]
  );
  const flat = useMemo(() => groups.flatMap((g) => g.keys), [groups]);
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [needle]);
  const live = useRef({ flat, index, onPick, onClose });
  live.current = { flat, index, onPick, onClose };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { flat: items, index: at, onPick: pick, onClose: close } = live.current;
      const eat = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      if (e.key === 'ArrowDown') {
        eat();
        setIndex(items.length ? (at + 1) % items.length : 0);
      } else if (e.key === 'ArrowUp') {
        eat();
        setIndex(items.length ? (at - 1 + items.length) % items.length : 0);
      } else if (e.key === 'Enter' && items.length) {
        eat();
        pick(items[Math.min(at, items.length - 1)]);
      } else if (e.key === 'Escape') {
        eat();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  const position = { position: 'fixed', left: anchor.left, top: anchor.top } as never;
  if (flat.length === 0) {
    return (
      <View style={[styles.box, { backgroundColor: D.card, borderColor: D.line, boxShadow: D.soft.shadow }, position]}>
        <Text style={[styles.empty, { color: D.ink3 }]}>Нічого не знайшов</Text>
      </View>
    );
  }
  return (
    <View style={[styles.box, { backgroundColor: D.card, borderColor: D.line, boxShadow: D.soft.shadow }, position]}>
      <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="always">
        {groups.map((g) => (
          <View key={g.title}>
            <Text style={[styles.group, { color: D.ink3 }]}>{g.title}</Text>
            {g.keys.map((k) => {
              const on = flat[index] === k;
              return (
                <Pressable
                  key={k}
                  onPress={() => onPick(k)}
                  onHoverIn={() => setIndex(flat.indexOf(k))}
                  style={[styles.row, on && { backgroundColor: D.fill }]}
                  // The text field must keep its focus: a click on the list is not a click away from the note.
                  {...({ onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault() } as object)}
                >
                  <View style={[styles.pic, { borderColor: D.line, backgroundColor: D.card }]}>
                    <BlockMiniature kind={k} width={46} />
                  </View>
                  <Text style={[styles.label, { color: D.ink }]}>{labelOf.get(k)}</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const makeStyles = (_t: Theme) =>
  StyleSheet.create({
    box: { width: 320, borderRadius: RADIUS.panel, borderWidth: StyleSheet.hairlineWidth, padding: 6, zIndex: 60 },
    group: { fontSize: TYPE.xs, fontFamily: FONT_SEMIBOLD, textTransform: 'uppercase', letterSpacing: 0.4, paddingHorizontal: 8, paddingTop: 8, paddingBottom: 2 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 6, height: 40, borderRadius: RADIUS.control },
    pic: { width: 48, height: 34, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    label: { flex: 1, fontSize: TYPE.sm, fontFamily: FONT_REGULAR },
    empty: { fontSize: TYPE.sm, fontFamily: FONT_REGULAR, padding: 12 },
  });
