import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Tag } from '../types';
import TagPicker from './TagPicker';

const ACCENT = '#3B82F6';

type Props = {
  tagIds: string[];
  tags: Tag[];
  onAttach: (tag: Tag) => void;
  onDetach: (tag: Tag) => void;
  onCreateAndAttach: (path: string, icon: string, color: string) => void;
  onRenameTag: (tag: Tag, newPath: string) => void;
};

// A permanent, always-visible tag block under the document title - not a
// modal/dropdown like TagPicker (used for Links/Photos/Files rows). Typing
// 2+ letters shows matches inline, right under this same block; picking one
// attaches it immediately. Creating a brand-new tag still needs an
// icon+color, which doesn't fit inline, so that one step opens TagPicker's
// own create form directly (see DocumentTagBlock.dc.html).
export default function DocumentTagsBlock({ tagIds, tags, onAttach, onDetach, onCreateAndAttach, onRenameTag }: Props) {
  const [query, setQuery] = useState('');
  const [createModal, setCreateModal] = useState<{ path: string } | null>(null);

  const appliedTags = tags.filter((tag) => tagIds.includes(tag.id));
  const needle = query.trim().toLowerCase();
  const suggestions =
    needle.length === 0
      ? []
      : tags.filter((tag) => !tagIds.includes(tag.id) && tag.path.toLowerCase().includes(needle));
  const hasExactMatch = tags.some((tag) => tag.path.toLowerCase() === needle);
  const canCreate = needle.length >= 2 && !hasExactMatch;

  function pickSuggestion(tag: Tag) {
    onAttach(tag);
    setQuery('');
  }

  function startCreate() {
    setCreateModal({ path: query.trim() });
    setQuery('');
  }

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {appliedTags.map((tag) => (
          <Pressable
            key={tag.id}
            style={[styles.chip, { backgroundColor: `${tag.color}1A` }]}
            onPress={() => onDetach(tag)}
          >
            <Ionicons name={tag.icon as keyof typeof Ionicons.glyphMap} size={12} color={tag.color} />
            <Text style={[styles.chipLabel, { color: tag.color }]} numberOfLines={1}>
              {tag.path}
            </Text>
          </Pressable>
        ))}
        <View style={styles.inputWrap}>
          <Ionicons name="add" size={13} color="#9CA3AF" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="тег"
            placeholderTextColor="#9CA3AF"
            style={styles.input}
          />
        </View>
      </View>

      {needle.length > 0 && (
        <View style={styles.dropdown}>
          <ScrollView style={styles.dropdownScroll} keyboardShouldPersistTaps="handled">
            {suggestions.map((tag) => (
              <Pressable key={tag.id} style={styles.suggestionRow} onPress={() => pickSuggestion(tag)}>
                <View style={[styles.suggestionIcon, { backgroundColor: `${tag.color}1A` }]}>
                  <Ionicons name={tag.icon as keyof typeof Ionicons.glyphMap} size={13} color={tag.color} />
                </View>
                <Text style={styles.suggestionLabel}>{tag.path}</Text>
              </Pressable>
            ))}
            {canCreate && (
              <Pressable style={styles.createRow} onPress={startCreate}>
                <Ionicons name="add" size={14} color={ACCENT} />
                <Text style={styles.createLabel}>створити тег "{query.trim()}"</Text>
              </Pressable>
            )}
          </ScrollView>
        </View>
      )}

      <TagPicker
        visible={createModal !== null}
        kind="document"
        tags={tags}
        selectedTagIds={tagIds}
        initialMode="create"
        initialPath={createModal?.path ?? ''}
        onAttach={onAttach}
        onDetach={onDetach}
        onCreateAndAttach={onCreateAndAttach}
        onRenameTag={onRenameTag}
        onClose={() => setCreateModal(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 14,
    backgroundColor: '#F9FAFB',
    padding: 10,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 9,
    paddingLeft: 7,
  },
  chipLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 70,
    gap: 5,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  input: {
    flex: 1,
    fontSize: 13,
    color: '#111827',
    padding: 0,
  },
  dropdown: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#EEF0F2',
    paddingTop: 6,
  },
  dropdownScroll: {
    maxHeight: 180,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 8,
  },
  suggestionIcon: {
    width: 24,
    height: 24,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionLabel: {
    fontSize: 13,
    color: '#111827',
  },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  createLabel: {
    fontSize: 13,
    color: ACCENT,
    fontWeight: '600',
  },
});
