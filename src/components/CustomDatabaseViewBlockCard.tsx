import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Tag } from '../types';
import { useCustomDatabaseViewData } from '../hooks/useCustomDatabaseViewData';
import { buildRowDisplay } from '../utils/customRowDisplay';
import CustomRowCard from './CustomRowCard';

// How many rows show before the block asks the reader to tap for more,
// rather than a hard cap - the row count itself never changes, just how
// much of it is shown right now.
const INITIAL_ROW_COUNT = 5;

type Props = {
  databaseId: string | undefined;
  viewId: string;
  // Snapshotted at insert time - what to show while the live view loads,
  // and if it's since been deleted from its database.
  fallbackTitle?: string;
  tags: Tag[];
  onOpenRow: (databaseId: string, rowId: string) => void;
  onOpenView: (databaseId: string, viewId: string) => void;
};

// A saved view of a user-created database, embedded in a document as a
// live, filtered, sorted slice of its rows ('dbView' block) - one level up
// from a single embedded row (see CustomRowBlockCard). Every row shown here
// is the exact same query the view's own database screen runs, re-applied
// live: add a row that matches the filter and it appears here too, with no
// edit to the document itself.
export default function CustomDatabaseViewBlockCard({
  databaseId,
  viewId,
  fallbackTitle,
  tags,
  onOpenRow,
  onOpenView,
}: Props) {
  const { database, view, rows, context } = useCustomDatabaseViewData(databaseId, viewId);
  const [expanded, setExpanded] = useState(false);

  // Deleted from its database (or never resolvable) - the block stays, so
  // the document doesn't silently lose a line, but it says plainly there's
  // nothing behind it any more. Requires the DATABASE to have loaded first,
  // same as CustomRowBlockCard's own missing-row check - that's what tells
  // "really deleted" apart from "hasn't loaded yet".
  if (databaseId && database && !view) {
    return (
      <View style={styles.missing}>
        <Ionicons name="alert-circle-outline" size={18} color="#9CA3AF" />
        <Text style={styles.missingLabel} numberOfLines={1}>
          {fallbackTitle ? `Вигляд видалено: ${fallbackTitle}` : 'Вигляд видалено'}
        </Text>
      </View>
    );
  }

  const title = view?.name || fallbackTitle || 'Вигляд';
  const shown = expanded ? rows : rows.slice(0, INITIAL_ROW_COUNT);
  const remaining = rows.length - shown.length;

  return (
    <View style={styles.wrap}>
      <Pressable
        style={styles.header}
        onPress={() => databaseId && view && onOpenView(databaseId, view.id)}
      >
        <Ionicons name="bookmark" size={14} color="#6B7280" />
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.headerCount}>{rows.length}</Text>
        <Ionicons name="chevron-forward" size={14} color="#9CA3AF" />
      </Pressable>

      {view && rows.length === 0 && (
        <Text style={styles.emptyLabel}>Немає записів, що відповідають вигляду</Text>
      )}

      {shown.map((row) => (
        <CustomRowCard
          key={row.id}
          rowId={row.id}
          display={buildRowDisplay(database, row, context)}
          tags={tags.filter((t) => (row.tagIds ?? []).includes(t.id))}
          onPress={() => databaseId && onOpenRow(databaseId, row.id)}
        />
      ))}

      {remaining > 0 && (
        <Pressable style={styles.more} onPress={() => setExpanded(true)}>
          <Text style={styles.moreLabel}>Ще {remaining}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    gap: 6,
    paddingVertical: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  headerCount: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  emptyLabel: {
    fontSize: 13,
    color: '#9CA3AF',
    paddingVertical: 6,
  },
  more: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  moreLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#3B82F6',
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
