import { FlatList, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { FlipFrom } from '../utils/flipOpen';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GlassLayer from './GlassLayer';
import FlashcardView from './FlashcardView';
import { Flashcard } from '../types';
import { formatUpdatedAt } from '../utils/documentPreview';

// A card OPENED FOR READING - the link card's own move: a tap on the
// small card in the list turns it over into a window of its own, with
// «Редагувати» at its top. From here the stack is flipped through: a
// sideways swipe over the words is the next / previous card, the same
// swipe over the pictures is the next picture (the carousel keeps its
// own touch), and a tap on a picture opens it full screen.
export default function FlashcardReader({
  cards,
  startIndex,
  isLearning,
  onSetKnown,
  onEdit,
  onOpenImage,
  onClose,
  flipFrom,
}: {
  // The stack as it was when the card was opened, read live by the caller
  // so an edit shows at once. null = closed.
  cards: Flashcard[] | null;
  startIndex: number;
  isLearning: (card: Flashcard) => boolean;
  onSetKnown: (card: Flashcard, known: boolean) => void;
  onEdit: (card: Flashcard) => void;
  onOpenImage: (card: Flashcard, index: number) => void;
  onClose: () => void;
  // Opened from a card in the list: the reader comes round from its back.
  flipFrom?: FlipFrom | null;
}) {
  const { width: windowW, height: windowH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const cardW = Math.min(windowW - 32, 560);
  const cardH = Math.round(Math.min((windowH - insets.top - insets.bottom) * 0.8, 760));
  const visible = !!cards && cards.length > 0;

  return (
    <GlassLayer visible={visible} onClose={onClose} flipFrom={flipFrom}>
      {visible && (
        <View style={[styles.strip, { height: cardH }]} pointerEvents="box-none">
          <FlatList
            data={cards}
            keyExtractor={(c) => c.id}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={Math.min(Math.max(0, startIndex), cards.length - 1)}
            getItemLayout={(_, index) => ({ length: windowW, offset: windowW * index, index })}
            windowSize={3}
            initialNumToRender={1}
            maxToRenderPerBatch={2}
            renderItem={({ item, index }) => (
              <View style={[styles.page, { width: windowW, height: cardH }]} pointerEvents="box-none">
                <FlashcardView
                  card={item}
                  width={cardW}
                  height={cardH}
                  header={{
                    position: `${index + 1} з ${cards.length}${
                      item.createdAt ?? item.updatedAt ? ` · ${formatUpdatedAt((item.createdAt ?? item.updatedAt) as number)}` : ''
                    }`,
                    onClose,
                  }}
                  learning={isLearning(item) ? { onSetKnown: (known) => onSetKnown(item, known) } : null}
                  onEdit={() => onEdit(item)}
                  onOpenImage={(i) => onOpenImage(item, i)}
                />
              </View>
            )}
          />
        </View>
      )}
    </GlassLayer>
  );
}

const styles = StyleSheet.create({
  strip: {
    width: '100%',
  },
  page: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
