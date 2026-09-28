import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DocumentRefBlockCard from './DocumentRefBlockCard';
import { FONT_SEMIBOLD } from '../utils/fonts';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import type { DocumentIndex } from '../hooks/useDocumentIndex';

type Props = {
  // The note this section sits at the foot of.
  documentId: string;
  index: DocumentIndex;
  onOpen: (documentId: string) => void;
  // Open that note at the place it mentions this one.
  onOpenAt: (documentId: string) => void;
};

// What mentions this note, at the foot of it.
//
// The other half of a link. A card inside a note points one way, and on
// its own that is a dead end: the note being pointed AT has no idea. The
// list is the way back, and it is what makes putting a card in a note
// worth doing at all.
//
// Nothing is indexed for this and nothing is queried. Every document is
// already in memory with the one field this needs - `linksTo`, written
// on save (see documentLinks.ts) - so the answer is a filter over a few
// dozen entries. That is also why it costs nothing to be live: link to
// this note from somewhere else and the section grows while it is open.
//
// Hidden entirely when nothing points here. A heading followed by
// nothing, at the foot of every note in the app, is a line of furniture
// paid for by the notes that have no links - which is most of them.
export default function RelatedDocuments({ documentId, index, onOpen, onOpenAt }: Props) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const [open, setOpen] = useState(false);

  const linking = Array.from(index.values())
    .filter((d) => d.id !== documentId && !d.deletedAt && (d.linksTo ?? []).includes(documentId))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  if (linking.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.rule} />
      <Pressable style={styles.header} onPress={() => setOpen((v) => !v)}>
        <Text style={styles.label}>
          Пов&apos;язані з цим документом
          <Text style={styles.count}>{`  ${linking.length}`}</Text>
        </Text>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={theme.paper.inkMuted}
        />
      </Pressable>
      {open &&
        linking.map((d) => (
          <DocumentRefBlockCard
            key={d.id}
            documentId={d.id}
            fallbackTitle={d.title}
            index={index}
            onOpen={onOpen}
            onOpenAt={onOpenAt}
          />
        ))}
    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  wrap: {
    marginTop: 28,
    gap: 4,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: t.paper.edge,
    marginBottom: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  label: {
    fontSize: 13,
    fontFamily: FONT_SEMIBOLD,
    color: t.paper.inkMuted,
  },
  count: {
    color: t.paper.inkFaint,
  },
});
