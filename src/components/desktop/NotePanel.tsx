import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '../icons/Ionicons';
import { RADIUS, TYPE, useDeskColors } from '../../theme/desktopTheme';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../../utils/fonts';
import { useStyles } from '../../theme/ThemeProvider';
import type { Theme } from '../../theme/tokens';
import type { Block, Tag } from '../../types';
import type { DocumentIndex, IndexedDocument } from '../../hooks/useDocumentIndex';
import { documentLinksIn } from '../../utils/documentLinks';
import { formatAddedOn } from '../../utils/documentPreview';

// «ЦЯ НОТАТКА» - the Mac's right panel while a note is open (frame B, 2026-10-19, after Claude's own side panel):
// where the note stands and when it was touched, how much is in it, what it points at and what points at it. Nothing
// here is edited - it is the note's context, read off what the app already keeps (the document index carries every
// note's name, dates and `linksTo`, so «сюди посилаються» costs no read of the other notes).
export default function NotePanel({
  documentId,
  blocks,
  tagIds,
  tags,
  index,
  project,
  onOpen,
}: {
  documentId: string;
  blocks: Block[];
  tagIds: string[];
  tags: Tag[];
  index: DocumentIndex;
  // The note's project («Проект» - the one cross-database grouping), or none.
  project: string | null;
  onOpen: (documentId: string) => void;
}) {
  const styles = useStyles(makeStyles);
  const D = useDeskColors();
  const me = index.get(documentId);
  const folders = useMemo(() => tagIds.map((id) => tags.find((t) => t.id === id)?.path).filter((p): p is string => !!p), [tagIds, tags]);
  const size = useMemo(() => {
    const words = blocks.reduce((n, b) => n + (b.text ?? '').split(/\s+/).filter(Boolean).length, 0);
    return { blocks: blocks.length, words };
  }, [blocks]);
  const alive = (d: IndexedDocument | undefined): d is IndexedDocument => !!d && !d.deletedAt;
  const outgoing = useMemo(() => documentLinksIn(blocks).map((id) => index.get(id)).filter(alive), [blocks, index]);
  const incoming = useMemo(
    () => Array.from(index.values()).filter((d) => d.id !== documentId && alive(d) && (d.linksTo ?? []).includes(documentId)),
    [index, documentId]
  );

  const fact = (label: string, value: string, sub?: string) => (
    <View style={styles.fact} key={label}>
      <Text style={[styles.factLabel, { color: D.ink3 }]}>{label}</Text>
      <Text style={[styles.factValue, { color: D.ink }]} numberOfLines={2}>
        {value}
      </Text>
      {!!sub && (
        <Text style={[styles.factSub, { color: D.ink3 }]} numberOfLines={1}>
          {sub}
        </Text>
      )}
    </View>
  );
  const noteRow = (d: IndexedDocument) => (
    <Pressable key={d.id} onPress={() => onOpen(d.id)} style={(state) => [styles.noteRow, (state as { hovered?: boolean }).hovered && { backgroundColor: D.fill }]}>
      <Ionicons name="document-text-outline" size={15} color={D.ink2} />
      <Text style={[styles.noteTitle, { color: D.ink }]} numberOfLines={1}>
        {d.title || 'Без назви'}
      </Text>
      <Ionicons name="chevron-forward" size={13} color={D.ink3} />
    </Pressable>
  );
  const list = (title: string, items: IndexedDocument[], empty: string) => (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: D.ink3 }]}>{title}</Text>
      {items.length ? items.map(noteRow) : <Text style={[styles.empty, { color: D.ink3 }]}>{empty}</Text>}
    </View>
  );

  const folder = folders.length ? folders[0] : '';
  const folderName = folder ? folder.split('/').pop() ?? folder : 'Нерозкладене';
  const folderPath = folder.includes('/') ? folder.split('/').slice(0, -1).join(' / ') : undefined;
  const more = folders.length > 1 ? `+${folders.length - 1}` : undefined;
  return (
    <ScrollView style={styles.host} contentContainerStyle={styles.content}>
      <Text style={[styles.head, { color: D.ink }]}>Ця нотатка</Text>
      <View style={[styles.card, { backgroundColor: D.card, borderColor: D.line }]}>
        {fact('Папка', more ? `${folderName} ${more}` : folderName, folderPath)}
        {fact('Проект', project ?? 'Без проекту')}
        {me?.createdAt ? fact('Створено', formatAddedOn(me.createdAt, true)) : null}
        {me?.updatedAt ? fact('Змінено', formatAddedOn(me.updatedAt, true)) : null}
        {fact('Обсяг', `${size.blocks} ${plural(size.blocks, 'блок', 'блоки', 'блоків')} · ${size.words} ${plural(size.words, 'слово', 'слова', 'слів')}`)}
      </View>
      {list('Посилається на', outgoing, 'Жодної нотатки')}
      {list('Сюди посилаються', incoming, 'Поки ніхто')}
    </ScrollView>
  );
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const makeStyles = (_t: Theme) =>
  StyleSheet.create({
    host: { flex: 1 },
    content: { paddingHorizontal: 16, paddingBottom: 24, gap: 14 },
    head: { fontSize: TYPE.md, fontFamily: FONT_SEMIBOLD, paddingHorizontal: 4 },
    card: { borderRadius: RADIUS.panel, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 6 },
    fact: { paddingVertical: 7, gap: 1 },
    factLabel: { fontSize: TYPE.xs, fontFamily: FONT_REGULAR },
    factValue: { fontSize: TYPE.sm, fontFamily: FONT_SEMIBOLD },
    factSub: { fontSize: TYPE.xs, fontFamily: FONT_REGULAR },
    section: { gap: 2 },
    sectionTitle: { fontSize: TYPE.xs, fontFamily: FONT_SEMIBOLD, paddingHorizontal: 4, paddingBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 },
    noteRow: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 30, paddingHorizontal: 8, borderRadius: RADIUS.control },
    noteTitle: { flex: 1, fontSize: TYPE.sm, fontFamily: FONT_REGULAR },
    empty: { fontSize: TYPE.sm, fontFamily: FONT_REGULAR, paddingHorizontal: 8, paddingVertical: 4 },
  });
