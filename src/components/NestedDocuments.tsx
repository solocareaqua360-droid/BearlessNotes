import { StyleSheet, Text, View } from 'react-native';
import DocumentRefBlockCard from './DocumentRefBlockCard';
import { FONT_SEMIBOLD } from '../utils/fonts';
import { useStyles } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import type { DocumentIndex } from '../hooks/useDocumentIndex';

type Props = {
  // The note this section sits at the foot of.
  documentId: string;
  index: DocumentIndex;
  onOpen: (documentId: string) => void;
};

// The notes nested in this one (recordNotes' DocOwner kind 'note'), at the
// foot of it. This is their home: they are not in the documents list, and
// a word linking to one is only a way there - erase the word and the note
// is still here. Open, unlike «Пов'язані», because these are the note's
// own contents, not a list of strangers that mention it. Hidden when there
// are none; in the order they were made, like a table of contents.
export default function NestedDocuments({ documentId, index, onOpen }: Props) {
  const styles = useStyles(makeStyles);

  const nested = Array.from(index.values())
    .filter((d) => d.parentId === documentId && !d.deletedAt)
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

  if (nested.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.rule} />
      <Text style={styles.label}>
        Вкладені
        <Text style={styles.count}>{`  ${nested.length}`}</Text>
      </Text>
      {nested.map((d) => (
        <DocumentRefBlockCard key={d.id} documentId={d.id} fallbackTitle={d.title} index={index} onOpen={onOpen} />
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
  label: {
    fontSize: 13,
    fontFamily: FONT_SEMIBOLD,
    color: t.paper.inkMuted,
    paddingVertical: 6,
  },
  count: {
    color: t.paper.inkFaint,
  },
});
