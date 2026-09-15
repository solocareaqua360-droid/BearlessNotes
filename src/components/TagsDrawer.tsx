import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation';
import { auth } from '../firebase';
import { onAuthStateChanged } from '@react-native-firebase/auth';
import { hapticButtonDown } from '../utils/haptics';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Gesture } from 'react-native-gesture-handler';
import { Tag } from '../types';
import type { ListMode } from '../hooks/useDatabaseList';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { RAIL_RIGHT } from '../constants/rail';
import { GLASS_ISLAND } from '../constants/glass';
import {
  GLASS_BODY,
  GLASS_BODY_BLURRED,
  GLASS_CARD,
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
// The drawer is opened by a swipe now - to the right, from anywhere on
// the screen's list but its very edge - and the folder button is gone:
// the user's words, there are too many buttons already, and swipes have
// taken. The screen wraps its list in a detector with this gesture and
// asks the drawer to open through its handle.
//
// Rightward only, and only after real travel, so a scroll (vertical -
// fails on Y) and the tab swipe to the next screen (leftward - fails on
// negative X) are never taken. The left edge is left alone: that is the
// system's own "back".
export type TagsDrawerHandle = { open: () => void };

// How much of the screen's height, in the middle, the drawer's swipe
// answers to. The user's problem: the same rightward drag both turned the
// page to the calendar and opened the drawer, and which one you got was a
// coin toss. Their own fix - "шторку повісити на жест... тільки
// посередині якби, екрану" - so the drag has a place: the middle third
// opens the drawer, everywhere else the tabs turn.
const DRAWER_BAND = 0.3;

export function useDrawerSwipe(open: () => void) {
  const { height } = useWindowDimensions();
  const bandTop = height * (0.5 - DRAWER_BAND / 2);
  const bandBottom = height * (0.5 + DRAWER_BAND / 2);
  // Where the finger went down, since a manually-activated pan is told
  // about touches rather than translations.
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  return useMemo(
    () =>
      Gesture.Pan()
        // Manual, and that is the whole point. The old gesture ACTIVATED
        // on any rightward drag and then decided what to do; activating is
        // what takes the swipe away from the pager, so a drag outside the
        // band was eaten either way. This one fails before it activates,
        // and a failed gesture leaves the swipe to the tabs.
        .manualActivation(true)
        .onTouchesDown((e, state) => {
          const touch = e.allTouches[0];
          if (!touch) {
            state.fail();
            return;
          }
          startX.value = touch.absoluteX;
          startY.value = touch.absoluteY;
          if (touch.absoluteY < bandTop || touch.absoluteY > bandBottom) state.fail();
        })
        .onTouchesMove((e, state) => {
          const touch = e.allTouches[0];
          if (!touch) return;
          const dx = touch.absoluteX - startX.value;
          const dy = touch.absoluteY - startY.value;
          // Up or down is the list scrolling; leftward is the other tab.
          if (Math.abs(dy) > 18 || dx < -12) {
            state.fail();
            return;
          }
          if (dx > 28) state.activate();
        })
        .onEnd((e) => {
          if (e.translationX > 60 || e.velocityX > 500) runOnJS(open)();
        }),
    [open, bandTop, bandBottom, startX, startY]
  );
}

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
// What a row's number says. A folder with a tag of its own counts the
// items carrying that tag; a branch that is only a path segment has no
// tag to count, so it stands for everything under it.
function countFor(node: TreeNode, counts: Record<string, number>): number {
  if (node.tag) return counts[node.tag.id] ?? 0;
  let total = 0;
  for (const child of node.children.values()) total += countFor(child, counts);
  return total;
}

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
  counts,
  onToggleExpand,
  onToggleTag,
}: {
  node: TreeNode;
  depth: number;
  guides: boolean[];
  isLast: boolean;
  expanded: Set<string>;
  selectedIds: Set<string>;
  counts: Record<string, number>;
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
        <Text style={styles.rowCount}>{countFor(node, counts)}</Text>
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
            counts={counts}
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
  // The height of the calling screen's capsule, when it isn't the usual
  // two-button one. The folder button is spaced against what is above it,
  // and this component places it - so a screen with a taller capsule has
  // to say so here as well, or the button lands where the capsule is.
  // Groups, when the calling screen has them: a section of its own at the
  // head of the drawer, over a rule, above the smart folders. A screen
  // that passes nothing here simply has no such section, and the long
  // press that shows and hides its row does nothing.
  // How many documents sit behind each folder and each group. The calling
  // screen counts them - it is the one that knows what it is listing.
  counts?: { byTag: Record<string, number>; untagged: number };
  // «Провідник» - the folders shown inside the calling screen's own list,
  // entered one at a time, the way a file manager shows them. Offered by
  // the screens that can draw them that way (documents); the others pass
  // nothing and show no switch.
  // How the calling screen's list is organised - one of three, chosen
  // here at the top of the drawer. Given only by the screen that has
  // three ways (documents); the others show no switch and the drawer is
  // as it always was for them.
  mode?: { value: ListMode; onChange: (mode: ListMode) => void };
  // The stickers, for the screen that has them: a row at the foot, in
  // every mode - they used to be a tab in the group strip, which only
  // the group mode shows now.
  stickers?: { count: number; active: boolean; onToggle: () => void };
  // The bin, for the screens whose items go there instead of away
  // (documents): a row at the foot of the tree, with how many it holds.
  trash?: { count: number; onOpen: () => void };
  groupSection?: {
    items: { id: string | null; name: string; color: string; count: number }[];
    selected: string | null;
    onSelect: (id: string | null) => void;
    // The older on/off of the group row, for the screens that still have
    // it as a switch of its own (the documents screen chooses a mode
    // instead).
    rowVisible?: boolean;
    onToggleRow?: () => void;
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
function TagsDrawerInner({
  tags,
  activeFilter,
  onSelectFilter,
  counts,
  mode,
  stickers,
  trash,
  groupSection,
}: Props, ref: React.Ref<TagsDrawerHandle>) {
  const showGroups = !mode || mode.value === 'groups';
  const showTree = !mode || mode.value !== 'groups';
  const showFilterMode = !mode || mode.value === 'list';
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
  const { width: windowWidth } = useWindowDimensions();
  const drawerWidth = Math.round(windowWidth * DRAWER_FRACTION);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [filterMode, setFilterMode] = useState<TagFilterMode>('multi');
  // Who everything belongs to, live - the row at the foot of the drawer
  // is the way to the account, the app's version and its updates now that
  // the island is going away, so it must never show a stale address.
  const [accountEmail, setAccountEmail] = useState<string | null>(auth.currentUser?.email ?? null);
  useEffect(() => onAuthStateChanged(auth, (user) => setAccountEmail(user?.email ?? null)), []);
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

  // Anything opened from the drawer closes it first, so the screen it
  // opens isn't pushed under a panel that is still standing.
  function openFromDrawer(go: () => void) {
    closeDrawer();
    go();
  }

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

  useImperativeHandle(ref, () => ({ open: openDrawer }));

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

          {mode && (
            <View style={styles.segmented}>
              {(
                [
                  { value: 'groups', label: 'Групи', icon: 'albums-outline' },
                  { value: 'list', label: 'Список', icon: 'list-outline' },
                  { value: 'explorer', label: 'Провідник', icon: 'folder-open-outline' },
                ] as { value: ListMode; label: string; icon: keyof typeof Ionicons.glyphMap }[]
              ).map((option) => {
                const active = mode.value === option.value;
                return (
                  <Pressable
                    key={option.value}
                    style={[styles.segmentButton, active && styles.segmentButtonActive]}
                    onPress={() => mode.onChange(option.value)}
                  >
                    <Ionicons name={option.icon} size={16} color={active ? GLASS_TEXT : GLASS_TEXT_MUTED} />
                    <Text style={[styles.segmentLabel, styles.modeLabel, active && styles.segmentLabelActive]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          {showFilterMode && (
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
          )}

          <ScrollView style={styles.scroll}>
            {groupSection && showGroups && (
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
                        <Text style={styles.rowCount}>{item.count}</Text>
                        <View style={styles.treeCheckSlot}>
                          {active && <Ionicons name="checkmark-outline" size={17} color={item.color} />}
                        </View>
                      </Pressable>
                    );
                  })}
                <View style={styles.sectionRule} />
              </>
            )}

            {showTree && (
            <>
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
                <Text style={styles.rowCount}>{counts?.untagged ?? 0}</Text>
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
                  counts={counts?.byTag ?? {}}
                  onToggleExpand={toggleExpand}
                  onToggleTag={toggleTag}
                />
              ))}
            </>
            )}
            {stickers && (
              <Pressable
                style={[styles.treeRow, styles.trashRow, stickers.active && styles.treeRowSelected]}
                onPress={stickers.onToggle}
              >
                {stickers.active && <View style={[styles.treeRowMark, { backgroundColor: '#F5C77E' }]} />}
                <View style={{ width: 17 }} />
                <Ionicons name="reader-outline" size={19} color="#F5C77E" />
                <Text style={styles.untaggedLabel}>Стікери</Text>
                <Text style={styles.rowCount}>{stickers.count}</Text>
                <View style={styles.treeCheckSlot}>
                  {stickers.active && <Ionicons name="checkmark-outline" size={17} color="#F5C77E" />}
                </View>
              </Pressable>
            )}
            {trash && (
              <Pressable style={[styles.treeRow, styles.trashRow, !stickers && undefined]} onPress={trash.onOpen}>
                <View style={{ width: 17 }} />
                <Ionicons name="trash-outline" size={19} color={GLASS_TEXT_MUTED} />
                <Text style={styles.untaggedLabel}>Кошик</Text>
                <Text style={styles.rowCount}>{trash.count}</Text>
                <View style={styles.treeCheckSlot} />
              </Pressable>
            )}
          </ScrollView>

          {/* Pinned to the foot of the panel, the way a profile sits at the
              bottom of a sidebar: the account everything belongs to, and
              behind it the app's version and its updates. This is the one
              way into settings once the island is gone, so it stays put
              while the lists above it scroll. */}
          <Pressable
            style={styles.accountRow}
            onPress={() => openFromDrawer(() => navigation.navigate('Settings'))}
          >
            <View style={styles.accountAvatar}>
              <Text style={styles.accountInitial}>
                {(accountEmail ?? '?').slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <View style={styles.accountText}>
              <Text style={styles.accountLabel} numberOfLines={1}>
                {accountEmail ?? 'Увійти через Google'}
              </Text>
              <Text style={styles.accountHint} numberOfLines={1}>
                Акаунт, версія, оновлення
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={GLASS_TEXT_FAINT} />
          </Pressable>
        </Animated.View>
      </View>
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
    borderTopRightRadius: 24,
    borderBottomRightRadius: 24,
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
  // The «Провідник» switch: a row in the tree's own shape, with a small
  // toggle at its end - the folders move into the list while it is on.
  explorerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    marginBottom: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  explorerRowOn: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderColor: 'rgba(255,255,255,0.2)',
  },
  explorerLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
    color: GLASS_TEXT_MUTED,
  },
  explorerLabelOn: {
    color: GLASS_TEXT,
  },
  explorerKnob: {
    width: 36,
    height: 20,
    borderRadius: 10,
    padding: 2,
    backgroundColor: 'rgba(255,255,255,0.14)',
    justifyContent: 'center',
  },
  explorerKnobOn: {
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  explorerDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  explorerDotOn: {
    backgroundColor: '#fff',
    alignSelf: 'flex-end',
  },
  segmented: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 14,
    padding: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
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
  // The three-way mode: an icon over a short word, because three words
  // in one row do not fit a phone.
  modeLabel: {
    fontSize: 12,
    marginTop: 3,
  },
  // White capsule, border always in its own color (gray for "Без тегів" -
  // it has none of its own) - not just when active. Selection shows as the
  // checkmark in the reserved slot, not a shape/color change, so picking a
  // tag never resizes its pill.
  // It takes the tree row's shape; only the breathing room under it is
  // its own, to set it apart from the tree proper.
  // The bin: one of the tree's rows, set a little apart at the foot.
  trashRow: {
    flexGrow: 0,
    marginTop: 14,
  },
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
    fontFamily: FONT_BOLD,
    letterSpacing: 0.06,
    textTransform: 'uppercase',
    color: GLASS_TEXT_FAINT,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: GLASS_CARD,
  },
  accountAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  accountInitial: {
    fontSize: 13,
    fontFamily: FONT_BOLD,
    color: GLASS_TEXT,
  },
  accountText: {
    flex: 1,
  },
  accountLabel: {
    fontSize: 13,
    fontFamily: FONT_SEMIBOLD,
    color: GLASS_TEXT,
  },
  accountHint: {
    fontSize: 11,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT_MUTED,
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
    borderRadius: 999,
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
  // Right up against the checkmark slot, quiet enough to read as a count
  // rather than as part of the name.
  rowCount: {
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT_FAINT,
    marginLeft: 4,
  },
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

// forwardRef, so the screen can open the drawer from its swipe - see
// useDrawerSwipe.
const TagsDrawer = forwardRef(TagsDrawerInner);
export default TagsDrawer;
