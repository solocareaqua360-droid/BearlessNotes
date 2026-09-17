import { useMemo, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GlassDrop from './GlassDrop';
import { GlassPortal } from './GlassPortal';
import { useTheme } from '../theme/ThemeProvider';
import { hapticButtonDown } from '../utils/haptics';
import { NAV_BOTTOM, NAV_BUTTON, NAV_PADDING } from '../constants/rail';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
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
// The dock's own glass, measured off the reference (a Samsung lock
// screen) rather than inherited from the theme. The theme's drop is a
// bead of glass - a lit contour, a rim inside it, a shadow under it, a
// convex body. The reference is none of those: FLAT frosted glass, dense
// enough that the picture behind is only a tint, with no edge drawn at
// all. "Форма колір розмір положення все не туди" was the theme's glass
// standing where the reference's frost should be.
const FLAT = {
  specularIntensity: 0,
  rimOpacity: 0,
  vignetteIntensity: 0,
  glassOpacity: 0.78,
  blurAmount: 70,
  lift: 'none' as const,
};
// The frost's own colour. NOT the theme's glass body: in the black theme
// that is white at 5% - a whisper, right for its capsules and wrong here,
// where at 78% it made a white pill with white icons on it. Dark frost on
// the dark themes, a light grey frost on the white one - the reference
// is dark on a dark screen and would be light on a light one.
function frostFor(themeKey: string): string {
  return themeKey === 'white' ? '#D9DCE1' : '#1C1B19';
}
// Sizes as FRACTIONS OF THE SCREEN'S WIDTH, read off the reference and
// our own dock side by side at the same pixel scale. Not points: every
// guess at this phone's density was wrong, and a dock sized in points
// came out a fifth too small every time - "я не знаю чому у тебе
// проблеми з розмірами". Fractions cannot be wrong about density.
//   bead diameter    0.111   capsule height   0.148 (a third taller)
//   bead-to-capsule  0.037   edge to bead     0.076
const BEAD_F = 0.111;
const CARD_F = 0.148;
const GAP_F = 0.037;
const INSET_F = 0.076;
const CARD_PAD = 2;

export default function ContextDock() {
  const theme = useTheme();
  const glassBody = frostFor(theme.key);
  const { width: screenW } = useWindowDimensions();
  const BEAD = Math.round(screenW * BEAD_F);
  const CARD_H = Math.round(screenW * CARD_F);
  const CARD_BUTTON = CARD_H - CARD_PAD * 2;
  const GAP = Math.round(screenW * GAP_F);
  const EDGE_INSET = Math.round(screenW * INSET_F);
  // The row's width is SAID, not left to flex: it was settling at
  // three-quarters of the screen and nobody could tell why.
  const rowWidth = screenW - EDGE_INSET * 2;
  const dims = {
    bead: { width: BEAD, height: BEAD },
    card: { height: CARD_H },
    button: { width: CARD_BUTTON, height: CARD_BUTTON },
    rowHeight: { height: CARD_BUTTON },
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
  const opensOn: DockFace = own?.kind === 'strip' ? 'desks' : 'context';
  useEffect(() => setFace(opensOn), [contextKey, opensOn, setFace]);
  // The cards this screen actually has, in the order they are wanted:
  // what you are in, what you can do in it, where else you could be. A
  // card with nothing on it is not a card and is simply not in the ring.
  const faces: DockFace[] = [
    ...(own ? (['context'] as DockFace[]) : []),
    ...(actions?.length ? (['actions'] as DockFace[]) : []),
    ...(desksCard ? (['desks'] as DockFace[]) : []),
  ];
  const showing: DockFace = faces.includes(face) ? face : (faces[0] ?? 'context');
  const stacked = faces.length > 1;
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
          // One card on per swipe, round the ring - a stack of three
          // walks with one direction just as a stack of two did.
          const ring = facesRef.current;
          if (ring.length < 2) return;
          hapticButtonDown();
          const at = ring.indexOf(faceRef.current);
          setFace(ring[(at + 1) % ring.length] ?? ring[0]);
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
  useEffect(() => {
    if (stripIndex < 0) {
      stripSettled.current = false;
      return;
    }
    const x = Math.max(0, stripIndex * STRIP_ITEM + STRIP_ITEM / 2 - stripWidth / 2);
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
  const showBead = !trail && !!leave;
  // What the bead carries: the thing it is LEAVING, when there is one.
  const icon = ((leave?.icon ?? dock?.icon) as keyof typeof Ionicons.glyphMap) ?? 'ellipse-outline';

  return (
    <GlassPortal>
      <View style={[styles.wrap, { bottom: 22 + insets.bottom, paddingHorizontal: EDGE_INSET }]} pointerEvents="box-none">
        <View style={[styles.row, { width: rowWidth, gap: GAP }]}>
          {/* A missing bead keeps its place. Without this the stack
              drifted: two beads on documents, one on the calendar, and
              the same control sat in a different spot on each - "док
              зміщений відносно того що є на екрані документів". */}
          {beads.left ? <Bead bead={beads.left} theme={theme} size={BEAD} /> : <View style={[styles.beadSlot, dims.bead]} />}
          {showBead && (
            <Pressable onPress={stepOut}>
              <GlassDrop style={[styles.exitBead, { height: BEAD }]} {...FLAT} glassBody={glassBody}>
                <Ionicons name="chevron-back" size={11} color={theme.glass.inkMuted} />
                <Ionicons name={icon} size={20} color={theme.glass.ink} />
              </GlassDrop>
            </Pressable>
          )}

          <GestureDetector gesture={swipe}>
          <View style={[styles.stack, { paddingBottom: BEHIND_EDGE * behind }]}>
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
                          top: -(CARD_H - BEHIND_EDGE * (i + 1)),
                          left: BEHIND_INSET * (i + 1),
                          right: BEHIND_INSET * (i + 1),
                          backgroundColor: glassBody,
                          opacity: Math.min(0.95, FLAT.glassOpacity + 0.1 + i * 0.05),
                        },
                      ]}
                    />
                  ))}
              </View>
            )}

          {showing === 'desks' && desks && (
            desks.collapsed ? (
              // The dots a home screen uses to say which page you are on
              // - still a way to get there, and still what "collapsed"
              // has meant here since the user first asked for it.
              <GlassDrop style={[styles.dotsShell, dims.card]} {...FLAT} glassBody={glassBody}>
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
              <GlassDrop style={[styles.shell, dims.card]} {...FLAT} glassBody={glassBody}>
                <Pressable
                  style={[styles.actionRow, styles.spread]}
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
                        <View style={[styles.actionButton, dims.button, styles.here]}>
                          <Ionicons
                            name={desk.icon as keyof typeof Ionicons.glyphMap}
                            size={22}
                            color={theme.glass.ink}
                          />
                        </View>
                      ) : (
                        <View style={[styles.actionButton, dims.button]}>
                          <Ionicons
                            name={desk.icon as keyof typeof Ionicons.glyphMap}
                            size={22}
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
            <GlassDrop style={[styles.shell, dims.card]} {...FLAT} glassBody={glassBody}>
              <ScrollView
                ref={stripRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.stripViewport}
                onLayout={(e) => setStripWidth(e.nativeEvent.layout.width)}
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
                        <View style={[styles.stripItem, dims.rowHeight, styles.here]}>{body}</View>
                      ) : (
                        <View style={[styles.stripItem, dims.rowHeight]}>{body}</View>
                      )}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </GlassDrop>
          )}

          {showing === 'context' && trail && (
            <GlassDrop style={[styles.shell, styles.trailShell, dims.card]} {...FLAT} glassBody={glassBody}>
              <View style={[styles.trailRow, dims.rowHeight]}>
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
                          <View style={[styles.trailCurrent, styles.here]}>
                            <Text
                              style={[styles.trailLabel, styles.trailLabelCurrent, { color: theme.glass.ink }]}
                              numberOfLines={1}
                            >
                              {segment}
                            </Text>
                          </View>
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
            <GlassDrop style={[styles.shell, styles.actionsShell, dims.card]} {...FLAT} glassBody={glassBody}>
              {/* Scrolls, like the path does. A screen with five things
                  its list can be done TO is not a screen with a design
                  problem - the card simply holds what fits and the rest
                  is a thumb away. */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.actionRow}
              >
                {actions.map((action) => (
                  <Pressable
                    key={action.key}
                    onPress={() => {
                      action.onPress();
                      // Done in one press: the path comes back by itself.
                      if (action.closesStack) setFace('context');
                    }}
                    onLongPress={action.onLongPress}
                    style={[styles.actionButton, dims.button, action.active && styles.actionButtonActive]}
                  >
                    <Ionicons
                      name={action.icon as keyof typeof Ionicons.glyphMap}
                      size={21}
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
              </ScrollView>
            </GlassDrop>
          )}
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
function Bead({ bead, theme, size }: { bead: DockBead; theme: ReturnType<typeof useTheme>; size: number }) {
  return (
    <Pressable onPress={bead.onPress} onLongPress={bead.onLongPress}>
      <GlassDrop style={[styles.bead, { width: size, height: size }]} {...FLAT} glassBody={frostFor(theme.key)}>
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
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  exitBead: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
    paddingLeft: 9,
    paddingRight: 12,
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
    justifyContent: 'space-around',
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
