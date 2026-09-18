import { ReactNode, useMemo, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleProp, StyleSheet, Text, View, ViewStyle, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming, Easing } from 'react-native-reanimated';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { openCapture } from './CaptureWindow';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import Svg, { Circle } from 'react-native-svg';
import { useBlurTarget } from './GlassTarget';
import { GlassPortal } from './GlassPortal';
import { useTheme } from '../theme/ThemeProvider';
import { hapticButtonDown } from '../utils/haptics';
import { NAV_BOTTOM, NAV_BUTTON, NAV_PADDING } from '../constants/rail';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { DOCK_BOTTOM, dockCardHeight } from '../navigation/dockGeometry';
import {
  DockBead,
  DockFace,
  useNavDockActions,
  useNavDockBeads,
  useNavDockDesks,
  useNavDockFace,
  useNavDockHidden,
  useNavDockLeave,
  useNavDockOwnContext,
  useNavDockTargets,
} from '../navigation/navDock';

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
const STRIP_VISIBLE = 5;
const STRIP_WIDTH = STRIP_ITEM * STRIP_VISIBLE;
// The same blue the calendar's own history dot uses - a mark has to mean
// the same thing in both places or it means nothing in either.
const STRIP_MARK_ACCENT = '#60A5FA';
// How much of the card behind is visible. Samsung's own measure, read
// off the user's screenshots: a HINT, two or three points, not a band.
// At seven it read as a second capsule parked under the first rather
// than as the same object with more of itself behind.
const BEHIND_EDGE = 3;
// How far each card behind is drawn in from the sides. Barely: the
// edges nearly line up, which is what makes it one stack instead of
// three pills of decreasing size.
const BEHIND_INSET = 5;
// The dock is made of the TAGS DRAWER'S material - and now literally of
// its LAYERS, not of GlassDrop dressed up to look like it. The drawer is
// two flat things: a BlurView at 60, tinted dark in every theme, and a
// View of the theme's surface colour over it, clipped by a rounded
// parent. GlassDrop paints its body as an SVG rectangle instead, and
// two things went wrong with that here: at full strength it was solid
// (white in the white theme, black in the black), and a bead's bottom
// point kept going missing under it. Frost, below, is the drawer's own
// construction with one deliberate difference - the tint is never
// opaque, whatever the theme's surface is, because a dock that is a
// solid slab is not frosted glass in any theme.
const FROST_BLUR = 60;
const FROST_TINT = 0.55;
// The lighter mark on the thing you are on.
const HERE_FILL = 'rgba(255,255,255,0.16)';
// Sizes as FRACTIONS OF THE SCREEN'S WIDTH, read off the reference and
// our own dock side by side at the same pixel scale. Not points: every
// guess at this phone's density was wrong, and a dock sized in points
// came out a fifth too small every time - "я не знаю чому у тебе
// проблеми з розмірами". Fractions cannot be wrong about density.
//   bead diameter    0.111   capsule height   0.148 (a third taller)
//   bead-to-capsule  0.037   edge to bead     0.076
// The way out inside the card: a chevron and a hairline - said in points.
const LEAVE_W = 36;
const BEAD_F = 0.111;

const GAP_F = 0.037;
const INSET_F = 0.076;
const CARD_PAD = 2;
// ...but of a PHONE's width, never of whatever screen this happens to be.
// A fraction of the screen is the right answer to "how big on a phone"
// and the wrong answer to "how big on a screen twice as wide": the dock
// is held in a thumb, and a thumb is the same size on a fold as on a
// phone. Unfolded, it came out nearly twice the size - "виглядає
// аномально великим... на великому екрані він буде капець яким
// аномально большим". Above this width the dock simply stops growing
// and stands centred, which is also what it should do in landscape,
// where the width is enormous and the height is not.
// 430 is wider than any phone in portrait, so no phone is touched.


