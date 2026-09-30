import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { Ionicons } from './icons/Ionicons';
import { StackActions } from '@react-navigation/native';
import { START_KEY, addTab, closeTab, leaveStart, noteRecent, openHome, openStart, showStart, stepTab, tabKey, useOpenTabs, useStartFront, useStartIsHome, type Tab } from '../navigation/desktopTabs';
import { useSoft } from '../theme/soft';
import { formatShortDate, parseDateKey } from '../utils/dateLocale';
import { useDocumentIndex } from '../hooks/useDocumentIndex';
import { navigationRef } from '../navigationRef';
import { navigateToTarget, targetInfo } from '../navigation/paneTargetInfo';
import type { PaneTarget } from '../navigation/paneTarget';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import { useDesktopNarrow } from '../constants/desktop';

// The strip is also the window's title bar now (see the shell); its buttons are not.
const DRAG = { WebkitAppRegion: 'drag' } as never;
const NO_DRAG = { WebkitAppRegion: 'no-drag' } as never;

// The tabs of the main pane, the documents list as the first of them.
//
// Switching between two open notes must not STACK them: navigating to
// «Editor» while already in one replaces it, so five tabs are five tabs and
// not five screens deep. Coming from anything else it is a push, which is
// what leaves «Назад» meaning "back to where you were".

// The whole sections a tab can be, and how the «+» offers them.
const SECTIONS: { ref: string; label: string; icon: string }[] = [
  // The documents list is a tab like the rest now - the ⌂ is the start page.
  { ref: 'Документи', label: 'Документи', icon: 'document-text-outline' },
  { ref: 'Календар', label: 'Календар', icon: 'calendar-outline' },
  { ref: 'Дошки', label: 'Дошки', icon: 'easel-outline' },
  { ref: 'Більше', label: 'Бази', icon: 'apps-outline' },
  { ref: 'Tasks', label: 'Справи', icon: 'checkbox-outline' },
  { ref: 'Chat', label: 'Чат', icon: 'chatbubbles-outline' },
];

type Place = { kind: 'home' } | { kind: Tab['kind']; ref: string } | null;

// Where the navigator is standing, read off its deepest route.
export function placeNow(): Place {
  if (!navigationRef.isReady()) return null;
  const route = navigationRef.getCurrentRoute();
  const params = route?.params as { documentId?: string; boardId?: string; databaseId?: string } | undefined;
  const name = route?.name as string | undefined;
  switch (name) {
    case 'Editor':
    case 'EditorModal':
      return params?.documentId ? { kind: 'note', ref: params.documentId } : null;
    case 'Board':
    case 'BoardCopy':
      return params?.boardId ? { kind: 'board', ref: params.boardId } : null;
    case 'CustomDatabase':
      return params?.databaseId ? { kind: 'database', ref: params.databaseId } : null;
    case 'FileView': {
      const fileId = (params as { fileId?: string } | undefined)?.fileId;
      return fileId ? { kind: 'file', ref: fileId } : null;
    }
    case 'Links':
      return { kind: 'target', ref: JSON.stringify({ kind: 'links', category: (params as { category?: string })?.category ?? 'other' }) };
    case 'Photos':
    case 'Files':
    case 'Stickers':
    case 'Flashcards':
    case 'Tags':
    case 'Groups':
    case 'Diary':
      return { kind: 'target', ref: JSON.stringify({ kind: 'route', route: name }) };
    case 'Документи':
      return { kind: 'section', ref: 'Документи' };
    case 'BoardsList':
      return { kind: 'section', ref: 'Дошки' };
    case 'Календар':
    case 'Більше':
    case 'Tasks':
    case 'Chat':
      return { kind: 'section', ref: name };
    default:
      return null;
  }
}

