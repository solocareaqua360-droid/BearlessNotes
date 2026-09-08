import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Props = {
  count: number;
  onTag: () => void;
  onGroup: () => void;
  // Absent on screens where "copy into a note" doesn't make sense (e.g.
  // Documents itself) - the button just doesn't render rather than calling
  // a no-op.
  onCopy?: () => void;
  onDelete: () => void;
  // Documents/Calendar share the bottom of the screen with
  // FloatingIslandTabBar (bottom: 24, ~64 tall) - this bar needs to float
  // clear above it there, or it visually collides with the island's own
  // buttons. Files/Photos/Links are plain pushed stack screens with no
  // island underneath, so they just want the plain bottom-safe spacing.
  aboveTabBar?: boolean;
};

// Floating glass capsule shown while select-mode is on and at least one row
// is picked (Files/Photos/Links, Documents) - one color throughout (white
// icons/text on dark glass, matching the header capsule's own look)
// instead of a full-width flat bar with per-action colors, which is what
// made it hard to tell apart from a plain toolbar and, on Documents, put it
// at the same height as the tab island underneath.
export default function BulkActionBar({ count, onTag, onGroup, onCopy, onDelete, aboveTabBar }: Props) {
  if (count === 0) return null;
  return (
    <View style={[styles.wrap, aboveTabBar && styles.wrapAboveTabBar]} pointerEvents="box-none">
      <View style={styles.capsule}>
        <Text style={styles.count}>{count}</Text>
        <View style={styles.divider} />
        <Pressable style={styles.action} hitSlop={6} onPress={onTag}>
          <Ionicons name="pricetag-outline" size={18} color="#fff" />
          <Text style={styles.actionLabel}>Тег</Text>
        </Pressable>
        <Pressable style={styles.action} hitSlop={6} onPress={onGroup}>
          <Ionicons name="folder-outline" size={18} color="#fff" />
          <Text style={styles.actionLabel}>Групування</Text>
        </Pressable>
        {onCopy && (
          <Pressable style={styles.action} hitSlop={6} onPress={onCopy}>
            <Ionicons name="document-text-outline" size={18} color="#fff" />
            <Text style={styles.actionLabel}>В нотатку</Text>
          </Pressable>
        )}
        <Pressable style={styles.action} hitSlop={6} onPress={onDelete}>
          <Ionicons name="trash-outline" size={18} color="#fff" />
          <Text style={styles.actionLabel}>Видалити</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 24,
    alignItems: 'center',
  },
  // 88 (island's own bottom + height) + 16 clearance.
  wrapAboveTabBar: {
    bottom: 104,
  },
  capsule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: 'rgba(20,20,20,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  count: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
  },
  divider: {
    width: 1,
    height: 22,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  action: {
    alignItems: 'center',
    gap: 3,
  },
  actionLabel: {
    fontSize: 9.5,
    fontWeight: '600',
    color: '#fff',
  },
});
