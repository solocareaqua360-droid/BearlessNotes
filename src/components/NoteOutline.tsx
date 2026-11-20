import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import type { OutlineItem } from '../utils/noteOutline';

// The note's contents as a list (phone: a card over the dock; Mac: the «Зміст» tab of the right panel). Depth is shown by indent
// only - the sketch's own rule - and the section the reader is in carries a dot and a tint. Taps are the caller's business.
export default function NoteOutline({
  items,
  currentId,
  onPick,
  ink,
  inkFaint,
  tint,
  accent,
  compact,
}: {
  items: OutlineItem[];
  currentId: string | null;
  onPick: (id: string) => void;
  ink?: string;
  inkFaint?: string;
  tint?: string;
  accent?: string;
  compact?: boolean;
}) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const color = ink ?? theme.ink.primary;
  const faint = inkFaint ?? theme.ink.muted;
  if (items.length === 0) {
    return <Text style={[styles.empty, { color: faint }]}>У нотатці ще немає заголовків.</Text>;
  }
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={{ paddingVertical: 2 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      {items.map((item) => {
        const current = item.id === currentId;
        return (
          <Pressable
            key={item.id}
            onPress={() => onPick(item.id)}
            style={({ pressed }) => [
              styles.row,
              compact && styles.rowCompact,
              { paddingLeft: 10 + item.depth * 14 },
              current && { backgroundColor: tint ?? theme.field.fill },
              pressed && { opacity: 0.6 },
            ]}
            // The mouse must not take the caret out of the note.
            {...({ onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault() } as object)}
          >
            <View style={[styles.dot, { backgroundColor: current ? accent ?? theme.accent : 'transparent' }]} />
            <Text
              numberOfLines={2}
              style={[
                styles.text,
                compact && { fontSize: 12.5 },
                { color: item.depth >= 2 && !current ? faint : color },
                item.depth === 0 && { fontFamily: FONT_SEMIBOLD },
              ]}
            >
              {item.text}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const makeStyles = (_t: Theme) =>
  StyleSheet.create({
    scroll: { flexGrow: 0 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingRight: 10, borderRadius: 12 },
    rowCompact: { paddingVertical: 6, borderRadius: 8 },
    dot: { width: 5, height: 5, borderRadius: 3 },
    text: { flex: 1, fontSize: 14.5, fontFamily: FONT_REGULAR },
    empty: { fontSize: 13, fontFamily: FONT_REGULAR, padding: 14 },
  });
