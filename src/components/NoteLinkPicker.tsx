import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from './icons/Ionicons';
import type { SoftTokens } from '../theme/soft';
import type { DocumentIndex } from '../hooks/useDocumentIndex';
import { SOFT_MEDIUM, SOFT_SEMIBOLD } from '../utils/fonts';

// THE «@» WINDOW (2026-10-05, the user's: "символ @ відкривається поле
// пошуку - маленьке вікно"): typed after a space or at a line's start, an
// "@" opens this small window over the keyboard; what follows narrows the
// notes by title, and a tap puts a word linking to the note in place of
// "@query". The first row makes a new note of that name. Kept small - the
// user did not want the note hidden behind it - with the page behind it
// faintly veiled rather than covered.
const ROWS = 3;

export default function NoteLinkPicker({
  query,
  index,
  excludeId,
  bottom,
  soft,
  onPick,
  onCreate,
}: {
  query: string;
  index: DocumentIndex;
  // The note being written in - it does not link to itself.
  excludeId: string;
  // Over the keyboard.
  bottom: number;
  soft: SoftTokens;
  onPick: (documentId: string, title: string) => void;
  onCreate: (title: string) => void;
}) {
  const needle = query.trim().toLowerCase();
  const found = Array.from(index.values())
    .filter((d) => d.id !== excludeId && !d.deletedAt)
    .filter((d) => !needle || (d.title || '').toLowerCase().includes(needle))
    // A title that starts with what was typed before one that merely holds
    // it; then the newest.
    .sort((a, b) => {
      const pa = (a.title || '').toLowerCase().startsWith(needle) ? 0 : 1;
      const pb = (b.title || '').toLowerCase().startsWith(needle) ? 0 : 1;
      return pa - pb || (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    })
    .slice(0, ROWS);

  const marked = (title: string) => {
    const at = needle ? title.toLowerCase().indexOf(needle) : -1;
    if (at < 0) return <Text>{title || 'Без назви'}</Text>;
    return (
      <Text>
        {title.slice(0, at)}
        <Text style={{ fontFamily: SOFT_SEMIBOLD }}>{title.slice(at, at + needle.length)}</Text>
        {title.slice(at + needle.length)}
      </Text>
    );
  };

  return (
    <>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: soft.dark ? 'rgba(0,0,0,0.25)' : 'rgba(246,245,242,0.45)' }]} />
      <View style={[styles.window, { bottom, backgroundColor: soft.chrome, boxShadow: soft.popShadow }]}>
        <View style={[styles.head, { borderBottomColor: soft.line }]}>
          <Ionicons name="document-text-outline" size={14} color={soft.ink3} />
          <Text style={[styles.headText, { color: soft.ink3 }]} numberOfLines={1}>
            {query ? query : 'Почни вводити назву нотатки'}
          </Text>
        </View>
        {!!query.trim() && (
          <Pressable
            onPress={() => onCreate(query.trim())}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: soft.fill }]}
          >
            <Ionicons name="add" size={17} color={soft.accent} />
            <Text style={[styles.rowText, { color: soft.accent, fontFamily: SOFT_SEMIBOLD }]} numberOfLines={1}>
              Нова нотатка «{query.trim()}»
            </Text>
          </Pressable>
        )}
        {found.map((d) => (
          <Pressable
            key={d.id}
            onPress={() => onPick(d.id, d.title || 'Без назви')}
            style={({ pressed }) => [styles.row, { borderTopColor: soft.line, borderTopWidth: StyleSheet.hairlineWidth }, pressed && { backgroundColor: soft.fill }]}
          >
            <Ionicons name="document-text-outline" size={16} color={soft.ink2} />
            <Text style={[styles.rowText, { color: soft.ink }]} numberOfLines={1}>
              {marked(d.title || '')}
            </Text>
          </Pressable>
        ))}
        {found.length === 0 && !query.trim() && (
          <Text style={[styles.empty, { color: soft.ink3 }]}>Ще немає нотаток</Text>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  window: {
    position: 'absolute',
    left: 12,
    width: '72%',
    maxWidth: 300,
    borderRadius: 16,
    overflow: 'hidden',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headText: { flex: 1, fontSize: 12, fontFamily: SOFT_MEDIUM },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    height: 40,
    paddingHorizontal: 12,
  },
  rowText: { flex: 1, fontSize: 14, fontFamily: SOFT_MEDIUM },
  empty: { fontSize: 13, fontFamily: SOFT_MEDIUM, paddingHorizontal: 12, paddingVertical: 10 },
});
