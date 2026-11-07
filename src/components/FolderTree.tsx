import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { Ionicons } from './icons/Ionicons';
import { useSoft, softCardFrame } from '../theme/soft';
import { withAlpha } from '../utils/color';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import type { FolderBase } from '../hooks/useFolderBases';
import type { Tag } from '../types';

// THE FOLDERS AS A TREE (the folders rework, 2026-10-02): each database is
// a root - its icon and name - and from it lines run to the folders it
// shows, and from a folder to the folders inside it. A folder that lives
// in three databases stands under all three. Everything folds: a database
// shut is one line, a folder shut hides what is under it. A folder card
// carries the small icons of the OTHER databases it also lives in; held,
// it opens its menu (the screen's HoldMenu) - no pencil or bin on the card.

type Node = { path: string; name: string; tag: Tag | null; children: Node[] };
export type FolderRect = { x: number; y: number; width: number; height: number };

const nameOf = (path: string) => path.split('/').pop() ?? path;

function buildTree(paths: string[], tagByPath: Map<string, Tag>): Node[] {
  const all = new Set<string>();
  paths.forEach((p) => {
    const parts = p.split('/');
    parts.forEach((_, i) => all.add(parts.slice(0, i + 1).join('/')));
  });
  const nodes = new Map<string, Node>();
  [...all].sort((a, b) => a.localeCompare(b)).forEach((p) => nodes.set(p, { path: p, name: nameOf(p), tag: tagByPath.get(p) ?? null, children: [] }));
  const roots: Node[] = [];
  nodes.forEach((node) => {
    const cut = node.path.lastIndexOf('/');
    const parent = cut > 0 ? nodes.get(node.path.slice(0, cut)) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  return roots;
}

// Whatever of the tree matches the search, with the way down to it.
function prune(nodes: Node[], needle: string): Node[] {
  return nodes
    .map((node) => {
      const children = prune(node.children, needle);
      return node.name.toLowerCase().includes(needle) || children.length ? { ...node, children } : null;
    })
    .filter((n): n is Node => !!n);
}

export default function FolderTree({
  tags,
  bases,
  query,
  bottomPad,
  onOpen,
  onHold,
}: {
  tags: Tag[];
  bases: FolderBase[];
  query: string;
  bottomPad: number;
  onOpen: (tag: Tag) => void;
  onHold: (tag: Tag, rect: FolderRect, kind: string) => void;
}) {
  const S = useSoft();
  // Shut databases, and shut folders (per database: the same folder can be
  // open under one and shut under another).
  const [openBases, setOpenBases] = useState<Set<string>>(new Set());
  const [shutFolders, setShutFolders] = useState<Set<string>>(new Set());
  const needle = query.trim().toLowerCase();
  const tagByPath = new Map(tags.map((t) => [t.path, t]));
  const baseOf = new Map(bases.map((b) => [b.kind, b]));
  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };
  const line = withAlpha(S.ink, 0.14);

  const hold = (tag: Tag, kind: string) => (e: GestureResponderEvent) => {
    const target = e.currentTarget as unknown as { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void };
    target?.measureInWindow?.((x, y, width, height) => onHold(tag, { x, y, width, height }, kind));
  };

  const folderCard = (node: Node, kind: string): ReactNode => {
    const tag = node.tag;
    const count = tag ? Object.keys(tag.usedIn).filter((k) => k.startsWith(`${kind}:`)).length : 0;
    const others = tag ? tag.types.filter((k) => k !== kind && baseOf.has(k)) : [];
    const key = `${kind}|${node.path}`;
    const shut = shutFolders.has(key);
    return (
      <Pressable
        onPress={() => (tag ? onOpen(tag) : setShutFolders((s) => toggle(s, key)))}
        onLongPress={tag ? hold(tag, kind) : undefined}
        delayLongPress={350}
        style={[styles.card, softCardFrame(S), { backgroundColor: S.card }, !tag && { opacity: 0.6 }]}
      >
        {node.children.length > 0 ? (
          <Pressable hitSlop={8} onPress={() => setShutFolders((s) => toggle(s, key))} style={styles.twist}>
            <Ionicons name={shut ? 'chevron-forward' : 'chevron-down'} size={15} color={S.ink3} />
          </Pressable>
        ) : (
          <View style={styles.twist} />
        )}
        <View style={[styles.icon, { backgroundColor: S.fill }]}>
          <Ionicons name={(tag?.icon ?? 'folder-outline') as never} size={18} color={tag?.color ?? S.ink3} />
        </View>
        <View style={styles.body}>
          <Text style={[styles.name, { color: S.ink }]} numberOfLines={1}>
            {node.name}
          </Text>
          {!!tag && (
            <Text style={[styles.meta, { color: S.ink3 }]} numberOfLines={1}>
              {count} {count === 1 ? 'елемент' : 'елементів'}
            </Text>
          )}
        </View>
        {/* The other databases this folder lives in. */}
        {others.length > 0 && (
          <View style={styles.others}>
            {others.map((k) => (
              <Ionicons key={k} name={baseOf.get(k)!.icon as never} size={14} color={baseOf.get(k)!.color} />
            ))}
          </View>
        )}
      </Pressable>
    );
  };

  const branch = (nodes: Node[], kind: string): ReactNode => (
    <View style={[styles.branch, { borderColor: line }]}>
      {nodes.map((node) => {
        const shut = shutFolders.has(`${kind}|${node.path}`) && !needle;
        return (
          <View key={node.path}>
            <View style={styles.leaf}>
              {/* The tick from the branch's line to this folder. */}
              <View style={[styles.tick, { backgroundColor: line }]} />
              <View style={styles.flex}>{folderCard(node, kind)}</View>
            </View>
            {node.children.length > 0 && !shut && branch(node.children, kind)}
          </View>
        );
      })}
    </View>
  );

  return (
    <View style={[styles.list, { paddingBottom: bottomPad }]}>
      {bases.map((base) => {
        const paths = tags.filter((t) => t.types.includes(base.kind)).map((t) => t.path);
        if (!paths.length) return null;
        let roots = buildTree(paths, tagByPath);
        if (needle) roots = prune(roots, needle);
        if (needle && !roots.length) return null;
        const open = !!needle || openBases.has(base.kind);
        return (
          <View key={base.kind}>
            <Pressable onPress={() => setOpenBases((s) => toggle(s, base.kind))} style={styles.baseRow}>
              <View style={[styles.baseIcon, { backgroundColor: S.card, boxShadow: S.shadow }]}>
                <Ionicons name={base.icon as never} size={20} color={base.color} />
              </View>
              <Text style={[styles.baseName, { color: S.ink }]} numberOfLines={1}>
                {base.label}
              </Text>
              <Text style={[styles.baseCount, { color: S.ink3 }]}>{paths.length}</Text>
              <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={18} color={S.ink3} />
            </Pressable>
            {open && branch(roots, base.kind)}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: 20,
    gap: 6,
  },
  flex: {
    flex: 1,
  },
  baseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  baseIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  baseName: {
    flex: 1,
    fontSize: 17,
    fontFamily: FONT_SEMIBOLD,
  },
  baseCount: {
    fontSize: 14,
    fontFamily: FONT_REGULAR,
  },
  // The line down from a database (or a folder) to what hangs from it.
  branch: {
    marginLeft: 19,
    borderLeftWidth: 1.5,
    paddingLeft: 14,
    paddingVertical: 4,
    gap: 8,
  },
  leaf: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tick: {
    position: 'absolute',
    left: -14,
    width: 12,
    height: 1.5,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingRight: 12,
    paddingLeft: 6,
  },
  twist: {
    width: 18,
    alignItems: 'center',
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: 16,
    fontFamily: FONT_SEMIBOLD,
  },
  meta: {
    fontSize: 12,
    fontFamily: FONT_REGULAR,
    marginTop: 1,
  },
  others: {
    flexDirection: 'row',
    gap: 4,
  },
});
