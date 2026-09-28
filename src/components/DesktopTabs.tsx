import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StackActions } from '@react-navigation/native';
import { closeTab, useOpenTabs } from '../navigation/desktopTabs';
import { useDocumentIndex } from '../hooks/useDocumentIndex';
import { navigationRef } from '../navigationRef';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';

// The open notes, along the top, with the list itself as the first one.
//
// Switching between two open notes must not STACK them: navigating to
// «Editor» while already in one replaces it, so five tabs are five
// tabs and not five screens deep. Coming from the list it is a push,
// which is what leaves «Назад» meaning "back to the list".
function goTo(documentId: string | null) {
  if (!navigationRef.isReady()) return;
  const current = navigationRef.getCurrentRoute()?.name;
  if (documentId === null) {
    if (current === 'Editor') navigationRef.goBack();
    return;
  }
  if (current === 'Editor') {
    navigationRef.dispatch(StackActions.replace('Editor', { documentId }));
    return;
  }
  navigationRef.navigate('Editor', { documentId } as never);
}

export default function DesktopTabs() {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const tabs = useOpenTabs();
  const index = useDocumentIndex();

  // Which one is in front. Read off the navigator rather than kept
  // here, so a tab stays lit when something else navigates - a card
  // inside a note, «Пов'язані», the back button.
  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => {
    const read = () => {
      if (!navigationRef.isReady()) return;
      const route = navigationRef.getCurrentRoute();
      const params = route?.params as { documentId?: string } | undefined;
      setActiveId(route?.name === 'Editor' ? (params?.documentId ?? null) : null);
    };
    read();
    return navigationRef.addListener('state', read);
  }, []);

  if (tabs.length === 0) return null;

  return (
    <View style={styles.frame}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        <Pressable
          style={[styles.tab, styles.home, activeId === null && styles.tabActive]}
          onPress={() => goTo(null)}
        >
          <Ionicons
            name="home-outline"
            size={14}
            color={activeId === null ? theme.ink.primary : theme.ink.muted}
          />
        </Pressable>
        {tabs.map((id) => {
          const active = id === activeId;
          const title = index.get(id)?.title?.trim() || 'Без назви';
          return (
            <Pressable
              key={id}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => goTo(id)}
            >
              <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
                {title}
              </Text>
              <Pressable
                hitSlop={6}
                style={styles.close}
                onPress={() => goTo(closeTab(id))}
              >
                <Ionicons name="close" size={13} color={theme.ink.faint} />
              </Pressable>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  frame: {
    backgroundColor: t.ground,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.edge.hairline,
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
    fontSize: 12,
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
});
