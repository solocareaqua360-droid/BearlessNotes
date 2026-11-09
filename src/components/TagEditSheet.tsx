import { useStyles, useTheme } from '../theme/ThemeProvider';
import IconCatalogGrid from './IconCatalogGrid';
import type { Theme } from '../theme/tokens';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import TextInput from './AppTextInput';
// gesture-handler's ScrollView, not the core RN one: on Android a drag that
// starts on a TextInput never reaches an RN ScrollView's scroll recognition,
// so a sheet with a search/name field only scrolled when a finger happened to
// land between rows. Same fix, same reason, as FieldsEditorSheet.
import { ScrollView } from 'react-native-gesture-handler';
import { Ionicons } from './icons/Ionicons';
import { Tag } from '../types';
import { TAG_COLORS, TAG_ICONS } from '../constants/tags';
import { SHEET_BACKDROP, SHEET_WINDOW, PHONE_ONLY } from '../constants/glass';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import GlassLayer from './GlassLayer';
import Animated from 'react-native-reanimated';
import { useBottomSheet } from './surfaces/bottomSheet';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { TAG_KIND_CHOICES } from '../constants/tagKinds';
import { useDatabaseTiles } from '../hooks/useDatabaseTiles';

type Props = {
  visible: boolean;
  tag: Tag | null;
  onCancel: () => void;
  // `types`: which databases the folder shows in - chosen here by hand.
  onSave: (path: string, icon: string, color: string, types: string[]) => void;
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
  const b = useBottomSheet(visible, onCancel);
  const [path, setPath] = useState('');
  const [iconQuery, setIconQuery] = useState('');
  const [selectedIcon, setSelectedIcon] = useState(TAG_ICONS[0]);
  const [selectedColor, setSelectedColor] = useState(swatches[0]);
  // WHERE THE FOLDER SHOWS: every kind of object it may hold. A folder
  // used to belong only to the kinds something had been put in, with no
  // way to widen it by hand - "не можу присвоїти цю папку і іншому типу
  // об'єкту ... не тільки фотографіям, а ще й посиланням або YouTube".
  // A kind that already has something in this folder stays on: taking it
  // off would hide those things, not remove them.
  const [types, setTypes] = useState<string[]>([]);
  const { customDatabases } = useDatabaseTiles();
  const kindChoices = [
    ...TAG_KIND_CHOICES,
    ...customDatabases.map((d) => ({ kind: `customRow:${d.id}`, label: d.name || 'База' })),
  ];
  // «Де показувати» lives one step in (2026-11-09): thirteen chips left the icon grid no room, and for an ordinary folder
  // the ticks fill themselves (filing a thing adds its kind). 'main' = name/look, 'where' = the ticks.
  const [page, setPage] = useState<'main' | 'where'>('main');
  const holding = (kind: string) => !!tag && Object.keys(tag.usedIn).some((key) => key.startsWith(`${kind}:`));

  useEffect(() => {
    if (visible && tag) {
      setPath(tag.path);
      setIconQuery('');
      setSelectedIcon(tag.icon);
      setSelectedColor(tag.color);
      setTypes(tag.types);
      setPage('main');
    }
  }, [visible, tag]);

  // A PLAYLIST is a folder whose only kind is «YouTube / TikTok» (the explorer draws it as a card and opens its own
  // window). It used to be reached by unticking twelve other chips; now it is one switch. A collection of photos / geo
  // points is NOT a tick: it is born in its base (Tag.baseOnly), so for those the sheet only names what it is.
  const isPlaylist = types.length === 1 && types[0] === 'link-video';
  const collectionLabel = tag?.baseOnly
    ? tag.types.length === 1 && tag.types[0] === 'link-video'
      ? 'Плейліст відео'
      : tag.types.length === 1 && tag.types[0] === 'photo'
      ? 'Підбірка фото'
      : tag.types.length === 1 && tag.types[0] === 'link-geo'
      ? 'Підбірка геоточок'
      : null
    : null;
  const [typesBeforePlaylist, setTypesBeforePlaylist] = useState<string[]>([]);
  function setPlaylist(on: boolean) {
    if (on) {
      setTypesBeforePlaylist(types);
      setTypes(['link-video']);
    } else {
      setTypes(typesBeforePlaylist.filter((k) => k !== 'link-video'));
    }
  }
  const whereSummary = (() => {
    if (types.length === 0) return 'з’явиться, коли щось покласти';
    const names = kindChoices.filter((c) => types.includes(c.kind)).map((c) => c.label);
    if (names.length >= TAG_KIND_CHOICES.length) return 'усюди';
    return names.join(', ');
  })();

  function toggleType(kind: string) {
    // Unticking a kind that already holds things is allowed (2026-10-11): it only takes the folder out of
    // that kind's base (a playlist, a photo folder); the things stay filed and come back with the tick.
    setTypes((prev) => (prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]));
  }

  const filteredIcons =
    iconQuery.trim().length === 0
      ? TAG_ICONS
      : TAG_ICONS.filter((name) => name.includes(iconQuery.trim().toLowerCase()));

  function save() {
    if (!path.trim()) return;
    onSave(path.trim(), selectedIcon, selectedColor, types);
  }

  return (
    <GlassLayer visible={visible} onClose={onCancel} rise={b.on}>
      {/* Backdrop as a SIBLING behind the sheet, not its parent - as a
          parent it took the RN touch responder for every drag that did
          not land on a deeper child, which is what kept the list from
          scrolling. A tap outside still closes it. */}
      <View style={[styles.backdrop, b.frame, { paddingBottom: keyboardHeight }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <Animated.View style={[styles.sheet, b.window, b.padBottom(28)]}>
          {b.fill}
          {b.grab}
          <View style={[styles.handle, b.on && { opacity: 0 }]} />

          <View style={styles.headerRow}>
            <Pressable onPress={onCancel}>
              <Text style={styles.headerCancel}>Скасувати</Text>
            </Pressable>
            <Text style={styles.headerTitle}>Папка</Text>
            <Pressable onPress={save} disabled={!path.trim()}>
              <Text style={[styles.headerSave, !path.trim() && styles.headerSaveDisabled]}>Зберегти</Text>
            </Pressable>
          </View>

          {page === 'where' ? (
            <>
          <Pressable style={styles.optRow} onPress={() => setPage('main')}>
            <Ionicons name="chevron-back" size={18} color={theme.ink.muted} />
            <Text style={styles.optLabel}>Де показувати</Text>
          </Pressable>
          <Text style={styles.whereHint}>
            Папка з'являється в списку цього виду речей. Коли щось кладеш у папку, його вид додається сам; тут можна додати
            вид наперед. «Старт» показує всі папки незалежно від цього.
          </Text>
          <View style={styles.kindRow}>
            {kindChoices.map((choice) => {
              const on = types.includes(choice.kind);
              const locked = false;
              return (
                <Pressable
                  key={choice.kind}
                  style={[styles.kindChip, on && { backgroundColor: selectedColor, borderColor: selectedColor }, locked && styles.kindChipLocked]}
                  onPress={() => toggleType(choice.kind)}
                  accessibilityState={{ selected: on, disabled: locked }}
                >
                  {on && <Ionicons name={locked ? 'lock-closed-outline' : 'checkmark'} size={13} color="#fff" />}
                  <Text style={[styles.kindChipLabel, on && styles.kindChipLabelOn]}>{choice.label}</Text>
                </Pressable>
              );
            })}
          </View>

            </>
          ) : (
            <>
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

          {collectionLabel ? (
            <View style={styles.kindNote}>
              <Ionicons name="albums-outline" size={16} color={theme.ink.muted} />
              <Text style={styles.kindNoteText}>{collectionLabel} · живе у своїй базі</Text>
            </View>
          ) : (
            <>
              <View style={styles.optRow}>
                <Text style={styles.optLabel}>Плейліст відео</Text>
                <Switch
                  value={isPlaylist}
                  onValueChange={setPlaylist}
                  trackColor={{ true: selectedColor, false: theme.edge.hairline }}
                  thumbColor="#fff"
                />
              </View>
              {!isPlaylist && (
                <Pressable style={styles.optRow} onPress={() => setPage('where')}>
                  <Text style={styles.optLabel}>Де показувати</Text>
                  <Text style={styles.optValue} numberOfLines={1}>{whereSummary}</Text>
                  <Ionicons name="chevron-forward" size={16} color={theme.ink.faint} />
                </Pressable>
              )}
            </>
          )}

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
            <IconCatalogGrid
              query={iconQuery}
              gridStyle={styles.iconGrid}
              labelColor={theme.ink.faint}
              renderCell={(name) => (<Pressable
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
              )}
            />
          </ScrollView>
            </>
          )}
        </Animated.View>
      </View>
    </GlassLayer>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  optRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    marginBottom: 6,
  },
  optLabel: {
    flex: 1,
    fontSize: 15,
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.primary,
  },
  optValue: {
    flexShrink: 1,
    maxWidth: '55%',
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: t.ink.muted,
    textAlign: 'right',
  },
  kindNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 40,
    marginBottom: 10,
  },
  kindNoteText: {
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: t.ink.muted,
  },
  whereHint: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FONT_REGULAR,
    color: t.ink.muted,
    marginBottom: 12,
  },
  kindRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  kindChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: t.edge.strong,
  },
  kindChipLocked: {
    opacity: 0.85,
  },
  kindChipLabel: {
    fontSize: 13,
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.primary,
  },
  kindChipLabelOn: {
    color: '#fff',
  },
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
    ...PHONE_ONLY,
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
