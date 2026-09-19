import { useEffect, useState } from 'react';
import { doc, onSnapshot } from '../firestore';
import { ownedQuery, setDoc } from '../utils/owned';
import { db } from '../firebase';
import { Group, Tag, TaggableKind } from '../types';
import { groupAppliesTo } from '../utils/groups';
import { UNASSIGNED_ID } from '../components/ProjectTabsRow';
import { TagFilter, matchesTagFilter } from '../components/TagsDrawer';
import { usePendingDelete } from '../hooks/usePendingDelete';
import { useMultiSelect } from '../hooks/useMultiSelect';
import { useSortPref } from '../hooks/useSortPref';
import { useTags } from '../hooks/useTags';
import { sortItems } from '../utils/sortItems';
import { GLASS_TEXT_MUTED } from '../constants/glass';

// Everything every database screen does with its records before it draws
// them: the groups that apply to it, the group and tag filters, the
// in-screen search, the sort, the selection, and the delete that can still
// be taken back. Six screens each had their own copy of this, and a change
// to any of it meant six edits and one screen quietly left behind.
//
// What a database does NOT share - how a card looks, what "+" makes, what
// a tap opens - stays with the screen. This only takes the records in and
// hands back the ones to show.

export type DatabaseListOptions<T> = {
  // The settings document this database keeps its preferences in
  // ('photosPrefs', 'filesPrefs', ...). Sort and the hidden group row both
  // live there, keyed per database so one never speaks for another.
  prefsKey: string;
  // Which groups belong to this database, and under which kind its tags
  // are filed (see the Group/TaggableKind comments in types.ts).
  groupKind: string;
  tagKind: TaggableKind;
  items: T[];
  tagIdsOf: (item: T) => string[];
  groupIdOf: (item: T) => string | undefined;
  titleOf: (item: T) => string;
  createdAtOf: (item: T) => number | undefined;
  updatedAtOf: (item: T) => number;
  // Which tags this database is even allowed to offer, when its kind is
  // narrower than "assigned to something here" - the three link screens
  // share one collection but must never show each other's tags.
  tagAllowed?: (tag: Tag) => boolean;
  // What the in-screen search looks through, when it is more than the
  // title (a link also matches on its address, a file on its name).
  searchTextOf?: (item: T) => string;
  // A database whose search is not a substring of one line - a document
  // matches on its body text too, block by block.
  matchesSearch?: (item: T, needle: string) => boolean;
  // Whether searching narrows what the filters left standing, or reaches
  // the whole database. Documents search everything on purpose: narrowing
  // by two things at once is rarely what anyone means by searching.
  searchIgnoresFilters?: boolean;
};

export type ListMode = 'groups' | 'list' | 'explorer';

