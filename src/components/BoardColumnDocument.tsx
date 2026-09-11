import { useRef } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { BoardCard } from '../types';

const ACCENT = '#3B82F6';

// One kanban column read - and written - as flowing text. Not a document:
// there is no second copy of anything here, and nothing is synchronised.
// The cards ARE the content, this is just the other way of looking at
// them, with the block outlines taken off so an image sits in the text the
// way it would in any ordinary editor.
//
// A text card holds one run of writing. It keeps growing until a card of
// another kind interrupts it, and the next run after that interruption is
// the next card - which is exactly how the column reads on the canvas.
export default function BoardColumnDocument({
  title,
  cards,
  onChangeCardText,
  onStartWriting,
  onOpenCard,
  onGenerate,
  onClose,
  hasDocument,
}: {
  title: string;
  cards: BoardCard[];
  onChangeCardText: (cardId: string, text: string) => void;
  // Adds an empty text card at the end of the column and returns its id, so
  // the caller owns card creation and this component only writes text.
  onStartWriting: () => string;
  onOpenCard: (card: BoardCard) => void;
  onGenerate: () => void;
  onClose: () => void;
  hasDocument: boolean;
}) {
  const inputs = useRef<Record<string, TextInput | null>>({});

  function startWriting() {
    const id = onStartWriting();
    // The card exists a render before its input does, so the focus waits
    // for that render rather than being dropped on the floor.
    requestAnimationFrame(() => inputs.current[id]?.focus());
  }

  function renderCard(card: BoardCard) {
    const type = card.type ?? 'paragraph';
    if (type === 'image' && card.imageUri) {
      return <Image key={card.id} source={{ uri: card.imageUri }} style={styles.image} resizeMode="cover" />;
    }
    if (type === 'link') {
      return (
        <Pressable key={card.id} style={styles.referenceRow} onPress={() => onOpenCard(card)}>
          <Ionicons name="link-outline" size={16} color="#6B7280" />
          <Text style={styles.referenceLabel} numberOfLines={2}>
            {card.linkTitle?.trim() || card.linkUrl || 'Посилання'}
          </Text>
        </Pressable>
      );
    }
    if (type === 'file') {
      return (
        <Pressable key={card.id} style={styles.referenceRow} onPress={() => onOpenCard(card)}>
          <Ionicons name="document-attach-outline" size={16} color="#6B7280" />
          <Text style={styles.referenceLabel} numberOfLines={2}>
            {card.fileTitle?.trim() || 'Файл'}
          </Text>
        </Pressable>
      );
    }
    if (type === 'document') {
      return (
        <Pressable key={card.id} style={styles.documentRow} onPress={() => onOpenCard(card)}>
          <Ionicons name="document-text-outline" size={16} color={ACCENT} />
          <View style={styles.documentBody}>
            <Text style={styles.documentTitle} numberOfLines={1}>
              {card.documentTitle?.trim() || 'Документ'}
            </Text>
            {!!card.documentPreviewText && (
              <Text style={styles.documentPreview} numberOfLines={2}>
                {card.documentPreviewText}
              </Text>
            )}
          </View>
        </Pressable>
      );
    }
    return (
      <TextInput
        key={card.id}
        ref={(ref) => {
          inputs.current[card.id] = ref;
        }}
        style={styles.paragraph}
        defaultValue={card.text ?? ''}
        onChangeText={(text) => onChangeCardText(card.id, text)}
        multiline
        placeholder="Текст"
        placeholderTextColor="#C4C4C4"
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable hitSlop={8} onPress={onClose}>
          <Ionicons name="close" size={22} color="#111827" />
        </Pressable>
        <Text style={styles.headerLabel} numberOfLines={1}>
          {title}
        </Text>
        <Pressable style={styles.generateButton} onPress={onGenerate}>
          <Text style={styles.generateLabel}>{hasDocument ? 'Оновити' : 'Сформувати'}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {cards.map(renderCard)}
        {/* The end of the column is where writing continues. A tap here
            makes the next card and puts the cursor in it - the same move as
            reaching the bottom of a page and carrying on. */}
        <Pressable style={styles.writeMore} onPress={startWriting}>
          <Text style={styles.writeMoreLabel}>{cards.length === 0 ? 'Почати писати' : 'Писати далі'}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 52,
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  headerLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  generateButton: {
    backgroundColor: ACCENT,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  generateLabel: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  body: {
    padding: 20,
    paddingBottom: 160,
    gap: 4,
  },
  // No border, no background, no handle: the whole point of this view is
  // that a card stops looking like a card.
  paragraph: {
    fontSize: 16,
    lineHeight: 24,
    color: '#111827',
    paddingVertical: 6,
    paddingHorizontal: 0,
  },
  image: {
    width: '100%',
    aspectRatio: 1.5,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    marginVertical: 8,
  },
  referenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  referenceLabel: {
    flex: 1,
    fontSize: 15,
    color: '#374151',
  },
  documentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginVertical: 8,
    borderRadius: 12,
    backgroundColor: '#F9FAFB',
  },
  documentBody: {
    flex: 1,
    gap: 2,
  },
  documentTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  documentPreview: {
    fontSize: 13,
    color: '#6B7280',
  },
  writeMore: {
    paddingVertical: 14,
  },
  writeMoreLabel: {
    fontSize: 15,
    color: '#9CA3AF',
  },
});
