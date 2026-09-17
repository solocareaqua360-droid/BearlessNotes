import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTheme, useStyles } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useDockLeave } from '../navigation/navDock';
import { useIsFocused } from '@react-navigation/native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import Animated, { FadeInDown, SharedValue } from 'react-native-reanimated';
import { DatabaseList } from '../hooks/useDatabaseList';
import { GlassPortal } from './GlassPortal';
import Menu from './surfaces/Menu';
import { useBlurTarget } from './GlassTarget';
import ContentColumn from './ContentColumn';
import SearchField, { searchFieldSides } from './SearchField';
import GlassDrop, { GlassIcon } from './GlassDrop';
import ProjectTabsRow from './ProjectTabsRow';
import { FIELD_ICONS, FIELD_LABELS, FIELD_ORDER } from './SortMenuRows';
import RailCapsule from './RailCapsule';
import { useDockActions, useDockBeads, useDockShowContext } from '../navigation/navDock';
import { NAV_BOTTOM, NAV_BUTTON as DOCK_BUTTON, NAV_PADDING as DOCK_PADDING } from '../constants/rail';
// What a menu has to clear to stand above the dock rather than under it.
const DOCK_CLEAR = NAV_BOTTOM + DOCK_BUTTON + DOCK_PADDING * 2 + 12;
import ScreenBackdrop from './ScreenBackdrop';
import TagsDrawer, { TagsDrawerHandle, removeTagFromFilter, useDrawerSwipe } from './TagsDrawer';
import BulkActionBar from './BulkActionBar';
import { useRail, useRailFree } from '../hooks/useRail';
import { useResponsiveLayout } from '../hooks/useResponsiveLayout';
import { pullHaptic, useKeyboardVisible, usePullToSearch, useSearchDismissal } from '../hooks/usePullToSearch';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { CAPSULE_DROP, CAPSULE_HEIGHT, CAPSULE_HEIGHT_1, CAPSULE_HEIGHT_3, CHROME_TOP, RAIL_CLEARANCE, RAIL_RIGHT, RAIL_WIDTH, capsuleHeightFor, railFits } from '../constants/rail';

// Everything a database screen puts AROUND its records: the gradient it
// stands on, the capsule on the rail (search / "..." / the way out), the
// menu that hangs off it, the group tabs floating over the cards, the tag
// chips a filter leaves behind, the in-screen search, the drawer, the "+"
// and the bulk bar. Six screens carried their own copy; this is the one.
//
// The records themselves are the caller's: `children` is given the line
// the first card should rest on (the floating chrome's own foot) and
// draws whatever that database looks like.