export default function ContextDock() {
  const theme = useTheme();
  const { width: windowW } = useWindowDimensions();
  const CARD_H = dockCardHeight(windowW);
  const screenW = Math.min(windowW, 430);
  const BEAD = Math.round(screenW * BEAD_F);
  const CARD_BUTTON = CARD_H - CARD_PAD * 2;
  const GAP = Math.round(screenW * GAP_F);
  const EDGE_INSET = Math.round(screenW * INSET_F);
  // The row's width is SAID, not left to flex: it was settling at
  // three-quarters of the screen and nobody could tell why. On a screen
  // wider than a phone this is narrower than the window, and the wrap
  // below centres it.
  const rowWidth = screenW - EDGE_INSET * 2;
  // And so is the CARD'S. Left to flex it hugged its content - one
  // folder deep the path card shrank to a single word and the whole row
  // bunched up on the left. A card is four buttons wide whatever it
  // holds: the width between the beads, every time, on every screen.
  const cardWidth = rowWidth - BEAD * 2 - GAP * 2;
  // A desk button is the biggest circle FOUR of which fit in the card
  // side by side - and never more than the card's own inner height.
  // At full card height, four of them were a few points wider than the
  // card, so the last desk's circle stood closer to the capsule's end
  // than its own radius and the capsule's rounded end took a bite out
  // of it: "обрізана, як неповна фаза місяця". A circle is whole inside
  // a capsule as long as its centre is no nearer the end than its
  // radius; laid edge to edge from the card's inner padding, the first
  // and last centres sit exactly where the capsule's own caps are.
  // Every radius is SAID as half the size, never left as 999. Android
  // works a "999" out from the size it knows at the moment it draws the
  // background, and on the first frame that size was not there yet -
  // the "you are here" disc came up a square with rounded corners and
  // stayed one until the next render happened to redraw it (the first
  // swipe). Half of a number the view already has cannot be early.
  const dims = {
    bead: { width: BEAD, height: BEAD, borderRadius: BEAD / 2 },
    card: { height: CARD_H, borderRadius: CARD_H / 2 },
    button: { width: CARD_BUTTON, height: CARD_BUTTON, borderRadius: CARD_BUTTON / 2 },
    rowHeight: { height: CARD_BUTTON, borderRadius: CARD_BUTTON / 2 },
  };
  const insets = useSafeAreaInsets();
  // Three cards, and they are three because of the one thing a
  // navigation dock must never do: the desks used to vanish the moment
  // you stepped into a folder or opened the calendar - "навігація між
  // столами пропадає зовсім". They are a card of their own now, so
  // wherever you are, where else you could be is one swipe away.
  const own = useNavDockOwnContext();
  const desksCard = useNavDockDesks();
  const [hidden] = useNavDockHidden();
  const dock = hidden ? desksCard : (own ?? desksCard);
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
  // Which card a screen OPENS on. A path is worth seeing straight away -
  // it says where in the database you are standing. A calendar's days
  // are not: the calendar itself is already on the screen above, so the
  // dock is better spent saying where else you could go.
  //
  // With no context of its own - a database's root, the boards list -
  // the screen opens on the DESKS. It used to ask for 'context', which
  // was not in the ring there, and the fallback was the first card in
  // the ring: the actions. So swiping from the calendar to documents
  // landed on the options card every time - "автоматично вмикається док
  // опцій".
  const opensOn: DockFace = !own ? 'desks' : own.kind === 'strip' ? 'desks' : 'context';
  useEffect(() => setFace(opensOn), [contextKey, opensOn, setFace]);
  // The cards this screen actually has, in the order they are wanted:
  // what you are in, what you can do in it, where else you could be. A
  // card with nothing on it is not a card and is simply not in the ring.
  const faces: DockFace[] = [
    ...(own ? (['context'] as DockFace[]) : []),
    ...(actions?.length ? (['actions'] as DockFace[]) : []),
    ...(desksCard ? (['desks'] as DockFace[]) : []),
  ];
  // When the card asked for is not in this screen's ring, fall back to
  // where you could go before what you could do - never land someone on
  // the options by accident.
  const showing: DockFace = faces.includes(face)
    ? face
    : faces.includes('desks')
      ? 'desks'
      : (faces[0] ?? 'context');
  const stacked = faces.length > 1;
  // The card the swipe reveals - always ONE ahead of the front, in the
  // same ring order stepping the gesture already walks. Rendered at
  // rest, permanently, underneath the front card: nothing about it
  // animates on its own, because it does not need to - lifting the
  // front card off is what shows it, exactly like sliding the top card
  // off a real stack uncovers the one under it.
  const queued: DockFace | null =
    faces.length > 1 ? faces[(faces.indexOf(showing) + 1) % faces.length] ?? null : null;
  // How many cards are BEHIND the one in front, drawn as that many
  // edges - the stack says its own depth instead of leaving you to
  // guess how far round the ring you are.
  const behind = Math.max(0, faces.length - 1);
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
  const facesRef = useRef(faces);
  facesRef.current = faces;
  const cardHRef = useRef(CARD_H);
  cardHRef.current = CARD_H;
  // The morph - the whole reason this is a swipe and not a tap. 0 is at
  // rest. Negative is the CURRENT card leaving, travelling up and out;
  // positive is the NEXT one arriving, travelling up FROM BELOW into
  // rest - one sign convention, so both halves of the cycle read as the
  // same upward motion through the stack rather than two different
  // effects stitched together. A cross-fade was tried for the card->page
  // move once and judged "дешево" - a morph has to change SHAPE, not
  // just opacity, or it reads as nothing happening at all.
  const morph = useSharedValue(0);
  function commitSwap(next: DockFace) {
    setFace(next);
    morph.value = 0;
  }
  // Only the card in FRONT ever moves - the one underneath is static,
  // sitting exactly at rest the whole time. Lifting the front one off is
  // what reveals it, the same way sliding the top card off a real stack
  // uncovers the one under it - not a fade, an actual uncovering.
  const swipeStyle = useAnimatedStyle(() => {
    const cardH = cardHRef.current;
    return {
      transform: [{ translateY: -morph.value * cardH }, { scale: 1 - Math.min(1, morph.value) * 0.04 }],
    };
  });
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
        .onUpdate((e) => {
          if (facesRef.current.length < 2) return;
          // A touch of resistance past a full card's height, so a very
          // long drag does not send it flying arbitrarily far.
          const dragged = Math.max(0, -e.translationY) / cardHRef.current;
          morph.value = Math.min(1.15, dragged);
        })
        .onEnd((e) => {
          const ring = facesRef.current;
          // A real swipe, not a nudge - distance OR a fast enough flick,
          // same as any carousel. Short of two cards there is nothing to
          // cycle to.
          const committed = ring.length >= 2 && (e.translationY < -40 || e.velocityY < -600);
          if (committed) {
            hapticButtonDown();
            const at = ring.indexOf(faceRef.current);
            const next = ring[(at + 1) % ring.length] ?? ring[0];
            // Finish rising clear, THEN swap - the swap has to land once
            // the card has actually cleared the frame, or the change of
            // content is seen mid-flight instead of once it settles.
            morph.value = withTiming(1, { duration: 150, easing: Easing.out(Easing.cubic) }, (finished) => {
              if (finished) runOnJS(commitSwap)(next);
            });
          } else {
            morph.value = withTiming(0, { duration: 180, easing: Easing.out(Easing.cubic) });
          }
        }),
    []
  );

  // A card being carried can step onto a crumb - the same registry the
  // folder rows use, handed up by whichever screen is carrying.
  const targets = useNavDockTargets();

  const trail = own?.kind === 'path' ? own : null;
  const strip = own?.kind === 'strip' ? own : null;
  const desks = desksCard?.kind === 'desks' ? desksCard : null;
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
  const [stripWidth, setStripWidth] = useState(STRIP_WIDTH);
  // Where the strip has to be so the day you are on is in the middle.
  const stripOffsetFor = (width: number) =>
    Math.max(0, stripIndex * STRIP_ITEM + STRIP_ITEM / 2 - width / 2);
  // Centred on every SHOWING, not only on every change of day. The days
  // card is unmounted while the desks or the actions are in front, and a
  // scroller that has just been mounted starts at zero - the first day of
  // the run, the 25th of last month - while the day you are on has not
  // changed at all, so nothing else asked for a scroll: "показує умовний
  // початок відліку, а не нашу поточну дату посередині".
  useEffect(() => {
    if (stripIndex < 0) {
      stripSettled.current = false;
      return;
    }
    const x = stripOffsetFor(stripWidth);
    // The first placement is not a journey - opening the calendar should
    // not show the strip travelling in from the first of the month.
    const animated = stripSettled.current;
    stripSettled.current = true;
    const id = setTimeout(() => stripRef.current?.scrollTo({ x, animated }), 0);
    return () => clearTimeout(id);
  }, [stripIndex, stripWidth]);

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
  // Leaving a DATABASE, and nothing else now: the desks are a card, so
  // the calendar has no need of a button meaning "put this away and
  // show me where else I could be" - a swipe does that.
  const stepOut = () => leave?.onLeave();
  // The bead shows only where it has a job nobody else has: at a
  // database's root, where it leaves the database, and on the calendar,
  // which has no root to walk to and is simply put away. Inside folders
  // the first crumb already goes to the root, and two buttons for one
  // job is what the user rightly refused.
  const showLeave = !trail && !!leave;
  // What it carries: the thing it is LEAVING, when there is one.
  const icon = ((leave?.icon ?? dock?.icon) as keyof typeof Ionicons.glyphMap) ?? 'ellipse-outline';
  // Four buttons fit in the card - desks OR actions - whether or not the
  // way out is riding at its left edge. The card does not grow, so the
  // buttons give: at full size a fifth thing simply scrolled off the end
  // of the card, which is where the "..." went on the custom database.
  // One card's whole content, parameterised by WHICH face it draws -
  // called twice now (see queued/showing below) instead of once, so the
  // swipe can uncover a real card sitting underneath instead of an empty
  // sliver. `showLeave` is the same regardless of which face this draws:
  // it is about whether this SCREEN has a way out, not about which card
  // is showing.
  function renderCard(f: DockFace) {
    return (
      <>
        {showLeave && (
          <Pressable onPress={stepOut} style={[styles.leave, { height: CARD_H }]}>
            <Ionicons name="chevron-back" size={24} color={theme.glass.ink} />
            <View style={[styles.leaveRule, { backgroundColor: theme.glass.inkMuted, opacity: 0.4 }]} />
          </Pressable>
        )}
        <View style={styles.face}>
          {f === 'desks' && desks && (
            desks.collapsed ? (
              <View style={[styles.dotsShell, dims.card]}>
                <Pressable style={styles.dotsRow} onLongPress={openCapture} delayLongPress={400}>
                  {desks.desks.map((desk) => (
                    <Pressable
                      key={desk.key}
                      hitSlop={6}
                      onPress={desk.onPress}
                      onLongPress={openCapture}
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
              </View>
            ) : (
              <View style={[styles.shell, dims.card]}>
                <Pressable style={[styles.actionRow, styles.spread]} onLongPress={openCapture} delayLongPress={400}>
                  {desks.desks.map((desk) => (
                    <Pressable key={desk.key} onPress={desk.onPress} onLongPress={openCapture} delayLongPress={400}>
                      {desk.active ? (
                        <View style={[styles.actionButton, { width: DESK, height: DESK, borderRadius: DESK / 2 }]}>
                          <Svg width={DESK} height={DESK} style={StyleSheet.absoluteFill} pointerEvents="none">
                            <Circle cx={DESK / 2} cy={DESK / 2} r={DESK / 2} fill={HERE_FILL} />
                          </Svg>
                          <Ionicons name={desk.icon as keyof typeof Ionicons.glyphMap} size={22} color={theme.glass.ink} />
                        </View>
                      ) : (
                        <View style={[styles.actionButton, { width: DESK, height: DESK, borderRadius: DESK / 2 }]}>
                          <Ionicons name={desk.icon as keyof typeof Ionicons.glyphMap} size={22} color={theme.glass.ink} />
                        </View>
                      )}
                    </Pressable>
                  ))}
                </Pressable>
              </View>
            )
          )}

          {f === 'context' && strip && (
            <View style={[styles.shell, dims.card]}>
              <ScrollView
                ref={stripRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.stripViewport}
                onLayout={(e) => {
                  const width = e.nativeEvent.layout.width;
                  setStripWidth(width);
                  stripRef.current?.scrollTo({ x: stripOffsetFor(width), animated: false });
                }}
              >
                {strip.items.map((item) => {
                  const current = item.key === strip.selected;
                  const ink = item.anchor ? theme.accent : current ? theme.glass.ink : theme.glass.inkMuted;
                  const body = (
                    <>
                      <Text style={[styles.stripLabel, item.anchor && styles.stripLabelAnchor, { color: ink }]}>
                        {item.label}
                      </Text>
                      {!!item.sub && <Text style={[styles.stripSub, { color: ink }]}>{item.sub}</Text>}
                      {!!item.marks?.length && (
                        <View style={styles.stripMarks}>
                          {item.marks.map((mark, i) => (
                            <View
                              key={`${mark}-${i}`}
                              style={[styles.stripMark, { backgroundColor: mark === 'accent' ? STRIP_MARK_ACCENT : theme.glass.ink }]}
                            />
                          ))}
                        </View>
                      )}
                    </>
                  );
                  return (
                    <Pressable key={item.key} onPress={() => strip.onPick(item.key)}>
                      {current ? (
                        <View style={[styles.stripItem, dims.rowHeight, styles.here]}>{body}</View>
                      ) : (
                        <View style={[styles.stripItem, dims.rowHeight]}>{body}</View>
                      )}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {f === 'context' && trail && (
            <View style={[styles.shell, styles.trailShell, dims.card]}>
              <View style={[styles.trailRow, dims.rowHeight]}>
                <ScrollView ref={trailRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trailStrip}>
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
                          <View style={[styles.trailCurrent, { borderRadius: CARD_BUTTON / 2 }, styles.here]}>
                            <Text style={[styles.trailLabel, styles.trailLabelCurrent, { color: theme.glass.ink }]} numberOfLines={1}>
                              {segment}
                            </Text>
                          </View>
                        ) : (
                          <View ref={targets?.(target)} collapsable={false}>
                            <Pressable onPress={() => trail.onGo(target)} style={styles.trailSegment}>
                              <Text style={[styles.trailLabel, { color: theme.glass.inkMuted }]} numberOfLines={1}>
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
            </View>
          )}

          {f === 'actions' && !!actions?.length && (
            <View style={[styles.shell, styles.actionsShell, dims.card]}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionRow}>
                {actions.map((action) => (
                  <Pressable
                    key={action.key}
                    onPress={() => {
                      action.onPress();
                      if (action.closesStack) setFace('context');
                    }}
                    onLongPress={action.onLongPress}
                    style={[styles.actionButton, { width: DESK, height: DESK, borderRadius: DESK / 2 }, action.active && styles.actionButtonActive]}
                  >
                    {action.icon.startsWith('mc:') ? (
                      <MaterialCommunityIcons
                        name={action.icon.slice(3) as keyof typeof MaterialCommunityIcons.glyphMap}
                        size={21}
                        color={action.active ? theme.accent : theme.glass.ink}
                      />
                    ) : (
                      <Ionicons name={action.icon as keyof typeof Ionicons.glyphMap} size={21} color={action.active ? theme.accent : theme.glass.ink} />
                    )}
                    {!!action.badge && (
                      <Ionicons name={action.badge as keyof typeof Ionicons.glyphMap} size={12} color={theme.glass.ink} style={styles.badge} />
                    )}
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}
        </View>
      </>
    );
  }

  const DESK = Math.min(CARD_BUTTON, Math.floor((cardWidth - CARD_PAD * 2 - (showLeave ? LEAVE_W : 0)) / 4));

  return (
    <GlassPortal>
      <View
        style={[styles.wrap, { bottom: DOCK_BOTTOM + insets.bottom, paddingHorizontal: EDGE_INSET }]}
        pointerEvents="box-none"
      >
        <View
          style={[
            styles.row,
            // Height SAID too, with the slivers' room included, so that
            // centring the beads happens inside a box that is really
            // this tall - and nothing in this chain is allowed to clip.
            // ALWAYS the room for two slivers, whether this screen has
            // two, one or none behind. The row is anchored at the bottom,
            // so a row that grew with its slivers pushed the front card
            // UP - a hair higher on the screens with more cards behind,
            // which read as a different dock on every desk.
            { width: rowWidth, gap: GAP, height: CARD_H + BEHIND_EDGE * 2, overflow: 'visible' },
          ]}
        >
          {/* A missing bead keeps its place. Without this the stack
              drifted: two beads on documents, one on the calendar, and
              the same control sat in a different spot on each - "док
              зміщений відносно того що є на екрані документів". */}
          {beads.left ? <Bead bead={beads.left} theme={theme} size={BEAD} /> : <View style={[styles.beadSlot, dims.bead]} />}
          <GestureDetector gesture={swipe}>
          <View
            style={[
              styles.stack,
              // Said explicitly now, not left to its own content: both
              // card layers inside are position:'absolute', which counts
              // for nothing toward a container's own height - `stack`
              // collapsed to just its padding, and centred (`row`'s own
              // alignItems) in a taller row, it dropped toward the
              // middle instead of sitting flush at the top: "док
              // змістився вниз".
              { width: cardWidth, height: CARD_H + BEHIND_EDGE * 2, paddingBottom: BEHIND_EDGE * 2 },
            ]}
          >
            {/* The card behind, seen as an EDGE and nothing more - a few
                points of the same glass, a little narrower, so it reads
                as BEHIND rather than beside. Empty on purpose: what a
                stack's back card shows is that it is there. */}
            {/* One edge per card behind, so the stack says its own depth
                rather than leaving you to guess how far round you are. */}
            {/* Only what shows BELOW the front card is drawn at all. The
                front card is translucent so the screen shows through it -
                and what showed through it was the cards behind, a lighter
                smear where they overlapped. Clipped to the slivers, they
                cannot be behind anything. Plain bands, not glass: glass
                carries a lit rim and three rims read as a staircase. */}
            {behind > 0 && (
              <View style={[styles.behindClip, { top: CARD_H, height: BEHIND_EDGE * behind }]} pointerEvents="none">
                {Array.from({ length: behind })
                  .map((_, i) => i)
                  .reverse()
                  .map((i) => (
                    <View
                      key={i}
                      style={[
                        styles.behind,
                        {
                          height: CARD_H,
                          borderRadius: CARD_H / 2,
                          top: -(CARD_H - BEHIND_EDGE * (i + 1)),
                          left: BEHIND_INSET * (i + 1),
                          right: BEHIND_INSET * (i + 1),
                          backgroundColor: theme.surface,
                          opacity: 0.85 - i * 0.1,
                        },
                      ]}
                    />
                  ))}
              </View>
            )}

          {/* Two pieces of glass, not one - the queued card sits at rest
              underneath, permanently, so lifting the front one off
              genuinely UNCOVERS it rather than swapping in once the
              front has already gone: "за нею повинна проступати інша
              картка... а зараз під нею нічого". What either of them is -
              a leave, or one day something else - is still open; where
              it stands is settled. */}
          {queued && (
            <View style={[styles.cardLayer, dims.card]} pointerEvents="none">
              <Frost style={[styles.front, dims.card]} radius={CARD_H / 2}>
                {renderCard(queued)}
              </Frost>
            </View>
          )}
          <Animated.View style={[styles.cardLayer, dims.card, swipeStyle]}>
            <Frost style={[styles.front, dims.card]} radius={CARD_H / 2}>
              {renderCard(showing)}
            </Frost>
          </Animated.View>
          </View>
          </GestureDetector>
          {beads.right ? <Bead bead={beads.right} theme={theme} size={BEAD} /> : <View style={[styles.beadSlot, dims.bead]} />}
        </View>
      </View>
    </GlassPortal>
  );
}

// A bead: the same glass, the same height as a capsule, standing on its
// own beside the stack.
// The drawer's two layers, clipped round. `radius` is always half of a
// size the view already has - never 999 (see dims).
function Frost({
  style,
  radius,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  radius: number;
  children?: ReactNode;
}) {
  const theme = useTheme();
  const blurTarget = useBlurTarget();
  return (
    <View style={[style, { borderRadius: radius, overflow: 'hidden' }]}>
      <BlurView
        intensity={FROST_BLUR}
        tint="dark"
        blurMethod="dimezisBlurView"
        blurTarget={blurTarget ?? undefined}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: theme.surface, opacity: FROST_TINT }]}
        pointerEvents="none"
      />
      {children}
    </View>
  );
}

function Bead({ bead, theme, size }: { bead: DockBead; theme: ReturnType<typeof useTheme>; size: number }) {
  return (
    <Pressable
      onPress={bead.onPress}
      onLongPress={bead.onLongPress}
      style={{ width: size, height: size, overflow: 'visible' }}
    >
      <Frost style={[styles.bead, { width: size, height: size }]} radius={size / 2}>
        <Ionicons
          name={bead.icon as keyof typeof Ionicons.glyphMap}
          size={21}
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
      </Frost>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    // Slack above and below, and no clipping: a bead's bottom point
    // was going missing, and the one thing every ancestor here can be
    // made to promise is that it is not the one cutting it.
    paddingVertical: 6,
    overflow: 'visible',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // The two overlapping layers a card transition stands in - absolutely
  // positioned so QUEUED and the animated FRONT sit exactly on top of
  // each other at rest, one hiding the other completely.
  cardLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
  },
  front: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  face: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  leave: {
    width: LEAVE_W,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  leaveRule: {
    position: 'absolute',
    right: 0,
    top: '30%',
    bottom: '30%',
    width: StyleSheet.hairlineWidth,
  },
  stack: {
    // Room under the front capsule for the cards behind it - exactly as
    // many edges as there are, no more (set inline).
    // The one thing in the row allowed to shrink: the beads either side
    // keep their size, and the card between them takes what is left.
    // minWidth 0 because a flex child will not shrink below its content
    // without it, and the content here is a scroller full of folders.
    flexShrink: 1,
    minWidth: 0,
  },
  // The window under the front card that the slivers show through.
  behindClip: {
    position: 'absolute',
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
  behind: {
    position: 'absolute',
    borderRadius: 999,
  },
  shell: {
    padding: CARD_PAD,
    width: '100%',
    justifyContent: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  spread: {
    justifyContent: 'space-between',
    flex: 1,
  },
  actionsShell: {},
  beadSlot: {
    flexShrink: 0,
  },
  bead: {
    // Fixed: a bead never gives up room, it is the card that does.
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    right: 8,
    bottom: 8,
  },
  actionButton: {
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Where you are: a flat lighter disc on the frost. Not a bead - the
  // reference has no beads inside its capsule.
  here: {
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  dotsShell: {
    paddingHorizontal: 10,
    width: '100%',
    justifyContent: 'center',
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
  },
  stripViewport: {
    flex: 1,
  },
  stripItem: {
    width: STRIP_ITEM,
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
    borderRadius: 999,
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
