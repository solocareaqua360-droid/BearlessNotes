import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AttachmentImage from './AttachmentImage';
import { useRecordColour } from '../theme/ThemeProvider';
import { Flashcard } from '../types';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';

const PAD = 16;

// ONE flashcard, as it is looked at: the pictures large (a carousel when
// there are several - "не в маленькій мініатюрі, а в великій"), the term
// under them, and the explanation folded into a framed panel of its own
// that opens only when it is wanted - the whole point of a card being
// that, once it is learned, you flip past without opening it.
//
// Written to stand anywhere a card is shown: a page of the flashcards
// stack now (a fixed `height`), a block in a note and a card on a board
// later (no height - the card is as tall as what it holds).
export default function FlashcardView({
  card,
  width,
  height,
  learning,
  onEdit,
  onOpenImage,
}: {
  card: Flashcard;
  width: number;
  height?: number;
  // Present only where the card's group is being learned.
  learning?: { onSetKnown: (known: boolean) => void } | null;
  onEdit?: () => void;
  onOpenImage?: (index: number) => void;
}) {
  const recordColour = useRecordColour();
  const { background, text, textMuted } = recordColour(card.id);
  const [open, setOpen] = useState(false);
  const [imageIndex, setImageIndex] = useState(0);
  const innerW = Math.max(0, width - PAD * 2);
  const images = card.images ?? [];
  // As tall as it is wide in a 4:3, but never more than half a page, so
  // the term and the folded explanation are always in sight with it.
  const imageH = Math.round(Math.min(innerW * 0.75, height ? height * 0.52 : innerW * 0.75));
  const edge = text === '#FFFFFF' ? 'rgba(255,255,255,0.28)' : 'rgba(17,24,39,0.16)';
  const hasExplanation = !!card.explanation?.trim();

  const body = (
    <>
      {images.length > 0 && (
        <View style={{ width: innerW, height: imageH }}>
          <ScrollView
            horizontal
            pagingEnabled
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) =>
              setImageIndex(Math.round(e.nativeEvent.contentOffset.x / Math.max(1, innerW)))
            }
          >
            {images.map((image, i) => (
              <Pressable
                key={`${i}:${image.uri}`}
                disabled={!onOpenImage}
                onPress={() => onOpenImage?.(i)}
                style={[styles.imageFrame, { width: innerW, height: imageH }]}
              >
                <AttachmentImage
                  uri={image.uri}
                  driveFileId={image.driveFileId}
                  resizeMode="contain"
                  resizeMethod="auto"
                  style={{ width: innerW, height: imageH }}
                />
              </Pressable>
            ))}
          </ScrollView>
          {images.length > 1 && (
            <View style={styles.dots} pointerEvents="none">
              {images.map((_, i) => (
                <View key={i} style={[styles.dot, { backgroundColor: i === imageIndex ? '#fff' : 'rgba(255,255,255,0.45)' }]} />
              ))}
            </View>
          )}
        </View>
      )}

      <Text style={[styles.term, { color: text }, images.length === 0 && styles.termAlone]}>
        {card.term || 'Без терміна'}
      </Text>

      {hasExplanation && (
        <View style={[styles.panel, { borderColor: edge }]}>
          <Pressable style={styles.panelHead} onPress={() => setOpen((v) => !v)}>
            <Text style={[styles.panelTitle, { color: text }]}>Пояснення</Text>
            <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={text} />
          </Pressable>
          {open && <Text style={[styles.explanation, { color: text }]}>{card.explanation}</Text>}
        </View>
      )}
    </>
  );

  const footer = (learning || onEdit) && (
    <View style={styles.footer}>
      {learning && (
        <>
          <FooterButton
            icon="refresh-outline"
            label="Ще вчу"
            active={!card.known}
            ink={text}
            edge={edge}
            onPress={() => learning.onSetKnown(false)}
          />
          <FooterButton
            icon="checkmark-done-outline"
            label="Знаю"
            active={!!card.known}
            ink={text}
            edge={edge}
            onPress={() => learning.onSetKnown(true)}
          />
        </>
      )}
      {onEdit && <FooterButton icon="create-outline" label="Редагувати" ink={text} edge={edge} onPress={onEdit} />}
    </View>
  );

  return (
    <View style={[styles.card, { width, backgroundColor: background }, height ? { height } : null]}>
      {height ? (
        <ScrollView
          nestedScrollEnabled
          style={styles.flex}
          contentContainerStyle={[styles.content, images.length === 0 && !open && styles.centred]}
          showsVerticalScrollIndicator={false}
        >
          {body}
        </ScrollView>
      ) : (
        <View style={styles.content}>{body}</View>
      )}
      {footer}
      {learning && card.known && (
        <View style={styles.knownBadge} pointerEvents="none">
          <Ionicons name="checkmark-circle" size={20} color={textMuted} />
        </View>
      )}
    </View>
  );
}

function FooterButton({
  icon,
  label,
  active,
  ink,
  edge,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active?: boolean;
  ink: string;
  edge: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.button, { borderColor: edge }, active && { backgroundColor: edge }]}
    >
      <Ionicons name={icon} size={17} color={ink} />
      <Text numberOfLines={1} style={[styles.buttonLabel, { color: ink }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  card: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(176,176,176,0.5)',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  content: {
    padding: PAD,
    gap: 14,
  },
  centred: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  imageFrame: {
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  dots: {
    position: 'absolute',
    bottom: 8,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  term: {
    fontSize: 19,
    lineHeight: 26,
    fontFamily: FONT_BOLD,
  },
  termAlone: {
    textAlign: 'center',
    fontSize: 22,
    lineHeight: 30,
  },
  panel: {
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  panelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  panelTitle: {
    fontSize: 15,
    fontFamily: FONT_SEMIBOLD,
  },
  explanation: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    fontSize: 16,
    lineHeight: 23,
    fontFamily: FONT_REGULAR,
  },
  footer: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: PAD,
    paddingBottom: PAD,
    paddingTop: 4,
  },
  button: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 6,
  },
  buttonLabel: {
    fontSize: 14,
    fontFamily: FONT_SEMIBOLD,
    flexShrink: 1,
  },
  knownBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
  },
});
