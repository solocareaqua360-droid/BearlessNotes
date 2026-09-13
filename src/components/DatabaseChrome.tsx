import { ReactNode, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { DatabaseList } from '../hooks/useDatabaseList';
import { GlassPortal } from './GlassPortal';
import { useBlurTarget } from './GlassTarget';
import ContentColumn from './ContentColumn';
import ProjectTabsRow from './ProjectTabsRow';
import SortMenuRows from './SortMenuRows';
import TagsDrawer, { removeTagFromFilter } from './TagsDrawer';
import BulkActionBar from './BulkActionBar';
import { useRail } from '../hooks/useRail';
import { usePullToSearch } from '../hooks/usePullToSearch';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { GLASS_ISLAND } from '../constants/glass';
import { CAPSULE_DROP, CAPSULE_HEIGHT_3, CHROME_TOP, RAIL_CLEARANCE, RAIL_RIGHT } from '../constants/rail';

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
  onBack: () => void;
  searchPlaceholder: string;
  // Rows of this database's own, above the sort rows in the "..." menu
  // (the view-mode switch, for the databases that have one).
  menuRows?: (close: () => void) => ReactNode;
  // Absent on a database whose records cannot be made from scratch -
  // photos, files and links only ever arrive from inside a document, and
  // a "+" that cannot do anything is worse than no "+".
  onAdd?: () => void;
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
  children: (listTopPad: number, listProps: ReturnType<typeof usePullToSearch>['listProps']) => ReactNode;
  // Anything that must reach the whole window rather than the content
  // column: toasts, viewers, the sheets a database opens. Drawn outside
  // the column, the way the drawer is.
  overlay?: ReactNode;
};

