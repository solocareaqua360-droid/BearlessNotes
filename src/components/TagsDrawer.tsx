import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Tag } from '../types';
import { FONT_REGULAR, FONT_SEMIBOLD, FONT_BOLD, FONT_EXTRABOLD } from '../utils/fonts';
import { GLASS_BODY, GLASS_BODY_BLURRED, GLASS_TEXT, GLASS_TEXT_FAINT } from '../constants/glass';
import { BlurView } from 'expo-blur';
import { useBlurTarget } from './GlassTarget';
import { GlassPortal } from './GlassPortal';

// Two thirds of the window, measured per render (useWindowDimensions) and
// never captured once at module scope from Dimensions.get() - see
// CalendarScreen's own PLATE_MARGIN comment for why that value can simply
// be the wrong window, and what it looks like when it is.
const DRAWER_FRACTION = 2 / 3;
// Matches FloatingIslandTabBar's own height (8px padding + 48px buttons) -
// the open button is a standalone circle the same size as the island.
const OPEN_BUTTON_SIZE = 64;

// 'multi' shows anything with at least one of the selected tags (OR);
// 'isolating' shows only items carrying every selected tag (AND).
export type TagFilterMode = 'multi' | 'isolating';

export type TagFilter = { type: 'tags'; tagIds: string[]; mode: TagFilterMode } | { type: 'untagged' };

// Single source of truth for what a tag filter actually matches, shared by
// every screen that filters its own list against a TagsDrawer selection.
export function matchesTagFilter(itemTagIds: string[], filter: TagFilter | null): boolean {
  if (!filter) return true;
  if (filter.type === 'untagged') return itemTagIds.length === 0;
  return filter.mode === 'isolating'
    ? filter.tagIds.every((id) => itemTagIds.includes(id))
    : filter.tagIds.some((id) => itemTagIds.includes(id));
}

// Used by each per-tag chip's own "x" - drops just that one tag out of the
// filter instead of clearing the whole selection.
export function removeTagFromFilter(filter: TagFilter, tagId: string): TagFilter | null {
  if (filter.type !== 'tags') return null;
  const remaining = filter.tagIds.filter((id) => id !== tagId);
  return remaining.length === 0 ? null : { type: 'tags', tagIds: remaining, mode: filter.mode };
}

type TreeNode = {
  name: string;
  fullPath: string;
  tag?: Tag;
  children: Map<string, TreeNode>;
};

// A branch only exists here for a path some tag in `tags` actually sits on -
// so a screen that passes in just its own "used" tags (see Files/Photos/
// Links) automatically prunes the whole tree down to branches that still
// have at least one tagged item, rather than every branch that ever existed
// app-wide.
function buildTree(tags: Tag[]): TreeNode {
  const root: TreeNode = { name: '', fullPath: '', children: new Map() };
  for (const tag of tags) {
    const parts = tag.path.split('/').filter((p) => p.trim() !== '');
    let node = root;
    let acc = '';
    parts.forEach((part, i) => {
      acc = acc ? `${acc}/${part}` : part;
      let child = node.children.get(part);
      if (!child) {
        child = { name: part, fullPath: acc, children: new Map() };
        node.children.set(part, child);
      }
      node = child;
      if (i === parts.length - 1) node.tag = tag;
    });
  }
  return root;
}

function TreeRow({
  node,
  depth,
  expanded,
  selectedIds,
  onToggleExpand,
  onToggleTag,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  selectedIds: Set<string>;
  onToggleExpand: (path: string) => void;
  onToggleTag: (tag: Tag) => void;
}) {
  const hasChildren = node.children.size > 0;
  const isExpanded = expanded.has(node.fullPath);
  const isSelected = !!node.tag && selectedIds.has(node.tag.id);
  const children = Array.from(node.children.values()).sort((a, b) => a.name.localeCompare(b.name));

  // A branch-only node (a path segment with no tag of its own, just
  // grouping children) has no color to draw from, so it - and the
  // chevron/icon/text that go with it - stay neutral gray instead.
  const tint = node.tag ? node.tag.color : GLASS_TEXT_FAINT;

  return (
    <View style={{ marginLeft: depth * 18 }}>
      <Pressable style={[styles.treeRow, { borderColor: tint }]} onPress={() => (node.tag ? onToggleTag(node.tag) : onToggleExpand(node.fullPath))}>
        {hasChildren ? (
          <Pressable hitSlop={8} onPress={() => onToggleExpand(node.fullPath)}>
            <Ionicons name={isExpanded ? 'chevron-down' : 'chevron-forward'} size={13} color={tint} />
          </Pressable>
        ) : (
          <View style={{ width: 13 }} />
        )}
        <Ionicons
          name={(node.tag ? node.tag.icon : 'folder-outline') as keyof typeof Ionicons.glyphMap}
          size={13}
          color={tint}
        />
        <Text style={[styles.treeLabel, { color: tint }]} numberOfLines={1}>
          {node.name}
        </Text>
        {/* Reserved always, populated only when selected - so picking a
            tag doesn't add width to the pill and change its shape. */}
        <View style={styles.treeCheckSlot}>
          {isSelected && node.tag && <Ionicons name="checkmark" size={14} color={tint} />}
        </View>
      </Pressable>
      {hasChildren &&
        isExpanded &&
        children.map((child) => (
          <TreeRow
            key={child.fullPath}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            selectedIds={selectedIds}
            onToggleExpand={onToggleExpand}
            onToggleTag={onToggleTag}
          />
        ))}
    </View>
  );
}

