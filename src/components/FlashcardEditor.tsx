import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from './icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { collection, deleteDoc, deleteField, doc, getDoc, updateDoc } from '../firestore';
import { addDoc, setDoc } from '../utils/owned';
import { db } from '../firebase';
import { Flashcard, FlashcardImage, Group, Tag } from '../types';
import { detachTagFromDeletedItem, useTags } from '../hooks/useTags';
import TagPicker from './TagPicker';
import { groupKindFields } from '../utils/groups';
import { backupFileToDrive } from '../utils/googleDrive';
import AttachmentImage from './AttachmentImage';
import Sheet from './surfaces/Sheet';
import { ask, confirm } from './surfaces/Ask';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';

const GROUP_COLORS = ['#3B82F6', '#16A34A', '#8B5CF6', '#F97316', '#EC4899', '#14B8A6', '#EAB308'];
const THUMB = 76;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Same resize-then-compress every other image-picking flow in this app
// goes through (StickerComposer, the editor's image blocks) - duplicated,
// per this app's convention for small single-purpose helpers.
async function compressPickedImage(uri: string, width: number, height: number): Promise<string> {
  const MAX_DIMENSION = 1600;
  try {
    const longest = Math.max(width, height);
    let context = ImageManipulator.manipulate(uri);
    if (longest > MAX_DIMENSION) {
      const scale = MAX_DIMENSION / longest;
      context = context.resize({ width: Math.round(width * scale), height: Math.round(height * scale) });
    }
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
    return saved.uri;
  } catch {
    return uri;
  }
}

// A picture's copy on Drive, written into the card once it lands - read
// fresh, so an edit made in the meantime is not overwritten.
async function backUpImages(cardId: string, images: FlashcardImage[]) {
  for (const image of images) {
    if (image.driveFileId) continue;
    const uploaded = await backupFileToDrive(image.uri, `${generateId()}.jpg`, 'image/jpeg', 'Photos');
    if (!uploaded) continue;
    const snapshot = await getDoc(doc(db, 'flashcards', cardId));
    const current = (snapshot.data()?.images as FlashcardImage[] | undefined) ?? [];
    if (!current.some((i) => i.uri === image.uri)) continue;
    await updateDoc(doc(db, 'flashcards', cardId), {
      images: current.map((i) =>
        i.uri === image.uri ? { ...i, driveFileId: uploaded.fileId, driveBytes: uploaded.bytes } : i
      ),
    });
  }
}