export default function DatabaseChrome<T extends { id: string }>({
  list,
  accent,
  accentGlass,
  onBack,
  searchPlaceholder,
  menuRows,
  onAdd,
  hideDrawer,
  bulk,
  children,
  overlay,
}: DatabaseChromeProps<T>) {
  const blurTarget = useBlurTarget();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  // Three buttons in the capsule, so the rail spaces what is under it
  // against the taller one.
  const rail = useRail(CAPSULE_HEIGHT_3);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [menuOpen, setMenuOpen] = useState(false);
  // The chrome floats over the cards, so its height decides where the
  // first one rests.
  const [chromeHeight, setChromeHeight] = useState(0);
  // Pulled down from the top of the list, the search comes out.
  const pull = usePullToSearch(() => list.setIsSearching(true));
  const chromeTop = insets.top + CHROME_TOP;
  const chromeBottom = chromeTop + chromeHeight + 8;

  return (
    <View style={styles.container}>
      {/* The same fixed gradient every screen stands on. 1px bled past
          every edge - windowWidth/Height can round to a hair less than the
          real screen, leaving a sliver of white at an edge otherwise. */}
      <Svg
        width={windowWidth + 2}
        height={windowHeight + 2}
        style={[StyleSheet.absoluteFill, { top: -1, left: -1 }]}
        pointerEvents="none"
      >
        <Defs>
          <LinearGradient id="databaseBg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.03" stopColor="#705648" />
            <Stop offset="0.52" stopColor="#69736E" />
            <Stop offset="1" stopColor="#000000" />
          </LinearGradient>
        </Defs>
        <Rect width={windowWidth + 2} height={windowHeight + 2} fill="url(#databaseBg)" />
      </Svg>

      {/* Through the portal, which is where a blur is safe - inside the
          screen it would be blurring a picture it is part of. */}
      {isFocused && (
        <GlassPortal>
          <View
            style={[styles.railWrap, { top: insets.top + CHROME_TOP + CAPSULE_DROP }]}
            pointerEvents="box-none"
          >
            <View style={styles.headerButtons}>
              <BlurView
                intensity={60}
                tint="dark"
                blurMethod="dimezisBlurView"
                blurTarget={blurTarget ?? undefined}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />
              <Pressable hitSlop={8} onPress={() => list.setIsSearching((prev) => !prev)}>
                <Ionicons
                  name={list.isSearching ? 'close-outline' : 'search-outline'}
                  size={24}
                  color="#fff"
                />
              </Pressable>
              <View style={styles.headerButtonsDivider} />
              <Pressable hitSlop={8} onPress={() => setMenuOpen((v) => !v)}>
                <Ionicons name="ellipsis-horizontal-outline" size={24} color="#fff" />
              </Pressable>
              <View style={styles.headerButtonsDivider} />
              {/* The way out of this database, where the arrow in the
                  header's corner used to be. */}
              <Pressable hitSlop={8} onPress={onBack}>
                <Ionicons name="arrow-back-outline" size={24} color="#fff" />
              </Pressable>
            </View>
          </View>
        </GlassPortal>
      )}

      <ContentColumn>
        {menuOpen && <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)} />}
        {menuOpen && (
          <View style={styles.menuPanel}>
            {menuRows?.(() => setMenuOpen(false))}
            <SortMenuRows sortPref={list.sortPref} onSelectField={list.selectSortField} accentColor={accent} />
            {bulk && (
              <>
                <View style={styles.menuRule} />
                <Pressable
                  style={styles.menuRow}
                  onPress={() => {
                    setMenuOpen(false);
                    list.toggleSelectMode();
                  }}
                >
                  <Ionicons
                    name={list.isSelectMode ? 'close-outline' : 'checkmark-circle-outline'}
                    size={17}
                    color="#111827"
                  />
                  <Text style={styles.menuRowLabel}>{list.isSelectMode ? 'Скасувати вибір' : 'Вибрати'}</Text>
                </Pressable>
              </>
            )}
          </View>
        )}

        {/* The tabs float over the cards rather than standing above them,
            so a card slides under them and off the top of the screen. */}
        {isFocused && (
          <GlassPortal>
            <View
              style={[styles.topChrome, { top: chromeTop }]}
              pointerEvents="box-none"
              onLayout={(e) => setChromeHeight(e.nativeEvent.layout.height)}
            >
              {list.groups.length > 0 && !list.groupsRowHidden && (
                <ProjectTabsRow
                  items={list.groups}
                  selected={list.groupFilter}
                  onSelect={list.setGroupFilter}
                  unassignedLabel="Без групи"
                  dark
                  blurTarget={blurTarget}
                  endPadding={RAIL_CLEARANCE}
                />
              )}
            </View>
          </GlassPortal>
        )}

        {list.tagFilter && (
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
          <View style={[styles.searchRow, !list.tagFilter && { marginTop: chromeBottom }]}>
            <Ionicons name="search" size={14} color="#9CA3AF" />
            <TextInput
              autoFocus
              value={list.searchQuery}
              onChangeText={list.setSearchQuery}
              placeholder={searchPlaceholder}
              placeholderTextColor="#9CA3AF"
              style={styles.searchInput}
            />
          </View>
        )}

        {/* Only what floats above the cards pushes them down; once a chip
            row or the search field has already taken that space, the
            cards start right under it. */}
        <GestureDetector gesture={pull.gesture}>
          <View style={styles.listWrap}>
            {children(list.tagFilter || list.isSearching ? 0 : chromeBottom, pull.listProps)}
          </View>
        </GestureDetector>
      </ContentColumn>

      {overlay}

      {isFocused && !list.isSelectMode && onAdd && (
        <GlassPortal>
          <Pressable
            style={[
              styles.fab,
              { bottom: rail.addBottom, backgroundColor: accentGlass, shadowColor: accent },
            ]}
            onPress={onAdd}
          >
            <BlurView
              intensity={60}
              tint="dark"
              blurMethod="dimezisBlurView"
              blurTarget={blurTarget ?? undefined}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
            <Ionicons name="add-outline" size={28} color="#fff" />
          </Pressable>
        </GlassPortal>
      )}

      {!hideDrawer && (
      <TagsDrawer
        tags={list.drawerTags}
        activeFilter={list.tagFilter}
        onSelectFilter={list.setTagFilter}
        hideOpenButton={list.isSelectMode}
        capsuleHeight={CAPSULE_HEIGHT_3}
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
export const menuStyles = StyleSheet.create({
  menuSectionLabel: {
    fontSize: 11,
    fontFamily: FONT_SEMIBOLD,
    color: '#9CA3AF',
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
  },
  menuRowLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: '#111827',
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // The pull gesture needs something to sit on that fills what is left of
  // the screen under the chrome.
  listWrap: {
    flex: 1,
  },
  railWrap: {
    position: 'absolute',
    right: RAIL_RIGHT,
    alignItems: 'center',
  },
  // Stood on its end, like every other screen's.
  headerButtons: {
    alignItems: 'center',
    gap: 18,
    paddingVertical: 18,
    paddingHorizontal: 19,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: GLASS_ISLAND,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  // Turned with the capsule.
  headerButtonsDivider: {
    width: 20,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  menuBackdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 5,
  },
  menuPanel: {
    position: 'absolute',
    top: 96,
    right: RAIL_CLEARANCE,
    width: 200,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 6,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
    zIndex: 6,
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
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 8,
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: '#111827',
  },
  // Same floating "+" every screen uses, not a header icon.
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 999,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
  },
});