// THE HOME: the start page, with the documents list put under it rather
// than whatever was open - a note left under it showed its badge through.
// The page comes up once the navigator has moved, because the row hides
// the start page on every move and runs first.
export function goHome() {
  if (!navigationRef.isReady() || (navigationRef.getCurrentRoute()?.name as string | undefined) === 'Документи') {
    openHome();
    return;
  }
  let done = false;
  const off = navigationRef.addListener('state', () => {
    off();
    done = true;
    openHome();
  });
  navigationRef.navigate('Tabs', { screen: 'Документи' } as never);
  // A move that changes nothing tells nobody.
  setTimeout(() => {
    if (done) return;
    off();
    openHome();
  }, 400);
}

export function go(tab: Tab | null) {
  if (tab?.kind === 'start') {
    showStart(true);
    return;
  }
  if (tab === null) {
    goHome();
    return;
  }
  showStart(false);
  if (!navigationRef.isReady()) return;
  const current = navigationRef.getCurrentRoute()?.name;
  if (tab.kind === 'target') {
    try {
      navigateToTarget(JSON.parse(tab.ref) as PaneTarget);
    } catch {
      // A tab from an older build - nothing to go to.
    }
    return;
  }
  if (tab.kind === 'note') {
    if (current === 'Editor') navigationRef.dispatch(StackActions.replace('Editor', { documentId: tab.ref }));
    else navigationRef.navigate('Editor', { documentId: tab.ref } as never);
  } else if (tab.kind === 'file') {
    if (current === 'FileView') navigationRef.dispatch(StackActions.replace('FileView', { fileId: tab.ref }));
    else navigationRef.navigate('FileView', { fileId: tab.ref } as never);
  } else if (tab.kind === 'board') {
    navigationRef.navigate('Tabs', {
      screen: 'Дошки',
      params: { screen: 'Board', params: { boardId: tab.ref } },
    } as never);
  } else if (tab.kind === 'database') {
    if (current === 'CustomDatabase') {
      navigationRef.dispatch(StackActions.replace('CustomDatabase', { databaseId: tab.ref }));
    } else navigationRef.navigate('CustomDatabase', { databaseId: tab.ref } as never);
  } else if (tab.ref === 'Tasks' || tab.ref === 'Chat') {
    navigationRef.navigate(tab.ref as never);
  } else {
    navigationRef.navigate('Tabs', { screen: tab.ref } as never);
  }
}

// A tab's name and icon: a note's title from the index, a board's or a
// database's from its own document, a section's from the list above.
function useTabLabel(tab: Tab): { title: string; icon: string } {
  const index = useDocumentIndex();
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (tab.kind !== 'board' && tab.kind !== 'database' && tab.kind !== 'file') return;
    const path = tab.kind === 'board' ? 'boards' : tab.kind === 'file' ? 'files' : 'customDatabases';
    return onSnapshot(
      doc(db, path, tab.ref),
      (snapshot) => {
        const data = snapshot.data() as { title?: string; name?: string; fileName?: string } | undefined;
        setName((tab.kind === 'database' ? data?.name : tab.kind === 'file' ? data?.title || data?.fileName : data?.title) ?? null);
      },
      () => setName(null)
    );
  }, [tab.kind, tab.ref]);
  if (tab.kind === 'start') return { title: 'Нова вкладка', icon: 'sparkles-outline' };
  if (tab.kind === 'target') {
    try {
      return targetInfo(JSON.parse(tab.ref) as PaneTarget);
    } catch {
      return { title: 'База', icon: 'grid-outline' };
    }
  }
  // A day of the diary is a note too (`day_<date>`), and is called by its date.
  if (tab.kind === 'note' && tab.ref.startsWith('day_')) {
    return { title: formatShortDate(parseDateKey(tab.ref.slice(4))), icon: 'book-outline' };
  }
  if (tab.kind === 'note') return { title: index.get(tab.ref)?.title?.trim() || 'Без назви', icon: '' };
  if (tab.kind === 'board') return { title: name || 'Дошка', icon: 'easel-outline' };
  if (tab.kind === 'file') return { title: name || 'Файл', icon: 'document-outline' };
  if (tab.kind === 'database') return { title: name || 'База', icon: 'grid-outline' };
  const section = SECTIONS.find((s) => s.ref === tab.ref);
  return { title: section?.label ?? tab.ref, icon: section?.icon ?? 'apps-outline' };
}

