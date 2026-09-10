import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Tag } from '../types';
import { useCustomRowData } from '../hooks/useCustomRowData';
import { buildRowDisplay } from '../utils/customRowDisplay';
import CustomRowCard from './CustomRowCard';

type Props = {
  databaseId: string | undefined;
  rowId: string;
  // Snapshotted at insert time - all there is to show if the row has since
  // been deleted from its database, or for the first frame before the live
  // one arrives.
  fallbackTitle?: string;
  tags: Tag[];
  onOpen: (databaseId: string, rowId: string) => void;
};

// A user-created database's row embedded in a document ('dbRow' block).
// Renders the row LIVE (see useCustomRowData) through the very same card
// its own database list uses, so the two can never drift apart, and an edit
// made in the database shows up here without touching the document.
export default function CustomRowBlockCard({ databaseId, rowId, fallbackTitle, tags, onOpen }: Props) {
  const { database, row, context } = useCustomRowData(databaseId, rowId);

  // Deleted from its database (or never resolvable) - the block stays, so
  // the document doesn't silently lose a line, but it says plainly that
  // there's nothing behind it any more.
  if (databaseId && database && !row) {
    return (
      <View style={styles.missing}>
        <Ionicons name="alert-circle-outline" size={18} color="#9CA3AF" />
        <Text style={styles.missingLabel} numberOfLines={1}>
          {fallbackTitle ? `Запис видалено: ${fallbackTitle}` : 'Запис видалено'}
        </Text>
      </View>
    );
  }

  const display = row
    ? buildRowDisplay(database, row, context)
    : { title: fallbackTitle || 'Без назви', cover: undefined, chips: [] };

  return (
    <View style={styles.wrap}>
      <CustomRowCard
        rowId={rowId}
        display={display}
        tags={tags.filter((t) => (row?.tagIds ?? []).includes(t.id))}
        onPress={() => databaseId && onOpen(databaseId, rowId)}
        right={
          <Pressable
            hitSlop={8}
            style={styles.openButton}
            onPress={() => databaseId && onOpen(databaseId, rowId)}
          >
            <Ionicons name="server-outline" size={16} color="rgba(0,0,0,0.45)" />
          </Pressable>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    paddingVertical: 4,
  },
  openButton: {
    padding: 6,
  },
  missing: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#E5E7EB',
    paddingHorizontal: 12,
    paddingVertical: 14,
    marginVertical: 4,
  },
  missingLabel: {
    flex: 1,
    fontSize: 13,
    color: '#9CA3AF',
  },
});
