import { useMemo, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RecognizedPage } from './TextRecognizer';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { GLASS_BODY, GLASS_TEXT, GLASS_TEXT_MUTED } from '../constants/glass';
import { hapticButtonDown } from '../utils/haptics';

// Picking a passage off the photographed page by dragging across it -
// the words themselves are the thing being touched, not a rectangle drawn
// over them.
//
// It works because the recogniser hands back every word with the box it
// sits in, in reading order: the finger only has to say which word it
// started on and which it is over now, and everything between the two is
// the selection.

type Positioned = RecognizedPage & { pageIndex: number };

export default function TextSelection({
  pages,
  onClose,
  onInsert,
}: {
  // null closes it.
  pages: RecognizedPage[] | null;
  onClose: () => void;
  onInsert: (text: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  // Which words are picked, as a range per page: a drag runs from one word
  // to another, and everything in between comes with them.
  const [range, setRange] = useState<{ page: number; from: number; to: number } | null>(null);

  const positioned: Positioned[] = useMemo(
    () => (pages ?? []).map((page, pageIndex) => ({ ...page, pageIndex })),
    [pages]
  );

  // The page is drawn as wide as the screen allows; everything else is
  // that one scale.
  const pageWidth = windowWidth - 32;

  const selected = useMemo(() => {
    if (!range || !pages) return '';
    const page = pages[range.page];
    if (!page) return '';
    const from = Math.min(range.from, range.to);
    const to = Math.max(range.from, range.to);
    return page.words
      .slice(from, to + 1)
      .map((word) => word.text)
      .join(' ');
  }, [range, pages]);

  const wholeText = useMemo(
    () => (pages ?? []).map((page) => page.text.trim()).filter(Boolean).join('\n\n'),
    [pages]
  );

  function wordAt(page: Positioned, scale: number, x: number, y: number): number | null {
    // The nearest word the point falls in, or on the line of - a finger
    // between two lines should still mean the line it is closest to,
    // rather than nothing at all.
    let best: number | null = null;
    let bestDistance = Infinity;
    page.words.forEach((word, index) => {
      const left = word.x0 * scale;
      const right = word.x1 * scale;
      const top = word.y0 * scale;
      const bottom = word.y1 * scale;
      const dx = Math.max(left - x, 0, x - right);
      const dy = Math.max(top - y, 0, y - bottom);
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < bestDistance && distance < 40) {
        bestDistance = distance;
        best = index;
      }
    });
    return best;
  }

  return (
    <Modal visible={!!pages} animationType="slide" onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.root}>
        <View style={[styles.bar, { paddingTop: insets.top + 8 }]}>
          <Pressable hitSlop={10} onPress={onClose}>
            <Ionicons name="close-outline" size={26} color={GLASS_TEXT} />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>
            {selected ? `Вибрано слів: ${selected.split(/\s+/).length}` : 'Проведи пальцем по тексту'}
          </Text>
          <Pressable
            hitSlop={10}
            onPress={() => onInsert(wholeText)}
            style={styles.wholeButton}
          >
            <Text style={styles.wholeLabel}>Весь текст</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.pages}>
          {positioned.map((page) => {
            const scale = page.width > 0 ? pageWidth / page.width : 1;
            // A page whose size is unknown is still shown: a photograph
            // standing in a frame of the usual proportions beats a
            // screen with nothing on it at all.
            const height = page.height > 0 ? page.height * scale : pageWidth * 1.4;
            const isThisPage = range?.page === page.pageIndex;
            const from = isThisPage ? Math.min(range!.from, range!.to) : -1;
            const to = isThisPage ? Math.max(range!.from, range!.to) : -2;

            // Runs on the JS thread: it reads the word list and sets React
            // state on every move, and there is no per-frame animation
            // here to protect.
            const drag = Gesture.Pan()
              .runOnJS(true)
              .minDistance(0)
              .onBegin((e) => {
                const index = wordAt(page, scale, e.x, e.y);
                if (index === null) return;
                hapticButtonDown();
                setRange({ page: page.pageIndex, from: index, to: index });
              })
              .onUpdate((e) => {
                const index = wordAt(page, scale, e.x, e.y);
                if (index === null) return;
                setRange((current) =>
                  current && current.page === page.pageIndex ? { ...current, to: index } : current
                );
              });

            return (
              <GestureDetector key={page.pageIndex} gesture={drag}>
                <View style={[styles.page, { width: pageWidth, height }]}>
                  <Image source={{ uri: page.image }} style={StyleSheet.absoluteFill} resizeMode="contain" />
                  {page.words.map((word, index) => {
                    const picked = index >= from && index <= to;
                    return (
                      <View
                        key={index}
                        pointerEvents="none"
                        style={[
                          styles.word,
                          picked && styles.wordPicked,
                          {
                            left: word.x0 * scale,
                            top: word.y0 * scale,
                            width: (word.x1 - word.x0) * scale,
                            height: (word.y1 - word.y0) * scale,
                          },
                        ]}
                      />
                    );
                  })}
                </View>
              </GestureDetector>
            );
          })}
        </ScrollView>

        {/* What was picked, and where it can go. Shown only once there is
            something - an empty bar would just be furniture. */}
        {!!selected && (
          <View style={[styles.picked, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.pickedText} numberOfLines={3}>
              {selected}
            </Text>
            <View style={styles.pickedActions}>
              <Pressable style={styles.pickedAction} onPress={() => setRange(null)}>
                <Ionicons name="close-outline" size={18} color={GLASS_TEXT} />
                <Text style={styles.pickedActionLabel}>Зняти</Text>
              </Pressable>
              <Pressable
                style={[styles.pickedAction, styles.pickedActionPrimary]}
                onPress={() => onInsert(selected)}
              >
                <Ionicons name="arrow-down-outline" size={18} color="#171310" />
                <Text style={[styles.pickedActionLabel, styles.pickedActionPrimaryLabel]}>У нотатку</Text>
              </Pressable>
            </View>
          </View>
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#111827',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingBottom: 10,
    backgroundColor: GLASS_BODY,
  },
  title: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONT_SEMIBOLD,
    color: GLASS_TEXT,
  },
  wholeButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  wholeLabel: {
    fontSize: 12,
    fontFamily: FONT_SEMIBOLD,
    color: GLASS_TEXT,
  },
  pages: {
    padding: 16,
    gap: 16,
  },
  page: {
    backgroundColor: '#000',
    borderRadius: 8,
    overflow: 'hidden',
  },
  // Every word carries a faint box, so it is visible that the words
  // themselves are what the finger is picking.
  word: {
    position: 'absolute',
    borderRadius: 2,
    backgroundColor: 'rgba(59,130,246,0.10)',
  },
  wordPicked: {
    backgroundColor: 'rgba(250,204,21,0.45)',
  },
  picked: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
    backgroundColor: GLASS_BODY,
  },
  pickedText: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT_MUTED,
  },
  pickedActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  pickedAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  pickedActionPrimary: {
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  pickedActionLabel: {
    fontSize: 13,
    fontFamily: FONT_SEMIBOLD,
    color: GLASS_TEXT,
  },
  pickedActionPrimaryLabel: {
    color: '#171310',
  },
});
