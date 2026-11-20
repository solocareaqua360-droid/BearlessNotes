import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import TextInput from './AppTextInput';
import { Ionicons } from './icons/Ionicons';
import GlassLayer from './GlassLayer';
import { RelationThumb } from './CustomRowCard';
import { useSoft } from '../theme/soft';
import { SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';
import { SHEET_BACKDROP, SHEET_WINDOW } from '../constants/glass';
import type { CustomDatabase, CustomDatabaseRow, DateRangeValue, FieldDef } from '../types';
import { displayFieldValue, resolveRelationList, rowTitleOf, type RowDisplayContext } from '../utils/customRowDisplay';
import { pickPhotosFromDevice, writePhotoRecord } from '../utils/photoLibrary';
import type { FlipFrom } from '../utils/flipOpen';

type Value = string | number | string[] | DateRangeValue;

// A RECORD OVER THE NOTE (the user, 2026-10-25: «по запису відкривав картку поверх документу»): a row of a note's
// table turns over into this card. It opens for LOOKING (feedback: a card opens for looking, edits after «Редагувати»).
// 2026-11-04 (the user: «чому ми не можемо редагувати саме цю форму?»): «Редагувати» turns THIS card into its own editor -
// the same rows become fields, «Готово» puts it back - instead of opening a second window with the same fields. Every
// change is written at once (the card has no «Зберегти»). Date and picture fields are edited here too; a relation to
// something other than pictures is changed in its base («Відкрити в базі»).
export default function DbRecordCard({
  database,
  row,
  context,
  flipFrom,
  onClose,
  onOpenInBase,
  onWrite,
}: {
  database: CustomDatabase | null;
  row: CustomDatabaseRow | null;
  context: RowDisplayContext;
  flipFrom: FlipFrom | null;
  onClose: () => void;
  onOpenInBase: (rowId: string) => void;
  onWrite: (rowId: string, fieldId: string, value: Value) => void | Promise<void>;
}) {
  const S = useSoft();
  const [editing, setEditing] = useState(false);
  const [dateField, setDateField] = useState<FieldDef | null>(null);
  // Every field, hidden ones too - hiding is the list's, the record page shows them all; a section is a heading, no value.
  const fields = (database?.fields ?? []).slice(1).filter((f) => f.type !== 'section');
  const title = database && row ? rowTitleOf(database, row) : '';
  useEffect(() => {
    // A card closed or another record opened: back to looking.
    setEditing(false);
    setDateField(null);
  }, [row?.id]);

  const write = (field: FieldDef, value: Value) => {
    if (!row) return;
    void onWrite(row.id, field.id, value);
  };
  // The calendar lives in the base's screen; taken only when a date is first edited (a require at call time keeps the note
  // from loading that big screen, and avoids an import cycle).
  const MiniDatePicker = dateField
    ? (require('../screens/CustomDatabaseScreen') as { MiniDatePicker: React.ComponentType<Record<string, unknown>> }).MiniDatePicker
    : null;

  // LOOKING: the value as text - and pictures as pictures, not as a count.
  const looking = (field: FieldDef, text: string) => {
    if (row && field.type === 'relation' && (!field.relationTarget || field.relationTarget.kind === 'photos')) {
      const shown = resolveRelationList(field, row.values[field.id], context).filter((r) => !!r.thumbUri);
      if (shown.length > 0) {
        return (
          <View style={styles.tiles}>
            {shown.map((r, i) => (
              <View key={i} style={styles.tile}>
                <RelationThumb uri={r.thumbUri!} driveFileId={r.driveFileId} size={64} radius={10} />
              </View>
            ))}
          </View>
        );
      }
    }
    return <Text style={[styles.value, { color: text ? S.ink : S.ink3 }]}>{text || '—'}</Text>;
  };

  const input = (field: FieldDef) => {
    if (!row) return null;
    const value = row.values[field.id];
    if (field.type === 'text' || field.type === 'number') {
      return <FieldText key={`${row.id}:${field.id}`} field={field} value={value} onCommit={(v) => write(field, v)} />;
    }
    if (field.type === 'select' || field.type === 'multiSelect') {
      const chosen = Array.isArray(value) ? value : value ? [String(value)] : [];
      return (
        <View style={styles.chips}>
          {(field.options ?? []).map((o) => {
            const on = chosen.includes(o.id);
            return (
              <Pressable
                key={o.id}
                onPress={() => {
                  if (field.type === 'multiSelect') write(field, on ? chosen.filter((x) => x !== o.id) : [...chosen, o.id]);
                  else write(field, on ? '' : o.id);
                }}
                style={[styles.chip, { backgroundColor: on ? S.ink : S.fill }]}
              >
                <Text style={[styles.chipText, { color: on ? S.card : S.ink }]}>{o.label}</Text>
              </Pressable>
            );
          })}
        </View>
      );
    }
    if (field.type === 'date') {
      const shown = displayFieldValue(field, value, context);
      return (
        <Pressable onPress={() => setDateField(field)} style={[styles.pick, { backgroundColor: S.fill }]}>
          <Text style={[styles.value, { color: shown ? S.ink : S.ink3 }]}>{shown || 'Обрати дату'}</Text>
          <Ionicons name="calendar-outline" size={18} color={S.ink2} />
        </Pressable>
      );
    }
    if (field.type === 'relation' && (!field.relationTarget || field.relationTarget.kind === 'photos')) {
      const ids = Array.isArray(value) ? value : value ? [String(value)] : [];
      const list = resolveRelationList(field, value, context);
      return (
        <View style={styles.tiles}>
          {list.map((r, i) =>
            r.thumbUri ? (
              <View key={`${ids[i] ?? i}`} style={styles.tile}>
                <RelationThumb uri={r.thumbUri} driveFileId={r.driveFileId} size={64} radius={10} />
                <Pressable hitSlop={6} onPress={() => write(field, field.multiple ? ids.filter((x) => x !== ids[i]) : '')} style={styles.tileX}>
                  <Ionicons name="close" size={13} color="#FFFFFF" />
                </Pressable>
              </View>
            ) : null
          )}
          {(field.multiple || ids.length === 0) && (
            <Pressable
              onPress={async () => {
                const got = await pickPhotosFromDevice('gallery', { record: false });
                if (got.length === 0) return;
                for (const p of got) await writePhotoRecord(p.imageUri, { id: p.id });
                write(field, field.multiple ? [...ids, ...got.map((p) => p.id)] : got[0].id);
              }}
              style={[styles.tile, styles.tileAdd, { borderColor: S.ink3 }]}
              accessibilityLabel="Додати зі стрічки"
            >
              <Ionicons name="images-outline" size={22} color={S.ink2} />
            </Pressable>
          )}
        </View>
      );
    }
    // Other relations / backlinks: read here, changed in the base.
    const shown = displayFieldValue(field, value, context);
    return <Text style={[styles.value, { color: shown ? S.ink : S.ink3 }]}>{shown || '—'}</Text>;
  };

  return (
    <GlassLayer visible={!!row} onClose={onClose} flipFrom={flipFrom}>
      <View style={SHEET_BACKDROP} pointerEvents="box-none">
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[SHEET_WINDOW, styles.card, { borderWidth: 0 }, { backgroundColor: S.card, boxShadow: S.popShadow } as never]}>
          <View style={styles.head}>
            <Pressable hitSlop={10} onPress={onClose} accessibilityLabel="Закрити">
              <Ionicons name="close" size={24} color={S.ink} />
            </Pressable>
            <Text style={[styles.headTitle, { color: S.ink2 }]} numberOfLines={1}>
              {database?.name ?? ''}
            </Text>
            {row && (
              <Pressable onPress={() => setEditing((e) => !e)} style={[styles.edit, { backgroundColor: S.ink }]}>
                <Ionicons name={editing ? 'checkmark' : 'create-outline'} size={17} color={S.card} />
                <Text style={[styles.editText, { color: S.card }]}>{editing ? 'Готово' : 'Редагувати'}</Text>
              </Pressable>
            )}
          </View>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {editing && row && database?.fields[0] ? (
              <FieldText
                key={`${row.id}:title`}
                field={database.fields[0]}
                value={row.values[database.fields[0].id]}
                big
                onCommit={(v) => write(database.fields[0], v)}
              />
            ) : (
              <Text style={[styles.title, { color: S.ink }]}>{title}</Text>
            )}
            {row &&
              fields.map((f) => {
                const value = displayFieldValue(f, row.values[f.id], context);
                return (
                  <View key={f.id} style={[styles.field, { borderBottomColor: S.line }]}>
                    <Text style={[styles.label, { color: S.ink3 }]}>{f.name}</Text>
                    {editing ? input(f) : looking(f, value)}
                  </View>
                );
              })}
            {row && (
              <Pressable onPress={() => onOpenInBase(row.id)} style={styles.inBase}>
                <Ionicons name="open-outline" size={16} color={S.ink2} />
                <Text style={[styles.inBaseText, { color: S.ink2 }]}>Відкрити в базі</Text>
              </Pressable>
            )}
          </ScrollView>
        </View>
      </View>
      {MiniDatePicker && dateField && row && (
        <MiniDatePicker
          value={row.values[dateField.id]}
          onPick={(picked: DateRangeValue) => {
            write(dateField, picked);
            setDateField(null);
          }}
          onClear={() => {
            write(dateField, '');
            setDateField(null);
          }}
          onClose={() => setDateField(null)}
        />
      )}
    </GlassLayer>
  );
}

