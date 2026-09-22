import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AttachmentImage from './AttachmentImage';
import { CoverGradientView, coverById, defaultCoverFor } from '../theme/covers';
import { formatUpdatedAt } from '../utils/documentPreview';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import type { DocumentIndex } from '../hooks/useDocumentIndex';

type Props = {
  documentId: string | undefined;
  // What the title was when the card was made: all there is to show
  // before the index answers, and all there is left if the note has since
  // been deleted outright.
  fallbackTitle?: string;
  index: DocumentIndex;
  onOpen: (documentId: string) => void;
  // A second way in, when there is one: open that note AT the place it
  // mentions this one, rather than at its top. Used by the list of
  // related documents; a card sitting in the body of a note has no such
  // place to go, so it shows the plain chevron instead.
  onOpenAt?: (documentId: string) => void;
};

// Another note, embedded in this one as a card ('docRef' block).
//
// Drawn LIVE from the document index, so a note renamed anywhere is
// renamed in every note that mentions it. The same choice 'dbRow' made,
// for the same reason.
//
// Three states, and the third is the one worth having: it exists, it is
// in the bin, or it is gone. A card that simply vanished when its note
// was deleted would take a line out of this note without saying so - and
// a note in the BIN is not gone at all, it is restorable for thirty
// days, so saying "deleted" about it would be a lie that reads as final.
export default function DocumentRefBlockCard({ documentId, fallbackTitle, index, onOpen, onOpenAt }: Props) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const target = documentId ? index.get(documentId) : undefined;

  // The index is empty until its listener answers, so "not in it" only
  // means gone once something is.
  const indexKnows = index.size > 0;
  if (documentId && indexKnows && !target) {
    return (
      <View style={styles.missing}>
        <Ionicons name="alert-circle-outline" size={18} color={theme.paper.inkFaint} />
        <Text style={styles.missingLabel} numberOfLines={1}>
          {fallbackTitle ? `Документ видалено: ${fallbackTitle}` : 'Документ видалено'}
        </Text>
      </View>
    );
  }

  const title = target?.title?.trim() || fallbackTitle?.trim() || 'Без назви';
  const gradient = coverById(target?.coverGradient) ?? defaultCoverFor(documentId ?? title);
  const binned = !!target?.deletedAt;

  return (
    <Pressable
      style={styles.card}
      onPress={() => documentId && onOpen(documentId)}
      disabled={!documentId}
    >
      <View style={styles.thumb}>
        {target?.coverImageUri ? (
          <AttachmentImage
            uri={target.coverImageUri}
            driveFileId={target.coverDriveFileId}
            style={StyleSheet.absoluteFill}
            countsAsUse={false}
          />
        ) : (
          <CoverGradientView gradient={gradient} style={StyleSheet.absoluteFill} />
        )}
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {binned ? 'У кошику' : target?.updatedAt ? formatUpdatedAt(target.updatedAt) : 'Документ'}
        </Text>
      </View>
      {onOpenAt && documentId ? (
        <Pressable
          hitSlop={8}
          style={styles.jump}
          onPress={() => onOpenAt(documentId)}
        >
          <Ionicons name="return-down-forward-outline" size={17} color={theme.paper.inkMuted} />
        </Pressable>
      ) : (
        <Ionicons name="chevron-forward" size={18} color={theme.paper.inkFaint} />
      )}
    </Pressable>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  card: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.paper.edge,
    backgroundColor: t.paper.tint,
    paddingRight: 12,
    marginVertical: 4,
    overflow: 'hidden',
  },
  thumb: {
    width: 56,
    height: 56,
    overflow: 'hidden',
  },
  body: {
    flex: 1,
    paddingVertical: 10,
    gap: 2,
  },
  title: {
    fontSize: 14,
    fontFamily: FONT_SEMIBOLD,
    color: t.paper.ink,
  },
  meta: {
    fontSize: 11,
    fontFamily: FONT_REGULAR,
    color: t.paper.inkFaint,
  },
  jump: {
    padding: 6,
    borderRadius: 8,
  },
  missing: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: t.paper.edge,
    paddingHorizontal: 12,
    paddingVertical: 14,
    marginVertical: 4,
  },
  missingLabel: {
    flex: 1,
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: t.paper.inkFaint,
  },
});