// Making a card and changing one - one window for both. The term on top,
// the explanation under it, the pictures as a row of thumbnails with
// "Додати фото" at its end, and the project the card is filed under.
export default function FlashcardEditor({
  visible,
  card,
  groups,
  defaultGroupId,
  tagApi,
  onClose,
}: {
  visible: boolean;
  // null = a new card.
  card: Flashcard | null;
  groups: Group[];
  // A new card lands in the project being looked at.
  defaultGroupId?: string | null;
  // The screen's own tag machinery (useDatabaseList spreads useTags).
  tagApi: Pick<ReturnType<typeof useTags>, 'tags' | 'attachTag' | 'detachTag' | 'createAndAttachTag' | 'renameTag'>;
  onClose: () => void;
}) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const [term, setTerm] = useState('');
  const [explanation, setExplanation] = useState('');
  const [images, setImages] = useState<FlashcardImage[]>([]);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState<string | null>(null);
  // Smartfolders are chosen here and written on save: a new card has no
  // document yet for a tag to be attached to.
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [newTags, setNewTags] = useState<{ path: string; icon: string; color: string }[]>([]);
  const [tagPickerVisible, setTagPickerVisible] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setTerm(card?.term ?? '');
    setExplanation(card?.explanation ?? '');
    setImages(card?.images ?? []);
    setGroupId(card ? card.groupId ?? null : defaultGroupId ?? null);
    setNewGroupName(null);
    setTagIds(card?.tagIds ?? []);
    setNewTags([]);
    setTagPickerVisible(false);
  }, [visible, card, defaultGroupId]);

  async function addPhoto() {
    const source = await ask({
      title: 'Додати фото',
      actions: [
        { id: 'gallery', label: 'З галереї' },
        { id: 'camera', label: 'Камера' },
      ],
    });
    if (source !== 'gallery' && source !== 'camera') return;
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, allowsMultipleSelection: true });
    if (result.canceled) return;
    const picked = await Promise.all(
      result.assets.map(async (asset) => ({ uri: await compressPickedImage(asset.uri, asset.width, asset.height) }))
    );
    setImages((prev) => [...prev, ...picked]);
  }

  async function createGroup() {
    const name = newGroupName?.trim();
    if (!name) {
      setNewGroupName(null);
      return;
    }
    const color = GROUP_COLORS[groups.length % GROUP_COLORS.length];
    const created = await addDoc(collection(db, 'groups'), { name, color, ...groupKindFields(['flashcard']) });
    setGroupId(created.id);
    setNewGroupName(null);
  }

  async function save() {
    const cleanTerm = term.trim();
    if (!cleanTerm && images.length === 0) {
      onClose();
      return;
    }
    const now = Date.now();
    const id = card?.id ?? generateId();
    if (card) {
      await updateDoc(doc(db, 'flashcards', id), {
        term: cleanTerm,
        explanation: explanation.trim(),
        images,
        groupId: groupId ?? deleteField(),
        updatedAt: now,
      });
    } else {
      await setDoc(doc(db, 'flashcards', id), {
        term: cleanTerm,
        explanation: explanation.trim(),
        images,
        tagIds: [],
        ...(groupId ? { groupId } : {}),
        createdAt: now,
        updatedAt: now,
      });
    }
    onClose();
    // The smartfolders, now that there is a card to file.
    const before = card?.tagIds ?? [];
    for (const tagId of tagIds) {
      if (before.includes(tagId)) continue;
      const tag = tagApi.tags.find((t) => t.id === tagId);
      if (tag) await tagApi.attachTag(tag, 'flashcard', id, 'flashcards');
    }
    for (const tagId of before) {
      if (tagIds.includes(tagId)) continue;
      const tag = tagApi.tags.find((t) => t.id === tagId);
      if (tag) await tagApi.detachTag(tag, 'flashcard', id, 'flashcards');
    }
    for (const created of newTags) {
      await tagApi.createAndAttachTag(created.path, created.icon, created.color, 'flashcard', id, 'flashcards');
    }
    backUpImages(id, images);
  }

  async function remove() {
    if (!card) return;
    const yes = await confirm({ title: 'Видалити картку?', confirmLabel: 'Видалити' });
    if (!yes) return;
    onClose();
    deleteDoc(doc(db, 'flashcards', card.id));
    (card.tagIds ?? []).forEach((tagId) => {
      const tag = tagApi.tags.find((t) => t.id === tagId);
      if (tag) detachTagFromDeletedItem(tag, 'flashcard', card.id);
    });
  }

  return (
    <>
    <Sheet visible={visible} onClose={onClose} title={card ? 'Картка' : 'Нова картка'} scroll maxHeight="85%">
      <Text style={styles.label}>Термін</Text>
      <TextInput
        style={[styles.input, styles.termInput]}
        value={term}
        onChangeText={setTerm}
        placeholder="Що вивчити"
        placeholderTextColor={theme.field.placeholder}
        multiline
        autoFocus={!card}
      />

      <Text style={styles.label}>Пояснення</Text>
      <TextInput
        style={[styles.input, styles.explanationInput]}
        value={explanation}
        onChangeText={setExplanation}
        placeholder="Розгорнеться під терміном - необовʼязково"
        placeholderTextColor={theme.field.placeholder}
        multiline
        textAlignVertical="top"
      />

      <Text style={styles.label}>Фото</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbs}>
        {images.map((image, i) => (
          <View key={`${i}:${image.uri}`} style={styles.thumb}>
            <AttachmentImage uri={image.uri} driveFileId={image.driveFileId} style={styles.thumbImage} />
            <Pressable
              hitSlop={6}
              style={styles.thumbRemove}
              onPress={() => setImages((prev) => prev.filter((_, j) => j !== i))}
            >
              <Ionicons name="close" size={14} color="#fff" />
            </Pressable>
          </View>
        ))}
        <Pressable style={[styles.thumb, styles.addThumb]} onPress={addPhoto}>
          <Ionicons name="image-outline" size={22} color={theme.ink.muted} />
          <Text style={styles.addThumbLabel}>Додати</Text>
        </Pressable>
      </ScrollView>

      <Text style={styles.label}>Проект</Text>
      <View style={styles.chips}>
        <Chip label="Без проекту" active={groupId === null} onPress={() => setGroupId(null)} />
        {groups.map((g) => (
          <Chip key={g.id} label={g.name} color={g.color} active={groupId === g.id} onPress={() => setGroupId(g.id)} />
        ))}
        {newGroupName === null ? (
          <Chip label="Новий" icon="add" onPress={() => setNewGroupName('')} />
        ) : (
          <TextInput
            style={[styles.input, styles.newGroupInput]}
            value={newGroupName}
            onChangeText={setNewGroupName}
            placeholder="Назва проекту"
            placeholderTextColor={theme.field.placeholder}
            autoFocus
            onSubmitEditing={createGroup}
            onBlur={createGroup}
            returnKeyType="done"
          />
        )}
      </View>

      <Text style={styles.label}>Смартпапки</Text>
      <View style={styles.chips}>
        {tagIds.map((tagId) => {
          const tag = tagApi.tags.find((t) => t.id === tagId);
          if (!tag) return null;
          return (
            <Chip
              key={tagId}
              label={tag.path}
              color={tag.color}
              active
              trailing="close"
              onPress={() => setTagIds((prev) => prev.filter((x) => x !== tagId))}
            />
          );
        })}
        {newTags.map((created, i) => (
          <Chip
            key={`new:${i}`}
            label={created.path}
            color={created.color}
            active
            trailing="close"
            onPress={() => setNewTags((prev) => prev.filter((_, j) => j !== i))}
          />
        ))}
        <Chip label="Додати" icon="add" onPress={() => setTagPickerVisible(true)} />
      </View>

      <View style={styles.actions}>
        {card && (
          <Pressable style={[styles.button, styles.dangerButton]} onPress={remove}>
            <Ionicons name="trash-outline" size={17} color={theme.danger} />
            <Text style={[styles.buttonLabel, { color: theme.danger }]}>Видалити</Text>
          </Pressable>
        )}
        <Pressable style={[styles.button, styles.primaryButton]} onPress={save}>
          <Ionicons name="checkmark" size={18} color={theme.onAccent} />
          <Text style={[styles.buttonLabel, { color: theme.onAccent }]}>Зберегти</Text>
        </Pressable>
      </View>
    </Sheet>
    {/* After the sheet, so it opens over it. */}
    <TagPicker
      visible={visible && tagPickerVisible}
      kind="flashcard"
      tags={tagApi.tags}
      selectedTagIds={tagIds}
      onAttach={(tag: Tag) => setTagIds((prev) => (prev.includes(tag.id) ? prev : [...prev, tag.id]))}
      onDetach={(tag: Tag) => setTagIds((prev) => prev.filter((x) => x !== tag.id))}
      onCreateAndAttach={(path, icon, color) => {
        setNewTags((prev) => [...prev, { path, icon, color }]);
        setTagPickerVisible(false);
      }}
      onRenameTag={tagApi.renameTag}
      onClose={() => setTagPickerVisible(false)}
    />
    </>
  );

  function Chip({
    label,
    color,
    icon,
    active,
    trailing,
    onPress,
  }: {
    label: string;
    color?: string;
    icon?: keyof typeof Ionicons.glyphMap;
    active?: boolean;
    trailing?: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
  }) {
    return (
      <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
        {icon ? (
          <Ionicons name={icon} size={14} color={theme.ink.primary} />
        ) : (
          <View style={[styles.chipDot, { backgroundColor: color ?? theme.ink.faint }]} />
        )}
        <Text style={styles.chipLabel}>{label}</Text>
        {trailing && <Ionicons name={trailing} size={13} color={theme.ink.muted} />}
      </Pressable>
    );
  }
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    label: {
      fontSize: 13,
      fontFamily: FONT_SEMIBOLD,
      color: t.ink.muted,
      marginTop: 12,
      marginBottom: 6,
    },
    input: {
      fontSize: 15,
      fontFamily: FONT_REGULAR,
      color: t.field.ink,
      backgroundColor: t.field.fill,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    termInput: {
      fontSize: 18,
      fontFamily: FONT_SEMIBOLD,
    },
    explanationInput: {
      minHeight: 110,
    },
    thumbs: {
      gap: 8,
    },
    thumb: {
      width: THUMB,
      height: THUMB,
      borderRadius: 12,
      overflow: 'hidden',
    },
    thumbImage: {
      width: THUMB,
      height: THUMB,
    },
    thumbRemove: {
      position: 'absolute',
      top: 4,
      right: 4,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    addThumb: {
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: t.edge.hairline,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
    },
    addThumbLabel: {
      fontSize: 11,
      fontFamily: FONT_REGULAR,
      color: t.ink.muted,
    },
    chips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      height: 34,
      borderRadius: 17,
      borderWidth: 1,
      borderColor: t.edge.hairline,
    },
    chipActive: {
      backgroundColor: t.selected,
      borderColor: t.accent,
    },
    chipDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    chipLabel: {
      fontSize: 14,
      fontFamily: FONT_REGULAR,
      color: t.ink.primary,
    },
    newGroupInput: {
      minWidth: 150,
      height: 34,
      paddingVertical: 0,
    },
    actions: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 20,
    },
    button: {
      flex: 1,
      height: 48,
      borderRadius: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    primaryButton: {
      backgroundColor: t.accent,
    },
    dangerButton: {
      borderWidth: 1,
      borderColor: t.danger,
    },
    buttonLabel: {
      fontSize: 15,
      fontFamily: FONT_SEMIBOLD,
    },
  });
