import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SortField, SortPref } from '../utils/sortItems';
import { FONT_BOLD, FONT_REGULAR } from '../utils/fonts';
import { GLASS_TEXT, GLASS_TEXT_FAINT } from '../constants/glass';

// Exported for the rail's sort button, which offers the same three in a
// «Меню» of its own rather than as a section of the "..." menu.
export const FIELD_ORDER: SortField[] = ['title', 'createdAt', 'updatedAt'];
export const FIELD_LABELS: Record<SortField, string> = {
  title: 'За алфавітом',
  createdAt: 'Дата створення',
  updatedAt: 'Дата зміни',
};
export const FIELD_ICONS: Record<SortField, keyof typeof Ionicons.glyphMap> = {
  title: 'text-outline',
  createdAt: 'add-circle-outline',
  updatedAt: 'create-outline',
};

// The "Сортування" section dropped into every database screen's "..." menu
// (Documents/Files/Photos/Links/Tasks) - each screen owns its own menu's
// chrome (backdrop/panel/positioning differ per header style), this is just
// the three field rows shared between them so the sort UI/logic isn't
// rewritten five times.
export default function SortMenuRows({
  sortPref,
  onSelectField,
  accentColor,
}: {
  sortPref: SortPref;
  onSelectField: (field: SortField) => void;
  accentColor: string;
}) {
  return (
    <>
      <Text style={styles.sectionLabel}>Сортування</Text>
      {FIELD_ORDER.map((field) => {
        const active = sortPref.field === field;
        return (
          <Pressable key={field} style={styles.row} onPress={() => onSelectField(field)}>
            <Ionicons name={FIELD_ICONS[field]} size={17} color={active ? accentColor : GLASS_TEXT} />
            <Text style={[styles.rowLabel, active && { color: accentColor, fontFamily: FONT_BOLD }]}>
              {FIELD_LABELS[field]}
            </Text>
            {active && <Ionicons name={sortPref.dir === 'asc' ? 'arrow-up-outline' : 'arrow-down-outline'} size={16} color={accentColor} />}
          </Pressable>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    letterSpacing: 0.04,
    textTransform: 'uppercase',
    color: GLASS_TEXT_FAINT,
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  rowLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT,
  },
});
