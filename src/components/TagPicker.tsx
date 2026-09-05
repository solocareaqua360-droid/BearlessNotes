import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Tag, TaggableKind } from '../types';
import { TAG_COLORS, TAG_ICONS } from '../constants/tags';
import { isTagAllowedForKind } from '../hooks/useTags';
import RenamePrompt from './RenamePrompt';

const ACCENT = '#3B82F6';

const KIND_LABELS: Record<TaggableKind, string> = {
  file: 'Файли',
  photo: 'Фото',
  'link-video': 'Відео',
  'link-geo': 'Геоточки',
  'link-other': 'Посилання',
  document: 'Документи',
};

type Props = {
  visible: boolean;
  kind: TaggableKind;
  tags: Tag[];
  selectedTagIds: string[];
  onAttach: (tag: Tag) => void;
  onDetach: (tag: Tag) => void;
  onCreateAndAttach: (path: string, icon: string, color: string) => void;
  onRenameTag: (tag: Tag, newPath: string) => void;
  onClose: () => void;
  // Opens the sheet straight into the create form (DocumentTagsBlock's own
  // inline search has no popup of its own, so "create tag" there reuses
  // just this sub-view rather than duplicating the icon/color grid).
  initialMode?: 'list' | 'create';
  initialPath?: string;
};