function TabItem({ tab, active, onClose }: { tab: Tab; active: boolean; onClose: () => void }) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const { title, icon } = useTabLabel(tab);
  return (
    <Pressable style={[styles.tab, active && styles.tabActive, NO_DRAG]} onPress={() => go(tab)}>
      {!!icon && <Ionicons name={icon as never} size={13} color={active ? theme.ink.primary : theme.ink.muted} />}
      <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
        {title}
      </Text>
      {/* Where the tab stands among the things its arrows step through. */}
      {!!tab.seq && tab.seq.length > 1 && tab.seq.includes(tab.ref) && (
        <Text style={[styles.label, { color: theme.ink.faint }]}>{`${tab.seq.indexOf(tab.ref) + 1}/${tab.seq.length}`}</Text>
      )}
      <Pressable hitSlop={6} style={styles.close} onPress={onClose}>
        <Ionicons name="close" size={13} color={theme.ink.faint} />
      </Pressable>
    </Pressable>
  );
}

// The tab in front, read off the navigator the way the row reads it.
function useActiveTab(): Tab | null {
  const tabs = useOpenTabs();
  const startFront = useStartFront();
  const [place, setPlace] = useState<Place>(null);
  useEffect(() => {
    const read = () => setPlace(placeNow());
    read();
    return navigationRef.addListener('state', read);
  }, []);
  if (startFront || !place || place.kind === 'home') return null;
  const key = tabKey(place.kind, place.ref);
  return tabs.find((t) => t.key === key) ?? null;
}

