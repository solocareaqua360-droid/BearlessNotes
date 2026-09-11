import { useEffect, useRef, useState } from 'react';
import { Keyboard, Modal, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
// gesture-handler's ScrollView, not the core RN one: a drag that starts on
// a field's name input (every row here has one) never reaches an RN
// ScrollView's scroll recognition on Android, so this list only scrolled
// when a finger happened to land between two cards. Same fix and same
// reason as DocumentEditorScreen's block list.
import { GestureHandlerRootView, ScrollView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { FieldDef, FieldOption, FieldType, RelationTarget } from '../types';
import { canJoinTitle } from '../utils/customRowDisplay';
import { TAG_COLORS } from '../constants/tags';

import {
  GLASS_ACCENT,
  GLASS_BACKDROP,
  GLASS_BODY,
  GLASS_DANGER,
  GLASS_EDGE,
  GLASS_TEXT,
  GLASS_TEXT_FAINT,
  GLASS_TEXT_MUTED,
} from '../constants/glass';

const ACCENT = '#3B82F6';
// The palette this sheet is drawn in. It sits over the database screen's
// own gradient, so it borrows that screen's glass language - a dark
// translucent body with a hairline white edge - instead of the white card
// every other sheet in the app still uses. On that body the flat blue and
// red of a white sheet go muddy, so both are lightened.
// The shared glass palette - see constants/glass.
const TEXT = GLASS_TEXT;
const TEXT_MUTED = GLASS_TEXT_MUTED;
const TEXT_FAINT = GLASS_TEXT_FAINT;
const ACCENT_ON_GLASS = GLASS_ACCENT;
const DANGER = GLASS_DANGER;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  text: 'Текст',
  number: 'Число',
  date: 'Дата',
  select: 'Список',
  multiSelect: 'Множинний список',
  relation: 'Пов’язана база',
  backlink: 'Зворотні посилання',
  section: 'Розділ',
};

// Shared with CustomDatabaseScreen's table header / row form, so a field's
// type is readable at a glance even before it's been named.
export const FIELD_TYPE_ICON: Record<FieldType, keyof typeof Ionicons.glyphMap> = {
  text: 'text-outline',
  number: 'calculator-outline',
  date: 'calendar-outline',
  select: 'chevron-down-circle-outline',
  multiSelect: 'list-outline',
  relation: 'git-network-outline',
  backlink: 'return-down-back-outline',
  section: 'bookmarks-outline',
};

const TYPE_LABEL = FIELD_TYPE_LABEL;
const TYPE_ICON = FIELD_TYPE_ICON;

// 'backlink' is missing on purpose: it's created by a relation's own
// "показувати з іншого боку" switch, never picked here by hand.
const TYPE_ORDER: FieldType[] = ['text', 'number', 'date', 'select', 'multiSelect', 'relation', 'section'];

function relationTargetLabel(
  target: RelationTarget | undefined,
  otherDatabases: { id: string; name: string }[]
): string {
  if (!target || target.kind === 'photos') return 'Фото';
  return otherDatabases.find((d) => d.id === target.databaseId)?.name ?? 'База';
}

type Props = {
  visible: boolean;
  fields: FieldDef[];
  // Every OTHER custom database (this one excluded) - what a 'relation'
  // field can point at besides the built-in "Фото".
  otherDatabases: { id: string; name: string }[];
  // Whether this relation's reverse side is currently shown in the target
  // database, and the switch for it. Applied straight away rather than
  // waiting for "Зберегти", because it writes to a DIFFERENT database's
  // field list, not to the draft this sheet is editing.
  isBacklinkEnabled: (field: FieldDef) => boolean;
  onToggleBacklink: (field: FieldDef, enabled: boolean) => void;
  onSave: (fields: FieldDef[]) => void;
  onClose: () => void;
};

// Manages one database's field list - add/rename/retype/delete, plus the
// nested option editor for select/multiSelect. Edits a local draft and only
// writes back on "Зберегти" (onSave), same "edit a copy, commit at the end"
// shape as GroupPickerSheet's inline rename, just for a whole list at once
// instead of one row.
export default function FieldsEditorSheet({
  visible,
  fields,
  otherDatabases,
  isBacklinkEnabled,
  onToggleBacklink,
  onSave,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<FieldDef[]>(fields);
  const [typeMenuFieldId, setTypeMenuFieldId] = useState<string | null>(null);
  // Which field's relation-target list ("Фото" vs another database) is
  // currently expanded - same one-at-a-time idea as typeMenuFieldId.
  const [relationMenuFieldId, setRelationMenuFieldId] = useState<string | null>(null);
  // The field whose "..." menu is open. Hiding, adding to the name and
  // deleting live in there rather than as four icons in the row: they're
  // reached once in a while, and as icons they were both too small to hit
  // and too many to read past the field's own name.
  const [fieldMenuId, setFieldMenuId] = useState<string | null>(null);
  const [newOptionText, setNewOptionText] = useState<Record<string, string>>({});
  const scrollRef = useRef<ScrollView>(null);
  // Each field card's own y inside the scroll list, filled in by its
  // onLayout - openTypeMenu scrolls to it so the menu it opens is on screen.
  const fieldOffsetsRef = useRef<Record<string, number>>({});
  // This Android build doesn't resize the window under the keyboard - it
  // arrives as an inset over the content, not a shrink - so the sheet has
  // to track its own height and push up by that much, same as
  // GroupPickerSheet's "Нова група" input.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const { height: windowHeight } = useWindowDimensions();
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => setKeyboardHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    if (visible) setDraft(fields);
  }, [visible, fields]);

  function updateField(id: string, patch: Partial<FieldDef>) {
    setDraft((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  // The type list expands INSIDE the field's own card, so on a field near
  // the bottom of the sheet it opens below the visible area and the tap
  // reads as "nothing happened". Scrolling that card up to the top of the
  // list makes room for the whole menu underneath it, rather than leaving
  // the user to guess that there's something to scroll to.
  function openTypeMenu(fieldId: string) {
    const next = typeMenuFieldId === fieldId ? null : fieldId;
    setTypeMenuFieldId(next);
    setFieldMenuId(null);
    if (!next) return;
    const y = fieldOffsetsRef.current[fieldId];
    if (y === undefined) return;
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true }));
  }

  // Firestore rejects `undefined` field values outright (same convention as
  // everywhere else in this app) - switching a field AWAY from select/
  // multiSelect (or relation) has to drop that type's own keys entirely,
  // not set them to undefined, or the whole "Зберегти" write silently
  // fails.
  function changeType(id: string, type: FieldType) {
    setTypeMenuFieldId(null);
    setRelationMenuFieldId(null);
    setDraft((prev) =>
      prev.map((f) => {
        if (f.id !== id) return f;
        // A type that can't be read as plain text can't be part of a name
        // either - dropped rather than left set and silently ignored.
        if (!canJoinTitle(type) && f.inTitle) {
          const { inTitle: _it, ...withoutTitle } = f;
          f = withoutTitle as FieldDef;
        }
        if (type === 'select' || type === 'multiSelect') {
          const { relationTarget: _rt, isCover: _ic, ...rest } = f;
          return { ...rest, type, options: f.options ?? [] };
        }
        if (type === 'relation') {
          const { options: _options, ...rest } = f;
          return { ...rest, type, relationTarget: f.relationTarget ?? { kind: 'photos' } };
        }
        const { options: _options2, relationTarget: _rt2, isCover: _ic2, ...rest } = f;
        return { ...rest, type };
      })
    );
  }

  function setRelationTarget(id: string, target: RelationTarget) {
    setRelationMenuFieldId(null);
    updateField(id, { relationTarget: target });
  }

  // Only one field per database can be the cover - tapping the already-on
  // one turns it off, tapping another moves it there. Only ever touches
  // the tapped field plus whichever other one currently holds the flag
  // (never every field in the list, most of which never had it).
  function toggleCoverField(id: string) {
    setDraft((prev) =>
      prev.map((f) => {
        if (f.id === id) return { ...f, isCover: !f.isCover };
        if (f.isCover) return { ...f, isCover: false };
        return f;
      })
    );
  }

  // Hiding is a display setting: the field keeps its values and stays
  // editable in the row form - it just stops being drawn in the list,
  // cards and table. fields[0] is never hideable (see the eye below):
  // it's the row's name everywhere.
  // Appends this field to the row's name (see rowTitleOf). Offered only for
  // types whose value is already its display text - an option or relation
  // stores an id, which would read as gibberish in a name.
  function toggleInTitle(id: string) {
    setDraft((prev) => prev.map((f) => (f.id === id ? { ...f, inTitle: !f.inTitle } : f)));
  }

  // Moves a field one place up or down. The title field stays put at the
  // top (it's the row's name everywhere), so nothing can move above it.
  function moveField(id: string, delta: -1 | 1) {
    setDraft((prev) => {
      const index = prev.findIndex((f) => f.id === id);
      const target = index + delta;
      if (index < 1 || target < 1 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  // A relation holding several targets instead of one - a gallery rather
  // than a single pick. Switching it off leaves any array already stored
  // alone; the picker simply starts using the first of them again.
  function toggleMultiple(id: string) {
    setDraft((prev) => prev.map((f) => (f.id === id ? { ...f, multiple: !f.multiple } : f)));
  }

  function toggleHidden(id: string) {
    setDraft((prev) => prev.map((f) => (f.id === id ? { ...f, hidden: !f.hidden } : f)));
  }

  function addField() {
    setDraft((prev) => [...prev, { id: generateId(), name: 'Нове поле', type: 'text' }]);
  }

  function deleteField(id: string) {
    setDraft((prev) => prev.filter((f) => f.id !== id));
  }

  function addOption(fieldId: string) {
    const label = (newOptionText[fieldId] ?? '').trim();
    if (!label) return;
    const field = draft.find((f) => f.id === fieldId);
    const color = TAG_COLORS[(field?.options?.length ?? 0) % TAG_COLORS.length];
    const option: FieldOption = { id: generateId(), label, color };
    updateField(fieldId, { options: [...(field?.options ?? []), option] });
    setNewOptionText((prev) => ({ ...prev, [fieldId]: '' }));
  }

  function removeOption(fieldId: string, optionId: string) {
    const field = draft.find((f) => f.id === fieldId);
    updateField(fieldId, { options: (field?.options ?? []).filter((o) => o.id !== optionId) });
  }

  function save() {
    onSave(draft.map((f) => ({ ...f, name: f.name.trim() || 'Поле' })));
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* RN's Modal is its own native window on Android, outside App.tsx's
          GestureHandlerRootView - the ScrollView above needs a root
          re-declared here or it doesn't scroll at all. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
      {/* Backdrop as a SIBLING behind the sheet, not its parent - as a
          parent it took the RN touch responder for every drag that didn't
          land on a deeper child, which is what kept this list from
          scrolling. A tap outside the sheet still closes it. */}
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        {/* Same keyboard-aware height as the row editor: sheet + keyboard
            must fit the screen, or the top of the list ends up above the
            screen edge with nothing able to scroll it back. */}
        <View
          style={[
            styles.sheet,
            {
              marginBottom: keyboardHeight,
              maxHeight: Math.min(windowHeight * 0.8, windowHeight - keyboardHeight - 48),
            },
          ]}
        >
          {/* The real glass, at last. On Android this blurs what is behind
              it WITHIN ITS OWN WINDOW - and a sheet like this one is its
              own window - so if the screen behind stays sharp, the fix is
              to make these sheets a layer inside the screen instead of a
              window over it. This one is the test of that. */}
          <BlurView
            intensity={60}
            tint="dark"
            blurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <View style={styles.handle} />
          <Text style={styles.title}>Поля</Text>

          {/* Without keyboardShouldPersistTaps, the first tap on anything
              here while the keyboard is open is swallowed just to dismiss
              it - the button itself never fires, which reads as a dead
              control. */}
          <ScrollView ref={scrollRef} style={styles.scroll} keyboardShouldPersistTaps="handled">
            {draft.map((field, index) => (
              <View
                key={field.id}
                style={styles.fieldCard}
                onLayout={(e) => {
                  fieldOffsetsRef.current[field.id] = e.nativeEvent.layout.y;
                }}
              >
                <View style={styles.fieldRow}>
                  <TextInput
                    style={[styles.fieldNameInput, field.hidden && styles.fieldNameHidden]}
                    value={field.name}
                    onChangeText={(text) => updateField(field.id, { name: text })}
                  />
                  <Pressable
                    style={styles.typeBadge}
                    onPress={() => openTypeMenu(field.id)}
                  >
                    <Ionicons name={TYPE_ICON[field.type]} size={14} color={TEXT_MUTED} />
                    <Text style={styles.typeBadgeLabel}>{TYPE_LABEL[field.type]}</Text>
                  </Pressable>
                  {/* Everything below is index > 0: fields[0] is the row's
                      title everywhere else in this database - renameable,
                      but never moved, retyped or deleted, so the app never
                      ends up with zero display name. Reordering is the one
                      control that stays in the row rather than moving into
                      the menu: it's used several times over, and a menu
                      would make every step a two-tap affair. */}
                  {index > 0 && (
                    <View style={styles.moveButtons}>
                      <Pressable
                        style={styles.iconButton}
                        hitSlop={6}
                        disabled={index <= 1}
                        onPress={() => moveField(field.id, -1)}
                      >
                        <Ionicons
                          name="chevron-up"
                          size={20}
                          color={index <= 1 ? TEXT_FAINT : TEXT_MUTED}
                        />
                      </Pressable>
                      <Pressable
                        style={styles.iconButton}
                        hitSlop={6}
                        disabled={index >= draft.length - 1}
                        onPress={() => moveField(field.id, 1)}
                      >
                        <Ionicons
                          name="chevron-down"
                          size={20}
                          color={index >= draft.length - 1 ? TEXT_FAINT : TEXT_MUTED}
                        />
                      </Pressable>
                    </View>
                  )}
                  {index > 0 && (
                    <Pressable
                      style={styles.iconButton}
                      hitSlop={6}
                      onPress={() => {
                        setFieldMenuId(fieldMenuId === field.id ? null : field.id);
                        setTypeMenuFieldId(null);
                      }}
                    >
                      <Ionicons
                        name="ellipsis-horizontal"
                        size={20}
                        color={fieldMenuId === field.id ? ACCENT_ON_GLASS : TEXT_MUTED}
                      />
                    </Pressable>
                  )}
                </View>

                {fieldMenuId === field.id && index > 0 && (
                  <View style={styles.typeMenu}>
                    {field.type !== 'section' && (
                      <Pressable
                        style={styles.typeMenuRow}
                        onPress={() => {
                          toggleHidden(field.id);
                          setFieldMenuId(null);
                        }}
                      >
                        <Ionicons
                          name={field.hidden ? 'eye-off-outline' : 'eye-outline'}
                          size={18}
                          color={field.hidden ? ACCENT_ON_GLASS : TEXT_MUTED}
                        />
                        <Text style={styles.typeMenuLabel}>
                          {field.hidden ? 'Показувати поле' : 'Приховати поле'}
                        </Text>
                      </Pressable>
                    )}
                    {canJoinTitle(field.type) && (
                      <Pressable
                        style={styles.typeMenuRow}
                        onPress={() => {
                          toggleInTitle(field.id);
                          setFieldMenuId(null);
                        }}
                      >
                        <Ionicons
                          name={field.inTitle ? 'pricetag' : 'pricetag-outline'}
                          size={18}
                          color={field.inTitle ? ACCENT_ON_GLASS : TEXT_MUTED}
                        />
                        <Text style={styles.typeMenuLabel}>Додавати до назви</Text>
                        {!!field.inTitle && <Ionicons name="checkmark" size={18} color={ACCENT_ON_GLASS} />}
                      </Pressable>
                    )}
                    <Pressable
                      style={styles.typeMenuRow}
                      onPress={() => {
                        deleteField(field.id);
                        setFieldMenuId(null);
                      }}
                    >
                      <Ionicons name="trash-outline" size={18} color={DANGER} />
                      <Text style={[styles.typeMenuLabel, { color: DANGER }]}>Видалити поле</Text>
                    </Pressable>
                  </View>
                )}

                {!!field.inTitle && canJoinTitle(field.type) && (
                  <Text style={styles.inTitleHint}>Додається до назви запису</Text>
                )}

                {typeMenuFieldId === field.id && index > 0 && (
                  <View style={styles.typeMenu}>
                    {TYPE_ORDER.map((type) => (
                      <Pressable key={type} style={styles.typeMenuRow} onPress={() => changeType(field.id, type)}>
                        <Ionicons name={TYPE_ICON[type]} size={17} color={TEXT_MUTED} />
                        <Text style={styles.typeMenuLabel}>{TYPE_LABEL[type]}</Text>
                        {field.type === type && <Ionicons name="checkmark" size={18} color={ACCENT_ON_GLASS} />}
                      </Pressable>
                    ))}
                  </View>
                )}

                {(field.type === 'select' || field.type === 'multiSelect') && (
                  <View style={styles.optionsBox}>
                    {(field.options ?? []).map((option) => (
                      // On the dark body the option's own colour is
                      // readable as a dot but not as text, so it fills the
                      // chip and the label stays white.
                      <View key={option.id} style={[styles.optionChip, { backgroundColor: `${option.color}55` }]}>
                        <View style={[styles.optionDot, { backgroundColor: option.color }]} />
                        <Text style={styles.optionLabel}>{option.label}</Text>
                        <Pressable style={styles.optionRemove} hitSlop={8} onPress={() => removeOption(field.id, option.id)}>
                          <Ionicons name="close" size={14} color="rgba(255,255,255,0.8)" />
                        </Pressable>
                      </View>
                    ))}
                    <View style={styles.addOptionRow}>
                      <TextInput
                        style={styles.addOptionInput}
                        value={newOptionText[field.id] ?? ''}
                        onChangeText={(text) => setNewOptionText((prev) => ({ ...prev, [field.id]: text }))}
                        placeholder="Новий варіант"
                        placeholderTextColor={TEXT_FAINT}
                        onSubmitEditing={() => addOption(field.id)}
                        returnKeyType="done"
                      />
                      <Pressable hitSlop={8} onPress={() => addOption(field.id)}>
                        <Ionicons name="add-circle" size={26} color={ACCENT_ON_GLASS} />
                      </Pressable>
                    </View>
                  </View>
                )}

                {field.type === 'relation' && (
                  <View style={styles.optionsBox}>
                    <Pressable
                      style={styles.relationTargetRow}
                      onPress={() => setRelationMenuFieldId(relationMenuFieldId === field.id ? null : field.id)}
                    >
                      <Ionicons name="link-outline" size={15} color={TEXT_MUTED} />
                      <Text style={styles.relationTargetLabel}>
                        Ціль: {relationTargetLabel(field.relationTarget, otherDatabases)}
                      </Text>
                      <Ionicons
                        name={relationMenuFieldId === field.id ? 'chevron-up' : 'chevron-down'}
                        size={16}
                        color={TEXT_MUTED}
                      />
                    </Pressable>
                    {relationMenuFieldId === field.id && (
                      <View style={styles.typeMenu}>
                        <Pressable
                          style={styles.typeMenuRow}
                          onPress={() => setRelationTarget(field.id, { kind: 'photos' })}
                        >
                          <Ionicons name="image-outline" size={17} color={TEXT_MUTED} />
                          <Text style={styles.typeMenuLabel}>Фото</Text>
                          {(field.relationTarget?.kind ?? 'photos') === 'photos' && (
                            <Ionicons name="checkmark" size={18} color={ACCENT_ON_GLASS} />
                          )}
                        </Pressable>
                        {otherDatabases.map((odb) => (
                          <Pressable
                            key={odb.id}
                            style={styles.typeMenuRow}
                            onPress={() => setRelationTarget(field.id, { kind: 'customDb', databaseId: odb.id })}
                          >
                            <Ionicons name="grid-outline" size={17} color={TEXT_MUTED} />
                            <Text style={styles.typeMenuLabel} numberOfLines={1}>
                              {odb.name}
                            </Text>
                            {field.relationTarget?.kind === 'customDb' &&
                              field.relationTarget.databaseId === odb.id && (
                                <Ionicons name="checkmark" size={18} color={ACCENT_ON_GLASS} />
                              )}
                          </Pressable>
                        ))}
                        {otherDatabases.length === 0 && (
                          <Text style={styles.relationEmptyHint}>Інших власних баз поки немає.</Text>
                        )}
                      </View>
                    )}
                    <Pressable style={styles.coverToggleRow} onPress={() => toggleMultiple(field.id)}>
                      <Ionicons
                        name={field.multiple ? 'checkbox' : 'square-outline'}
                        size={22}
                        color={field.multiple ? ACCENT_ON_GLASS : TEXT_MUTED}
                      />
                      <Text style={styles.coverToggleLabel}>Кілька значень (галерея)</Text>
                    </Pressable>
                    <Pressable style={styles.coverToggleRow} onPress={() => toggleCoverField(field.id)}>
                      <Ionicons
                        name={field.isCover ? 'checkbox' : 'square-outline'}
                        size={22}
                        color={field.isCover ? ACCENT_ON_GLASS : TEXT_MUTED}
                      />
                      <Text style={styles.coverToggleLabel}>Використовувати як заставку</Text>
                    </Pressable>
                    {/* Only for a field that's already saved: the reverse
                        side has to name a real field id, and a field
                        added in this draft doesn't have one on record yet
                        (cancelling would leave the other database pointing
                        at something that never existed). */}
                    {field.relationTarget?.kind === 'customDb' &&
                      fields.some((f) => f.id === field.id) && (
                        <Pressable
                          style={styles.coverToggleRow}
                          onPress={() => onToggleBacklink(field, !isBacklinkEnabled(field))}
                        >
                          <Ionicons
                            name={isBacklinkEnabled(field) ? 'checkbox' : 'square-outline'}
                            size={22}
                            color={isBacklinkEnabled(field) ? ACCENT_ON_GLASS : TEXT_MUTED}
                          />
                          <Text style={styles.coverToggleLabel}>Показувати з іншого боку</Text>
                        </Pressable>
                      )}
                  </View>
                )}
              </View>
            ))}

            <Pressable style={styles.addFieldRow} onPress={addField}>
              <Ionicons name="add" size={20} color={ACCENT_ON_GLASS} />
              <Text style={styles.addFieldLabel}>Додати поле</Text>
            </Pressable>
          </ScrollView>

          <View style={styles.buttons}>
            <Pressable style={styles.cancelButton} onPress={onClose}>
              <Text style={styles.cancelLabel}>Скасувати</Text>
            </Pressable>
            <Pressable style={styles.saveButton} onPress={save}>
              <Text style={styles.saveLabel}>Зберегти</Text>
            </Pressable>
          </View>
        </View>
      </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: GLASS_BACKDROP,
    justifyContent: 'flex-end',
  },
  sheet: {
    // Lower than the shared GLASS_BODY on purpose: behind this one there
    // is a real blur, and at 0.96 it would hide it completely.
    backgroundColor: 'rgba(24,21,19,0.55)',
    overflow: 'hidden',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: GLASS_EDGE,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 28,
    maxHeight: '80%',
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 14,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: TEXT,
    marginBottom: 12,
  },
  scroll: {
    // See the sheet's own maxHeight - this takes what's left of it rather
    // than a fixed height the keyboard can push off-screen.
    flexShrink: 1,
  },
  fieldCard: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fieldNameHidden: {
    color: TEXT_FAINT,
    textDecorationLine: 'line-through',
  },
  fieldNameInput: {
    flex: 1,
    fontSize: 16,
    color: TEXT,
    paddingVertical: 6,
  },
  // Every icon control in this sheet is this big whatever the glyph inside
  // it: 36 is the smallest square a thumb hits without aiming, and the
  // icons here used to be 16px with nothing but hitSlop around them.
  iconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    // The same glass pill as the capsules on the database screen behind
    // this sheet - same fill, same hairline, same radius.
    backgroundColor: 'rgba(20,20,20,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  typeBadgeLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.85)',
  },
  typeMenu: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.14)',
    paddingTop: 4,
  },
  typeMenuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
  },
  typeMenuLabel: {
    flex: 1,
    fontSize: 15,
    color: TEXT,
  },
  moveButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inTitleHint: {
    fontSize: 12,
    color: ACCENT_ON_GLASS,
    marginTop: 4,
  },
  optionsBox: {
    marginTop: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
  optionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 11,
  },
  optionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  optionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: TEXT,
  },
  optionRemove: {
    paddingLeft: 2,
  },
  addOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    marginTop: 4,
  },
  addOptionInput: {
    flex: 1,
    fontSize: 14,
    color: TEXT,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  relationTargetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    paddingVertical: 6,
  },
  relationTargetLabel: {
    flex: 1,
    fontSize: 14,
    color: TEXT,
  },
  relationEmptyHint: {
    fontSize: 13,
    color: TEXT_MUTED,
    paddingVertical: 6,
  },
  coverToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    marginTop: 6,
    paddingTop: 6,
    paddingBottom: 4,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.14)',
  },
  coverToggleLabel: {
    fontSize: 14,
    color: TEXT,
  },
  addFieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  addFieldLabel: {
    fontSize: 15,
    color: ACCENT_ON_GLASS,
    fontWeight: '600',
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 10,
  },
  cancelButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    backgroundColor: 'rgba(20,20,20,0.35)',
    paddingVertical: 11,
    paddingHorizontal: 20,
  },
  cancelLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.85)',
  },
  saveButton: {
    backgroundColor: ACCENT,
    borderRadius: 999,
    paddingVertical: 11,
    paddingHorizontal: 24,
  },
  saveLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
});
