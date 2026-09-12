import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { hapticButtonDown } from '../utils/haptics';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Tag } from '../types';
import { FONT_REGULAR, FONT_SEMIBOLD, FONT_BOLD } from '../utils/fonts';
import { RAIL_RIGHT } from '../constants/rail';
import { GLASS_ISLAND } from '../constants/glass';
import { useRail } from '../hooks/useRail';
import {
  GLASS_BODY,
  GLASS_BODY_BLURRED,
  GLASS_LINE,
  GLASS_TEXT,
  GLASS_TEXT_FAINT,
  GLASS_TEXT_MUTED,
} from '../constants/glass';
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

// One line of the tree, drawn the way Explorer's side pane draws one: a
// gutter cell per level of nesting, each either blank or carrying the
// vertical line of an ancestor that still has folders below it, and an
// elbow in the row's own cell - a corner if this is the last child of its
// parent, a tee if more follow. The lines are what makes the nesting
// legible; indentation alone left it to be inferred.
//
// `guides` is one flag per cell, computed by the parent: cells before the
// row's own carry a line when that ancestor has siblings still to come.
// The head of a section, and the handle that folds it away. Same shape as
// a row in it, one notch quieter.
function SectionHeader({
  label,
  collapsed,
  onPress,
}: {
  label: string;
  collapsed: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.sectionHeader} onPress={onPress}>
      <Ionicons
        name={collapsed ? 'chevron-forward' : 'chevron-down'}
        size={15}
        color={GLASS_TEXT_FAINT}
      />
      <Text style={styles.sectionLabel}>{label}</Text>
    </Pressable>
  );
}

