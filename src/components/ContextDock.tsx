import { useMemo, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GlassDrop from './GlassDrop';
import { GlassPortal } from './GlassPortal';
import { useTheme } from '../theme/ThemeProvider';
import { hapticButtonDown } from '../utils/haptics';
import { NAV_BOTTOM, NAV_BUTTON, NAV_PADDING } from '../constants/rail';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { DockBead, useNavDockActions, useNavDockFace, useNavDockBeads, useNavDockContext, useNavDockHidden, useNavDockLeave, useNavDockTargets } from '../navigation/navDock';

// The dock, when it is holding a CONTEXT rather than the four desks.
//
// It used to live inside FloatingIslandTabBar, which was fine while the
// only screens with folders were tabs. They are not: files, photos,
// links, stickers, boards and the custom databases are all PUSHED over
// the tabs, so the tab bar - and with it the dock - is not drawn there at
// all. The path was being published to nobody, which is what the user
// reported as "док залишився старим" in every database but notes.
//
// So the context half of the dock stands on its own, above the whole app,
// and the tab bar stands aside while it is showing (see
// useNavDockHasContext). One control, drawn in one place, whatever screen
// is underneath.
const STRIP_ITEM = 38;
const STRIP_VISIBLE = 7;
const STRIP_WIDTH = STRIP_ITEM * STRIP_VISIBLE;
// The same blue the calendar's own history dot uses - a mark has to mean
// the same thing in both places or it means nothing in either.
const STRIP_MARK_ACCENT = '#60A5FA';
// How much of the card behind is visible. Enough to know it is there,
// not enough to argue with the one in front.
const BEHIND_EDGE = 7;
// TEMPORARY, FOR TESTING ONLY - the user's own request, and a fair one:
// glass on glass on a dark screen is "каша", and a stack cannot be
// judged when its two cards look identical. Blue is where-you-are, red
// is what-you-can-do, both opaque. Replace with the real treatment once
// the shape itself is settled.
const FACE_CONTEXT = '#1D4ED8';
const FACE_ACTIONS = '#B91C1C';

export default function ContextDock() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const dock = useNavDockContext();
  // The way out of the SCREEN, which is true even at a database's root,
  // where there is no path to show. The user's own ask: standing in a
  // database, the way back to the databases was the small arrow in the
  // top-right corner of the rail, and it belongs under the thumb.
  const leave = useNavDockLeave();
  // The other card in the stack: what this screen can DO. Two capsules,
  // one behind the other, swapped with a light swipe - the user's own
  // reference, a Samsung lock screen, and the shape it keeps: the back
  // one shows only an EDGE, both are the same size in the same place,
  // and whatever stands beside the stack does not move at all.
  const actions = useNavDockActions();
  // What never changes stands beside the stack and does not move: search
  // on the left, creating on the right. The user's own arrangement, and
  // Samsung's own reasoning - a pile of cards is for what changes.
  const beads = useNavDockBeads();
  // Lives in the provider now - a screen has to be able to ask for the
  // path back when an action finishes somewhere else.
  const [face, setFace] = useNavDockFace();
  // Back to where-you-are whenever a context arrives - changing screen,
  // or stepping into folders from a root that had none. Watching the
  // context's KIND was not enough: moving between two screens that both
  // have no path (or both have a path) never changed it, so the stack
  // stayed on whichever card it had been left on. That is the
  // randomness the user reported - "ніколи не знаєш, як воно буде".
  // Back to where-you-are when the SCREEN changes - which desk, which
  // database, which shape - rather than only when a context appears.
  // Now that the desks are a context too, "a context arrived" is almost
  // always true and would never have reset anything.
  const contextKey = dock ? `${dock.kind}:${dock.icon}` : '';
  useEffect(() => setFace('context'), [contextKey, setFace]);
  // What is actually drawn. A context always wins the front unless the
  // swipe asked otherwise; with no context there is only one card to
  // show, so there is nothing to be uncertain about.
  // A card with nothing on it is not a card: with no actions published
  // there is only the context to show, whatever the swipe last asked
  // for, and with no context only the actions.
  const showing: 'context' | 'actions' = !dock
    ? 'actions'
    : actions?.length && face === 'actions'
      ? 'actions'
      : 'context';
  const stacked = !!dock && !!actions?.length;
  // ONE gesture, not a new one per render. A fresh Gesture object hands
  // GestureDetector a new configuration on every render, and a gesture
  // being reconfigured is a gesture that never activates - the same
  // thing that stopped the reference drag dead two days ago. It was
  // being rebuilt here on every render of a dock that re-renders
  // constantly, which is why the swipe did not exist at all.
  // Read through a ref inside the gesture, which is built once: the
  // gesture must not be rebuilt when the face changes, or it stops
  // activating (the whole reason the swipe did not exist at first).
  const faceRef = useRef(face);
  faceRef.current = face;
  const swipe = useMemo(
    () =>
      Gesture.Pan()
        // Strictly vertical, and it gives up the moment it reads as
        // sideways: the capsule under it scrolls horizontally (the days,
        // the path), and that has to keep working.
        .activeOffsetY([-10, 10])
        .failOffsetX([-16, 16])
        .runOnJS(true)
        // UP only, and every swipe swaps them - the user's own
        // correction, and Samsung's own behaviour: a stack of two is a
        // cycle, so there is nothing to remember about which way is
        // which. Down does nothing on purpose; it is the direction the
        // system itself uses just below here.
        .onEnd((e) => {
          if (e.translationY > -10) return;
          hapticButtonDown();
          setFace(faceRef.current === 'context' ? 'actions' : 'context');
        }),
    []
  );

  const [, setHidden] = useNavDockHidden();
  // A card being carried can step onto a crumb - the same registry the
  // folder rows use, handed up by whichever screen is carrying.
  const targets = useNavDockTargets();

  const trail = dock?.kind === 'path' ? dock : null;
  const strip = dock?.kind === 'strip' ? dock : null;
  const desks = dock?.kind === 'desks' ? dock : null;
  const trailRef = useRef<ScrollView>(null);
  const stripRef = useRef<ScrollView>(null);

  const depth = trail?.crumbs.length ?? 0;
  useEffect(() => {
    if (!depth) return;
    // Deeper means further right, and the deepest is where you are.
    const id = setTimeout(() => trailRef.current?.scrollToEnd({ animated: true }), 0);
    return () => clearTimeout(id);
  }, [depth]);

  // The day you are on sits under your thumb, in the middle - a scrubber
  // you have to hunt along is not a scrubber. It SLIDES there: the days
  // either side stay mounted just off the edge.
  const stripIndex = strip ? strip.items.findIndex((item) => item.key === strip.selected) : -1;
  const stripSettled = useRef(false);
  useEffect(() => {
    if (stripIndex < 0) {
      stripSettled.current = false;
      return;
    }
    const x = Math.max(0, stripIndex * STRIP_ITEM + STRIP_ITEM / 2 - STRIP_WIDTH / 2);
    // The first placement is not a journey - opening the calendar should
    // not show the strip travelling in from the first of the month.
    const animated = stripSettled.current;
    stripSettled.current = true;
    const id = setTimeout(() => stripRef.current?.scrollTo({ x, animated }), 0);
    return () => clearTimeout(id);
  }, [stripIndex]);

  if (!dock && !leave && !actions?.length && !beads.left && !beads.right) return null;

  // The way out, as a bead of its own beside the pill rather than a
  // button inside it - the user's own call: inside, it read as an eighth
  // day and had to be aimed at. It carries what this context IS, so it
  // says where it takes you.
  //
  // For folders, leaving the context and walking out to the root are the
  // same move, and the context ends itself when the root is reached. A
  // calendar has no root to walk to, so there it is simply put away.
  // One bead, stepping out one level at a time - the same ladder the
  // note's back arrow walks. Inside folders it walks to the root; at the
  // root it leaves the database altogether; a calendar, which has no
  // root, is simply put away.
  // The bead only appears where it has a job NOBODY ELSE has. Inside
  // folders it had none: it walked to the root, and so does the first
  // crumb - "дві кнопки одна функція це невірно", and the user was
  // right. There the path stands alone, and its first crumb is the
  // database's own icon rather than the word "Всі", so one press still
  // means one thing and the dock still says WHICH database you are
  // walking in. At the root there is no path to show and the bead is the
  // way out of the database. A calendar has neither, so the bead puts it
  // away.
  const stepOut = () => {
    if (strip) return setHidden(true);
    leave?.onLeave();
  };
  // The bead shows only where it has a job nobody else has: at a
  // database's root, where it leaves the database, and on the calendar,
  // which has no root to walk to and is simply put away. Inside folders
  // the first crumb already goes to the root, and two buttons for one
  // job is what the user rightly refused.
  const showBead = !!strip || (!trail && !!leave);
  // What the bead carries: the thing it is LEAVING, when there is one.
  const icon = ((leave?.icon ?? dock?.icon) as keyof typeof Ionicons.glyphMap) ?? 'ellipse-outline';

  return (
    <GlassPortal>
      <View style={[styles.wrap, { bottom: NAV_BOTTOM + insets.bottom }]} pointerEvents="box-none">
        <View style={styles.row}>
          {!!beads.left && <Bead bead={beads.left} theme={theme} />}
          {showBead && (
            <Pressable onPress={stepOut}>
              <GlassDrop style={styles.exitBead}>
                <Ionicons name="chevron-back" size={11} color={theme.glass.inkMuted} />
                <Ionicons name={icon} size={20} color={theme.glass.ink} />
              </GlassDrop>
            </Pressable>
          )}

          <GestureDetector gesture={swipe}>
          <View style={styles.stack}>
            {/* The card behind, seen as an EDGE and nothing more - a few
                points of the same glass, a little narrower, so it reads
                as BEHIND rather than beside. Empty on purpose: what a
                stack's back card shows is that it is there. */}
            {stacked && (
              <GlassDrop
                style={[styles.behind, showing === 'context' ? styles.faceActions : styles.faceContext]}
              />
            )}

          {showing === 'context' && desks && (
            desks.collapsed ? (
              // The dots a home screen uses to say which page you are on
              // - still a way to get there, and still what "collapsed"
              // has meant here since the user first asked for it.
              <GlassDrop style={styles.dotsShell}>
                <Pressable
                  style={styles.dotsRow}
                  onLongPress={desks.onToggleCollapsed}
                  delayLongPress={400}
                >
                  {desks.desks.map((desk) => (
                    <Pressable
                      key={desk.key}
                      hitSlop={6}
                      onPress={desk.onPress}
                      onLongPress={desks.onToggleCollapsed}
                      delayLongPress={400}
                    >
                      <View
                        style={[
                          styles.dot,
                          { backgroundColor: desk.active ? theme.glass.ink : theme.glass.inkMuted },
                          desk.active && styles.dotActive,
                        ]}
                      />
                    </Pressable>
                  ))}
                </Pressable>
              </GlassDrop>
            ) : (
              <GlassDrop style={[styles.shell, styles.faceContext]}>
                <Pressable
                  style={styles.actionRow}
                  onLongPress={desks.onToggleCollapsed}
                  delayLongPress={400}
                >
                  {desks.desks.map((desk) => (
                    <Pressable
                      key={desk.key}
                      onPress={desk.onPress}
                      onLongPress={desks.onToggleCollapsed}
                      delayLongPress={400}
                    >
                      {desk.active ? (
                        // A lens over the bar, not a pane: the tab you
                        // are on, marked the way this dock marks
                        // everything you are on.
                        <GlassDrop style={styles.actionButton} lift="none" blurAmount={0} convex>
                          <Ionicons
                            name={desk.icon as keyof typeof Ionicons.glyphMap}
                            size={24}
                            color={theme.glass.ink}
                          />
                        </GlassDrop>
                      ) : (
                        <View style={styles.actionButton}>
                          <Ionicons
                            name={desk.icon as keyof typeof Ionicons.glyphMap}
                            size={24}
                            color={theme.glass.ink}
                          />
                        </View>
                      )}
                    </Pressable>
                  ))}
                </Pressable>
              </GlassDrop>
            )
          )}

          {showing === 'context' && strip && (
            <GlassDrop style={[styles.shell, styles.faceContext]}>
              <ScrollView
                ref={stripRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.stripViewport}
              >
                {strip.items.map((item) => {
                  const current = item.key === strip.selected;
                  // The lens is the day you PICKED, riding in the middle;
                  // TODAY is said in colour instead. Two sentences, not
                  // two claims on the same one.
                  const ink = item.anchor
                    ? theme.accent
                    : current
                      ? theme.glass.ink
                      : theme.glass.inkMuted;
                  const body = (
                    <>
                      <Text style={[styles.stripLabel, item.anchor && styles.stripLabelAnchor, { color: ink }]}>
                        {item.label}
                      </Text>
                      {!!item.sub && <Text style={[styles.stripSub, { color: ink }]}>{item.sub}</Text>}
                      {/* The user's own two marks, and their own reason
                          for them: "дуже маленькі, але вони мене дуже
                          рятують. Це теж про навігацію." */}
                      {!!item.marks?.length && (
                        <View style={styles.stripMarks}>
                          {item.marks.map((mark, i) => (
                            <View
                              key={`${mark}-${i}`}
                              style={[
                                styles.stripMark,
                                { backgroundColor: mark === 'accent' ? STRIP_MARK_ACCENT : theme.glass.ink },
                              ]}
                            />
                          ))}
                        </View>
                      )}
                    </>
                  );
                  return (
                    <Pressable key={item.key} onPress={() => strip.onPick(item.key)}>
                      {current ? (
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
            </GlassDrop>
          )}

          {showing === 'context' && trail && (
            <GlassDrop style={[styles.shell, styles.trailShell, styles.faceContext]}>
              <View style={styles.trailRow}>
                <ScrollView
                  ref={trailRef}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.trailStrip}
                >
                  {/* The root, as the database's own icon: one press,
                      one meaning, and it still says which database these
                      folders belong to now that the bead has gone. */}
                  <View ref={targets?.('')} collapsable={false}>
                    <Pressable onPress={() => trail.onGo('')} style={styles.trailRoot}>
                      <Ionicons name={icon} size={19} color={theme.glass.ink} />
                    </Pressable>
                  </View>
                  {trail.crumbs.map((segment, index) => {
                    const isLast = index === trail.crumbs.length - 1;
                    const target = trail.crumbs.slice(0, index + 1).join('/');
                    return (
                      <View key={target} style={styles.trailPair}>
                        <Ionicons name="chevron-forward" size={13} color={theme.glass.inkMuted} />
                        {isLast ? (
                          // Where you are, in the lens the dock marks the
                          // desk you are on with. No target: a card is
                          // already here.
                          <GlassDrop style={styles.trailCurrent} lift="none" blurAmount={0} convex>
                            <Text
                              style={[styles.trailLabel, styles.trailLabelCurrent, { color: theme.glass.ink }]}
                              numberOfLines={1}
                            >
                              {segment}
                            </Text>
                          </GlassDrop>
                        ) : (
                          <View ref={targets?.(target)} collapsable={false}>
                            <Pressable onPress={() => trail.onGo(target)} style={styles.trailSegment}>
                              <Text
                                style={[styles.trailLabel, { color: theme.glass.inkMuted }]}
                                numberOfLines={1}
                              >
                                {segment}
                              </Text>
                            </Pressable>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
            </GlassDrop>
          )}

          {showing === 'actions' && !!actions?.length && (
            <GlassDrop style={[styles.shell, styles.faceActions]}>
              <View style={styles.actionRow}>
                {actions.map((action) => (
                  <Pressable
                    key={action.key}
                    onPress={() => {
                      action.onPress();
                      // Done in one press: the path comes back by itself.
                      if (action.closesStack) setFace('context');
                    }}
                    onLongPress={action.onLongPress}
                    style={[styles.actionButton, action.active && styles.actionButtonActive]}
                  >
                    <Ionicons
                      name={action.icon as keyof typeof Ionicons.glyphMap}
                      size={22}
                      color={action.active ? theme.accent : theme.glass.ink}
                    />
                    {!!action.badge && (
                      <Ionicons
                        name={action.badge as keyof typeof Ionicons.glyphMap}
                        size={12}
                        color={theme.glass.ink}
                        style={styles.badge}
                      />
                    )}
                  </Pressable>
                ))}
              </View>
            </GlassDrop>
          )}
          </View>
          </GestureDetector>
          {!!beads.right && <Bead bead={beads.right} theme={theme} />}
        </View>
      </View>
    </GlassPortal>
  );
}

// A bead: the same glass, the same height as a capsule, standing on its
// own beside the stack.
function Bead({ bead, theme }: { bead: DockBead; theme: ReturnType<typeof useTheme> }) {
  return (
    <Pressable onPress={bead.onPress} onLongPress={bead.onLongPress}>
      <GlassDrop style={styles.bead}>
        <Ionicons
          name={bead.icon as keyof typeof Ionicons.glyphMap}
          size={22}
          color={bead.active ? theme.accent : theme.glass.ink}
        />
        {!!bead.badge && (
          <Ionicons
            name={bead.badge as keyof typeof Ionicons.glyphMap}
            size={12}
            color={theme.glass.ink}
            style={styles.badge}
          />
        )}
      </GlassDrop>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    // The beads must not touch the edges of the screen.
    paddingHorizontal: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    // Never wider than the screen. A path grows with every folder you
    // walk into, and left to itself it pushed the bead beside it clean
    // off the edge - the capsule scrolls INSIDE, so what has to give is
    // the capsule's width, not the row's.
    maxWidth: '100%',
  },
  exitBead: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
    paddingLeft: 10,
    paddingRight: 13,
    height: NAV_BUTTON + NAV_PADDING * 2,
  },
  stack: {
    // Room under the front capsule for the back one's edge to show in.
    paddingBottom: BEHIND_EDGE,
    // The one thing in the row allowed to shrink: the beads either side
    // keep their size, and the card between them takes what is left.
    // minWidth 0 because a flex child will not shrink below its content
    // without it, and the content here is a scroller full of folders.
    flexShrink: 1,
    minWidth: 0,
  },
  behind: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 0,
    height: NAV_BUTTON + NAV_PADDING * 2,
  },
  shell: {
    padding: NAV_PADDING,
  },
  // TEMPORARY - see FACE_CONTEXT/FACE_ACTIONS.
  faceContext: {
    backgroundColor: FACE_CONTEXT,
  },
  faceActions: {
    backgroundColor: FACE_ACTIONS,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bead: {
    // Fixed: a bead never gives up room, it is the card that does.
    flexShrink: 0,
    width: NAV_BUTTON + NAV_PADDING * 2,
    height: NAV_BUTTON + NAV_PADDING * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    right: 8,
    bottom: 8,
  },
  actionButton: {
    width: NAV_BUTTON,
    height: NAV_BUTTON,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
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
  actionButtonActive: {
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  trailShell: {
    flexShrink: 1,
    minWidth: 0,
    // Short on purpose. Left to fill the row it showed three and a half
    // folders with the last one cut in half, which reads as a mistake
    // rather than as a path that continues. The user's own measure: the
    // root and a couple of folders, and the rest is scrolled to.
    maxWidth: 210,
  },
  stripViewport: {
    width: STRIP_WIDTH,
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
  // Today is heavier as well as coloured: on a dark ground a tint alone
  // is a weak signal, and this is the one day that has to be findable
  // without looking for it.
  stripLabelAnchor: {
    fontFamily: FONT_BOLD,
    fontWeight: '700',
  },
  stripSub: {
    fontSize: 10,
    marginTop: 1,
    fontFamily: FONT_REGULAR,
  },
  stripMarks: {
    position: 'absolute',
    bottom: 3,
    flexDirection: 'row',
    gap: 3,
  },
  stripMark: {
    width: 3.5,
    height: 3.5,
    borderRadius: 2,
  },
  trailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: NAV_BUTTON,
    minWidth: 0,
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
  trailRoot: {
    paddingHorizontal: 8,
    paddingVertical: 8,
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
  trailLabelCurrent: {
    fontFamily: FONT_SEMIBOLD,
    fontWeight: '600',
  },
});
