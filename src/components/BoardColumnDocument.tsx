import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { doc, getDoc, updateDoc } from '@react-native-firebase/firestore';
import { db } from '../firebase';
import { Block, BoardCard } from '../types';

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
// How long after the last keystroke a document card's own document is
// written. The same 600ms the editor itself uses, for the same reason.
const SAVE_DELAY_MS = 600;

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
  // The documents behind this column's document cards, read once each and
  // written back as they're edited. A card of that kind isn't a title with
  // a link here - its document's own text is part of the column, and
  // editing it edits THAT document, not a copy.
  const [documents, setDocuments] = useState<Record<string, { title: string; blocks: Block[] }>>({});
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const documentIds = cards
    .filter((card) => card.type === 'document' && card.documentId)
    .map((card) => card.documentId as string);
  const documentKey = documentIds.join(',');

  useEffect(() => {
    let cancelled = false;
    documentIds.forEach(async (id) => {
      if (documents[id]) return;
      const snapshot = await getDoc(doc(db, 'documents', id));
      const data = snapshot.data() as { title?: string; blocks?: Block[] } | undefined;
      if (cancelled || !data) return;
      setDocuments((prev) => ({ ...prev, [id]: { title: data.title ?? '', blocks: data.blocks ?? [] } }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentKey]);

  useEffect(
    () => () => {
      Object.values(saveTimers.current).forEach(clearTimeout);
    },
    []
  );

  function changeDocumentBlock(documentId: string, blockId: string, text: string) {
    setDocuments((prev) => {
      const current = prev[documentId];
      if (!current) return prev;
      const blocks = current.blocks.map((block) => (block.id === blockId ? { ...block, text } : block));
      const next = { ...prev, [documentId]: { ...current, blocks } };
      // Written from inside the timer so the version saved is the one that
      // exists when it fires, not the one that existed when it was set.
      clearTimeout(saveTimers.current[documentId]);
      saveTimers.current[documentId] = setTimeout(() => {
        updateDoc(doc(db, 'documents', documentId), { blocks, updatedAt: Date.now() });
      }, SAVE_DELAY_MS);
      return next;
    });
  }

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
    if (type === 'document' && card.documentId) {
      const source = documents[card.documentId];
      return (
        <View key={card.id} style={styles.documentSection}>
          {/* The document's own name, so it's clear whose text this is -
              and the only part of it that still behaves like a card: a tap
              opens that document on its own. */}
          <Pressable onPress={() => onOpenCard(card)}>
            <Text style={styles.documentTitle}>
              {source?.title?.trim() || card.documentTitle?.trim() || 'Документ'}
            </Text>
          </Pressable>
          {!source && <Text style={styles.hint}>Завантаження…</Text>}
          {source?.blocks.map((block) => renderDocumentBlock(card.documentId as string, block))}
        </View>
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

  // One block of a document card's document, editable in place. Text and
  // its list variants are written back; the rest is shown as it is, since
  // nothing here can edit an image.
  function renderDocumentBlock(documentId: string, block: Block) {
    const type = block.type ?? 'paragraph';
    if (type === 'divider') return <View key={block.id} style={styles.divider} />;
    if (type === 'image') {
      return block.imageUri ? (
        <Image key={block.id} source={{ uri: block.imageUri }} style={styles.image} resizeMode="cover" />
      ) : null;
    }
    if (type === 'link' || type === 'file') {
      return (
        <View key={block.id} style={styles.referenceRow}>
          <Ionicons name={type === 'link' ? 'link-outline' : 'document-attach-outline'} size={16} color="#6B7280" />
          <Text style={styles.referenceLabel} numberOfLines={2}>
            {block.linkTitle?.trim() || block.fileTitle?.trim() || block.linkUrl || 'Вкладення'}
          </Text>
        </View>
      );
    }
    return (
      <View key={block.id} style={styles.blockRow}>
        {type === 'checkbox' && (
          <Ionicons
            name={block.checked ? 'checkbox' : 'square-outline'}
            size={18}
            color="#6B7280"
            style={styles.blockBullet}
          />
        )}
        {type === 'bulleted' && <Text style={styles.blockBullet}>•</Text>}
        <TextInput
          style={styles.paragraph}
          defaultValue={block.text ?? ''}
          onChangeText={(text) => changeDocumentBlock(documentId, block.id, text)}
          multiline
        />
      </View>
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
    flex: 1,
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
  // No frame and no fill: a document card's text belongs to the column's
  // flow as much as a paragraph does. Its name is the only thing marking
  // where it starts.
  documentSection: {
    marginVertical: 6,
    gap: 2,
  },
  documentTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 2,
  },
  blockRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  blockBullet: {
    fontSize: 16,
    lineHeight: 24,
    color: '#6B7280',
    paddingTop: 6,
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 10,
  },
  hint: {
    fontSize: 14,
    color: '#9CA3AF',
  },
  writeMore: {
    paddingVertical: 14,
  },
  writeMoreLabel: {
    fontSize: 15,
    color: '#9CA3AF',
  },
});
