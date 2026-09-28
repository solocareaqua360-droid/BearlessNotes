import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AttachmentImage from './AttachmentImage';
import { useFlashcardLive } from '../hooks/useFlashcardLive';
import { useRecordColour, useTheme } from '../theme/ThemeProvider';
import { Block } from '../types';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';

// A flashcard where it has been put: in a note (a block) or on a board (a
// card). Either way it is the card as it is NOW in «Картки» - the block
// only keeps the id and a snapshot to show until that arrives - with its
// whole term, its first picture, and the explanation folding open under
// it: "на дошці як і в документі пояснення можна розгорнути".
//
// In a note the card folds itself (a tap on «Пояснення»). On a board the
// board's own gesture owns the tap and keeps the fold on the card
// (BoardCard.flashcardOpen), so there it is told `open` and draws no
// buttons of its own.
export default function FlashcardBlockCard({
  block,
  variant,
  open: openProp,
  interactive = true,
}: {
  block: Block;
  variant: 'note' | 'board';
  open?: boolean;
  interactive?: boolean;
}) {
  const theme = useTheme();
  const recordColour = useRecordColour();
  const card = useFlashcardLive(block.id, {
    id: block.id,
    term: block.flashcardTerm ?? block.text ?? '',
    explanation: block.flashcardExplanation ?? '',
    images: block.flashcardImages ?? [],
  });
  const [ownOpen, setOwnOpen] = useState(false);
  const open = openProp ?? ownOpen;
  const first = card.images[0];
  const hasExplanation = !!card.explanation.trim();

  if (variant === 'board') {
    return (
      <View style={[styles.boardCard, { backgroundColor: theme.canvas.card, borderColor: theme.canvas.edge }]}>
        {first && (
          <View style={styles.boardThumb}>
            <AttachmentImage uri={first.uri} driveFileId={first.driveFileId} style={styles.fill} />
          </View>
        )}
        <Text style={[styles.boardTerm, { color: theme.canvas.ink }]}>{card.term || 'Без терміна'}</Text>
        {hasExplanation && (
          <View style={[styles.boardFold, { borderTopColor: theme.canvas.edge }]}>
            <Text style={[styles.foldLabel, { color: theme.canvas.inkMuted }]}>Пояснення</Text>
            <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={theme.canvas.inkMuted} />
          </View>
        )}
        {hasExplanation && open && (
          <Text style={[styles.boardExplanation, { color: theme.canvas.ink }]}>{card.explanation}</Text>
        )}
      </View>
    );
  }

  const { background, text, textMuted } = recordColour(card.id);
  const edge = text === '#FFFFFF' ? 'rgba(255,255,255,0.28)' : 'rgba(17,24,39,0.16)';
  return (
    <View style={[styles.noteCard, { backgroundColor: background }]}>
      <View style={styles.noteLine}>
        {first && (
          <View style={styles.noteThumb}>
            <AttachmentImage uri={first.uri} driveFileId={first.driveFileId} style={styles.fill} />
          </View>
        )}
        <Text style={[styles.noteTerm, { color: text }]}>{card.term || 'Без терміна'}</Text>
      </View>
      {hasExplanation && (
        <Pressable
          disabled={!interactive}
          onPress={() => setOwnOpen((v) => !v)}
          style={[styles.noteFold, { borderColor: edge }]}
        >
          <Text style={[styles.foldLabel, { color: textMuted }]}>Пояснення</Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={text} />
        </Pressable>
      )}
      {hasExplanation && open && <Text style={[styles.noteExplanation, { color: text }]}>{card.explanation}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    width: '100%',
    height: '100%',
  },
  noteCard: {
    borderRadius: 14,
    padding: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(176,176,176,0.5)',
  },
  noteLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  // A link card's own window: 104 across, a video's proportion.
  noteThumb: {
    width: 104,
    aspectRatio: 16 / 9,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#E5E7EB',
  },
  noteTerm: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: FONT_SEMIBOLD,
  },
  noteFold: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 38,
  },
  foldLabel: {
    fontSize: 13,
    fontFamily: FONT_SEMIBOLD,
  },
  noteExplanation: {
    fontSize: 15,
    lineHeight: 22,
    fontFamily: FONT_REGULAR,
    paddingHorizontal: 2,
  },
  boardCard: {
    borderRadius: 10,
    padding: 8,
    gap: 6,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  boardThumb: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: '#E5E7EB',
  },
  boardTerm: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FONT_SEMIBOLD,
  },
  boardFold: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 6,
  },
  boardExplanation: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: FONT_REGULAR,
  },
});
