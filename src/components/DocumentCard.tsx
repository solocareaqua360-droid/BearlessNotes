import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TextMatch, formatUpdatedAt } from '../utils/documentPreview';
import { colorForDocument } from '../utils/documentColor';
import { FONT_REGULAR, FONT_BOLD } from '../utils/fonts';

const THUMB_SIZE = 72;

function HighlightedLine({ match, style, highlightStyle }: { match: TextMatch; style: object; highlightStyle: object }) {
  return (
    <Text style={style} numberOfLines={2}>
      {match.before}
      <Text style={highlightStyle}>{match.match}</Text>
      {match.after}
    </Text>
  );
}

type Props = {
  id: string;
  title: string;
  updatedAt: number;
  imageUri: string | null;
  previewText: string;
  // When set (a search match), the title or preview line renders with the
  // matched substring highlighted instead of the plain text - see
  // SearchScreen. DocumentsScreen's own list never sets these.
  titleMatch?: TextMatch | null;
  bodyMatch?: TextMatch | null;
  onPress: () => void;
  onDelete?: () => void;
};

// The list-row card shared by Documents and Search: a thumbnail (the
// document's first image block, or a plain placeholder box with a document
// icon when it has none), title, a two-line preview of the body text (or a
// highlighted search-match snippet in its place), and the last-edited
// timestamp.
//
// The card's fill color comes from `colorForDocument(id)` - a fixed palette
// picked deterministically from the document's own id (see that file for
// why it isn't a random pick or a stored field), with the text/border/
// delete-icon colors all derived to stay readable against whichever fill a
// given document landed on.
export default function DocumentCard({
  id,
  title,
  updatedAt,
  imageUri,
  previewText,
  titleMatch,
  bodyMatch,
  onPress,
  onDelete,
}: Props) {
  const { background, text, textMuted } = colorForDocument(id);
  return (
    <View style={[styles.row, { backgroundColor: background }]}>
      <Pressable style={styles.tap} onPress={onPress}>
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={styles.thumb} resizeMode="cover" />
        ) : (
          <View style={[styles.thumb, styles.thumbPlaceholder]}>
            <Ionicons name="document-text-outline" size={22} color="#D1D5DB" />
          </View>
        )}
        <View style={styles.body}>
          {titleMatch ? (
            <HighlightedLine match={titleMatch} style={[styles.title, { color: text }]} highlightStyle={styles.highlight} />
          ) : (
            <Text style={[styles.title, { color: text }]} numberOfLines={2}>
              {title || 'Без назви'}
            </Text>
          )}
          {bodyMatch ? (
            <HighlightedLine match={bodyMatch} style={[styles.preview, { color: textMuted }]} highlightStyle={styles.highlight} />
          ) : (
            !!previewText && (
              <Text style={[styles.preview, { color: textMuted }]} numberOfLines={2}>
                {previewText}
              </Text>
            )
          )}
          <Text style={[styles.date, { color: textMuted }]}>{formatUpdatedAt(updatedAt)}</Text>
        </View>
      </Pressable>
      {onDelete && (
        <Pressable hitSlop={8} onPress={onDelete} style={styles.deleteButton}>
          <Ionicons name="trash-outline" size={20} color={text} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginHorizontal: 20,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
    borderRadius: 16,
    // A thin, muted border so a light-colored card doesn't visually merge
    // into the page's gradient background behind it - reads as an edge on
    // both the warm and the cool end of that gradient.
    borderWidth: 1,
    borderColor: 'rgba(176,176,176,0.5)',
    // Drop shadow onto the gradient behind the card - previously a flat
    // row with no shadow at all.
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  tap: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
  },
  thumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    gap: 3,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
  },
  preview: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FONT_REGULAR,
  },
  highlight: {
    backgroundColor: '#FEF08A',
    color: '#111827',
  },
  date: {
    fontSize: 12,
    marginTop: 2,
    fontFamily: FONT_REGULAR,
  },
  deleteButton: {
    padding: 4,
    marginTop: 4,
  },
});
