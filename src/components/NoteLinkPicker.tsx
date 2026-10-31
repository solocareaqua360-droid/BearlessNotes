import { useEffect, useRef, useState } from 'react';
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
// On the Mac the window is wider and lists more (Craft's: a «Нотатки» label, five rows, the matched part kept in view).
const WIDE_ROWS = 5;

export default function NoteLinkPicker({
  query,
  index,
  excludeId,
  bottom,
  soft,
  onPick,
  onCreate,
  anchor,
  others = [],
  onCreateBoard,
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
  // Boards and files to link to as well (2026-10-26). `ref` is what goes into the word (see documentBlocks' linkTarget).
  others?: { ref: string; kind: 'board' | 'file'; title: string }[];
  onCreateBoard?: (title: string) => void;
  // The Mac (no keyboard to stand over): under the caret's block, in screen coordinates, with the arrows and Enter to choose.
  anchor?: { left: number; top: number };
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
    .slice(0, anchor ? WIDE_ROWS : ROWS);

  const marked = (title: string) => {
    const at = needle ? title.toLowerCase().indexOf(needle) : -1;
    if (at < 0) return <Text>{title || 'Без назви'}</Text>;
    // A long title is cut at the front so the match stays in view: «…иймання передачі основних засобів».
    const lead = anchor && at > 14 ? at - 8 : 0;
    return (
      <Text>
        {lead > 0 ? '…' : ''}
        {title.slice(lead, at)}
        <Text style={{ fontFamily: SOFT_SEMIBOLD }}>{title.slice(at, at + needle.length)}</Text>
        {title.slice(at + needle.length)}
      </Text>
    );
  };

  // The rows in order: «Нова нотатка» (when something is typed), then the notes found.
  const noteRows = found.map((d) => ({ id: d.id, title: d.title || 'Без назви' }));
  // Notes, boards and files in one list (phone): what starts with the typed word first; no more than a screenful.
  const otherFound = others
    .filter((o) => !needle || o.title.toLowerCase().includes(needle))
    .map((o) => ({ ref: o.ref, kind: o.kind as 'board' | 'file' | 'note', title: o.title || 'Без назви' }));
  const mixed = [...found.map((d) => ({ ref: d.id, kind: 'note' as const, title: d.title || 'Без назви' })), ...otherFound]
    .sort((x, y) => (needle ? (x.title.toLowerCase().startsWith(needle) ? 0 : 1) - (y.title.toLowerCase().startsWith(needle) ? 0 : 1) : 0))
    .slice(0, ROWS + 2);
  const createRow = query.trim() ? [{ create: query.trim() }] : [];
  const rows: ({ create: string } | { id: string; title: string })[] = anchor ? [...noteRows, ...createRow] : [...createRow, ...noteRows];
  const [hot, setHot] = useState(0);
  useEffect(() => setHot(0), [needle]);
  const live = useRef({ rows, hot, onPick, onCreate });
  live.current = { rows, hot, onPick, onCreate };
  useEffect(() => {
    if (!anchor || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      const { rows: list, hot: at, onPick: pick, onCreate: create } = live.current;
      if (!list.length) return;
      const eat = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      if (e.key === 'ArrowDown') { eat(); setHot((at + 1) % list.length); }
      else if (e.key === 'ArrowUp') { eat(); setHot((at - 1 + list.length) % list.length); }
      else if (e.key === 'Enter') {
        eat();
        const row = list[Math.min(at, list.length - 1)];
        if ('create' in row) create(row.create);
        else pick(row.id, row.title);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [!!anchor]);
  if (anchor) {
    // THE MAC'S WINDOW, after Craft's: a quiet label, the notes with the matched part in view, the first one lit;
    // «Нова нотатка» last.
    return (
      <View style={[styles.window, { position: 'fixed', left: anchor.left, top: anchor.top, width: 440, maxWidth: undefined, zIndex: 60, padding: 6, backgroundColor: soft.chrome, boxShadow: soft.popShadow, borderWidth: StyleSheet.hairlineWidth, borderColor: soft.line } as never]}>
        <Text style={[styles.label, { color: soft.ink3 }]}>Нотатки</Text>
        {noteRows.length === 0 && <Text style={[styles.empty, { color: soft.ink3 }]}>{query.trim() ? 'Такої нотатки ще немає' : 'Ще немає нотаток'}</Text>}
        {noteRows.map((d, i) => (
          <Pressable
            key={d.id}
            onPress={() => onPick(d.id, d.title)}
            onHoverIn={() => setHot(i)}
            style={[styles.wideRow, i === hot && { backgroundColor: soft.fill }]}
            {...({ onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault() } as object)}
          >
            <Ionicons name="document-text-outline" size={17} color={soft.ink2} />
            <Text style={[styles.rowText, { color: soft.ink }]} numberOfLines={1}>
              {marked(d.title)}
            </Text>
          </Pressable>
        ))}
        {!!createRow.length && (
          <Pressable
            onPress={() => onCreate(query.trim())}
            onHoverIn={() => setHot(noteRows.length)}
            style={[styles.wideRow, noteRows.length === hot && { backgroundColor: soft.fill }]}
            {...({ onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault() } as object)}
          >
            <Ionicons name="add" size={17} color={soft.accent} />
            <Text style={[styles.rowText, { color: soft.accent, fontFamily: SOFT_SEMIBOLD }]} numberOfLines={1}>
              Нова нотатка «{query.trim()}»
            </Text>
          </Pressable>
        )}
      </View>
    );
  }
  const placed = { bottom };
  return (
    <>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: soft.dark ? 'rgba(0,0,0,0.25)' : 'rgba(246,245,242,0.45)' }]} />
      <View style={[styles.window, placed, { backgroundColor: soft.chrome, boxShadow: soft.popShadow }]}>
        <View style={[styles.head, { borderBottomColor: soft.line }]}>
          <Ionicons name="document-text-outline" size={14} color={soft.ink3} />
          <Text style={[styles.headText, { color: soft.ink3 }]} numberOfLines={1}>
            {query ? query : 'Нотатка, дошка або файл'}
          </Text>
        </View>
        {/* ONE row to create (2026-10-26, the user: a second «+» row only took the room back): the name, then which kind. */}
        {!!query.trim() && (
          <View style={[styles.row, { gap: 8 }]}>
            <Ionicons name="add" size={17} color={soft.accent} />
            <Text style={[styles.rowText, { color: soft.ink, fontFamily: SOFT_SEMIBOLD }]} numberOfLines={1}>
              «{query.trim()}»
            </Text>
            <Pressable onPress={() => onCreate(query.trim())} hitSlop={6} style={[styles.kindPill, { backgroundColor: soft.ink }]}>
              <Text style={[styles.kindPillText, { color: soft.chrome }]}>нотатка</Text>
            </Pressable>
            {!!onCreateBoard && (
              <Pressable onPress={() => onCreateBoard(query.trim())} hitSlop={6} style={[styles.kindPill, { backgroundColor: soft.fill }]}>
                <Text style={[styles.kindPillText, { color: soft.ink }]}>дошка</Text>
              </Pressable>
            )}
          </View>
        )}
        {mixed.map((d) => (
          <Pressable
            key={d.ref}
            onPress={() => onPick(d.ref, d.title)}
            style={({ pressed }) => [styles.row, { borderTopColor: soft.line, borderTopWidth: StyleSheet.hairlineWidth }, pressed && { backgroundColor: soft.fill }]}
          >
            <Ionicons name={d.kind === 'board' ? 'easel-outline' : d.kind === 'file' ? 'document-outline' : 'document-text-outline'} size={16} color={soft.ink2} />
            <Text style={[styles.rowText, { color: soft.ink }]} numberOfLines={1}>
              {marked(d.title)}
            </Text>
            {d.kind !== 'note' && <Text style={[styles.kindHint, { color: soft.ink3 }]}>{d.kind === 'board' ? 'дошка' : 'файл'}</Text>}
          </Pressable>
        ))}
        {mixed.length === 0 && !query.trim() && (
          <Text style={[styles.empty, { color: soft.ink3 }]}>Ще нічого немає</Text>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  window: {
    position: 'absolute',
    left: 12,
    width: '86%',
    maxWidth: 360,
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
  label: { fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', fontFamily: SOFT_MEDIUM, paddingHorizontal: 10, paddingTop: 6, paddingBottom: 4 },
  wideRow: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 40, paddingHorizontal: 10, borderRadius: 10 },
  headText: { flex: 1, fontSize: 12, fontFamily: SOFT_MEDIUM },
  kindPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  kindPillText: { fontSize: 12.5, fontFamily: SOFT_SEMIBOLD },
  kindHint: { fontSize: 11.5, fontFamily: SOFT_MEDIUM },
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
