import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { doc, onSnapshot } from '../firestore';
import { setDoc } from '../utils/owned';
import { db } from '../firebase';
import { hapticButtonDown } from '../utils/haptics';
import { Ionicons } from '@expo/vector-icons';
import GlassDrop from './GlassDrop';
import { useTheme } from '../theme/ThemeProvider';
import { MaterialTopTabBarProps } from '@react-navigation/material-top-tabs';
import { useIsFocused } from '@react-navigation/native';
import { GlassPortal } from './GlassPortal';
import { NAV_BOTTOM, NAV_BUTTON, NAV_GAP, NAV_PADDING } from '../constants/rail';
import { useNavDockHasContext, useNavDockHidden } from '../navigation/navDock';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Outline glyphs at 24, the same set and the same size as everything else
// on this screen - what made these read as thinner and smaller before was
// standing at 20 next to the capsule's 24, not the weight. One pack, one
// weight: a window with both filled and outline icons in it reads as two
// different sets of icons.
const ICON_BY_ROUTE: Record<string, keyof typeof Ionicons.glyphMap> = {
  Документи: 'document-text-outline',
  Календар: 'calendar-outline',
  Дошки: 'easel-outline',
  Більше: 'apps-outline',
};

const ICON_SIZE = 24;
// Every day the same width, so the dock can put the selected one under
// the thumb without measuring anything.
const STRIP_ITEM = 38;
// Seven of them, and no more - the user's own correction. The dock stays
// a pill rather than a ribbon, and seven is the number a week already is.
// The days BEYOND those seven are still there, just off the edge: that is
// what lets the strip slide instead of flicking from one set to the next.
const STRIP_VISIBLE = 7;
const STRIP_WIDTH = STRIP_ITEM * STRIP_VISIBLE;
// The same blue the calendar's own history dot uses - the mark has to
// mean the same thing in both places or it means nothing in either.
const STRIP_MARK_ACCENT = '#60A5FA';

