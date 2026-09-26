import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
// gesture-handler's ScrollView, not the core RN one: on Android a drag that
// starts on a TextInput never reaches an RN ScrollView's scroll recognition,
// so a sheet with a search/name field only scrolled when a finger happened to
// land between rows. Same fix, same reason, as FieldsEditorSheet.
import { ScrollView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { Tag } from '../types';
import { TAG_COLORS, TAG_ICONS } from '../constants/tags';
import { SHEET_BACKDROP, SHEET_WINDOW } from '../constants/glass';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import GlassLayer from './GlassLayer';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';

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
  const theme = useTheme();
  const accent = theme.accent;
  const swatches = useTheme().cards;
  const styles = useStyles(makeStyles);
  const keyboardHeight = useKeyboardHeight();
  const [path, setPath] = useState('');
  const [iconQuery, setIconQuery] = useState('');
  const [selectedIcon, setSelectedIcon] = useState(TAG_ICONS[0]);
  const [selectedColor, setSelectedColor] = useState(swatches[0]);

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
    <GlassLayer visible={visible} onClose={onCancel}>
      {/* Backdrop as a SIBLING behind the sheet, not its parent - as a
          parent it took the RN touch responder for every drag that did
          not land on a deeper child, which is what kept the list from
          scrolling. A tap outside still closes it. */}
      <View style={[styles.backdrop, { paddingBottom: keyboardHeight }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View style={styles.sheet}>
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
              placeholderTextColor={theme.ink.faint}
              style={styles.pathInput}
            />
          </View>

          <Text style={styles.sectionLabel}>КОЛІР</Text>
          <View style={styles.colorRow}>
            {swatches.map((color) => (
              <Pressable
                key={color}
                style={[styles.colorSwatch, { backgroundColor: color }, selectedColor === color && styles.colorSwatchSelected]}
                onPress={() => setSelectedColor(color)}
              />
            ))}
          </View>

          <Text style={styles.sectionLabel}>ІКОНКА</Text>
          <View style={styles.iconSearchRow}>
            <Ionicons name="search" size={14} color={theme.ink.faint} />
            <TextInput
              value={iconQuery}
              onChangeText={setIconQuery}
              placeholder="пошук іконки"
              placeholderTextColor={theme.ink.faint}
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
                    color={selectedIcon === name ? '#fff' : theme.ink.muted}
                  />
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </View>
      </View>
    </GlassLayer>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  backdrop: {
    ...SHEET_BACKDROP,
  },
  sheet: {
    backgroundColor: t.raised,
    ...SHEET_WINDOW,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    maxHeight: '80%',
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: t.edge.hairline,
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
    fontFamily: FONT_REGULAR,
    color: t.ink.muted,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: t.ink.primary,
  },
  headerSave: {
    fontSize: 15,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: t.accent,
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
    fontFamily: FONT_REGULAR,
    color: t.ink.primary,
    borderBottomWidth: 1.5,
    borderBottomColor: t.edge.hairline,
    paddingBottom: 8,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.muted,
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
    borderColor: t.ink.primary,
  },
  iconSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: t.edge.hairline,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  iconSearchInput: {
    flex: 1,
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: t.ink.primary,
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