export type DatabaseChromeProps<T extends { id: string }> = {
  list: DatabaseList<T>;
  accent: string;
  // The "+" button's fill - the accent at half strength, since the blur
  // behind it is what separates it from the screen.
  accentGlass: string;
  // Absent on a tab's own root, which has nowhere to go back TO.
  //
  // It is no longer a button up here: it is published to the dock, at
  // the foot of the screen, where the hand already is. The user's own
  // ask - standing in a database's root there was nothing under the
  // thumb at all, and the way back to the databases was the small arrow
  // in the top-right corner.
  onBack?: () => void;
  // What the dock's bead shows while it is offering that way out - the
  // thing this database holds, so the way out says what it is leaving.
  leaveIcon?: keyof typeof Ionicons.glyphMap;
  // A tab's root also keeps the navigation island at its foot, so the
  // rail must leave room for it; a PUSHED screen has none.
  hasIsland?: boolean;
  // Drawn inside another screen's LEFT pane: the rail stands on the
  // window's outer edge, which is the left one there, rather than against
  // the divider in the middle of the screen.
  railSide?: 'left' | 'right';
  searchPlaceholder: string;
  // Rows of this database's own, above the sort rows in the "..." menu
  // (the view-mode switch, for the databases that have one).
  menuRows?: (close: () => void) => ReactNode;
  // Absent on a database whose records cannot be made from scratch -
  // photos, files and links only ever arrive from inside a document, and
  // a "+" that cannot do anything is worse than no "+".
  onAdd?: () => void;
  // What the "+" makes, for the create capsule the explorer turns it into
  // - the plus is drawn ON the thing it adds there, as it is on the
  // documents screen.
  addIcon?: keyof typeof Ionicons.glyphMap;
  // The shape of the list, where this database has two of them. It was
  // the "Вигляд" pair of rows inside the "..." menu on three screens, all
  // spelling out the same thing; on the rail its icon IS the shape in
  // force, and with only two to choose from a tap simply swaps them -
  // a list to pick from would be a list of two.
  // The icon is the shape IN FORCE, which is how every other icon on the
  // rail reads; the caller names it, because "the other one" is a grid on
  // three of these screens and a tile on another.
  shape?: { icon: keyof typeof Ionicons.glyphMap; onToggle: () => void };
  // A database with folders: the three-way switch in the drawer, a second
  // button on the create capsule for a new folder, and back/forward
  // through the folders you have been in - in a capsule of their own,
  // where the documents screen keeps them.
  explorer?: {
    mode: 'groups' | 'list' | 'explorer';
    onChangeMode: (mode: 'groups' | 'list' | 'explorer') => void;
    active: boolean;
    onNewFolder: () => void;
    onBack: () => void;
    onForward: () => void;
    canBack: boolean;
    canForward: boolean;
  };
  // A database with neither tags nor groups has nothing to browse in the
  // drawer, and a folder button that opens an empty panel is worse than
  // none (stickers).
  hideDrawer?: boolean;
  // Selecting exists to act on what was selected, so the "Вибрати" row
  // appears only where there are bulk actions to reach.
  bulk?: {
    onTag: () => void;
    onGroup: () => void;
    onCopy?: () => void;
    onCopyObject?: () => void;
    onDelete: () => void;
  };
  // The list itself. It is handed the line the first card rests on, and
  // the props that let the pull-down-for-search gesture watch it (spread
  // them onto the ScrollView or FlatList).
  // `listWidth` is the width the rows actually have: this column, less the
  // clearance it keeps from the rail and the margin each row carries. A
  // grid cell sized as a PERCENTAGE of that cannot line up with anything,
  // because the gaps between cells are pixels - and in a half-width pane
  // the two disagree enough to deform the cards. Every grid works this
  // number out in pixels instead.
  children: (
    listTopPad: number,
    listProps: ReturnType<typeof usePullToSearch>['listProps'],
    listWidth: number,
    // The list's own live scroll offset - a screen that carries a card
    // (see useCardCarry) needs it to scroll programmatically by a second
    // finger's movement rather than the user's own touch.
    scrollY: SharedValue<number>
  ) => ReactNode;
  // Anything that must reach the whole window rather than the content
  // column: toasts, viewers, the sheets a database opens. Drawn outside
  // the column, the way the drawer is.
  overlay?: ReactNode;
  // On a screen wide enough for two columns, something that stands beside
  // the list - the left half, the way an open document does on the
  // documents screen. The list keeps the right half, against its rail.
  // Ignored on a phone; the caller shows the same thing as an overlay
  // there.
  pane?: ReactNode;
};

