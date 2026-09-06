import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Tag } from '../types';
import { TAG_COLORS, TAG_ICONS } from '../constants/tags';

const ACCENT = '#3B82F6';

type Props = {
  visible: boolean;
  tag: Tag | null;
  onCancel: () => void;
  onSave: (path: string, icon: string, color: string) => void;
};

// Full tag editor for TagManageScreen - path, color and icon together,
// same swatch-row/icon-grid UI as TagPicker's own "new tag" form (see
// TagPicker.tsx), just pre-filled from an existing tag and always in edit
// mode rather than reached only through a first assignment.
export default function TagEditSheet({ visible, tag, onCancel, onSave }: Props) {
  const [path, setPath] = useState('');
  const [iconQuery, setIconQuery] = useState('');
  const [selectedIcon, setSelectedIcon] = useState(TAG_ICONS[0]);
  const [selectedColor, setSelectedColor] = useState(TAG_COLORS[0]);

  useEffect(() => {
    if (visible && tag) {
      setPath(tag.path);
      setIconQuery('');
      setSelectedIcon(tag.icon);
      setSelectedColor(tag.color);
    }
  }, [visible, tag]);

  const filteredIcons =
    iconQuery.trim().length === 0
      ? TAG_ICONS
      : TAG_ICONS.filter((name) => name.includes(iconQuery.trim().toLowerCase()));

  function save() {
    if (!path.trim()) return;
    onSave(path.trim(), selectedIcon, selectedColor);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />

          <View style={styles.headerRow}>
            <Pressable onPress={onCancel}>
              <Text style={styles.headerCancel}>Скасувати</Text>
            </Pressable>
            <Text style={styles.headerTitle}>Тег</Text>
            <Pressable onPress={save} disabled={!path.trim()}>
              <Text style={[styles.headerSave, !path.trim() && styles.headerSaveDisabled]}>Зберегти</Text>
            </Pressable>
          </View>

          <View style={styles.previewRow}>
            <View style={[styles.previewIcon, { backgroundColor: `${selectedColor}1F` }]}>
              <Ionicons name={selectedIcon as keyof typeof Ionicons.glyphMap} size={22} color={selectedColor} />
            </View>
            <TextInput
              value={path}
              onChangeText={setPath}
              placeholder='робота/оренда'
              placeholderTextColor="#9CA3AF"
              style={styles.pathInput}
            />
          </View>

          <Text style={styles.sectionLabel}>КОЛІР</Text>
          <View style={styles.colorRow}>
            {TAG_COLORS.map((color) => (
              <Pressable
                key={color}
                style={[styles.colorSwatch, { backgroundColor: color }, selectedColor === color && styles.colorSwatchSelected]}
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
        </Pressable>
      </Pressable>
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerCancel: {
    fontSize: 15,
    color: '#6B7280',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
  },
  headerSave: {
    fontSize: 15,
    fontWeight: '700',
    color: ACCENT,
  },
  headerSaveDisabled: {
    color: '#BFDBFE',
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
  },
  previewIcon: {
    width: 48,
    height: 48,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pathInput: {
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
    maxHeight: 240,
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
});
