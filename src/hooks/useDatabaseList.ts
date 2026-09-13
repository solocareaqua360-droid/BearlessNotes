import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query } from '../firestore';
import { setDoc } from '../utils/owned';
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
  // The group row at the head of the screen is a convenience now that the
  // groups also live in the drawer - held down, the folder button puts it
  // away.
  const [groupsRowHidden, setGroupsRowHidden] = useState(false);
  // List or grid, for the databases that offer both - kept in the same
  // per-database preferences document as the sort and the hidden row.
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

  const { sortPref, selectSortField } = useSortPref(prefsKey);
  const { filterPending, requestDelete, requestDeleteMany, undo, toast } = usePendingDelete<T>();
  const tagApi = useTags();
  const select = useMultiSelect();

  useEffect(
    () =>
      onSnapshot(prefsDoc, (snapshot) => {
        setGroupsRowHidden(!!snapshot.data()?.groupsRowHidden);
        setViewMode((snapshot.data()?.viewMode as 'list' | 'grid' | undefined) ?? 'list');
      }),
    [prefsKey]
  );

  useEffect(
    () =>
      // Filtered client-side rather than with a `where('kind','==',...)`
      // query - combining an equality filter with `orderBy` on a different
      // field needs a composite index set up by hand in the Firebase
      // console, which this app avoids everywhere else too.
      onSnapshot(query(collection(db, 'groups'), orderBy('name')), (snapshot) => {
        setGroups(
          snapshot.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<Group, 'id'>) }))
            .filter((g) => groupAppliesTo(g, groupKind))
        );
      }),
    [groupKind]
  );

  function changeViewMode(mode: 'list' | 'grid') {
    setDoc(prefsDoc, { viewMode: mode }, { merge: true });
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

  return {
    displayed,
    present,
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