export default function DatabaseChrome<T extends { id: string }>({
  list,
  accent,
  accentGlass,
  onBack,
  leaveIcon,
  hasIsland,
  railSide = 'right',
  searchPlaceholder,
  menuRows,
  onAdd,
  addIcon,
  shape,
  explorer,
  hideDrawer,
  bulk,
  children,
  overlay,
  pane,
}: DatabaseChromeProps<T>) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const drawerRef = useRef<TagsDrawerHandle>(null);
  const drawerSwipe = useDrawerSwipe(useCallback(() => drawerRef.current?.open(), []));
  const { isTwoPane } = useResponsiveLayout();
  // The rail on the left is the sign that this chrome stands in another
  // screen's pane - and a pane is never split again, whatever the window
  // is: the list would get half of a half.
  const splitting = isTwoPane && !!pane && railSide !== 'left';
  // Where the list's own column starts, so the floating tabs begin at its
  // edge rather than at the window's - they span the window, so that a
  // long row can still be scrolled across the whole display.
  const [listPaneX, setListPaneX] = useState(0);
  // The column the rows stand in - measured, because in a pane it is not
  // the window.
  const [columnWidth, setColumnWidth] = useState(0);
  const blurTarget = useBlurTarget();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  // The top capsule is three buttons now: search, "...", and the way out.
  // Ordering left it for the actions capsule, where the same button sits
  // on a custom database - what a screen can DO to its list belongs
  // together, and a four-button capsule at the top of the rail was the
  // tallest thing on the screen.
  //
  // Every screen this chrome dresses - files, photos, links, stickers -
  // is PUSHED over the tabs, so the navigation island is not on it and
  // the rail must not hold its height at the foot (see useRail). Nor the
  // create button's, on the three databases that have no "+": photos,
  // files and links only ever arrive from inside a document.
  // Search, plus "..." where the screen still has rows for it, plus the
  // way out where there is one - one, two or three buttons.
  // The way out went to the dock, so the top capsule is one button
  // shorter than it used to be.
  useDockLeave(leaveIcon ?? 'albums-outline', onBack ?? (() => {}), !!onBack);
  const topHeight = capsuleHeightFor(1 + (menuRows ? 1 : 0));
  const createHeight = onAdd ? (explorer?.active ? CAPSULE_HEIGHT : RAIL_WIDTH) : 0;
  const selectHeight = bulk ? CAPSULE_HEIGHT_1 : 0;
  // Back and forward take a capsule of their own wherever the screen is
  // tall enough to stand five pieces clear of one another; where it is
  // not, they fall back into the actions capsule rather than ride up over
  // the top one. The user's point, and it was right: on a screen with the
  // same number of buttons as the documents list there is no reason they
  // cannot have their own.
  const railFree = useRailFree(topHeight, !!hasIsland);
  // A LADDER, not one fallback. The first version tried the arrows in a
  // capsule of their own, then in the actions capsule, and stopped - so on
  // a screen too short for either (the Fold lying down: a tall top inset,
  // the island at the foot, and only about 440 points between them) the
  // stack still rode up over the top capsule. Each rung here gives up one
  // more thing, and the first that stands clear is the one drawn.
  //
  // The arrows go before anything else does: back and forward are a
  // convenience, and the path strip above the list does the same job.
  // Ordering, the shape of the list and choosing all stay.
  const RUNGS = [
    { arrows: 'own' as const, selectOwn: true },
    { arrows: 'inside' as const, selectOwn: true },
    { arrows: 'inside' as const, selectOwn: false },
    { arrows: 'none' as const, selectOwn: true },
    { arrows: 'none' as const, selectOwn: false },
  ];
  const rungActions = (rung: (typeof RUNGS)[number]) =>
    capsuleHeightFor(
      (shape ? 1 : 0) + 1 + (rung.arrows === 'inside' ? 2 : 0) + (rung.selectOwn ? 0 : 1)
    );
  const rung = explorer?.active
    ? RUNGS.find((candidate) =>
        railFits(
          railFree,
          candidate.selectOwn ? selectHeight : rungActions(candidate),
          createHeight,
          candidate.arrows === 'own' ? CAPSULE_HEIGHT : candidate.selectOwn ? selectHeight : 0,
          candidate.arrows === 'own' ? rungActions(candidate) : candidate.selectOwn ? rungActions(candidate) : 0
        )
      ) ?? RUNGS[RUNGS.length - 1]
    : { arrows: 'none' as const, selectOwn: true };
  // Back and forward through the folders you have been in are GONE from
  // the rail. Their own comment said what they were for - "so the hand
  // need not reach for the path strip at the top" - and there is no strip
  // at the top any more: the path is in the dock, under the thumb, and
  // every level of it is one press away. A control kept for a reach
  // nobody makes is a control to delete.
  //
  // The rung system still counts a slot for them where a tall screen
  // would have had one; that only makes it more generous than it needs to
  // be, never less.
  const ownHistory = false;
  const actionsHeight = rungActions(rung);
  const rail = useRail(
    topHeight,
    // With a capsule of their own, the arrows take the middle slot and
    // choosing moves up one; with choosing folded in there is no middle
    // slot at all.
    rung.selectOwn ? selectHeight : actionsHeight,
    createHeight,
    ownHistory ? CAPSULE_HEIGHT : rung.selectOwn ? selectHeight : 0,
    !!hasIsland,
    ownHistory || rung.selectOwn ? actionsHeight : 0
  );
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [menuOpen, setMenuOpen] = useState(false);
  // The chrome floats over the cards, so its height decides where the
  // first one rests.
  const [chromeHeight, setChromeHeight] = useState(0);
  const chromeTop = insets.top + CHROME_TOP;
  const chromeBottom = chromeTop + chromeHeight + 8;
  // Searching takes the screen - but only while it is actually being
  // typed. With the keyboard down the field is a field like any other,
  // and the buttons around it come back.
  const keyboardUp = useKeyboardVisible();
  const searchingAlone = list.isSearching && keyboardUp;
  const showContext = useDockShowContext();
  // Everything this screen offers now goes to the DOCK, not the rail -
  // the same move the documents screen made, and it lands on files,
  // photos, links and the boards list at once because they all came
  // through here. Search on the left, creating on the right, and what
  // the list can be done TO on the stack's second card.
  //
  // The rail reserved 90 points of width whether it held four capsules
  // or one; that is what leaving it buys, not the count of buttons.
  useDockBeads(
    isFocused
      ? {
          icon: list.isSelectMode || list.isSearching ? 'close-outline' : 'search-outline',
          active: list.isSearching,
          onPress: () => {
            // While selecting, this is the way OUT of selecting - the one
            // screen state you most need to be able to leave.
            if (list.isSelectMode) {
              list.toggleSelectMode();
              return;
            }
            list.setIsSearching((prev) => !prev);
          },
        }
      : null,
    isFocused && !list.isSelectMode && !searchingAlone && onAdd
      ? { icon: addIcon ?? 'add-outline', badge: 'add-circle-outline', onPress: onAdd }
      : null
  );
  useDockActions(
    isFocused && !searchingAlone
      ? [
          ...(shape
            ? [{ key: 'shape', icon: shape.icon as string, onPress: shape.onToggle, closesStack: true }]
            : []),
          {
            key: 'sort',
            icon: 'filter-outline',
            active: sortMenuOpen,
            onPress: () => setSortMenuOpen((v) => !v),
          },
          // Narrowing the list to a tag. The drawer answers a swipe from
          // the middle of the screen - the user's own gesture - and that
          // was the ONLY way in once the rail's tag button went with the
          // rail: "відсутнє фільтрування, воно було раніше, а тепер я не
          // знаю, як відфільтрувати елементи бази". A gesture is a
          // shortcut for the hand that knows it, not the way to reach a
          // thing at all.
          {
            key: 'tags',
            icon: 'pricetag-outline',
            active: !!list.tagFilter,
            onPress: () => drawerRef.current?.open(),
            closesStack: true,
          },
          ...(bulk
            ? [
                {
                  key: 'select',
                  icon: list.isSelectMode ? 'close-outline' : 'checkmark-circle-outline',
                  active: list.isSelectMode,
                  onPress: () => {
                    // Leaving select mode is the END of the thing this
                    // card was opened for; entering it is the start.
                    if (list.isSelectMode) showContext();
                    list.toggleSelectMode();
                  },
                },
              ]
            : []),
          // Folders are made far less often than records - the user's own
          // reckoning - so this rides with the rest rather than beside
          // the bead that makes a record.
          ...(explorer?.active
            ? [
                {
                  key: 'folder',
                  icon: 'folder-outline',
                  badge: 'add-circle-outline',
                  onPress: explorer.onNewFolder,
                  closesStack: true,
                },
              ]
            : []),
          ...(menuRows
            ? [
                {
                  key: 'menu',
                  icon: 'ellipsis-horizontal-outline',
                  active: menuOpen,
                  onPress: () => setMenuOpen((v) => !v),
                },
              ]
            : []),
        ]
      : null
  );

  // Pulled down from the top of the list, the search comes out.
  const pull = usePullToSearch(() => {
    pullHaptic();
    list.setIsSearching(true);
  });
  const listGesture = useMemo(() => Gesture.Simultaneous(pull.gesture, drawerSwipe), [pull.gesture, drawerSwipe]);
  // The search takes the screen; what hangs off the rail goes with it.
  useEffect(() => {
    if (list.isSearching || list.isSelectMode) {
      setSortMenuOpen(false);
      setMenuOpen(false);
    }
  }, [list.isSearching, list.isSelectMode]);
  // ...and closes itself when the keyboard goes away empty, or when a
  // swipe carries the screen off.
  useSearchDismissal({
    isSearching: list.isSearching,
    query: list.searchQuery,
    isFocused,
    close: () => {
      list.setIsSearching(false);
      list.setSearchQuery('');
    },
  });

  const column = (
    <>
        <Menu
          visible={menuOpen && !!menuRows}
          onClose={() => setMenuOpen(false)}
          entries={[]}
          // Above the dock, where the button that opens it now lives.
          style={{ position: 'absolute', right: 16, bottom: DOCK_CLEAR + insets.bottom }}
        >
          {menuRows?.(() => setMenuOpen(false))}
        </Menu>

        {/* Choosing several is a mode, not an action - its own capsule,
            where a custom database keeps it too, for as long as the screen
            has the height for one. */}
        <Menu
          visible={sortMenuOpen}
          onClose={() => setSortMenuOpen(false)}
          accent={accent}
          entries={[
            { kind: 'section', label: 'Сортування' },
            ...FIELD_ORDER.map((field) => ({
              label: FIELD_LABELS[field],
              icon: FIELD_ICONS[field],
              checked: list.sortPref.field === field,
              onPress: () => {
                list.selectSortField(field);
                setSortMenuOpen(false);
                // The card of actions was opened for this one thing.
                showContext();
              },
            })),
          ]}
          // Above the dock, where the button that opens it now lives.
          style={{ position: 'absolute', right: 16, bottom: DOCK_CLEAR + insets.bottom }}
        />

        {/* The tabs float over the cards rather than standing above them,
            so a card slides under them and off the top of the screen. */}
        {isFocused && (
          <GlassPortal>
            <View
              style={[styles.topChrome, { top: chromeTop }]}
              pointerEvents="box-none"
              onLayout={(e) => setChromeHeight(e.nativeEvent.layout.height)}
            >
              {!searchingAlone && list.groups.length > 0 && !list.groupsRowHidden && (
                <ProjectTabsRow
                  items={list.groups}
                  selected={list.groupFilter}
                  onSelect={list.setGroupFilter}
                  unassignedLabel="Без групи"
                  dark
                  blurTarget={blurTarget}
                  startPadding={splitting ? listPaneX + 20 : undefined}
                  endPadding={20}
                />
              )}
            </View>
          </GlassPortal>
        )}

        {list.tagFilter && !searchingAlone && (
          <View style={[styles.filterRow, { marginTop: chromeBottom }]}>
            {list.tagFilter.type === 'untagged' ? (
              <View style={[styles.filterChip, { borderColor: '#6B7280' }]}>
                <Ionicons name="pricetag-outline" size={13} color="#6B7280" />
                <Text style={[styles.filterChipLabel, { color: '#6B7280' }]}>Без тегів</Text>
                <Pressable hitSlop={8} onPress={() => list.setTagFilter(null)}>
                  <Ionicons name="close" size={14} color="#6B7280" />
                </Pressable>
              </View>
            ) : (
              list.tagFilter.tagIds.map((tagId) => {
                const tag = list.tags.find((t) => t.id === tagId);
                if (!tag) return null;
                return (
                  <View key={tagId} style={[styles.filterChip, { borderColor: tag.color }]}>
                    <Ionicons name={tag.icon as keyof typeof Ionicons.glyphMap} size={13} color={tag.color} />
                    <Text style={[styles.filterChipLabel, { color: tag.color }]}>{tag.path}</Text>
                    <Pressable
                      hitSlop={8}
                      onPress={() =>
                        list.setTagFilter(list.tagFilter ? removeTagFromFilter(list.tagFilter, tagId) : null)
                      }
                    >
                      <Ionicons name="close" size={14} color={tag.color} />
                    </Pressable>
                  </View>
                );
              })
            )}
          </View>
        )}

        {list.isSearching && (
          // Fades down into place rather than appearing between two
          // frames - the pull that opens it is a slow movement, and the
          // field arriving instantly at the end of it read as a jolt.
          <Animated.View entering={FadeInDown.duration(220)}>
            <SearchField
              autoFocus
              value={list.searchQuery}
              onChangeText={list.setSearchQuery}
              placeholder={searchPlaceholder}
              onClose={() => {
                list.setSearchQuery('');
                list.setIsSearching(false);
              }}
              style={[
                styles.searchRow,
                searchFieldSides(railSide),
                !list.tagFilter && { marginTop: chromeBottom },
              ]}
            />
          </Animated.View>
        )}

        {/* Only what floats above the cards pushes them down; once a chip
            row or the search field has already taken that space, the
            cards start right under it. */}
        {/* The list is declared as a gesture of its own here (see
            usePullToSearch), so the pull can be measured alongside it
            without taking anything away from it. */}
        {/* Nothing under the field until something is typed for - an
            empty search is a question, not a list. */}
        {list.isSearching && list.needle.length === 0 ? (
          <View style={styles.emptySearch} />
        ) : (
          // ONE detector, with the two gestures composed as equals.
          //
          // They used to be two detectors, one inside the other, and that
          // is a parent/child relation: the inner one - which carries the
          // list's own native scroll - wins the touch, and the outer pan
          // is never given the chance to decide. It went unnoticed because
          // the documents screen, where this was first written, is the one
          // place the same pair is declared side by side.
          //
          // Simultaneous is safe precisely because neither can be greedy:
          // the drawer's pan fails before it activates unless the finger
          // went down in its band and moved clearly sideways, and the pull
          // fails as soon as the movement reads as horizontal.
          <GestureDetector gesture={listGesture}>
            {children(
              list.tagFilter || list.isSearching ? 0 : chromeBottom,
              pull.listProps,
              Math.max(0, columnWidth - 20),
              pull.scrollY
            )}
          </GestureDetector>
        )}
    </>
  );

  return (
    <View style={styles.container}>
      {/* The same fixed gradient every screen stands on. 1px bled past
          every edge - windowWidth/Height can round to a hair less than the
          real screen, leaving a sliver of white at an edge otherwise. */}
      <ScreenBackdrop id="databaseBg" colors={['#705648', '#69736E', '#000000']} scrollY={pull.scrollY} />


      {splitting ? (
        <View style={styles.paneRow}>
          <View
            style={styles.listPane}
            onLayout={(e) => {
              setListPaneX(e.nativeEvent.layout.x);
              setColumnWidth(e.nativeEvent.layout.width);
            }}
          >
            {column}
          </View>
          <View style={styles.sidePane}>{pane}</View>
        </View>
      ) : (
        <ContentColumn>
          <View style={styles.container} onLayout={(e) => setColumnWidth(e.nativeEvent.layout.width)}>
            {column}
          </View>
        </ContentColumn>
      )}

      {overlay}

      {/* In the explorer the "+" is a capsule of two: this database's own
          record, and a folder beside it - the same pair, drawn the same
          way, as on the documents screen. Everywhere else it stays the
          one round accent button it has always been. */}

      {!hideDrawer && (
      <TagsDrawer
        counts={list.drawerCounts}
        ref={drawerRef}
        tags={list.drawerTags}
        activeFilter={list.tagFilter}
        onSelectFilter={list.setTagFilter}
        hideOpenButton={list.isSelectMode || searchingAlone}
        mode={explorer ? { value: explorer.mode, onChange: explorer.onChangeMode } : undefined}
        groupSection={{
          items: list.groupSectionItems,
          selected: list.groupFilter,
          onSelect: list.setGroupFilter,
          rowVisible: !list.groupsRowHidden,
          onToggleRow: list.toggleGroupsRow,
        }}
      />
      )}

      {bulk && (
        <BulkActionBar
          count={list.selectedIds.size}
          onTag={bulk.onTag}
          onGroup={bulk.onGroup}
          onCopy={bulk.onCopy}
          onCopyObject={bulk.onCopyObject}
          onDelete={bulk.onDelete}
        />
      )}
    </View>
  );
}