// A text or number field: typed freely, written when the finger leaves it (a write per letter would bump the record's
// «changed» time and the table's order under the user's hand).
function FieldText({ field, value, big, onCommit }: { field: FieldDef; value: Value | undefined; big?: boolean; onCommit: (v: string | number) => void }) {
  const S = useSoft();
  const [text, setText] = useState(value === undefined || value === null ? '' : String(value));
  return (
    <TextInput
      multiline={field.type === 'text'}
      value={text}
      onChangeText={setText}
      onBlur={() => {
        const next: string | number = field.type === 'number' ? (text.trim() === '' ? '' : Number(text.replace(',', '.')) || 0) : text;
        if (String(value ?? '') !== String(next)) onCommit(next);
      }}
      keyboardType={field.type === 'number' ? 'numeric' : undefined}
      placeholder={field.name}
      placeholderTextColor={S.ink3}
      style={[styles.input, big && styles.inputBig, { backgroundColor: S.fill, color: S.ink }]}
    />
  );
}

const styles = StyleSheet.create({
  card: { maxHeight: '85%', overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 10 },
  headTitle: { flex: 1, fontSize: 15, fontFamily: SOFT_MEDIUM },
  edit: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 14, borderRadius: 19 },
  editText: { fontSize: 14.5, fontFamily: SOFT_SEMIBOLD },
  body: { paddingHorizontal: 22, paddingBottom: 24 },
  title: { fontSize: 24, fontFamily: SOFT_SEMIBOLD, marginBottom: 10 },
  field: { paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, gap: 6 },
  label: { fontSize: 13, fontFamily: SOFT_REGULAR },
  value: { fontSize: 16, fontFamily: SOFT_REGULAR },
  input: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16, fontFamily: SOFT_REGULAR, textAlignVertical: 'top' },
  inputBig: { fontSize: 22, fontFamily: SOFT_SEMIBOLD, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { height: 38, paddingHorizontal: 14, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 14, fontFamily: SOFT_MEDIUM },
  pick: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 14, paddingHorizontal: 14, minHeight: 44 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: 64, height: 64, borderRadius: 10, overflow: 'hidden' },
  tileX: { position: 'absolute', top: 3, right: 3, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(30,30,28,0.7)', alignItems: 'center', justifyContent: 'center' },
  tileAdd: { borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  inBase: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18, alignSelf: 'flex-start', minHeight: 40 },
  inBaseText: { fontSize: 14.5, fontFamily: SOFT_MEDIUM },
});
