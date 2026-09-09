import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FieldDef, FieldOption, FieldType } from '../types';
import { TAG_COLORS } from '../constants/tags';

const ACCENT = '#3B82F6';
const DANGER = '#EF4444';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const TYPE_LABEL: Record<FieldType, string> = {
  text: 'Текст',
  number: 'Число',
  date: 'Дата',
  select: 'Список',
  multiSelect: 'Множинний список',
};

const TYPE_ICON: Record<FieldType, keyof typeof Ionicons.glyphMap> = {
  text: 'text-outline',
  number: 'calculator-outline',
  date: 'calendar-outline',
  select: 'chevron-down-circle-outline',
  multiSelect: 'list-outline',
};

const TYPE_ORDER: FieldType[] = ['text', 'number', 'date', 'select', 'multiSelect'];

type Props = {
  visible: boolean;
  fields: FieldDef[];
  onSave: (fields: FieldDef[]) => void;
  onClose: () => void;
};

// Manages one database's field list - add/rename/retype/delete, plus the
// nested option editor for select/multiSelect. Edits a local draft and only
// writes back on "Зберегти" (onSave), same "edit a copy, commit at the end"
// shape as GroupPickerSheet's inline rename, just for a whole list at once
// instead of one row.
export default function FieldsEditorSheet({ visible, fields, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<FieldDef[]>(fields);
  const [typeMenuFieldId, setTypeMenuFieldId] = useState<string | null>(null);
  const [newOptionText, setNewOptionText] = useState<Record<string, string>>({});

  useEffect(() => {
    if (visible) setDraft(fields);
  }, [visible, fields]);

  function updateField(id: string, patch: Partial<FieldDef>) {
    setDraft((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  function changeType(id: string, type: FieldType) {
    setTypeMenuFieldId(null);
    updateField(id, {
      type,
      options: type === 'select' || type === 'multiSelect' ? [] : undefined,
    });
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
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.title}>Поля</Text>

          <ScrollView style={styles.scroll}>
            {draft.map((field, index) => (
              <View key={field.id} style={styles.fieldCard}>
                <View style={styles.fieldRow}>
                  <TextInput
                    style={styles.fieldNameInput}
                    value={field.name}
                    onChangeText={(text) => updateField(field.id, { name: text })}
                  />
                  <Pressable
                    style={styles.typeBadge}
                    onPress={() => setTypeMenuFieldId(typeMenuFieldId === field.id ? null : field.id)}
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
