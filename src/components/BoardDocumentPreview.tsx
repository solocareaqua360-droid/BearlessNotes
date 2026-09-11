import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { Block } from '../types';
import { stripFormatting } from '../utils/documentPreview';

const ACCENT = '#3B82F6';

// A block as it will read in the exported document. Deliberately a reader,
// not an editor: nothing here writes anything, and the document itself
// doesn't exist yet - it's built from the board's cards in memory and only
// becomes a real document when "Сформувати" is pressed.
function PreviewBlock({ block }: { block: Block }) {
  const type = block.type ?? 'paragraph';
  if (type === 'divider') return <View style={styles.divider} />;
  if (type === 'image') {
    return block.imageUri ? (
      <Image source={{ uri: block.imageUri }} style={styles.image} resizeMode="cover" />
    ) : null;
  }
  if (type === 'link') {
    return (
      <View style={styles.linkRow}>
        <Ionicons name="link-outline" size={15} color="#6B7280" />
        <Text style={styles.linkLabel} numberOfLines={2}>
          {block.linkTitle?.trim() || block.linkUrl || 'Посилання'}
        </Text>
      </View>
    );
  }
  if (type === 'file') {
    return (
      <View style={styles.linkRow}>
        <Ionicons name="document-attach-outline" size={15} color="#6B7280" />
        <Text style={styles.linkLabel} numberOfLines={2}>
          {block.fileTitle?.trim() || 'Файл'}
        </Text>
      </View>
    );
  }
  const text = stripFormatting(block.text ?? '').trim();
  if (type === 'checkbox') {
    return (
      <View style={styles.linkRow}>
        <Ionicons name={block.checked ? 'checkbox' : 'square-outline'} size={16} color="#6B7280" />
        <Text style={styles.paragraph}>{text}</Text>
      </View>
    );
  }
  if (type === 'bulleted') return <Text style={styles.paragraph}>{`•  ${text}`}</Text>;
  if (type === 'numbered') return <Text style={styles.paragraph}>{`1.  ${text}`}</Text>;
  if (text === '') return null;
  // A whole line in bold is what a column title becomes (see
  // boardToDocument's headingBlock), so it reads as the heading it is.
  const isHeading = /^\*\*.+\*\*$/.test((block.text ?? '').trim());
  return <Text style={isHeading ? styles.heading : styles.paragraph}>{text}</Text>;
}

// The right-hand half of the board: the document this board would produce,
// laid out as it will be exported, while the board itself stays readable
// on the left. That pairing is the point - the stickers and comment cards
// that explain a decision never travel into the document, so they have to
// be visible beside it while deciding what the document is missing.
export default function BoardDocumentPreview({
  title,
  blocks,
  building,
  hasDocument,
  onGenerate,
  onClose,
}: {
  title: string;
  blocks: Block[];
  building: boolean;
  hasDocument: boolean;
  onGenerate: () => void;
  onClose: () => void;
}) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable hitSlop={8} onPress={onClose}>
          <Ionicons name="close" size={22} color="#111827" />
        </Pressable>
        <Text style={styles.headerLabel} numberOfLines={1}>
          Попередній перегляд
        </Text>
        <Pressable style={styles.generateButton} onPress={onGenerate}>
          <Text style={styles.generateLabel}>{hasDocument ? 'Оновити' : 'Сформувати'}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title}>{title || 'Без назви'}</Text>
        {building && <Text style={styles.hint}>Збираємо…</Text>}
        {!building && blocks.length === 0 && (
          <Text style={styles.hint}>На дошці ще немає карток, з яких можна скласти документ.</Text>
        )}
        {blocks.map((block) => (
          <PreviewBlock key={block.id} block={block} />
        ))}
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
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
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
    paddingBottom: 140,
    gap: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 6,
  },
  heading: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    marginTop: 8,
  },
  paragraph: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    color: '#111827',
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  linkLabel: {
    flex: 1,
    fontSize: 15,
    color: '#374151',
  },
  image: {
    width: '100%',
    aspectRatio: 1.5,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 8,
  },
  hint: {
    fontSize: 14,
    color: '#9CA3AF',
  },
});