// The rows a database adds to the "..." menu are drawn in the menu's own
// styles, so a screen's extra rows can never sit a little differently
// from the ones the chrome puts there itself.
// Still literals, and the one sheet in the app that is: it is EXPORTED
// and spread into rows by six screens, so making it a hook would ripple
// through all of them. The menu WINDOW itself follows the theme (see
// surfaces/Menu); these are the extra rows a screen adds inside one.
export const menuStyles = StyleSheet.create({
  menuSectionLabel: {
    fontSize: 11,
    fontFamily: FONT_SEMIBOLD,
    color: 'rgba(255,255,255,0.3)',
    textTransform: 'uppercase',
    letterSpacing: 0.06,
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 2,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  menuRowLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: '#fff',
  },
  menuRule: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.14)',
    marginVertical: 6,
  },
});

const makeStyles = (t: Theme) =>
  StyleSheet.create({
  container: {
    flex: 1,
  },
  emptySearch: {
    flex: 1,
  },
  // Two columns on a wide screen. Reversed, so the list keeps the right
  // half against the rail that belongs to it while staying the first
  // thing in the tree - it is the screen.
  paneRow: {
    flex: 1,
    flexDirection: 'row-reverse',
  },
  listPane: {
    flex: 1,
  },
  sidePane: {
    flex: 1,
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255,255,255,0.15)',
    overflow: 'hidden',
  },
  railWrap: {
    position: 'absolute',
    alignItems: 'center',
  },
  railWrapRight: {
    right: RAIL_RIGHT,
  },
  railWrapLeft: {
    left: RAIL_RIGHT,
  },
  // Stood on its end, like every other screen's. The glass itself is
  // GlassDrop's - this is only the room inside it.
  headerButtons: {
    alignItems: 'center',
    gap: 18,
    paddingVertical: 18,
    paddingHorizontal: 19,
  },
  // Turned with the capsule.
  headerButtonsDivider: {
    width: 20,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  menuRule: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 6,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  menuRowLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: '#111827',
  },
  // The band the group tabs float in, over the cards.
  topChrome: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 6,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  // White capsule, border + text in the tag's own colour.
  filterChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  filterChipLabel: {
    fontSize: 13,
    fontFamily: FONT_SEMIBOLD,
  },
  // Only where it sits - the pill itself is SearchField's.
  searchRow: {
    marginBottom: 8,
  },
  // Same floating "+" every screen uses, not a header icon.
  fabRight: {
    right: 20,
  },
  fabLeft: {
    left: 20,
  },

  });
