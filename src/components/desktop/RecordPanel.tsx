import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '../icons/Ionicons';
import { RADIUS, TYPE, useDeskColors } from '../../theme/desktopTheme';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../../utils/fonts';
import { useStyles } from '../../theme/ThemeProvider';
import type { Theme } from '../../theme/tokens';
import type { CustomDatabase, CustomDatabaseRow, FieldDef } from '../../types';
import { coverFieldOf, displayFieldValue, resolveRelationList, rowTitleOf, visibleFieldsOf, type RowDisplayContext } from '../../utils/customRowDisplay';

// THE CHOSEN RECORD, in the Mac's right panel (frame B, 2026-10-19, the sketch's «клацни поїздку в графіку - її поля
// тут, без переходу»): a base's row pressed shows its fields here, read-only, instead of turning into a page over the
// whole window. Editing and the full page are a step from here - the same two steps the phone's page offers.
export default function RecordPanel({
  database,
  row,
  context,
  onEdit,
  onOpenPage,
  onClose,
}: {
  database: CustomDatabase;
  row: CustomDatabaseRow;
  context: RowDisplayContext;
  onEdit: () => void;
  onOpenPage: () => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const D = useDeskColors();
  const cover = coverFieldOf(database);
  const picture = cover ? resolveRelationList(cover, row.values[cover.id], context)[0]?.thumbUri : undefined;
  // Every field the base shows, in its order; a section is a small heading over what follows, and an empty field is
  // left out (the panel says what the record IS, not what it could hold).
  const fields = visibleFieldsOf(database).filter((f) => f.id !== cover?.id);
  type Item = { kind: 'section'; field: FieldDef } | { kind: 'value'; field: FieldDef; shown: string };
  const items: Item[] = [];
  for (const field of fields) {
    if ((field.type as string) === 'section') {
      items.push({ kind: 'section', field });
      continue;
    }
    const shown = displayFieldValue(field, row.values[field.id], context);
    if (shown) items.push({ kind: 'value', field, shown });
  }
  // A section with nothing filled under it says nothing.
  const kept = items.filter((it, i) => it.kind === 'value' || items.slice(i + 1).find((n) => n.kind === 'section' || n.kind === 'value')?.kind === 'value');

  const action = (label: string, icon: string, onPress: () => void, dark?: boolean) => (
    <Pressable
      key={label}
      onPress={onPress}
      style={(state) => [styles.action, { backgroundColor: dark ? D.ink : D.fill }, (state as { hovered?: boolean }).hovered && !dark && { backgroundColor: D.line }]}
    >
      <Ionicons name={icon as never} size={14} color={dark ? D.card : D.ink} />
      <Text style={[styles.actionLabel, { color: dark ? D.card : D.ink }]}>{label}</Text>
    </Pressable>
  );

  return (
    <ScrollView style={styles.host} contentContainerStyle={styles.content}>
      <View style={styles.headRow}>
        <Text style={[styles.head, { color: D.ink }]} numberOfLines={2}>
          {rowTitleOf(database, row)}
        </Text>
        <Pressable hitSlop={8} onPress={onClose} accessibilityLabel="Закрити запис">
          <Ionicons name="close" size={18} color={D.ink3} />
        </Pressable>
      </View>
      {!!picture && <Image source={{ uri: picture }} style={[styles.cover, { backgroundColor: D.fill }]} resizeMode="cover" />}
      <View style={[styles.card, { backgroundColor: D.card, borderColor: D.line }]}>
        {kept.length === 0 && <Text style={[styles.empty, { color: D.ink3 }]}>Поля ще порожні</Text>}
        {kept.map((it) =>
          it.kind === 'section' ? (
            <Text key={it.field.id} style={[styles.section, { color: D.ink3 }]}>
              {it.field.name}
            </Text>
          ) : (
            <View key={it.field.id} style={styles.fact}>
              <Text style={[styles.factLabel, { color: D.ink3 }]}>{it.field.name}</Text>
              <Text style={[styles.factValue, { color: D.ink }]}>{it.shown}</Text>
            </View>
          )
        )}
      </View>
      <View style={styles.actions}>
        {action('Редагувати', 'create-outline', onEdit, true)}
        {action('Сторінка', 'reader-outline', onOpenPage)}
      </View>
    </ScrollView>
  );
}

const makeStyles = (_t: Theme) =>
  StyleSheet.create({
    host: { flex: 1 },
    content: { paddingHorizontal: 16, paddingBottom: 24, gap: 12 },
    headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 4 },
    head: { flex: 1, fontSize: TYPE.md, fontFamily: FONT_SEMIBOLD },
    cover: { width: '100%', aspectRatio: 16 / 10, borderRadius: RADIUS.panel },
    card: { borderRadius: RADIUS.panel, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 6 },
    section: { fontSize: TYPE.xs, fontFamily: FONT_SEMIBOLD, textTransform: 'uppercase', letterSpacing: 0.4, paddingTop: 12, paddingBottom: 2 },
    fact: { paddingVertical: 7, gap: 1 },
    factLabel: { fontSize: TYPE.xs, fontFamily: FONT_REGULAR },
    factValue: { fontSize: TYPE.sm, fontFamily: FONT_SEMIBOLD },
    empty: { fontSize: TYPE.sm, fontFamily: FONT_REGULAR, paddingVertical: 8 },
    actions: { flexDirection: 'row', gap: 6 },
    action: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 30, borderRadius: RADIUS.control },
    actionLabel: { fontSize: TYPE.sm, fontFamily: FONT_SEMIBOLD },
  });
