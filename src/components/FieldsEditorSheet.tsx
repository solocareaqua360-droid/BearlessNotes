import { useEffect, useRef, useState } from 'react';
import { Keyboard, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
// gesture-handler's ScrollView, not the core RN one: a drag that starts on
// a field's name input (every row here has one) never reaches an RN
// ScrollView's scroll recognition on Android, so this list only scrolled
// when a finger happened to land between two cards. Same fix and same
// reason as DocumentEditorScreen's block list.
import { GestureHandlerRootView, ScrollView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { FieldDef, FieldOption, FieldType, RelationTarget } from '../types';
import { TAG_COLORS } from '../constants/tags';

const ACCENT = '#3B82F6';
const DANGER = '#EF4444';

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
};

const TYPE_LABEL = FIELD_TYPE_LABEL;
const TYPE_ICON = FIELD_TYPE_ICON;

const TYPE_ORDER: FieldType[] = ['text', 'number', 'date', 'select', 'multiSelect', 'relation'];

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
  onSave: (fields: FieldDef[]) => void;
  onClose: () => void;
};

// Manages one database's field list - add/rename/retype/delete, plus the
// nested option editor for select/multiSelect. Edits a local draft and only
// writes back on "Зберегти" (onSave), same "edit a copy, commit at the end"
// shape as GroupPickerSheet's inline rename, just for a whole list at once
// instead of one row.
export default function FieldsEditorSheet({ visible, fields, otherDatabases, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<FieldDef[]>(fields);
  const [typeMenuFieldId, setTypeMenuFieldId] = useState<string | null>(null);
  // Which field's relation-target list ("Фото" vs another database) is
  // currently expanded - same one-at-a-time idea as typeMenuFieldId.
  const [relationMenuFieldId, setRelationMenuFieldId] = useState<string | null>(null);
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
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { marginBottom: keyboardHeight }]} onPress={() => {}}>
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
                    style={styles.fieldNameInput}
                    value={field.name}
                    onChangeText={(text) => updateField(field.id, { name: text })}
                  />
                  <Pressable
                    style={styles.typeBadge}
                    onPress={() => openTypeMenu(field.id)}
                  >
                    <Ionicons name={TYPE_ICON[field.type]} size={14} color="#6B7280" />
                    <Text style={styles.typeBadgeLabel}>{TYPE_LABEL[field.type]}</Text>
                  </Pressable>
                  {/* fields[0] is the row's title everywhere else in this
                      database - renameable but never deletable or retyped,
                      so the app never ends up with zero display name. */}
                  {index > 0 && (
                    <Pressable hitSlop={8} onPress={() => deleteField(field.id)}>
                      <Ionicons name="trash-outline" size={16} color={DANGER} />
                    </Pressable>
                  )}
                </View>

                {typeMenuFieldId === field.id && index > 0 && (
                  <View style={styles.typeMenu}>
                    {TYPE_ORDER.map((type) => (
                      <Pressable key={type} style={styles.typeMenuRow} onPress={() => changeType(field.id, type)}>
                        <Ionicons name={TYPE_ICON[type]} size={15} color="#111827" />
                        <Text style={styles.typeMenuLabel}>{TYPE_LABEL[type]}</Text>
                        {field.type === type && <Ionicons name="checkmark" size={16} color={ACCENT} />}
                      </Pressable>
                    ))}
                  </View>
                )}

                {(field.type === 'select' || field.type === 'multiSelect') && (
                  <View style={styles.optionsBox}>
                    {(field.options ?? []).map((option) => (
                      <View key={option.id} style={[styles.optionChip, { backgroundColor: `${option.color}22` }]}>
                        <View style={[styles.optionDot, { backgroundColor: option.color }]} />
                        <Text style={[styles.optionLabel, { color: option.color }]}>{option.label}</Text>
                        <Pressable hitSlop={6} onPress={() => removeOption(field.id, option.id)}>
                          <Ionicons name="close" size={12} color={option.color} />
                        </Pressable>
                      </View>
                    ))}
                    <View style={styles.addOptionRow}>
                      <TextInput
                        style={styles.addOptionInput}
                        value={newOptionText[field.id] ?? ''}
                        onChangeText={(text) => setNewOptionText((prev) => ({ ...prev, [field.id]: text }))}
                        placeholder="Новий варіант"
                        onSubmitEditing={() => addOption(field.id)}
                        returnKeyType="done"
                      />
                      <Pressable hitSlop={8} onPress={() => addOption(field.id)}>
                        <Ionicons name="add-circle" size={22} color={ACCENT} />
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
                      <Ionicons name="link-outline" size={13} color="#6B7280" />
                      <Text style={styles.relationTargetLabel}>
                        Ціль: {relationTargetLabel(field.relationTarget, otherDatabases)}
                      </Text>
                      <Ionicons
                        name={relationMenuFieldId === field.id ? 'chevron-up' : 'chevron-down'}
                        size={14}
                        color="#9CA3AF"
                      />
                    </Pressable>
                    {relationMenuFieldId === field.id && (
                      <View style={styles.typeMenu}>
                        <Pressable
                          style={styles.typeMenuRow}
                          onPress={() => setRelationTarget(field.id, { kind: 'photos' })}
                        >
                          <Ionicons name="image-outline" size={15} color="#111827" />
                          <Text style={styles.typeMenuLabel}>Фото</Text>
                          {(field.relationTarget?.kind ?? 'photos') === 'photos' && (
                            <Ionicons name="checkmark" size={16} color={ACCENT} />
                          )}
                        </Pressable>
                        {otherDatabases.map((odb) => (
                          <Pressable
                            key={odb.id}
                            style={styles.typeMenuRow}
                            onPress={() => setRelationTarget(field.id, { kind: 'customDb', databaseId: odb.id })}
                          >
                            <Ionicons name="grid-outline" size={15} color="#111827" />
                            <Text style={styles.typeMenuLabel} numberOfLines={1}>
                              {odb.name}
                            </Text>
                            {field.relationTarget?.kind === 'customDb' &&
                              field.relationTarget.databaseId === odb.id && (
                                <Ionicons name="checkmark" size={16} color={ACCENT} />
                              )}
                          </Pressable>
                        ))}
                        {otherDatabases.length === 0 && (
                          <Text style={styles.relationEmptyHint}>Інших власних баз поки немає.</Text>
                        )}
                      </View>
                    )}
                    <Pressable style={styles.coverToggleRow} onPress={() => toggleCoverField(field.id)}>
                      <Ionicons
                        name={field.isCover ? 'checkbox' : 'square-outline'}
                        size={18}
                        color={field.isCover ? ACCENT : '#9CA3AF'}
                      />
                      <Text style={styles.coverToggleLabel}>Використовувати як заставку</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            ))}

            <Pressable style={styles.addFieldRow} onPress={addField}>
              <Ionicons name="add" size={18} color={ACCENT} />
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
        </Pressable>
      </Pressable>
      </GestureHandlerRootView>
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
    marginBottom: 8,
  },
  scroll: {
    maxHeight: 420,
  },
  fieldCard: {
    borderWidth: 1,
    borderColor: '#F3F4F6',
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  fieldNameInput: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    paddingVertical: 4,
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  typeBadgeLabel: {
    fontSize: 12,
    color: '#6B7280',
  },
  typeMenu: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingTop: 6,
  },
  typeMenuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  typeMenuLabel: {
    flex: 1,
    fontSize: 14,
    color: '#111827',
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
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  optionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  optionLabel: {
    fontSize: 12,
    fontWeight: '600',
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
    fontSize: 13,
    color: '#111827',
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  relationTargetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    width: '100%',
  },
  relationTargetLabel: {
    flex: 1,
    fontSize: 13,
    color: '#111827',
  },
  relationEmptyHint: {
    fontSize: 12,
    color: '#9CA3AF',
    paddingVertical: 6,
  },
  coverToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  coverToggleLabel: {
    fontSize: 13,
    color: '#111827',
  },
  addFieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  addFieldLabel: {
    fontSize: 14,
    color: ACCENT,
    fontWeight: '600',
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 8,
  },
  cancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  cancelLabel: {
    fontSize: 15,
    color: '#6B7280',
  },
  saveButton: {
    backgroundColor: ACCENT,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  saveLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
});
