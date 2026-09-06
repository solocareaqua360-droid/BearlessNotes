import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Project } from '../types';

// Sentinel for "Без проєкту" - a project id string, since a real Project
// document's id (a Firestore auto-id) can never collide with it. `null`
// itself means "Всі" (no filter).
export const NO_PROJECT_ID = '__none__';

const MUTED = '#6B7280';

type Props = {
  projects: Project[];
  selected: string | null;
  onSelect: (projectId: string | null) => void;
};

// Horizontal row of project pills (see the videobookmark reference the user
// showed: "Всі / Робота / Дім / Навчання") - a plain filter, not a toggle
// into grouped sections. Reused across Files/Photos/Links/Tasks so a
// project means the same thing, and looks the same, everywhere.
export default function ProjectTabsRow({ projects, selected, onSelect }: Props) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      <Tab label="Всі" color={MUTED} active={selected === null} onPress={() => onSelect(null)} />
      {projects.map((p) => (
        <Tab key={p.id} label={p.name} color={p.color} active={selected === p.id} onPress={() => onSelect(p.id)} />
      ))}
      <Tab label="Без проєкту" color={MUTED} active={selected === NO_PROJECT_ID} onPress={() => onSelect(NO_PROJECT_ID)} />
    </ScrollView>
  );
}

function Tab({ label, color, active, onPress }: { label: string; color: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[styles.tab, active ? { backgroundColor: `${color}1A` } : styles.tabInactive]}
      onPress={onPress}
    >
      {active && <View style={[styles.dot, { backgroundColor: color }]} />}
      <Text style={[styles.tabLabel, { color: active ? color : '#374151' }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 13,
    borderRadius: 16,
  },
  tabInactive: {
    backgroundColor: '#F3F4F6',
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
