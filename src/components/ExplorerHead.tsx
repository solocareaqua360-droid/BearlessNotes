import { useState } from 'react';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ExplorerFolder } from '../hooks/useExplorer';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';

// What stands above a database's records while it is in explorer mode:
// where you are, and the folders at this level.
//
// Written inside DocumentsScreen; boards need the same rows, so it is a
// component. A folder row deliberately wears the record row's clothes -
// the same card, with the tag's icon in a frame where a record shows its
// picture - so the two read as one list rather than two.

export default function ExplorerHead({
  path,
  folders,
  onGo,
  onFolderMenu,
  // The icon beside a folder's first number - what this database's
  // records ARE (a document, a board), since that number counts them.
  itemIcon,
  // The bin, at the root, after the folders - where a file manager keeps
  // it. Absent on a database that has no bin yet.
  trash,
  columns,
  folderRef,
}: {
  path: string;
  folders: ExplorerFolder[];
  onGo: (path: string) => void;
  onFolderMenu: (folder: ExplorerFolder) => void;
  itemIcon: keyof typeof Ionicons.glyphMap;
  trash?: { count: number; onOpen: () => void };
  // How many folders stand across a line. One on a phone; two or three
  // on the Fold's inner screen, where a folder row - an icon, a name and
  // two small numbers - is a very long way to say very little at full
  // width. The rows are sized from this component's OWN measured width,
  // so it is right whatever list it stands in.
  columns?: number;
  // A card being carried (see useCardCarry) needs to measure a target at
  // drop time to know whether it landed on one - this hands each one's
  // node out for that, and nothing else. Folder rows register under their
  // own path; the crumbs register under the path they lead to, which is
  // what lets the second finger step back OUT of a folder mid-carry (and
  // a card be dropped straight onto a parent). Absent on a screen that
  // has not joined drag-and-drop yet.
  folderRef?: (path: string) => (node: View | null) => void;
}) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const [width, setWidth] = useState(0);
  const cols = Math.max(1, columns ?? 1);
  const rowWidth = cols > 1 && width > 0 ? Math.floor((width - FOLDER_GAP * (cols - 1)) / cols) : undefined;

  // Nothing above the list unless there is something to put there. The
  // path used to count as something; it lives in the dock now.
  if (folders.length === 0 && !trash) return null;

  return (
    <View style={styles.head} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View style={cols > 1 ? styles.folderGrid : styles.folderStack}>
      {folders.map((folder) => (
        <View key={folder.fullPath} ref={folderRef?.(folder.fullPath)} collapsable={false}>
          <Pressable
            style={[styles.folderRow, rowWidth !== undefined && { width: rowWidth }]}
            onPress={() => onGo(folder.fullPath)}
            onLongPress={() => onFolderMenu(folder)}
          >
            <View style={[styles.folderThumb, { borderColor: folder.tag?.color ?? theme.ink.faint }]}>
              <Ionicons
                name={(folder.tag?.icon as keyof typeof Ionicons.glyphMap) || 'folder-outline'}
                size={26}
                color={folder.tag?.color ?? theme.ink.muted}
              />
            </View>
            <View style={styles.folderBody}>
              <Text style={styles.folderName} numberOfLines={1}>
                {folder.name}
              </Text>
              <View style={styles.folderMeta}>
                <Ionicons name={itemIcon} size={14} color={theme.ink.muted} />
                <Text style={styles.folderCount}>{folder.docs}</Text>
                <Ionicons name="folder-outline" size={14} color={theme.ink.muted} style={styles.folderMetaGap} />
                <Text style={styles.folderCount}>{folder.subfolders}</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.ink.faint} />
          </Pressable>
        </View>
      ))}

      {!!trash && trash.count > 0 && path === '' && (
        <Pressable
          style={[styles.folderRow, styles.trashRow, rowWidth !== undefined && { width: rowWidth }]}
          onPress={trash.onOpen}
        >
          <View style={[styles.folderThumb, { borderColor: theme.ink.faint }]}>
            <Ionicons name="trash-outline" size={26} color={theme.ink.muted} />
          </View>
          <View style={styles.folderBody}>
            <Text style={[styles.folderName, { color: theme.ink.muted }]}>Кошик</Text>
            <View style={styles.folderMeta}>
              <Ionicons name={itemIcon} size={14} color={theme.ink.muted} />
              <Text style={styles.folderCount}>{trash.count}</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.ink.faint} />
        </Pressable>
      )}
      </View>
    </View>
  );
}

const FOLDER_GAP = 10;

const makeStyles = (t: Theme) =>
  StyleSheet.create({
  head: {
    gap: 8,
    marginBottom: 8,
  },
  folderGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: FOLDER_GAP,
  },
  // One to a line: the same 8 between rows the head itself keeps, which
  // the rows lost when they moved one level down into this wrapper.
  folderStack: {
    gap: 8,
  },
  crumbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  crumbUp: {
    padding: 4,
  },
  crumbStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 8,
  },
  crumbPair: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  crumbSegment: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  crumbSegmentCurrent: {
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  crumbLabel: {
    fontSize: 15,
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.muted,
  },
  crumbLabelCurrent: {
    color: t.ink.primary,
  },
  // Glass, like every row of the app's own lists, in the record row's
  // size - the user's words: the glass stays, only the size grows.
  folderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  trashRow: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  folderThumb: {
    width: 56,
    height: 56,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  folderBody: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  folderName: {
    fontSize: 18,
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.primary,
  },
  folderMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  folderMetaGap: {
    marginLeft: 10,
  },
  folderCount: {
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: t.ink.muted,
  },
  });
