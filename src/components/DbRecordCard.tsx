import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from './icons/Ionicons';
import GlassLayer from './GlassLayer';
import { useSoft } from '../theme/soft';
import { SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';
import { SHEET_BACKDROP, SHEET_WINDOW } from '../constants/glass';
import type { CustomDatabase, CustomDatabaseRow } from '../types';
import { displayFieldValue, rowTitleOf, visibleFieldsOf, type RowDisplayContext } from '../utils/customRowDisplay';
import type { FlipFrom } from '../utils/flipOpen';

// A RECORD OVER THE NOTE (the user, 2026-10-25: «по запису відкривав картку поверх документу»): a row of a note's
// table turns over into this card, read-only - looking is what a tap is for (feedback: a card opens for looking, edits
// after «Редагувати»), and «Редагувати» takes the record to its base, where every field is edited.
export default function DbRecordCard({
  database,
  row,
  context,
  flipFrom,
  onClose,
  onEdit,
}: {
  database: CustomDatabase | null;
  row: CustomDatabaseRow | null;
  context: RowDisplayContext;
  flipFrom: FlipFrom | null;
  onClose: () => void;
  onEdit: (rowId: string) => void;
}) {
  const S = useSoft();
  const fields = visibleFieldsOf(database).slice(1);
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
              <Pressable onPress={() => onEdit(row.id)} style={[styles.edit, { backgroundColor: S.ink }]}>
                <Ionicons name="create-outline" size={17} color={S.card} />
                <Text style={[styles.editText, { color: S.card }]}>Редагувати</Text>
              </Pressable>
            )}
          </View>
          <ScrollView contentContainerStyle={styles.body}>
            <Text style={[styles.title, { color: S.ink }]}>{row ? rowTitleOf(database, row) : ''}</Text>
            {row &&
              fields.map((f) => {
                const value = displayFieldValue(f, row.values[f.id], context);
                return (
                  <View key={f.id} style={[styles.field, { borderBottomColor: S.line }]}>
                    <Text style={[styles.label, { color: S.ink3 }]}>{f.name}</Text>
                    <Text style={[styles.value, { color: value ? S.ink : S.ink3 }]}>{value || '—'}</Text>
                  </View>
                );
              })}
          </ScrollView>
        </View>
      </View>
    </GlassLayer>
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
  field: { paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, gap: 3 },
  label: { fontSize: 13, fontFamily: SOFT_REGULAR },
  value: { fontSize: 16, fontFamily: SOFT_REGULAR },
});