function TreeRow({
  node,
  depth,
  guides,
  isLast,
  expanded,
  selectedIds,
  onToggleExpand,
  onToggleTag,
}: {
  node: TreeNode;
  depth: number;
  guides: boolean[];
  isLast: boolean;
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

  // What the children draw in their own gutters: everything this row had,
  // then a line in this row's own cell if - and only if - the branch
  // carries on under it.
  const childGuides = [...guides.slice(0, Math.max(0, depth - 1)), !isLast, false];

  return (
    <View>
      <View style={styles.treeLine}>
        {Array.from({ length: depth }).map((_, i) =>
          i === depth - 1 ? (
            // This row's own cell: the elbow. Its stem stops at the label's
            // middle when nothing follows, and runs the whole way down when
            // something does.
            <View key={i} style={styles.guideCell}>
              <View style={[styles.guideStem, !isLast && styles.guideStemFull]} />
              <View style={styles.guideArm} />
            </View>
          ) : (
            <View key={i} style={styles.guideCell}>
              {guides[i] && <View style={styles.guidePipe} />}
            </View>
          )
        )}
      <Pressable
        style={[styles.treeRow, isSelected && styles.treeRowSelected]}
        onPress={() => (node.tag ? onToggleTag(node.tag) : onToggleExpand(node.fullPath))}
      >
        {/* The bar Explorer puts against a selected row, in this folder's
            own colour - the one place the colour still shows now that the
            rows aren't coloured capsules. */}
        {isSelected && <View style={[styles.treeRowMark, { backgroundColor: tint }]} />}
        {hasChildren ? (
          <Pressable hitSlop={8} onPress={() => onToggleExpand(node.fullPath)}>
            <Ionicons
              name={isExpanded ? 'chevron-down' : 'chevron-forward'}
              size={17}
              color={GLASS_TEXT_MUTED}
            />
          </Pressable>
        ) : (
          <View style={{ width: 17 }} />
        )}
        <Ionicons
          name={(node.tag ? node.tag.icon : 'folder-outline') as keyof typeof Ionicons.glyphMap}
          size={19}
          color={tint}
        />
        <Text
          style={[styles.treeLabel, { color: node.tag ? GLASS_TEXT : GLASS_TEXT_MUTED }]}
          numberOfLines={1}
        >
          {node.name}
        </Text>
        {/* Reserved always, populated only when selected - so picking a
            folder doesn't shift the label. */}
        <View style={styles.treeCheckSlot}>
          {isSelected && node.tag && <Ionicons name="checkmark-outline" size={17} color={tint} />}
        </View>
      </Pressable>
      </View>
      {hasChildren &&
        isExpanded &&
        children.map((child, i) => (
          <TreeRow
            key={child.fullPath}
            node={child}
            depth={depth + 1}
            guides={childGuides}
            isLast={i === children.length - 1}
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
  // Groups, when the calling screen has them: a section of its own at the
  // head of the drawer, over a rule, above the smart folders. A screen
  // that passes nothing here simply has no such section, and the long
  // press that shows and hides its row does nothing.
  groupSection?: {
    items: { id: string | null; name: string; color: string }[];
    selected: string | null;
    onSelect: (id: string | null) => void;
    rowVisible: boolean;
    onToggleRow: () => void;
  };
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
export default function TagsDrawer({
  tags,
  activeFilter,
  onSelectFilter,
  hideOpenButton,
  groupSection,
}: Props) {
  // Bottom tabs stay mounted when another tab is on screen (React
  // Navigation doesn't unmount them), and this drawer's own floating
  // pieces are drawn through a portal that reaches over the WHOLE app -
  // so without this, the tag row and the "#" button from a screen the
  // user has merely visited once kept floating over whichever tab they
  // actually navigated to next.
  const isFocused = useIsFocused();
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
  const rail = useRail();
  const { width: windowWidth } = useWindowDimensions();
  const drawerWidth = Math.round(windowWidth * DRAWER_FRACTION);
  const [filterMode, setFilterMode] = useState<TagFilterMode>('multi');
  const [groupsCollapsed, setGroupsCollapsed] = useState(false);
  const [foldersCollapsed, setFoldersCollapsed] = useState(false);
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
        {/* A plain dim, no blur: the screen beside the drawer should stay
            readable - only what is BEHIND the drawer is frosted. */}
        <Animated.View style={[styles.backdrop, backdropStyle]} pointerEvents={isOpen ? 'auto' : 'none'}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeDrawer} />
        </Animated.View>

        <Animated.View style={[styles.panel, { width: drawerWidth }, panelStyle]}>
          {/* The frost, clipped to the panel by its overflow. Under its own
              tint, which is why the panel itself carries no background:
              a child paints over its parent's fill, so the colour has to
              be a layer of its own on top of the blur. */}
          <BlurView
            intensity={60}
            tint="dark"
            blurMethod="dimezisBlurView"
            blurTarget={blurTarget ?? undefined}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <View style={[StyleSheet.absoluteFill, styles.panelTint]} pointerEvents="none" />
          <Text style={styles.title}>Теги</Text>

          <View style={styles.segmented}>
            <Pressable
              style={[styles.segmentButton, filterMode === 'multi' && styles.segmentButtonActive]}
              onPress={() => selectFilterMode('multi')}
            >
              <Text style={[styles.segmentLabel, filterMode === 'multi' && styles.segmentLabelActive]}>Мульти</Text>
            </Pressable>
            <Pressable
              style={[styles.segmentButton, filterMode === 'isolating' && styles.segmentButtonActive]}
              onPress={() => selectFilterMode('isolating')}
            >
              <Text style={[styles.segmentLabel, filterMode === 'isolating' && styles.segmentLabelActive]}>
                Ізолюючий
              </Text>
            </Pressable>
          </View>

          <ScrollView style={styles.scroll}>
            {groupSection && (
              <>
                <SectionHeader
                  label="Групи"
                  collapsed={groupsCollapsed}
                  onPress={() => setGroupsCollapsed((v) => !v)}
                />
                {!groupsCollapsed &&
                  groupSection.items.map((item) => {
                    const active = groupSection.selected === item.id;
                    return (
                      <Pressable
                        key={item.id ?? '__all__'}
                        style={[styles.treeRow, active && styles.treeRowSelected]}
                        onPress={() => groupSection.onSelect(item.id)}
                      >
                        {active && <View style={[styles.treeRowMark, { backgroundColor: item.color }]} />}
                        <View style={{ width: 17 }} />
                        <Ionicons name="albums-outline" size={19} color={item.color} />
                        <Text style={[styles.treeLabel, { color: GLASS_TEXT }]} numberOfLines={1}>
                          {item.name}
                        </Text>
                        <View style={styles.treeCheckSlot}>
                          {active && <Ionicons name="checkmark-outline" size={17} color={item.color} />}
                        </View>
                      </Pressable>
                    );
                  })}
                <View style={styles.sectionRule} />
              </>
            )}

            <SectionHeader
              label="Смартпапки"
              collapsed={foldersCollapsed}
              onPress={() => setFoldersCollapsed((v) => !v)}
            />
            {!foldersCollapsed && (
              // Drawn as one of the tree's own rows - it stands at the head
              // of the same list and reads as one of them.
              <Pressable
                style={[
                  styles.treeRow,
                  styles.untaggedRow,
                  activeFilter?.type === 'untagged' && styles.treeRowSelected,
                ]}
                onPress={toggleUntagged}
              >
                {activeFilter?.type === 'untagged' && (
                  <View style={[styles.treeRowMark, { backgroundColor: GLASS_TEXT_MUTED }]} />
                )}
                <View style={{ width: 17 }} />
                <Ionicons name="pricetag-outline" size={19} color={GLASS_TEXT_MUTED} />
                <Text style={styles.untaggedLabel}>Без тегів</Text>
                <View style={styles.treeCheckSlot}>
                  {activeFilter?.type === 'untagged' && (
                    <Ionicons name="checkmark-outline" size={17} color={GLASS_TEXT_MUTED} />
                  )}
                </View>
              </Pressable>
            )}
            {!foldersCollapsed &&
              topLevel.map((node, i) => (
                <TreeRow
                  key={node.fullPath}
                  node={node}
                  depth={0}
                  guides={[]}
                  isLast={i === topLevel.length - 1}
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

      {isFocused && !isOpen && !hideOpenButton && (
        // Through the portal like the rest of the rail - the blur that
        // fills it cannot live inside the view it blurs.
        <GlassPortal>
          <Pressable
            style={[styles.openButton, { bottom: rail.tagBottom }]}
            onPress={openDrawer}
            // Held down, it shows and hides the group tabs at the head of
            // the screen instead of opening the drawer - they live here
            // now, and the row up there is a convenience you can put away.
            onLongPress={
              groupSection
                ? () => {
                    hapticButtonDown();
                    groupSection.onToggleRow();
                  }
                : undefined
            }
            delayLongPress={400}
          >
            <BlurView
              intensity={60}
              tint="dark"
              blurMethod="dimezisBlurView"
              blurTarget={blurTarget ?? undefined}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
            <Ionicons name="folder-outline" size={28} color={GLASS_TEXT} />
          </Pressable>
        </GlassPortal>
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
    // No elevation and no shadow: on Android elevation paints a black
    // halo right round the view, which is the dark outline that was
    // running down the drawer's whole perimeter. A hairline on the edge
    // it actually has - the one facing the screen - does the job.
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.18)',
    // The blur inside is clipped to this.
    overflow: 'hidden',
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  panelTint: {
    backgroundColor: GLASS_BODY_BLURRED,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: GLASS_TEXT,
    marginBottom: 12,
  },
  // A track with the chosen half lifted out of it - the same soft panel a
  // selected row gets, rather than two bordered capsules with only their
  // labels telling them apart.
  segmented: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 14,
    padding: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  segmentButtonActive: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderColor: 'rgba(255,255,255,0.2)',
  },
  segmentLabel: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
    color: GLASS_TEXT_MUTED,
  },
  segmentLabelActive: {
    color: GLASS_TEXT,
  },
  // White capsule, border always in its own color (gray for "Без тегів" -
  // it has none of its own) - not just when active. Selection shows as the
  // checkmark in the reserved slot, not a shape/color change, so picking a
  // tag never resizes its pill.
  // It takes the tree row's shape; only the breathing room under it is
  // its own, to set it apart from the tree proper.
  untaggedRow: {
    flexGrow: 0,
    marginBottom: 8,
  },
  untaggedLabel: {
    flex: 1,
    fontSize: 16,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT_MUTED,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 6,
    paddingTop: 2,
    paddingBottom: 6,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.06,
    textTransform: 'uppercase',
    color: GLASS_TEXT_FAINT,
  },
  sectionRule: {
    height: 1,
    backgroundColor: GLASS_LINE,
    marginTop: 8,
    marginBottom: 10,
  },
  scroll: {
    flex: 1,
  },
  // A row and its gutters. alignItems stretch, so a gutter's line runs the
  // full height of the row it belongs to and meets the one above it.
  treeLine: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  guideCell: {
    width: 22,
  },
  // A line through the whole cell: an ancestor whose branch carries on
  // below this row.
  guidePipe: {
    position: 'absolute',
    left: 10,
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: GLASS_LINE,
  },
  // The elbow: down to the row's middle...
  guideStem: {
    position: 'absolute',
    left: 10,
    top: 0,
    height: '50%',
    width: 1,
    backgroundColor: GLASS_LINE,
  },
  // ...and on down, when this isn't the last child.
  guideStemFull: {
    bottom: 0,
    height: undefined,
  },
  // ...then across, to meet the row.
  guideArm: {
    position: 'absolute',
    left: 10,
    right: 0,
    top: '50%',
    height: 1,
    backgroundColor: GLASS_LINE,
  },
  // A plain line, not a capsule: only the selected row is drawn, and it is
  // drawn the way Explorer draws one - a soft rounded panel running the
  // rest of the width, rather than a pill hugging its own text.
  treeRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingVertical: 8,
    paddingLeft: 10,
    paddingRight: 8,
    marginBottom: 2,
  },
  treeRowSelected: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderColor: 'rgba(255,255,255,0.2)',
  },
  treeRowMark: {
    position: 'absolute',
    left: 3,
    top: 7,
    bottom: 7,
    width: 3,
    borderRadius: 999,
  },
  // Fixed-width slot for the checkmark, always rendered - see TreeRow.
  treeCheckSlot: {
    width: 17,
    alignItems: 'center',
  },
  treeLabel: {
    fontSize: 16,
    fontFamily: FONT_REGULAR,
    flexShrink: 1,
  },
  // The square the halo is drawn on - twice the button across and centred
  // on it, because the button's own box would clip the light.
  openButton: {
    // On the rail at the right edge, above the add button and under the
    // control capsule - a plain tap, no drag: dragging from the screen's
    // edge was exactly where Android's own edge-back gesture kept
    // stealing the touch stream mid-swipe.
    position: 'absolute',
    right: RAIL_RIGHT,
    width: OPEN_BUTTON_SIZE,
    height: OPEN_BUTTON_SIZE,
    borderRadius: 999,
    // Glass, like everything else on the rail: the blur separates it from
    // the cards under it, so the fill only tints.
    overflow: 'hidden',
    backgroundColor: GLASS_ISLAND,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
  },
});
