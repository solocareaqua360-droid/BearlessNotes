import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  count: number;
  onTag: () => void;
  onGroup: () => void;
  // Absent on screens where "copy into a note" doesn't make sense (e.g.
  // Documents itself) - the button just doesn't render rather than calling
  // a no-op.
  onCopy?: () => void;
  // Puts the one selected row on the app's own clipboard, to be pasted
  // into any open document (see objectClipboard). Offered only for a
  // single row: pasting expects one object, not a pile.
  onCopyObject?: () => void;
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
export default function BulkActionBar({
  count,
  onTag,
  onGroup,
  onCopy,
  onCopyObject,
  onDelete,
  aboveTabBar,
}: Props) {
  // The device's own gesture-nav strip isn't accounted for by a plain
  // hardcoded bottom offset - on a phone with a tall gesture inset, that
  // let this bar render partly behind/under the system bar rather than
  // fully on-screen. Adding the real inset on top of the base offset
  // keeps it clear on every device instead of just the ones this was
  // eyeballed on.
  const insets = useSafeAreaInsets();
  if (count === 0) return null;
  return (
    <View
      style={[styles.wrap, { bottom: (aboveTabBar ? 104 : 24) + insets.bottom }]}
      pointerEvents="box-none"
    >
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
        {!!onCopyObject && count === 1 && (
          <Pressable style={styles.action} hitSlop={6} onPress={onCopyObject}>
            <Ionicons name="copy-outline" size={18} color="#fff" />
            <Text style={styles.actionLabel}>Копіювати</Text>
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
  // `bottom` is set inline (base offset + the device's real safe-area
  // inset) rather than here - see the component body.
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
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