// A tab opened with «Відкрити в новій вкладці» steps through what it was
// opened among: round arrows at the main pane's sides, and ← → on the
// keyboard while no text has the caret. The same tab, on the next thing.
export function TabStepper() {
  const S = useSoft();
  const tab = useActiveTab();
  const seq = tab?.seq ?? [];
  const at = tab ? seq.indexOf(tab.ref) : -1;
  const prev = at > 0 ? seq[at - 1] : null;
  const next = at >= 0 && at < seq.length - 1 ? seq[at + 1] : null;
  const stepping = !!tab && seq.length > 1 && at >= 0;
  const step = (ref: string | null) => {
    if (!tab || !ref) return;
    const moved = stepTab(tab.key, ref);
    if (moved) go(moved);
  };
  const latest = useRef({ prev, next, step });
  latest.current = { prev, next, step };
  useEffect(() => {
    if (!stepping) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const el = event.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      event.preventDefault();
      latest.current.step(event.key === 'ArrowLeft' ? latest.current.prev : latest.current.next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stepping]);
  if (!stepping) return null;
  const arrow = (side: 'left' | 'right', ref: string) => {
    const label = side === 'left' ? 'Попереднє' : 'Наступне';
    return (
      <Pressable
        onPress={() => step(ref)}
        accessibilityLabel={label}
        {...({ title: label } as object)}
        style={(state) => [
          stepStyles.arrow,
          side === 'left' ? { left: 12 } : { right: 12 },
          { backgroundColor: (state as { hovered?: boolean }).hovered ? S.fill : S.card, boxShadow: S.shadow },
        ]}
      >
        <Ionicons name={side === 'left' ? 'chevron-back' : 'chevron-forward'} size={20} color={S.ink} />
      </Pressable>
    );
  };
  return (
    <>
      {prev && arrow('left', prev)}
      {next && arrow('right', next)}
    </>
  );
}

const stepStyles = StyleSheet.create({
  arrow: {
    position: 'absolute',
    top: '50%',
    marginTop: -20,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 25,
  },
});

export default function DesktopTabs() {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const tabs = useOpenTabs();
  const [place, setPlace] = useState<Place>(null);
  const startFront = useStartFront();
  const startIsHome = useStartIsHome();
  const narrow = useDesktopNarrow();

  // Which one is in front. Read off the navigator rather than kept here, so
  // a tab stays lit when something else navigates - a card inside a note,
  // «Пов'язані», the back button. A note, a board or a database opened by
  // ANY route also becomes a tab here, so no screen has to register itself.
  useEffect(() => {
    // What it read last: an event that leaves the navigator where it was
    // (params settling, a screen's own setParams) is not a move.
    let last: string | undefined;
    const read = () => {
      const now = placeNow();
      setPlace(now);
      const key = !now ? '' : now.kind === 'home' ? 'home' : `${now.kind}:${now.ref}`;
      if (key === last) return;
      last = key;
      // The navigator moved: whatever stood in front of it gives way.
      showStart(false);
      if (now && (now.kind === 'note' || now.kind === 'board' || now.kind === 'database' || now.kind === 'target' || now.kind === 'file')) {
        addTab(now.kind, now.ref);
        if (now.kind === 'note' || now.kind === 'board' || now.kind === 'database') noteRecent(now.kind, now.ref);
      }
    };
    read();
    const off = navigationRef.addListener('state', read);
    // The app opens at home - once the navigator is there to open it over.
    let waiting: ReturnType<typeof setTimeout> | undefined;
    const launch = () => {
      if (!navigationRef.isReady()) {
        waiting = setTimeout(launch, 50);
        return;
      }
      read();
      goHome();
    };
    launch();
    return () => {
      off();
      if (waiting) clearTimeout(waiting);
    };
  }, []);

  const activeKey = startFront
    ? startIsHome
      ? 'home'
      : START_KEY
    : place === null
      ? null
      : place.kind === 'home'
        ? 'home'
        : tabKey(place.kind, place.ref);

  function close(tab: Tab) {
    if (tab.kind === 'start') {
      leaveStart();
      return;
    }
    const next = closeTab(tab.key);
    // Only the tab in front has anything to switch away from.
    if (tab.key === activeKey) go(next);
  }

  return (
    <View style={[styles.frame, DRAG]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.row, narrow && { paddingLeft: 26 }]}>
        <Pressable
          style={[styles.tab, styles.home, activeKey === 'home' && styles.tabActive, NO_DRAG]}
          onPress={() => go(null)}
        >
          <Ionicons
            name="home-outline"
            size={14}
            color={activeKey === 'home' ? theme.ink.primary : theme.ink.muted}
          />
        </Pressable>
        {tabs.map((tab) => (
          <TabItem key={tab.key} tab={tab} active={tab.key === activeKey} onClose={() => close(tab)} />
        ))}
        <Pressable
          style={[styles.tab, styles.home, NO_DRAG]}
          onPress={openStart}
          accessibilityLabel="Нова вкладка"
        >
          <Ionicons name="add" size={16} color={theme.ink.muted} />
        </Pressable>
      </ScrollView>

    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  frame: {
    backgroundColor: t.ground,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.edge.hairline,
    // Over the toolbar under it, so the menu of «+» can hang down.
    zIndex: 30,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 28,
    maxWidth: 220,
    paddingLeft: 12,
    paddingRight: 6,
    borderRadius: 8,
  },
  home: {
    paddingHorizontal: 10,
  },
  tabActive: {
    backgroundColor: t.selected,
  },
  label: {
    flexShrink: 1,
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: t.ink.muted,
  },
  labelActive: {
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.primary,
  },
  close: {
    padding: 2,
    borderRadius: 5,
  },
  // A sheet over the whole window that only catches the tap away.
  scrim: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  } as never,
  menu: {
    position: 'absolute',
    top: 38,
    left: 10,
    minWidth: 180,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: t.paper.fill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.edge.hairline,
    boxShadow: '0px 8px 24px rgba(0,0,0,0.16)',
  } as never,
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 34,
    paddingHorizontal: 14,
  },
  menuLabel: {
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: t.ink.primary,
  },
});