type Props = {
  tags: Tag[];
  activeFilter: TagFilter | null;
  onSelectFilter: (filter: TagFilter | null) => void;
  // Files/Photos/Links show the same round button in the same corner, but
  // it has to get out of the way while their own bulk-select bar is on
  // screen (same bottom-left corner, would otherwise overlap it).
  hideOpenButton?: boolean;
};

// A standalone round button at the bottom-left (same size as the floating
// island, styled to match it) opens a Bear-style tag tree, 2/3 of the
// screen wide, over a dimmed rest of the screen. Tapping a tag (or "Без
// тегів") toggles it into the calling screen's filter without closing the
// drawer, so more than one can be picked; closing happens by tapping the
// dimmed backdrop. The Мульти/Ізолюючий switch decides how multiple picked
// tags combine: Мульти = at least one matches (OR), Ізолюючий = every
// picked tag must be present (AND). Shared as-is across Documents/
// Calendar/Files/Photos/Links - it only ever browses and toggles from
// whatever `tags` list it's given (Files/Photos/Links pass only their own
// "used" tags, which is what prunes empty branches for them - see
// buildTree above).
export default function TagsDrawer({ tags, activeFilter, onSelectFilter, hideOpenButton }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  // The backdrop+panel live inside a real Modal (a separate Android window,
  // always painted above the whole activity - including the floating
  // island, which sits in an entirely different branch of the component
  // tree from this drawer and so could never be out-stacked by elevation/
  // zIndex alone, no matter how high). Kept mounted a beat after isOpen
  // flips false so the closing animation below gets to finish before the
  // Modal actually unmounts, instead of yanking the drawer away instantly.
  const [isRendered, setIsRendered] = useState(false);
  const blurTarget = useBlurTarget();
  const { width: windowWidth } = useWindowDimensions();
  const drawerWidth = Math.round(windowWidth * DRAWER_FRACTION);
  const [filterMode, setFilterMode] = useState<TagFilterMode>('multi');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // How far open the panel is, 0 (closed) .. drawerWidth (fully open).
  // Kept separate from the backdrop's own dim-in below - the panel itself
  // snaps out quickly (a spring here read as "wobbling like a boat", so a
  // plain eased slide replaces it), while the dimming behind it fades in
  // more gradually, like the background slowly dropping out of focus.
  // (A real blur was tried here too - expo-blur's Android blur view - but
  // the native module bundled in Expo Go didn't match the JS package's
  // version and crashed the app outright, so this stays a plain dim.)
  const openAmount = useSharedValue(0);
  const dimAmount = useSharedValue(0);

  const tree = useMemo(() => buildTree(tags), [tags]);
  const topLevel = useMemo(
    () => Array.from(tree.children.values()).sort((a, b) => a.name.localeCompare(b.name)),
    [tree]
  );
  const selectedTagIds = activeFilter?.type === 'tags' ? new Set(activeFilter.tagIds) : new Set<string>();

  function openDrawer() {
    setIsOpen(true);
    setIsRendered(true);
    openAmount.value = withTiming(drawerWidth, { duration: 260, easing: Easing.out(Easing.cubic) });
    dimAmount.value = withTiming(1, { duration: 520, easing: Easing.out(Easing.quad) });
  }

  function closeDrawer() {
    setIsOpen(false);
    openAmount.value = withTiming(0, { duration: 260, easing: Easing.out(Easing.cubic) });
    dimAmount.value = withTiming(0, { duration: 260, easing: Easing.out(Easing.quad) });
    setTimeout(() => setIsRendered(false), 260);
  }

  function toggleExpand(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function toggleTag(tag: Tag) {
    const next = new Set(selectedTagIds);
    if (next.has(tag.id)) next.delete(tag.id);
    else next.add(tag.id);
    onSelectFilter(next.size === 0 ? null : { type: 'tags', tagIds: Array.from(next), mode: filterMode });
  }

  function toggleUntagged() {
    onSelectFilter(activeFilter?.type === 'untagged' ? null : { type: 'untagged' });
  }

  function selectFilterMode(next: TagFilterMode) {
    setFilterMode(next);
    if (activeFilter?.type === 'tags') {
      onSelectFilter({ type: 'tags', tagIds: activeFilter.tagIds, mode: next });
    }
  }

  const panelStyle = useAnimatedStyle(
    () => ({ transform: [{ translateX: openAmount.value - drawerWidth }] }),
    [drawerWidth]
  );
  const backdropStyle = useAnimatedStyle(() => ({ opacity: dimAmount.value }));

  return (
    <>
      {isRendered && (
      // A layer, not a Modal: a Modal is its own window on Android, and a
      // blur only reaches what is in the window it lives in. The dim below
      // fades in on its own timing (see dimAmount), so it stays an animated
      // view rather than moving into GlassLayer - but it goes through the
      // same portal, for the same reason: a blur drawn inside the target it
      // blurs draws itself.
      <GlassPortal>
      <View style={styles.layer} pointerEvents="box-none">
        <Animated.View style={[styles.backdrop, backdropStyle]} pointerEvents={isOpen ? 'auto' : 'none'}>
          <BlurView
            intensity={45}
            tint="dark"
            blurMethod="dimezisBlurView"
            blurTarget={blurTarget ?? undefined}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <Pressable style={StyleSheet.absoluteFill} onPress={closeDrawer} />
        </Animated.View>

        <Animated.View style={[styles.panel, { width: drawerWidth }, panelStyle]}>
          <Text style={styles.title}>Теги</Text>

          <View style={styles.segmented}>
            <Pressable style={styles.segmentButton} onPress={() => selectFilterMode('multi')}>
              <Text style={[styles.segmentLabel, filterMode === 'multi' && styles.segmentLabelActive]}>Мульти</Text>
            </Pressable>
            <Pressable style={styles.segmentButton} onPress={() => selectFilterMode('isolating')}>
              <Text style={[styles.segmentLabel, filterMode === 'isolating' && styles.segmentLabelActive]}>
                Ізолюючий
              </Text>
            </Pressable>
          </View>

          <Pressable style={styles.untaggedRow} onPress={toggleUntagged}>
            <Ionicons name="pricetag-outline" size={13} color={GLASS_TEXT_FAINT} />
            <Text style={styles.untaggedLabel}>Без тегів</Text>
            <View style={styles.treeCheckSlot}>
              {activeFilter?.type === 'untagged' && <Ionicons name="checkmark" size={14} color={GLASS_TEXT_FAINT} />}
            </View>
          </Pressable>

          <ScrollView style={styles.scroll}>
            {topLevel.map((node) => (
              <TreeRow
                key={node.fullPath}
                node={node}
                depth={0}
                expanded={expanded}
                selectedIds={selectedTagIds}
                onToggleExpand={toggleExpand}
                onToggleTag={toggleTag}
              />
            ))}
          </ScrollView>
        </Animated.View>
      </View>
      </GlassPortal>
      )}

      {!isOpen && !hideOpenButton && (
        <Pressable style={styles.openButton} onPress={openDrawer}>
          <Text style={styles.openButtonHash}>#</Text>
        </Pressable>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(17,24,39,0.35)',
  },
  // The layer the drawer lives in, in place of the window it used to have.
  layer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 60,
  },
  panel: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: GLASS_BODY_BLURRED,
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 20,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 4, height: 0 },
    elevation: 8,
  },
  title: {
    fontSize: 19,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: GLASS_TEXT,
    marginBottom: 12,
  },
  segmented: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  // Same height as a tag pill, wide enough for "Ізолюючий" - always a
  // black-bordered white capsule; only the label's color (below) says
  // which one is active.
  segmentButton: {
    paddingVertical: 7,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GLASS_BODY,
    borderWidth: 1.5,
    borderColor: GLASS_TEXT,
    borderRadius: 999,
  },
  segmentLabel: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
    color: GLASS_TEXT_FAINT,
  },
  segmentLabelActive: {
    color: GLASS_TEXT,
  },
  // White capsule, border always in its own color (gray for "Без тегів" -
  // it has none of its own) - not just when active. Selection shows as the
  // checkmark in the reserved slot, not a shape/color change, so picking a
  // tag never resizes its pill.
  untaggedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    backgroundColor: GLASS_BODY,
    borderWidth: 1.5,
    borderColor: GLASS_TEXT_FAINT,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 12,
    marginBottom: 6,
    maxWidth: '100%',
  },
  untaggedLabel: {
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT_FAINT,
    flexShrink: 1,
  },
  scroll: {
    flex: 1,
  },
  treeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    backgroundColor: GLASS_BODY,
    borderWidth: 1.5,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 12,
    marginBottom: 6,
    maxWidth: '100%',
  },
  // Fixed-width slot for the checkmark, always rendered - see TreeRow.
  treeCheckSlot: {
    width: 14,
    alignItems: 'center',
  },
  treeLabel: {
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    flexShrink: 1,
  },
  openButton: {
    position: 'absolute',
    // Same size and bottom offset as the island, standing on its own to
    // its left (see the videobookmark reference) - a plain tap, no more
    // drag: dragging from the screen's edge was exactly where Android's
    // own edge-back gesture kept stealing the touch stream mid-swipe.
    left: 20,
    bottom: 24,
    width: OPEN_BUTTON_SIZE,
    height: OPEN_BUTTON_SIZE,
    borderRadius: 16,
    backgroundColor: GLASS_BODY,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  openButtonHash: {
    fontSize: 26,
    fontWeight: '700',
    fontFamily: FONT_EXTRABOLD,
    color: GLASS_TEXT,
  },
});
