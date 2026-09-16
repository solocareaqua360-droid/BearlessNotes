import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { useNavDockContext } from '../navigation/navDock';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
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
const STRIP_ITEM = 44;

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
  // Where the screen underneath currently is - see navigation/navDock.tsx
  // and «план навігації» in the project memory. While there is a path to
  // show, the dock IS the path: the same pill in the same place, holding
  // something else. That is the whole idea - the app does not grow a new
  // control for every context, the one control changes shape.
  const dock = useNavDockContext();
  const trail = dock?.kind === 'path' ? dock : null;
  const strip = dock?.kind === 'strip' ? dock : null;
  const trailRef = useRef<ScrollView>(null);
  const stripRef = useRef<ScrollView>(null);
  const [stripViewport, setStripViewport] = useState(0);
  const depth = trail?.crumbs.length ?? 0;
  useEffect(() => {
    if (!depth) return;
    // Deeper means further right, and the deepest is where you are.
    const id = setTimeout(() => trailRef.current?.scrollToEnd({ animated: true }), 0);
    return () => clearTimeout(id);
  }, [depth]);
  // The day you are on sits under your thumb, in the middle - a scrubber
  // you have to hunt along is not a scrubber.
  const stripIndex = strip ? strip.items.findIndex((item) => item.key === strip.selected) : -1;
  useEffect(() => {
    if (stripIndex < 0 || !stripViewport) return;
    const x = Math.max(0, stripIndex * STRIP_ITEM + STRIP_ITEM / 2 - stripViewport / 2);
    const id = setTimeout(() => stripRef.current?.scrollTo({ x, animated: true }), 0);
    return () => clearTimeout(id);
  }, [stripIndex, stripViewport]);

  if (!tabsFocused) return null;
  const here = state.routes[state.index];
  const hereIcon = ICON_BY_ROUTE[here?.name] ?? 'ellipse-outline';

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
        strip ? (
        // A run of days under the thumb. Same shell, same height: the
        // dock holding time instead of places.
        <GlassDrop style={[styles.islandShell, styles.trailShell]}>
        <Pressable onLongPress={toggleCollapsed} delayLongPress={400}>
          <ScrollView
            ref={stripRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            onLayout={(e) => setStripViewport(e.nativeEvent.layout.width)}
          >
            {strip.items.map((item) => {
              const current = item.key === strip.selected;
              const body = (
                <>
                  <Text
                    style={[
                      styles.stripLabel,
                      { color: current ? theme.glass.ink : theme.glass.inkMuted },
                    ]}
                  >
                    {item.label}
                  </Text>
                  {!!item.sub && (
                    <Text
                      style={[
                        styles.stripSub,
                        // The day you are on reads as ONE thing, number
                        // and weekday together, not a number with a
                        // footnote under it.
                        { color: current ? theme.glass.ink : theme.glass.inkMuted },
                      ]}
                    >
                      {item.sub}
                    </Text>
                  )}
                </>
              );
              return (
                <Pressable
                  key={item.key}
                  onPress={() => strip.onPick(item.key)}
                  onLongPress={toggleCollapsed}
                  delayLongPress={400}
                >
                  {current ? (
                    // The day you are on, in the lens the dock marks the
                    // desk you are on with.
                    <GlassDrop style={styles.stripItem} lift="none" blurAmount={0} convex>
                      {body}
                    </GlassDrop>
                  ) : (
                    <View style={styles.stripItem}>{body}</View>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
        </GlassDrop>
        ) : trail ? (
        // The path, in the dock's own shell: same height, same place,
        // wider. A morph has to change SHAPE to be noticed at all - this
        // project has already reverted one that only cross-faded.
        <GlassDrop style={[styles.islandShell, styles.trailShell]}>
        <Pressable style={styles.trailRow} onLongPress={toggleCollapsed} delayLongPress={400}>
          {/* The desk you are on, and the way back out of every folder at
              once. Leaving the folders and giving the dock back to the
              desks is deliberately the SAME press: at the root there is
              no path left to show. */}
          <Pressable
            hitSlop={6}
            onPress={() => trail.onGo('')}
            onLongPress={toggleCollapsed}
            delayLongPress={400}
            style={styles.trailHome}
          >
            <Ionicons name={hereIcon} size={20} color={theme.glass.ink} />
          </Pressable>
          <ScrollView
            ref={trailRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.trailStrip}
          >
            {trail.crumbs.map((segment, index) => {
              const isLast = index === trail.crumbs.length - 1;
              const target = trail.crumbs.slice(0, index + 1).join('/');
              return (
                <View key={target} style={styles.trailPair}>
                  <Ionicons name="chevron-forward" size={13} color={theme.glass.inkMuted} />
                  {isLast ? (
                    // Where you are, marked the way the dock marks the
                    // desk you are on - the same lens, so the two shapes
                    // of this one control speak the same language.
                    <GlassDrop style={styles.trailCurrent} lift="none" blurAmount={0} convex>
                      <Text style={[styles.trailLabel, styles.trailLabelCurrent, { color: theme.glass.ink }]} numberOfLines={1}>
                        {segment}
                      </Text>
                    </GlassDrop>
                  ) : (
                    <Pressable
                      onPress={() => trail.onGo(target)}
                      onLongPress={toggleCollapsed}
                      delayLongPress={400}
                      style={styles.trailSegment}
                    >
                      <Text style={[styles.trailLabel, { color: theme.glass.inkMuted }]} numberOfLines={1}>
                        {segment}
                      </Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
          </ScrollView>
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
        )
        )}
      </View>
    </GlassPortal>
  );
}

const styles = StyleSheet.create({
  // Back across the foot of the screen, centred, the way it was before it
  // stood on the rail: the swipe between tabs is the main way around now,
  // and the island is the shortcut - which belongs under the thumb rather
  // than up the side.
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  // The shell is the drop's (see GlassDrop); what is left here is the
  // room inside it and the row of buttons within that. Two views because
  // the whole island is also one long-press target - holding anywhere on
  // it folds it away.
  islandShell: {
    padding: NAV_PADDING,
  },
  islandRow: {
    flexDirection: 'row',
    gap: NAV_GAP,
  },
  // The dock holding a path instead of the desks. Its height is the
  // island's own (the buttons set it), so the two shapes read as one
  // control in two states rather than two different bars; only the width
  // changes, and it stops well short of the screen so it still reads as
  // a pill lying on the screen rather than a bar across it.
  trailShell: {
    maxWidth: '88%',
  },
  trailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: NAV_BUTTON,
  },
  trailHome: {
    width: NAV_BUTTON - 8,
    height: NAV_BUTTON,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trailStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 4,
  },
  trailPair: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  trailSegment: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  trailCurrent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  trailLabel: {
    fontSize: 14,
    maxWidth: 160,
    fontFamily: FONT_REGULAR,
  },
  stripItem: {
    width: STRIP_ITEM,
    height: NAV_BUTTON,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  stripLabel: {
    fontSize: 16,
    fontFamily: FONT_SEMIBOLD,
    fontWeight: '600',
  },
  stripSub: {
    fontSize: 10,
    marginTop: 1,
    fontFamily: FONT_REGULAR,
  },
  trailLabelCurrent: {
    fontFamily: FONT_SEMIBOLD,
    fontWeight: '600',
  },
  // The collapsed island: the page dots, in the same glass.
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
  // The lens bulges a little past the bar's own edge, as a bead of
  // glass sitting on a surface does.
  lens: {
    transform: [{ scale: 1.12 }],
  },
});
