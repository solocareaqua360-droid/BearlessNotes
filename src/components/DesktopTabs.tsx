import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { Ionicons } from './icons/Ionicons';
import { StackActions } from '@react-navigation/native';
import { addTab, closeTab, tabKey, useOpenTabs, type Tab } from '../navigation/desktopTabs';
import { useDocumentIndex } from '../hooks/useDocumentIndex';
import { navigationRef } from '../navigationRef';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';

// The tabs of the main pane, the documents list as the first of them.
//
// Switching between two open notes must not STACK them: navigating to
// «Editor» while already in one replaces it, so five tabs are five tabs and
// not five screens deep. Coming from anything else it is a push, which is
// what leaves «Назад» meaning "back to where you were".

// The whole sections a tab can be, and how the «+» offers them.
const SECTIONS: { ref: string; label: string; icon: string }[] = [
  { ref: 'Календар', label: 'Календар', icon: 'calendar-outline' },
  { ref: 'Дошки', label: 'Дошки', icon: 'easel-outline' },
  { ref: 'Більше', label: 'Бази', icon: 'apps-outline' },
  { ref: 'Tasks', label: 'Справи', icon: 'checkbox-outline' },
  { ref: 'Chat', label: 'Чат', icon: 'chatbubbles-outline' },
];

type Place = { kind: 'home' } | { kind: Tab['kind']; ref: string } | null;

// Where the navigator is standing, read off its deepest route.
function placeNow(): Place {
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
    case 'Документи':
      return { kind: 'home' };
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

function go(tab: Tab | null) {
  if (!navigationRef.isReady()) return;
  const current = navigationRef.getCurrentRoute()?.name;
  if (tab === null) {
    if (current === 'Editor') navigationRef.goBack();
    else navigationRef.navigate('Tabs', { screen: 'Документи' } as never);
    return;
  }
  if (tab.kind === 'note') {
    if (current === 'Editor') navigationRef.dispatch(StackActions.replace('Editor', { documentId: tab.ref }));
    else navigationRef.navigate('Editor', { documentId: tab.ref } as never);
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
    if (tab.kind !== 'board' && tab.kind !== 'database') return;
    const path = tab.kind === 'board' ? 'boards' : 'customDatabases';
    return onSnapshot(doc(db, path, tab.ref), (snapshot) => {
      const data = snapshot.data() as { title?: string; name?: string } | undefined;
      setName((tab.kind === 'board' ? data?.title : data?.name) ?? null);
    });
  }, [tab.kind, tab.ref]);
  if (tab.kind === 'note') return { title: index.get(tab.ref)?.title?.trim() || 'Без назви', icon: '' };
  if (tab.kind === 'board') return { title: name || 'Дошка', icon: 'easel-outline' };
  if (tab.kind === 'database') return { title: name || 'База', icon: 'grid-outline' };
  const section = SECTIONS.find((s) => s.ref === tab.ref);
  return { title: section?.label ?? tab.ref, icon: section?.icon ?? 'apps-outline' };
}

function TabItem({ tab, active, onClose }: { tab: Tab; active: boolean; onClose: () => void }) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const { title, icon } = useTabLabel(tab);
  return (
    <Pressable style={[styles.tab, active && styles.tabActive]} onPress={() => go(tab)}>
      {!!icon && <Ionicons name={icon as never} size={13} color={active ? theme.ink.primary : theme.ink.muted} />}
      <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
        {title}
      </Text>
      <Pressable hitSlop={6} style={styles.close} onPress={onClose}>
        <Ionicons name="close" size={13} color={theme.ink.faint} />
      </Pressable>
    </Pressable>
  );
}

export default function DesktopTabs() {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const tabs = useOpenTabs();
  const [place, setPlace] = useState<Place>(null);
  const [adding, setAdding] = useState(false);

  // Which one is in front. Read off the navigator rather than kept here, so
  // a tab stays lit when something else navigates - a card inside a note,
  // «Пов'язані», the back button. A note, a board or a database opened by
  // ANY route also becomes a tab here, so no screen has to register itself.
  useEffect(() => {
    const read = () => {
      const now = placeNow();
      setPlace(now);
      if (now && now.kind !== 'home' && now.kind !== 'section') addTab(now.kind, now.ref);
    };
    read();
    return navigationRef.addListener('state', read);
  }, []);

  const activeKey =
    place === null ? null : place.kind === 'home' ? 'home' : tabKey(place.kind, place.ref);

  function close(tab: Tab) {
    const next = closeTab(tab.key);
    // Only the tab in front has anything to switch away from.
    if (tab.key === activeKey) go(next);
  }

  return (
    <View style={styles.frame}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        <Pressable
          style={[styles.tab, styles.home, activeKey === 'home' && styles.tabActive]}
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
          style={[styles.tab, styles.home, adding && styles.tabActive]}
          onPress={() => setAdding((v) => !v)}
          accessibilityLabel="Нова вкладка"
        >
          <Ionicons name="add" size={16} color={theme.ink.muted} />
        </Pressable>
      </ScrollView>

      {adding && (
        <>
          <Pressable style={styles.scrim} onPress={() => setAdding(false)} />
          <View style={styles.menu}>
            {SECTIONS.map((section) => (
              <Pressable
                key={section.ref}
                style={styles.menuItem}
                onPress={() => {
                  setAdding(false);
                  go(addTab('section', section.ref));
                }}
              >
                <Ionicons name={section.icon as never} size={16} color={theme.ink.muted} />
                <Text style={styles.menuLabel}>{section.label}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
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
