import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from './icons/Ionicons';
import LiveDocumentCard from './LiveDocumentCard';
import { FONT_SEMIBOLD } from '../utils/fonts';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import type { DocumentIndex } from '../hooks/useDocumentIndex';
import type { Tag } from '../types';

type Props = {
  // The note this section sits at the foot of.
  documentId: string;
  index: DocumentIndex;
  tags: Tag[];
  onOpen: (documentId: string) => void;
  // Told when it unfolds or folds - the sheet keeps its header still (see
  // the editor's foot spacer).
  onToggle?: (open: boolean) => void;
};

// The notes nested in this one (recordNotes' DocOwner kind 'note'), at the
// foot of it. This is their home: they are not in the documents list, and
// a word linking to one is only a way there - erase the word and the note
// is still here. Folds like «Пов'язані» (the user's: an open list that
// would not close was in the way); the count on the fold says how many.
// Hidden when there are none; in the order they were made, like a table
// of contents.
export default function NestedDocuments({ documentId, index, tags, onOpen, onToggle }: Props) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const [open, setOpen] = useState(false);

  const nested = Array.from(index.values())
    .filter((d) => d.parentId === documentId && !d.deletedAt)
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

  if (nested.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.rule} />
      <Pressable
        style={styles.header}
        onPress={() => {
          onToggle?.(!open);
          setOpen(!open);
        }}
      >
        <Text style={styles.label}>
          Вкладені
          <Text style={styles.count}>{`  ${nested.length}`}</Text>
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={theme.paper.inkMuted} />
      </Pressable>
      {open && nested.map((d) => (
        <LiveDocumentCard key={d.id} documentId={d.id} fallbackTitle={d.title} index={index} tags={tags} onOpen={onOpen} />
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
