import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTheme, useStyles } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { SharedValue } from 'react-native-reanimated';
import { DatabaseList } from '../hooks/useDatabaseList';
import { GlassPortal } from './GlassPortal';
import Menu from './surfaces/Menu';
import { useBlurTarget } from './GlassTarget';
import ContentColumn from './ContentColumn';
import SearchCorner, { searchCornerHeight } from './SearchCorner';
import SearchField, { searchFieldSides } from './SearchField';
import { TOP_NAV_SPACE, useTopNavOn } from './TopNavBar';
import GlassDrop, { GlassIcon } from './GlassDrop';
import ProjectTabsRow from './ProjectTabsRow';
import { FIELD_ICONS, FIELD_LABELS, FIELD_ORDER } from './SortMenuRows';
import { useDockActions, useDockBeads, useDockShowContext, useTopBack } from '../navigation/navDock';
import { useDockClearance } from '../navigation/dockGeometry';
import ScreenBackdrop from './ScreenBackdrop';
import TagsDrawer, { TagsDrawerHandle, removeTagFromFilter, useDrawerSwipe } from './TagsDrawer';
import { usePublishRailTree } from '../navigation/navRail';
import { useResponsiveLayout } from '../hooks/useResponsiveLayout';
import { pullHaptic, useKeyboardVisible, usePullToSearch, useSearchDismissal } from '../hooks/usePullToSearch';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { CHROME_TOP } from '../constants/rail';

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
    // The tree itself, for the desktop rail - every folder path, where
    // this list is standing, and how to go somewhere. The drawer builds
    // its own tree from the tags; the rail is outside every screen and
    // has to be told (see navigation/navRail).
    paths: string[];
    path: string;
    onGo: (path: string) => void;
    onNewFolderIn: (parent: string) => void;
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
  // One of the four desks' own screens (the boards list at its tab): the
  // desks bar stands at the top (TopNavBar) with the way back in its
  // corner, the content starts below it, and search is back on the
  // dock's left bead.
  topNav?: boolean;
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
  topNav: topNavWanted,
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
  const topNavOn = useTopNavOn();

  // The same tree the documents list publishes, from every other
  // database that has one. Not from a pane: two publishers would fight
  // over one rail, and the rail belongs to whatever is the SCREEN.
  usePublishRailTree(
    // Only while this screen is the one being looked at. Every screen
    // that has ever been opened stays mounted and goes on rendering, and
    // the rail takes the most recent claim - so without this the last
    // one to re-render won, which is not the same thing as the one in
    // front: opening Files from Boards left the BOARDS' folders in the
    // rail.
    isFocused && explorer && railSide !== 'left'
      ? {
          paths: explorer.paths,
          current: explorer.path,
          onGo: explorer.onGo,
          onNewFolder: explorer.onNewFolderIn,
        }
      : null
  );
  const insets = useSafeAreaInsets();
  // The top capsule is three buttons now: search, "...", and the way out.
  // Ordering left it for the actions capsule, where the same button sits
  // on a custom database - what a screen can DO to its list belongs
  // together, and a four-button capsule at the top of the rail was the
  // tallest thing on the screen.
  //
  // Every screen this chrome dresses - files, photos, links, stickers -
  // is PUSHED over the tabs, so the navigation island is not on it and
  // create button's, on the three databases that have no "+": photos,
  // files and links only ever arrive from inside a document.
  // Search, plus "..." where the screen still has rows for it, plus the
  // way out where there is one - one, two or three buttons.
  // The way out is the dock's LEFT BEAD now (below), not a chevron
  // inside its card - see `back`.
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [menuOpen, setMenuOpen] = useState(false);
  // The chrome floats over the cards, so its height decides where the
  // first one rests.
  const [chromeHeight, setChromeHeight] = useState(0);
  const topNav = !!topNavWanted && topNavOn;
  const chromeTop = insets.top + CHROME_TOP + (topNav ? TOP_NAV_SPACE : 0);
  const chromeBottom = chromeTop + chromeHeight + 8;
  // Searching takes the screen - but only while it is actually being
  // typed. With the keyboard down the field is a field like any other,
  // and the buttons around it come back.
  const keyboardUp = useKeyboardVisible();
  const searchingAlone = list.isSearching && keyboardUp;
  const showContext = useDockShowContext();
  const dockClear = useDockClearance();
  // Everything this screen offers now goes to the DOCK, not the rail -
  // the same move the documents screen made, and it lands on files,
  // photos, links and the boards list at once because they all came
  // through here. Search on the left, creating on the right, and what
  // the list can be done TO on the stack's second card.
  //
  // The rail reserved 90 points of width whether it held four capsules
  // or one; that is what leaving it buys, not the count of buttons.
  // THE WAY BACK, the dock's left bead on every screen this chrome
  // dresses - "кнопка назад є одним із головних якорів". One step at a
  // time: out of selecting, out of searching, up one folder, then out of
  // the screen (whatever the screen says that is - a pushed copy goes
  // back, the boards' own desk steps to the desk before it). Where there
  // is nowhere left to go it stays in its place, dimmed.
  const folderUp =
    explorer?.active && explorer.path !== ''
      ? () => explorer.onGo(explorer.path.split('/').slice(0, -1).join('/'))
      : null;
  const back: (() => void) | null = list.isSelectMode
    ? () => list.toggleSelectMode()
    : list.isSearching
      ? () => {
          list.setSearchQuery('');
          list.setIsSearching(false);
        }
      : folderUp ?? onBack ?? null;
  useTopBack(back, !!topNav);
  useDockBeads(
    isFocused
      ? topNav
        ? {
            icon: list.isSelectMode || list.isSearching ? 'close-outline' : 'search-outline',
            active: list.isSearching,
            onPress: () => {
              // While selecting, this is the way OUT of selecting.
              if (list.isSelectMode) {
                list.toggleSelectMode();
                return;
              }
              list.setIsSearching((prev) => !prev);
            },
          }
        : { icon: 'arrow-back', onPress: () => back?.(), dimmed: !back }
      : null,
    isFocused && !list.isSelectMode && !searchingAlone && onAdd
      ? {
          icon: addIcon ?? 'add-outline',
          badge: 'add-circle-outline',
          onPress: onAdd,
          // Folders are made far less often than records - the user's
          // own reckoning - so making one rides the SAME bead as making
          // a record, held rather than tapped, instead of taking a fifth
          // slot on the actions card (four is the most that ever fits
          // beside the way out).
          onLongPress: explorer?.active ? explorer.onNewFolder : undefined,
        }
      : null
  );
  useDockActions(
    isFocused && !searchingAlone
      ? list.isSelectMode
        ? [
            {
              key: 'cancel',
              icon: 'close-outline',
              label: 'Вийти',
              onPress: () => {
                showContext();
                list.toggleSelectMode();
              },
            },
            ...(bulk && list.selectedIds.size > 0
              ? [
                  { key: 'tag', icon: 'pricetag-outline' as const, label: 'Теги', onPress: bulk.onTag },
                  { key: 'group', icon: 'folder-outline' as const, label: 'Проект', onPress: bulk.onGroup },
                  ...(bulk.onCopy
                    ? [{ key: 'copy', icon: 'document-text-outline' as const, label: 'У нотатку', onPress: bulk.onCopy }]
                    : []),
                  ...(bulk.onCopyObject && list.selectedIds.size === 1
                    ? [{ key: 'copyObject', icon: 'clipboard-outline' as const, label: 'Копія', onPress: bulk.onCopyObject }]
                    : []),
                  { key: 'delete', icon: 'trash-outline' as const, label: 'Видалити', onPress: bulk.onDelete },
                ]
              : []),
          ]
        : [
            ...(shape
              ? [{ key: 'shape', icon: shape.icon as string, label: 'Вигляд', onPress: shape.onToggle, closesStack: true }]
              : []),
            {
              key: 'sort',
              icon: 'filter-outline',
              label: 'Порядок',
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
              label: 'Папки',
              active: !!list.tagFilter,
              onPress: () => drawerRef.current?.open(),
              closesStack: true,
            },
            ...(bulk ? [{ key: 'select', icon: 'checkmark-circle-outline', label: 'Вибір', onPress: () => list.toggleSelectMode() }] : []),
            ...(menuRows
              ? [
                  {
                    key: 'menu',
                    icon: 'ellipsis-horizontal-outline',
                    label: 'Ще',
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
          style={{ position: 'absolute', right: 16, bottom: dockClear + insets.bottom }}
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
          style={{ position: 'absolute', right: 16, bottom: dockClear + insets.bottom }}
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
              {!list.isSearching && list.groups.length > 0 && !list.groupsRowHidden && (
                <ProjectTabsRow
                  items={list.groups}
                  selected={list.groupFilter}
                  onSelect={list.setGroupFilter}
                  unassignedLabel="Без проекту"
                  dark
                  blurTarget={blurTarget}
                  startPadding={splitting ? listPaneX + 20 : undefined}
                  endPadding={20}
                />
              )}
            </View>
          </GlassPortal>
        )}

        {list.tagFilter && !list.isSearching && (
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

        <SearchCorner
          visible={!topNav && isFocused && !list.isSelectMode}
          open={list.isSearching}
          query={list.searchQuery}
          onChangeQuery={list.setSearchQuery}
          placeholder={searchPlaceholder}
          onOpen={() => list.setIsSearching(true)}
          onClose={() => {
            list.setSearchQuery('');
            list.setIsSearching(false);
          }}
        />
        {/* The field itself is the corner's (SearchCorner, drawn over
            the screen); this only keeps its room, so the list starts
            below it rather than under it. */}
        {list.isSearching &&
          (topNav ? (
            <SearchField
              autoFocus
              value={list.searchQuery}
              onChangeText={list.setSearchQuery}
              placeholder={searchPlaceholder}
              onClose={() => {
                list.setSearchQuery('');
                list.setIsSearching(false);
              }}
              style={[{ marginBottom: 8, marginTop: chromeBottom }, searchFieldSides(railSide)]}
            />
          ) : (
            <View style={{ height: searchCornerHeight(windowWidth) + 8, marginTop: chromeBottom }} />
          ))}

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
      <ScreenBackdrop id="databaseBg" scrollY={pull.scrollY} />


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

  // Same floating "+" every screen uses, not a header icon.
  fabRight: {
    right: 20,
  },
  fabLeft: {
    left: 20,
  },

  });