export function useDatabaseList<T extends { id: string }>(options: DatabaseListOptions<T>) {
  const {
    prefsKey,
    groupKind,
    items,
    tagIdsOf,
    groupIdOf,
    titleOf,
    createdAtOf,
    updatedAtOf,
    searchTextOf,
    matchesSearch,
    searchIgnoresFilters,
    tagAllowed,
  } = options;
  const prefsDoc = doc(db, 'settings', prefsKey);

  const [groups, setGroups] = useState<Group[]>([]);
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<TagFilter | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // List or grid, for the databases that offer both - kept in the same
  // per-database preferences document as the sort and the hidden row.
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  // How the documents list is organised - ONE of three, because each
  // gives the list its one axis: 'groups' (the group tabs over the list),
  // 'list' (documents, folders through the drawer), 'explorer' (folders
  // in the list). Only the documents screen sets it; every other screen
  // still keeps groupsRowHidden as its own preference, and the two older
  // names below are derived from it there so nothing else has to change.
  const [listMode, setListModeState] = useState<ListMode | null>(null);
  const [groupsRowHiddenPref, setGroupsRowHiddenPref] = useState(false);
  const explorerMode = listMode === 'explorer';
  const groupsRowHidden = listMode ? listMode !== 'groups' : groupsRowHiddenPref;

  const { sortPref, selectSortField } = useSortPref(prefsKey);
  const { filterPending, requestDelete, requestDeleteMany, undo, toast } = usePendingDelete<T>();
  const tagApi = useTags();
  const select = useMultiSelect();

  useEffect(
    () =>
      onSnapshot(prefsDoc, (snapshot) => {
        setGroupsRowHiddenPref(!!snapshot.data()?.groupsRowHidden);
        setViewMode((snapshot.data()?.viewMode as 'list' | 'grid' | undefined) ?? 'list');
        // The three-way mode; a preferences document from before it
        // existed is read through the two switches it had.
        const stored = snapshot.data()?.listMode as ListMode | undefined;
        setListModeState(
          stored ?? (snapshot.data()?.explorerMode ? 'explorer' : snapshot.data()?.groupsRowHidden ? 'list' : 'groups')
        );
      }),
    [prefsKey]
  );

  useEffect(
    () =>
      // Filtered AND sorted client-side rather than by the query - combining
      // an equality filter with `orderBy` on a different field needs a
      // composite index set up by hand in the Firebase console, which this
      // app avoids everywhere else too. Since ownedQuery adds an equality
      // filter of its own to every read, that now goes for all of them.
      onSnapshot(ownedQuery('groups'), (snapshot) => {
        setGroups(
          snapshot.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<Group, 'id'>) }))
            .filter((g) => groupAppliesTo(g, groupKind))
            .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))
        );
      }),
    [groupKind]
  );

  function changeViewMode(mode: 'list' | 'grid') {
    setDoc(prefsDoc, { viewMode: mode }, { merge: true });
  }

  function setListMode(mode: ListMode) {
    setDoc(prefsDoc, { listMode: mode }, { merge: true });
  }

  function toggleGroupsRow() {
    setDoc(prefsDoc, { groupsRowHidden: !groupsRowHidden }, { merge: true });
  }

  // Pending deletes first: an item on its way out must not be counted by
  // anything below, or the counts flicker back when the toast expires.
  const present = filterPending(items);
  const inGroup =
    groupFilter === null
      ? present
      : groupFilter === UNASSIGNED_ID
        ? present.filter((item) => !groupIdOf(item))
        : present.filter((item) => groupIdOf(item) === groupFilter);
  const tagged = inGroup.filter((item) => matchesTagFilter(tagIdsOf(item), tagFilter));
  const needle = searchQuery.trim().toLowerCase();
  const searchIn = searchIgnoresFilters ? present : tagged;
  const found = needle
    ? searchIn.filter((item) =>
        matchesSearch
          ? matchesSearch(item, needle)
          : (searchTextOf ? searchTextOf(item) : titleOf(item)).toLowerCase().includes(needle)
      )
    : tagged;
  const displayed = sortItems(found, sortPref, titleOf, createdAtOf, updatedAtOf);

  // Only tags actually assigned to something in this database - not the
  // whole app-wide list - so the drawer stays a short, relevant menu.
  const usedTagIds = new Set(items.flatMap(tagIdsOf));
  const drawerTags = tagApi.tags.filter((t) => usedTagIds.has(t.id) && (tagAllowed ? tagAllowed(t) : true));

  // The group section the drawer draws, counted over this database only:
  // the same list the row above the cards shows, sentinels and all, so the
  // two can never disagree about what there is to pick.
  const groupSectionItems = [
    { id: null as string | null, name: 'Всі', color: GLASS_TEXT_MUTED, count: present.length },
    ...groups.map((g) => ({
      id: g.id as string | null,
      name: g.name,
      color: g.color,
      count: present.filter((item) => groupIdOf(item) === g.id).length,
    })),
    {
      id: UNASSIGNED_ID as string | null,
      name: 'Без групи',
      color: GLASS_TEXT_MUTED,
      count: present.filter((item) => !groupIdOf(item)).length,
    },
  ];

  const selected = items.filter((item) => select.selectedIds.has(item.id));

  // A real group, as opposed to "Всі", "Без групи" or one of the tabs that
  // is not a group at all (the documents screen's stickers). What the
  // cross-database sections under the list key off - they exist only when
  // a theme is actually chosen.
  const selectedGroupId =
    groupFilter && groupFilter !== UNASSIGNED_ID && groups.some((g) => g.id === groupFilter)
      ? groupFilter
      : null;

  // What the drawer's numbers say - totals over everything, not over what
  // the current filter leaves standing, so a count does not move as you
  // filter by it. The documents screen worked these out for itself and
  // every database left the drawer without any, which is why every folder
  // there read "0" however much was in it.
  const drawerCounts = (() => {
    const byTag: Record<string, number> = {};
    let untagged = 0;
    for (const item of items) {
      const ids = tagIdsOf(item);
      if (ids.length === 0) untagged += 1;
      for (const id of ids) byTag[id] = (byTag[id] ?? 0) + 1;
    }
    return { byTag, untagged };
  })();

  return {
    displayed,
    present,
    drawerCounts,
    groups,
    groupFilter,
    setGroupFilter,
    selectedGroupId,
    groupSectionItems,
    groupsRowHidden,
    toggleGroupsRow,
    viewMode,
    changeViewMode,
    tagFilter,
    setTagFilter,
    drawerTags,
    explorerMode,
    listMode: listMode ?? 'groups',
    setListMode,
    isSearching,
    setIsSearching,
    searchQuery,
    setSearchQuery,
    needle,
    sortPref,
    selectSortField,
    selected,
    requestDelete,
    requestDeleteMany,
    undo,
    toast,
    ...tagApi,
    ...select,
  };
}

export type DatabaseList<T extends { id: string }> = ReturnType<typeof useDatabaseList<T>>;