// Bottom-sheet tag picker for a single database item (Files/Photos/Links
// row) - see TagPicker.dc.html / IconColorPicker.dc.html. Two internal
// modes: the search+list, and a "new tag" icon+color form reached only
// from a first assignment (there's no standalone tag-creation path).
export default function TagPicker({
  visible,
  kind,
  tags,
  selectedTagIds,
  onAttach,
  onDetach,
  onCreateAndAttach,
  onRenameTag,
  onClose,
  initialMode = 'list',
  initialPath = '',
}: Props) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'list' | 'create'>('list');
  const [creatingPath, setCreatingPath] = useState('');
  const [iconQuery, setIconQuery] = useState('');
  const [selectedIcon, setSelectedIcon] = useState(TAG_ICONS[0]);
  const [selectedColor, setSelectedColor] = useState(TAG_COLORS[0]);
  const [renamingTag, setRenamingTag] = useState<Tag | null>(null);

  useEffect(() => {
    if (visible) {
      setQuery('');
      if (initialMode === 'create') {
        setCreatingPath(initialPath);
        setIconQuery('');
        setSelectedIcon(TAG_ICONS[0]);
        setSelectedColor(TAG_COLORS[0]);
        setMode('create');
      } else {
        setMode('list');
      }
    }
    // initialMode/initialPath are read once when the sheet opens, not
    // tracked live - re-running this on their identity would reset the
    // in-progress create form on every keystroke of the caller's own state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const needle = query.trim().toLowerCase();
  const visibleTags = tags.filter((tag) => isTagAllowedForKind(tag, kind));
  const matches = needle.length === 0 ? visibleTags : visibleTags.filter((tag) => tag.path.toLowerCase().includes(needle));
  // Checked against the FULL tag list (not just what's visible for this
  // kind) so a name already used by a hidden, cross-kind tag can't be
  // duplicated - it just stays unavailable here, same as being filtered out.
  const hasExactMatch = tags.some((tag) => tag.path.toLowerCase() === needle);
  const canCreate = needle.length >= 2 && !hasExactMatch;

  function startCreate() {
    setCreatingPath(query.trim());
    setIconQuery('');
    setSelectedIcon(TAG_ICONS[0]);
    setSelectedColor(TAG_COLORS[0]);
    setMode('create');
  }

  function saveNewTag() {
    if (!creatingPath.trim()) return;
    onCreateAndAttach(creatingPath.trim(), selectedIcon, selectedColor);
    onClose();
  }

  const filteredIcons =
    iconQuery.trim().length === 0
      ? TAG_ICONS
      : TAG_ICONS.filter((name) => name.includes(iconQuery.trim().toLowerCase()));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />

          {mode === 'list' ? (
            <>
              <Text style={styles.title}>Теги</Text>
              <View style={styles.searchRow}>
                <Ionicons name="search" size={16} color="#9CA3AF" />
                <TextInput
                  autoFocus
                  value={query}
                  onChangeText={setQuery}
                  placeholder='пошук або нова назва "робота/..."'
                  placeholderTextColor="#9CA3AF"
                  style={styles.searchInput}
                />
              </View>

              <ScrollView style={styles.list}>
                {matches.map((tag) => {
                  const selected = selectedTagIds.includes(tag.id);
                  return (
                    <View key={tag.id} style={styles.row}>
                      <Pressable
                        style={styles.rowTap}
                        onPress={() => (selected ? onDetach(tag) : onAttach(tag))}
                      >
                        <View style={[styles.rowIcon, { backgroundColor: `${tag.color}1A` }]}>
                          <Ionicons name={tag.icon as keyof typeof Ionicons.glyphMap} size={15} color={tag.color} />
                        </View>
                        <View style={styles.rowBody}>
                          <Text style={styles.rowLabel}>{tag.path}</Text>
                          <Text style={styles.rowMeta}>
                            {Object.keys(tag.usedIn).length} елем. · {tag.types.map((t) => KIND_LABELS[t]).join(', ')}
                          </Text>
                        </View>
                        <View style={selected ? styles.checkFilled : styles.checkEmpty}>
                          {selected && <Ionicons name="checkmark" size={13} color="#fff" />}
                        </View>
                      </Pressable>
                      <Pressable hitSlop={8} style={styles.pencilButton} onPress={() => setRenamingTag(tag)}>
                        <Ionicons name="pencil-outline" size={14} color="#9CA3AF" />
                      </Pressable>
                    </View>
                  );
                })}

                {canCreate && (
                  <Pressable style={styles.createRow} onPress={startCreate}>
                    <Ionicons name="add" size={18} color={ACCENT} />
                    <Text style={styles.createLabel}>Створити тег "{query.trim()}"</Text>
                  </Pressable>
                )}
              </ScrollView>
            </>
          ) : (
            <>
              <View style={styles.createHeaderRow}>
                <Pressable onPress={() => setMode('list')}>
                  <Text style={styles.createHeaderCancel}>Скасувати</Text>
                </Pressable>
                <Text style={styles.createHeaderTitle}>Новий тег</Text>
                <Pressable onPress={saveNewTag}>
                  <Text style={styles.createHeaderSave}>Зберегти</Text>
                </Pressable>
              </View>

              <View style={styles.createPreviewRow}>
                <View style={[styles.createPreviewIcon, { backgroundColor: `${selectedColor}1F` }]}>
                  <Ionicons name={selectedIcon as keyof typeof Ionicons.glyphMap} size={22} color={selectedColor} />
                </View>
                <Text style={styles.createPreviewPath} numberOfLines={1}>
                  {creatingPath}
                </Text>
              </View>

              <Text style={styles.sectionLabel}>КОЛІР</Text>
              <View style={styles.colorRow}>
                {TAG_COLORS.map((color) => (
                  <Pressable
                    key={color}
                    style={[
                      styles.colorSwatch,
                      { backgroundColor: color },
                      selectedColor === color && styles.colorSwatchSelected,
                    ]}
                    onPress={() => setSelectedColor(color)}
                  />
                ))}
              </View>

              <Text style={styles.sectionLabel}>ІКОНКА</Text>
              <View style={styles.iconSearchRow}>
                <Ionicons name="search" size={14} color="#9CA3AF" />
                <TextInput
                  value={iconQuery}
                  onChangeText={setIconQuery}
                  placeholder="пошук іконки"
                  placeholderTextColor="#9CA3AF"
                  style={styles.iconSearchInput}
                />
              </View>
              <ScrollView style={styles.iconGridScroll}>
                <View style={styles.iconGrid}>
                  {filteredIcons.map((name) => (
                    <Pressable
                      key={name}
                      style={[styles.iconCell, selectedIcon === name && { backgroundColor: selectedColor }]}
                      onPress={() => setSelectedIcon(name)}
                    >
                      <Ionicons
                        name={name as keyof typeof Ionicons.glyphMap}
                        size={18}
                        color={selectedIcon === name ? '#fff' : '#6B7280'}
                      />
                    </Pressable>
                  ))}
                </View>
              </ScrollView>

              <Text style={styles.sectionLabel}>ТИП</Text>
              <View style={styles.typeRow}>
                <View style={styles.typeChip}>
                  <Text style={styles.typeChipLabel}>{KIND_LABELS[kind]}</Text>
                </View>
                <Text style={styles.typeHint}>- звідки створюєш</Text>
              </View>
            </>
          )}
        </Pressable>
      </Pressable>

      <RenamePrompt
        visible={renamingTag !== null}
        title="Назва тега"
        initialValue={renamingTag?.path ?? ''}
        onCancel={() => setRenamingTag(null)}
        onSave={(value) => {
          if (renamingTag) onRenameTag(renamingTag, value);
          setRenamingTag(null);
        }}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    maxHeight: '80%',
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#E5E7EB',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 10,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#111827',
  },
  list: {
    marginTop: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowTap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  rowIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    fontSize: 15,
    color: '#111827',
  },
  rowMeta: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 1,
  },
  checkFilled: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkEmpty: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
  },
  pencilButton: {
    padding: 8,
  },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    marginTop: 4,
  },
  createLabel: {
    fontSize: 15,
    color: ACCENT,
    fontWeight: '600',
  },
  createHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  createHeaderCancel: {
    fontSize: 15,
    color: '#6B7280',
  },
  createHeaderTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
  },
  createHeaderSave: {
    fontSize: 15,
    fontWeight: '700',
    color: ACCENT,
  },
  createPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
  },
  createPreviewIcon: {
    width: 48,
    height: 48,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createPreviewPath: {
    flex: 1,
    fontSize: 17,
    color: '#111827',
    borderBottomWidth: 1.5,
    borderBottomColor: '#E5E7EB',
    paddingBottom: 8,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 8,
  },
  colorRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  colorSwatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  colorSwatchSelected: {
    borderWidth: 2,
    borderColor: '#111827',
  },
  iconSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  iconSearchInput: {
    flex: 1,
    fontSize: 13,
    color: '#111827',
  },
  iconGridScroll: {
    maxHeight: 180,
    marginBottom: 12,
  },
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  iconCell: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  typeChip: {
    borderRadius: 16,
    backgroundColor: '#EFF6FF',
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  typeChipLabel: {
    fontSize: 13,
    color: ACCENT,
    fontWeight: '600',
  },
  typeHint: {
    fontSize: 12,
    color: '#9CA3AF',
  },
});