// The navigation island. It used to lie across the bottom of the screen;
// it now stands on its end at the right edge, at the foot of the rail
// every other floating control shares (see constants/rail).
//
// Drawn through the portal, like every other piece of glass: the blur has
// to sit outside the view it blurs, and the screens are what the blur
// target wraps.
export default function FloatingIslandTabBar({ state, navigation }: MaterialTopTabBarProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // Held down, the island shrinks to the row of dots a home screen uses
  // to say which page you are on: the swipe between tabs is the way
  // around now, and the buttons are only the shortcut. Held again, it
  // comes back. Kept in settings, so it stays the way it was left.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(
    () =>
      onSnapshot(doc(db, 'settings', 'navIsland'), (snapshot) => {
        setCollapsed(!!snapshot.data()?.collapsed);
      }),
    []
  );
  function toggleCollapsed() {
    hapticButtonDown();
    setDoc(doc(db, 'settings', 'navIsland'), { collapsed: !collapsed }, { merge: true });
  }
  // The island draws through the portal, which reaches over the whole app
  // - including screens pushed on top of the tabs. Without this it stayed
  // floating over an open note, where there is nothing to navigate to.
  const tabsFocused = useIsFocused();
  // The dock's CONTEXT half moved out to ContextDock, which stands over
  // the whole app - because the screens that have folders are mostly
  // PUSHED over the tabs (files, photos, links, boards, the custom
  // databases), and a tab bar is not drawn there at all. What is left
  // here is the one thing that is genuinely about tabs: the four desks.
  //
  // And the desks stand aside while a context is showing. The user's own
  // question, and the right one: what would four desk buttons be FOR at
  // that depth? Nothing - so they are not there.
  const hasContext = useNavDockHasContext();
  const [, setDockHidden] = useNavDockHidden();

  if (!tabsFocused || hasContext) return null;

  return (
    <GlassPortal>
      <View style={[styles.wrap, { bottom: NAV_BOTTOM + insets.bottom }]} pointerEvents="box-none">
        {collapsed ? (
          <GlassDrop style={styles.dotsShell}>
          <Pressable style={styles.dotsRow} onLongPress={toggleCollapsed} delayLongPress={400}>
            {state.routes.map((route, index) => (
              // A dot is still a way to get there: the indicator says
              // where you are, and tapping one of them takes you.
              <Pressable
                key={route.key}
                hitSlop={6}
                onPress={() => {
                  if (state.index !== index) navigation.navigate(route.name);
                }}
                onLongPress={toggleCollapsed}
                delayLongPress={400}
              >
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: theme.glass.inkMuted },
                    state.index === index && [styles.dotActive, { backgroundColor: theme.glass.ink }],
                  ]}
                />
              </Pressable>
            ))}
          </Pressable>
          </GlassDrop>
        ) : (
        <GlassDrop style={styles.islandShell}>
        <Pressable style={styles.islandRow} onLongPress={toggleCollapsed} delayLongPress={400}>
          {state.routes.map((route, index) => {
            const focused = state.index === index;
            const icon = ICON_BY_ROUTE[route.name] ?? 'ellipse-outline';
            return (
              <Pressable
                key={route.key}
                onPress={() => {
                  // Pressing the desk you are already on brings its
                  // context back - see useNavDockHidden. The desks only
                  // stand here at all when a context is put away, so it
                  // is the one thing that press can usefully mean.
                  if (focused && hasContext) {
                    setDockHidden(false);
                    return;
                  }
                  const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                  if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
                }}
                // Held down, a button folds the island away just as its
                // own edge does - the buttons cover nearly all of it, and
                // a gesture that needs you to miss them is a gesture you
                // have to aim for.
                onLongPress={toggleCollapsed}
                delayLongPress={400}
              >
                {/* The tab you are on is GLASS ON GLASS - a second, denser
                    drop laid over the bar, with its glyph in the accent -
                    which is what the user's reference does and what the
                    solid disc here was not. It carries no blur of its own
                    (blurAmount 0): the bar underneath is already blurring
                    the screen, and a blur inside a blur costs a great
                    deal on Android for something the eye cannot separate.
                    No lift either - it is lying ON the glass, not above
                    the screen. */}
                {focused ? (
                  // A lens over the bar, not a pane: convex, a touch
                  // opaque, and the glyph under it drawn a little larger
                  // than its neighbours - what a lens does to what is
                  // beneath it. The user's word was "риб'яче око".
                  <GlassDrop
                    style={[styles.button, styles.lens]}
                    lift="none"
                    blurAmount={0}
                    convex
                    glassOpacity={Math.min(0.5, Math.max(0.24, theme.glass.opacity * 2.4))}
                  >
                    {/* Same ink and same size as its neighbours: the lens
                        marks the selection, the glyph does not. Drawn
                        larger it looked bold - a scaled outline glyph
                        thickens with it - and in the accent it looked
                        like a different family from the other three. */}
                    <Ionicons name={icon} size={ICON_SIZE} color={theme.glass.ink} />
                  </GlassDrop>
                ) : (
                  <View style={styles.button}>
                    <Ionicons name={icon} size={ICON_SIZE} color={theme.glass.ink} />
                  </View>
                )}
              </Pressable>
            );
          })}
        </Pressable>
        </GlassDrop>
        )}
      </View>
    </GlassPortal>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  islandShell: {
    padding: NAV_PADDING,
  },
  islandRow: {
    flexDirection: 'row',
    gap: NAV_GAP,
  },
  dotsShell: {
    paddingVertical: 12,
    paddingHorizontal: 10,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 999,
  },
  dotActive: {
    width: 8,
    height: 8,
  },
  button: {
    width: NAV_BUTTON,
    height: NAV_BUTTON,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lens: {
    transform: [{ scale: 1.12 }],
  },
});
