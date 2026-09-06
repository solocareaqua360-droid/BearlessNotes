import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const ACCENT = '#3B82F6';
const DANGER = '#EF4444';

type Props = {
  count: number;
  onTag: () => void;
  onProject: () => void;
  onCopy: () => void;
  onDelete: () => void;
};

// Bottom bar shown while select-mode is on and at least one row is picked
// (Files/Photos/Links) - same bottom-bar placement as the document editor's
// own select-mode delete bar, just with more than one action.
export default function BulkActionBar({ count, onTag, onProject, onCopy, onDelete }: Props) {
  if (count === 0) return null;
  return (
    <View style={styles.bar}>
      <Text style={styles.count}>{count}</Text>
      <View style={styles.actions}>
        <Pressable style={styles.action} hitSlop={6} onPress={onTag}>
          <Ionicons name="pricetag-outline" size={20} color={ACCENT} />
          <Text style={styles.actionLabel}>Тег</Text>
        </Pressable>
        <Pressable style={styles.action} hitSlop={6} onPress={onProject}>
          <Ionicons name="folder-outline" size={20} color={ACCENT} />
          <Text style={styles.actionLabel}>Проєкт</Text>
        </Pressable>
        <Pressable style={styles.action} hitSlop={6} onPress={onCopy}>
          <Ionicons name="document-text-outline" size={20} color={ACCENT} />
          <Text style={styles.actionLabel}>В нотатку</Text>
        </Pressable>
        <Pressable style={styles.action} hitSlop={6} onPress={onDelete}>
          <Ionicons name="trash-outline" size={20} color={DANGER} />
          <Text style={[styles.actionLabel, { color: DANGER }]}>Видалити</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -2 },
    elevation: 8,
  },
  count: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    minWidth: 20,
  },
  actions: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  action: {
    alignItems: 'center',
    gap: 3,
  },
  actionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: ACCENT,
  },
});
