import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

// Sentinel for "no group/project assigned" - an id string, since a real
// document's id (a Firestore auto-id) can never collide with it. `null`
// itself means "Всі" (no filter).
export const UNASSIGNED_ID = '__none__';

const MUTED = '#6B7280';

type Item = { id: string; name: string; color: string };

type Props = {
  items: Item[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  // Tasks' own projects and Files/Photos/Links' groups are two entirely
  // separate collections (the user was explicit: grouping in the database
  // screens is its own thing, not the same "project" tasks have) - this
  // component only draws the pill row, so it doesn't care which; the
  // caller supplies the right wording for its "unassigned" tab.
  unassignedLabel?: string;
};

// Horizontal row of pills (see the videobookmark reference the user showed:
// "Всі / Робота / Дім / Навчання") - a plain filter, not a toggle into
// grouped sections.
export default function ProjectTabsRow({ items, selected, onSelect, unassignedLabel = 'Без проєкту' }: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // RN gives every ScrollView flexGrow: 1 by default - without pinning
      // it to 0 here, this row competes for height with the list/grid
      // ScrollView below it and can end up claiming half the screen, which
      // then stretches every pill tall to match (row's default cross-axis
      // alignItems is 'stretch'). Same bug, same fix, as the calendar's own
      // week strip.
      style={styles.scroll}
      contentContainerStyle={styles.row}
    >
      <Tab label="Всі" color={MUTED} active={selected === null} onPress={() => onSelect(null)} />
      {items.map((p) => (
        <Tab key={p.id} label={p.name} color={p.color} active={selected === p.id} onPress={() => onSelect(p.id)} />
      ))}
      <Tab label={unassignedLabel} color={MUTED} active={selected === UNASSIGNED_ID} onPress={() => onSelect(UNASSIGNED_ID)} />
    </ScrollView>
  );
}

function Tab({ label, color, active, onPress }: { label: string; color: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={styles.tab} onPress={onPress}>
      {active && <View style={[styles.dot, { backgroundColor: color }]} />}
      <Text style={[styles.tabLabel, { color: active ? color : '#374151' }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  // Frosted-glass capsule for every tab, active or not - a soft
  // translucent fill and border rather than a flat color-tint/gray one.
  // These screens have a plain white background (not the dark gradient
  // Documents/Calendar/Databases got), so this is the light-glass variant
  // of that same treatment: still translucent and bordered, just legible
  // against white instead of a dark backdrop.
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 13,
    borderRadius: 999,
    backgroundColor: 'rgba(120,120,120,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
});
