import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRailTree } from '../navigation/navRail';
import { useNavDockLeave } from '../navigation/navDock';
import { navigationRef } from '../navigationRef';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';

export const RAIL_WIDTH = 240;

const SECTIONS: { name: 'Документи' | 'Календар' | 'Дошки' | 'Більше'; icon: string }[] = [
  { name: 'Документи', icon: 'document-text-outline' },
  { name: 'Календар', icon: 'calendar-outline' },
  { name: 'Дошки', icon: 'easel-outline' },
  { name: 'Більше', icon: 'apps-outline' },
];

// One folder in the tree, and its children under it.
type Node = { path: string; name: string; children: Node[] };

function buildTree(paths: string[]): Node[] {
  const roots: Node[] = [];
  const byPath = new Map<string, Node>();
  // Shortest first, so a parent always exists before the child that
  // needs it - a folder can be only a segment of a deeper one's path.
  for (const path of [...new Set(paths)].sort((a, b) => a.split('/').length - b.split('/').length)) {
    const parts = path.split('/');
    const node: Node = { path, name: parts[parts.length - 1], children: [] };
    byPath.set(path, node);
    const parent = parts.length > 1 ? byPath.get(parts.slice(0, -1).join('/')) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  const sort = (list: Node[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name));
    list.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

// The rail, where a cursor is pointing.
//
// It replaces the dock rather than joining it. The dock is a bar 60
// points tall floating at the bottom of the screen, which is where a
// thumb rests and where a cursor never goes - and on a 753-point-tall
// window it costs 96 of them, thirteen per cent of the height, to put
// navigation somewhere the pointer has to travel to.
//
// THE RULE, and it is the reason this is a column and not a menu:
// nothing here may cover the columns to its right. A folder opens
// INSIDE the rail, pushing what is below it down in the rail's own
// scroll. Popovers exist because a 60-point bar has nowhere to put
// anything; 240 by 753 has room, so they have no reason to exist. If
// something cannot fit here expanded, it does not belong here.
export default function DesktopRail({ footer }: { footer?: ReactNode }) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const tree = useRailTree();
  // The way OUT of a screen that was pushed over the tabs - a board, a
  // database, a note. It lived on the dock, and the dock is not here, so
  // hiding the dock took the only exit with it: the user opened a board
  // and had no way back at all. It belongs at the top of the rail, which
  // is where a Mac keeps "back" anyway.
  const leave = useNavDockLeave();
  const [open, setOpen] = useState<Set<string>>(new Set());

  // Which of the four is showing. Read through the global ref, not
  // through useNavigationState: this rail stands BESIDE the navigator
  // rather than inside one, and that hook refuses to answer anywhere
  // else - "Couldn't get the navigation state. Is your component inside
  // a navigator?", which it is not, and is not meant to be.
  const [section, setSection] = useState('Документи');
  useEffect(() => {
    const read = () => {
      if (!navigationRef.isReady()) return;
      const state = navigationRef.getRootState() as
        | { index?: number; routes?: { name: string; state?: { index?: number; routes?: { name: string }[] } }[] }
        | undefined;
      const route = state?.routes?.[state.index ?? 0];
      if (!route) return;
      if (route.name !== 'Tabs') {
        setSection(route.name);
        return;
      }
      setSection(route.state?.routes?.[route.state.index ?? 0]?.name ?? 'Документи');
    };
    read();
    return navigationRef.addListener('state', read);
  }, []);

  const roots = useMemo(() => buildTree(tree?.paths ?? []), [tree?.paths]);

  function toggle(path: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function renderNode(node: Node, depth: number) {
    const expanded = open.has(node.path);
    const here = tree?.current === node.path;
    return (
      <View key={node.path}>
        <Pressable
          style={[styles.folder, { paddingLeft: 10 + depth * 14 }, here && styles.folderHere]}
          onPress={() => tree?.onGo(node.path)}
        >
          {node.children.length > 0 ? (
            <Pressable hitSlop={6} onPress={() => toggle(node.path)} style={styles.twist}>
              <Ionicons
                name={expanded ? 'chevron-down' : 'chevron-forward'}
                size={13}
                color={theme.ink.faint}
              />
            </Pressable>
          ) : (
            <View style={styles.twist} />
          )}
          <Ionicons
            name={expanded ? 'folder-open-outline' : 'folder-outline'}
            size={15}
            color={here ? theme.accent : theme.ink.muted}
          />
          <Text style={[styles.folderName, here && styles.folderNameHere]} numberOfLines={1}>
            {node.name}
          </Text>
        </Pressable>
        {expanded && node.children.map((child) => renderNode(child, depth + 1))}
      </View>
    );
  }

  return (
    <View style={styles.rail}>
      {!!leave && (
        <Pressable style={styles.leave} onPress={leave.onLeave}>
          <Ionicons name="chevron-back" size={16} color={theme.ink.primary} />
          <Text style={styles.leaveLabel}>Назад</Text>
        </Pressable>
      )}
      <View style={styles.sections}>
        {SECTIONS.map((s) => {
          const active = section === s.name;
          return (
            <Pressable
              key={s.name}
              style={[styles.section, active && styles.sectionActive]}
              onPress={() => {
                if (navigationRef.isReady()) navigationRef.navigate('Tabs', { screen: s.name } as never);
              }}
            >
              <Ionicons
                name={s.icon as never}
                size={17}
                color={active ? theme.accent : theme.ink.muted}
              />
              <Text style={[styles.sectionLabel, active && styles.sectionLabelActive]}>{s.name}</Text>
            </Pressable>
          );
        })}
      </View>

      {!!tree && (
        <>
          <View style={styles.rule} />
          {!!tree.onNewFolder && (
            <Pressable
              style={styles.newFolder}
              // Inside whichever folder the list is standing in, which is
              // what "new folder" means anywhere else a folder tree
              // exists.
              onPress={() => tree.onNewFolder?.(tree.current)}
            >
              <Ionicons name="add" size={15} color={theme.ink.muted} />
              <Text style={styles.newFolderLabel}>Нова папка</Text>
            </Pressable>
          )}
          <ScrollView style={styles.tree} contentContainerStyle={styles.treeContent}>
            <Pressable
              style={[styles.folder, styles.rootRow, tree.current === '' && !tree.bin?.active && styles.folderHere]}
              onPress={() => tree.onGo('')}
            >
              <View style={styles.twist} />
              <Ionicons
                name="home-outline"
                size={15}
                color={tree.current === '' ? theme.accent : theme.ink.muted}
              />
              <Text style={[styles.folderName, tree.current === '' && styles.folderNameHere]}>Усі</Text>
            </Pressable>
            {roots.map((node) => renderNode(node, 0))}
          </ScrollView>
          {!!tree.bin && (
            <Pressable
              style={[styles.folder, styles.bin, tree.bin.active && styles.folderHere]}
              onPress={tree.bin.onOpen}
            >
              <View style={styles.twist} />
              <Ionicons
                name="trash-outline"
                size={15}
                color={tree.bin.active ? theme.accent : theme.ink.muted}
              />
              <Text style={[styles.folderName, tree.bin.active && styles.folderNameHere]}>Кошик</Text>
              {tree.bin.count > 0 && <Text style={styles.count}>{tree.bin.count}</Text>}
            </Pressable>
          )}
        </>
      )}
      {/* Whose data this is, at the foot of the column - where a sidebar
          keeps it. It is the same strip the phone shows across the top;
          only its place changes. */}
      {!!footer && <View style={styles.footer}>{footer}</View>}
    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  rail: {
    width: RAIL_WIDTH,
    // Its own ground, and it had none - so on a dark theme the light
    // backing of the window showed straight through it and the labels
    // went almost invisible on it. A column that stands beside every
    // screen has to paint itself; only the screens have a background
    // of their own.
    backgroundColor: t.ground,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: t.edge.hairline,
    paddingTop: 10,
    paddingBottom: 10,
  },
  leave: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 30,
    marginHorizontal: 8,
    marginBottom: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: t.selected,
  },
  leaveLabel: {
    fontSize: 13,
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.primary,
  },
  sections: {
    paddingHorizontal: 8,
    gap: 2,
  },
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  sectionActive: {
    backgroundColor: t.selected,
  },
  sectionLabel: {
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: t.ink.muted,
  },
  sectionLabelActive: {
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.primary,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: t.edge.hairline,
    marginVertical: 10,
    marginHorizontal: 12,
  },
  newFolder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 26,
    marginHorizontal: 8,
    marginBottom: 2,
    paddingHorizontal: 10,
    borderRadius: 7,
  },
  newFolderLabel: {
    fontSize: 12,
    fontFamily: FONT_REGULAR,
    color: t.ink.faint,
  },
  tree: {
    flex: 1,
  },
  treeContent: {
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  rootRow: {
    paddingLeft: 10,
  },
  folder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 28,
    paddingRight: 8,
    borderRadius: 7,
  },
  folderHere: {
    backgroundColor: t.selected,
  },
  twist: {
    width: 14,
    alignItems: 'center',
  },
  folderName: {
    flex: 1,
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: t.ink.muted,
  },
  folderNameHere: {
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.primary,
  },
  count: {
    fontSize: 11,
    fontFamily: FONT_REGULAR,
    color: t.ink.faint,
  },
  bin: {
    marginTop: 4,
    marginHorizontal: 8,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.edge.hairline,
    marginTop: 8,
    paddingTop: 8,
  },
});
