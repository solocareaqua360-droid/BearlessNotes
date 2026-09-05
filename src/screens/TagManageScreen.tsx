import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Tag } from '../types';
import { useTags } from '../hooks/useTags';
import RenamePrompt from '../components/RenamePrompt';

const DANGER = '#EF4444';

const KIND_LABELS: Record<string, string> = {
  file: 'Файли',
  photo: 'Фото',
  'link-video': 'Відео',
  'link-geo': 'Геоточки',
  'link-other': 'Посилання',
  document: 'Документи',
};

// Edit/delete-only, per the design decision this app settled on: a tag can
// only be CREATED alongside a first assignment (see TagPicker), so there's
// no "+" here - this screen just lists every tag that already exists.
// Sorted flat by path (the hook already orders by it) rather than grouped
// into a visual tree - the tree view belongs to Search's browsing mode, not
// duplicated here.
export default function TagManageScreen() {
  const { tags, isLoading, renameTag, deleteTagCompletely } = useTags();
  const [renamingTag, setRenamingTag] = useState<Tag | null>(null);

  function confirmDelete(tag: Tag) {
    const count = Object.keys(tag.usedIn).length;
    Alert.alert(
      `Видалити тег "${tag.path}"?`,
      `Він буде знятий з ${count} ${count === 1 ? 'елемента' : 'елементів'}.`,
      [
        { text: 'Скасувати', style: 'cancel' },
        { text: 'Видалити', style: 'destructive', onPress: () => deleteTagCompletely(tag) },
      ]
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Теги</Text>
      <Text style={styles.subtitle}>
        Керування вже існуючими тегами. Створити новий тег можна лише разом із присвоєнням елементу.
      </Text>

      {!isLoading && tags.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Ionicons name="pricetag-outline" size={32} color="#3B82F6" />
          </View>
          <Text style={styles.emptyLabel}>Ще немає тегів</Text>
          <Text style={styles.emptyHint}>Додайте перший тег через меню тегів на будь-якому елементі</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {tags.map((tag) => (
            <View key={tag.id} style={styles.row}>
              <View style={[styles.rowIcon, { backgroundColor: `${tag.color}1A` }]}>
                <Ionicons name={tag.icon as keyof typeof Ionicons.glyphMap} size={16} color={tag.color} />
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowLabel}>{tag.path}</Text>
                <Text style={styles.rowMeta}>
                  {Object.keys(tag.usedIn).length} {Object.keys(tag.usedIn).length === 1 ? 'елемент' : 'елементів'} ·{' '}
                  {tag.types.map((t) => KIND_LABELS[t] ?? t).join(', ')}
                </Text>
              </View>
              <Pressable hitSlop={8} style={styles.rowAction} onPress={() => setRenamingTag(tag)}>
                <Ionicons name="pencil-outline" size={15} color="#9CA3AF" />
              </Pressable>
              <Pressable hitSlop={8} style={styles.rowAction} onPress={() => confirmDelete(tag)}>
                <Ionicons name="trash-outline" size={15} color={DANGER} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}

      <RenamePrompt
        visible={renamingTag !== null}
        title="Назва тега"
        initialValue={renamingTag?.path ?? ''}
        onCancel={() => setRenamingTag(null)}
        onSave={(value) => {
          if (renamingTag) renameTag(renamingTag, value);
          setRenamingTag(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    paddingHorizontal: 20,
    paddingTop: 56,
  },
  subtitle: {
    fontSize: 12,
    color: '#9CA3AF',
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 12,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyLabel: {
    marginTop: 16,
    fontSize: 15,
    color: '#111827',
    textAlign: 'center',
  },
  emptyHint: {
    marginTop: 6,
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  rowMeta: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 1,
  },
  rowAction: {
    padding: 6,
  },
});
