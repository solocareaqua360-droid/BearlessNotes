import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import { Ionicons } from './icons/Ionicons';
import Sheet from './surfaces/Sheet';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';

// «Продовжити листи» (the user, 2026-11-09): the road sheets are carried on one by one, by hand, each with its «Продовжити». This is
// one list, a vertical one (the schedule scrolls sideways and a sheet is easy to lose there): the LATEST sheet of every vehicle, none
// ticked beforehand - the user ticks them himself - and one button that continues all the ticked at once. The numbers are not
// touched: they follow the pre-numbered paper blanks, so each new sheet keeps «Задати номер» and is numbered by hand afterwards.
export type ContinueItem = {
  id: string;
  // The vehicle (the schedule's row).
  title: string;
  // The sheet's own number / name, its period and anything else worth seeing.
  line: string;
  period: string;
};

type Props = {
  visible: boolean;
  items: ContinueItem[];
  onClose: () => void;
  onConfirm: (ids: string[]) => void;
};

export default function ContinueSheetsSheet({ visible, items, onClose, onConfirm }: Props) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const [ticked, setTicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (visible) setTicked(new Set());
  }, [visible]);

  const toggle = (id: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const all = items.length > 0 && ticked.size === items.length;
  const n = ticked.size;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Продовжити листи"
      subtitle="Останній лист кожної машини"
      scroll
      maxHeight="80%"
      header={
        <View style={styles.head}>
          <Pressable style={styles.allBtn} onPress={() => setTicked(all ? new Set() : new Set(items.map((i) => i.id)))}>
            <Text style={styles.allLabel}>{all ? 'Зняти всі' : 'Відмітити всі'}</Text>
          </Pressable>
          <Pressable
            disabled={n === 0}
            style={[styles.go, { backgroundColor: n === 0 ? theme.edge.hairline : theme.accent }]}
            onPress={() => onConfirm(items.filter((i) => ticked.has(i.id)).map((i) => i.id))}
          >
            <Text style={[styles.goLabel, n === 0 && { color: theme.ink.faint }]}>{n === 0 ? 'Продовжити' : `Продовжити ${n}`}</Text>
          </Pressable>
        </View>
      }
    >
      {items.length === 0 && <Text style={styles.empty}>Немає листів із періодом, який можна продовжити.</Text>}
      {items.map((item) => {
        const on = ticked.has(item.id);
        return (
          <Pressable key={item.id} style={styles.row} onPress={() => toggle(item.id)}>
            <Ionicons
              name={on ? 'checkmark-circle' : 'ellipse-outline'}
              size={24}
              color={on ? theme.accent : theme.ink.faint}
            />
            <View style={styles.texts}>
              <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.line} numberOfLines={1}>{item.line}</Text>
              <Text style={styles.line} numberOfLines={1}>{item.period}</Text>
            </View>
          </Pressable>
        );
      })}
    </Sheet>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingBottom: 8 },
    allBtn: { paddingVertical: 8, paddingHorizontal: 4 },
    allLabel: { fontSize: 14, fontFamily: FONT_SEMIBOLD, color: t.ink.muted },
    go: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 999 },
    goLabel: { fontSize: 15, fontFamily: FONT_SEMIBOLD, color: '#fff' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
    texts: { flex: 1 },
    title: { fontSize: 15, fontFamily: FONT_SEMIBOLD, color: t.ink.primary },
    line: { fontSize: 13, fontFamily: FONT_REGULAR, color: t.ink.muted, marginTop: 1 },
    empty: { fontSize: 14, fontFamily: FONT_REGULAR, color: t.ink.muted, paddingVertical: 16 },
  });
