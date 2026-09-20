import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, ViewStyle, useWindowDimensions } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { openCapture } from './CaptureWindow';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { GlassPortal } from './GlassPortal';
import DockFrost from './DockFrost';
import { useResponsiveLayout } from '../hooks/useResponsiveLayout';
import { useLift, useTheme } from '../theme/ThemeProvider';
import { liftStyle } from '../theme/tokens';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { DOCK_BOTTOM, dockCardHeight, dockEdgeInset, dockRowWidth } from '../navigation/dockGeometry';
import {
  DockAction,
  DockBead,
  useNavDockActions,
  useNavDockBeads,
  useNavDockDesks,
  useNavDockHidden,
  useNavDockLeave,
  useNavDockOwnContext,
  useNavDockTabsInFlux,
  useNavDockTargets,
} from '../navigation/navDock';

// ONE DOCK, ALWAYS - rebuilt from scratch 2026-09-20.
//
// Everything this file used to be - a ring of up to three cards
// (context/actions/desks), swiped between with a hand-rolled gesture, a
// separate widened "split" zone for the Fold, a two-way crossfade for
// the one ring shape that reduced to - is gone. Not simplified: gone.
// The user's own diagnosis of the whole night that built it: "ми по
// факту перебудовуємо складний док з прогортанням спрощуючи його
// замість того щоб спочатку зробити простий а потім ускладнити його" -
// build the simple, correct thing FIRST, animate it later if at all.
//
// So there is exactly one card, always mounted, showing exactly one
// thing: whatever this screen's own context is if it has one, or the
// four desks if it does not. The two are never both true at once - a
// path and the desks were never really two things you swipe between,
// they are what stands in the same spot depending on how deep you are.
// The desks are reached by walking OUT of a context (the existing
// `leave` chevron) to the root, where the context ends and the desks
// take its place - never by a swipe past it. Nothing else in the dock
// changes: actions still stand beside whatever the card is showing,
// beads still stand outside it, and every publisher in navDock.tsx
// (useDockActions, useDockBeads, useDockLeave, useNavDockPublisher,
// useNavDockFace and the rest) is untouched, whether or not this file
// still reads every one of them - a screen calling `setDockFace` to
// request "show actions" or "show desks" simply has nothing left to
// switch to, since both are already standing in the one card at once.
const STRIP_ITEM = 38;
const STRIP_VISIBLE = 5;
const STRIP_WIDTH = STRIP_ITEM * STRIP_VISIBLE;
// The same blue the calendar's own history dot uses - a mark has to mean
// the same thing in both places or it means nothing in either.
const STRIP_MARK_ACCENT = '#60A5FA';
// The lighter mark on the thing you are on.
const HERE_FILL = 'rgba(255,255,255,0.16)';
// How much smaller than its own button the "here" circle sits - its rim
// has to clear the button's own edge.
const HERE_SHRINK = 6;
// The way out inside the card: a chevron and a hairline - said in points.
const LEAVE_W = 36;
// Sizes as FRACTIONS OF THE SCREEN'S WIDTH - fractions cannot be wrong
// about density the way a guess in points was, repeatedly.
const BEAD_F = 0.111;
const GAP_F = 0.037;
const CARD_PAD = 2;
// The room reserved for the divider between the card's own content and
// its actions, when both stand in the same card - see `dividerSpace`.
const DIVIDER_SPACE = 17;
const ACTION_GROUP_GAP = 24;

export default function ContextDock() {
  const theme = useTheme();
  const { width: windowW } = useWindowDimensions();
  const CARD_H = dockCardHeight(windowW);
  const screenW = Math.min(windowW, 430);
  const BEAD = Math.round(screenW * BEAD_F);
  const CARD_BUTTON = CARD_H - CARD_PAD * 2;
  const GAP = Math.round(screenW * GAP_F);
  const EDGE_INSET = dockEdgeInset(windowW);
  const rowWidth = dockRowWidth(windowW);
  const cardWidth = rowWidth - BEAD * 2 - GAP * 2;
  const dims = {
    bead: { width: BEAD, height: BEAD, borderRadius: BEAD / 2 },
    card: { height: CARD_H, borderRadius: CARD_H / 2 },
    button: { width: CARD_BUTTON, height: CARD_BUTTON, borderRadius: CARD_BUTTON / 2 },
    rowHeight: { height: CARD_BUTTON, borderRadius: CARD_BUTTON / 2 },
  };
  const insets = useSafeAreaInsets();
  // NEVER LOWER THAN THE BEST READING SEEN - see the project memory on
  // Android's own under-reported bottom inset right after a screen
  // change; every screen shares this one dock, so a dip on any one of
  // them briefly drags it down everywhere.
  const stableBottomRef = useRef(insets.bottom);
  if (insets.bottom > stableBottomRef.current) stableBottomRef.current = insets.bottom;
  const bottomInset = stableBottomRef.current;

  const ownPublished = useNavDockOwnContext();
  const desksCard = useNavDockDesks();
  const [hidden] = useNavDockHidden();
  // See FloatingIslandTabBar's own comment on `tabsInFlux`: for the one
  // beat a swipe's settle has not yet reached react-navigation, whatever
  // is published here can still be the PREVIOUS screen's.
  const tabsInFlux = useNavDockTabsInFlux();
  const suppress = tabsInFlux;
  const own = suppress ? null : ownPublished;
  // THE ONE RULE THIS WHOLE FILE NOW TURNS ON: a path replaces the
  // desks, in place, never beside them. `hidden` puts the context away
  // (a screen that wants the desks shown even though it has a context
  // of its own) exactly as it already did.
  const content = hidden ? desksCard : (own ?? desksCard);
  const leave = useNavDockLeave();
  const actionsPublished = useNavDockActions();
  const actions = suppress ? null : actionsPublished;
  const beads = useNavDockBeads();
  const lift = useLift();

  const trail = own?.kind === 'path' && content === own ? own : null;
  const strip = own?.kind === 'strip' && content === own ? own : null;
  const desks = content?.kind === 'desks' ? content : null;
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
  const stripOffsetFor = (width: number) =>
    Math.max(0, stripIndex * STRIP_ITEM + STRIP_ITEM / 2 - width / 2);
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

  // Only appears where it has a job nobody else has: at a database's
  // root, where it leaves the database, and on the calendar, which has
  // no root to walk to and is simply put away. Inside folders the first
  // crumb already goes to the root, and two buttons for one job is what
  // the user rightly refused. This is now also the ONLY way to reach
  // the desks while a context is showing - see the file's own header.
  const showLeave = !trail && !!leave;
  const targets = useNavDockTargets();

  if (!content && !leave && !actions?.length && !beads.left && !beads.right) return null;

  const stepOut = () => leave?.onLeave();
  const icon = ((leave?.icon ?? content?.icon) as keyof typeof Ionicons.glyphMap) ?? 'ellipse-outline';

  // WHAT THE CARD IS MADE OF, and how much room each part gets.
  //
  // `hasContent` and `hasActions` can each be true, false, or both -
  // a note past its own root has actions and no context; the calendar's
  // day strip has a context and no actions of its own; a folder deep in
  // a database usually has both. Whichever pair holds, they stand side
  // by side in the SAME card, a hairline between them - never two cards,
  // never a swipe.
  const hasContent = !!content;
  const hasActions = !!actions?.length;
  const showDivider = hasContent && hasActions;
  const dividerSpace = showDivider ? DIVIDER_SPACE : 0;
  // An action button is sized off the room actions actually have -
  // the card's whole width when actions are the only thing in it, the
  // card's width alone (never counting the content zone) when a context
  // shares the card too, since the content zone's own width is worked
  // out below FROM this.
  const ACT_W = Math.floor(
    (hasContent ? cardWidth - CARD_PAD * 2 : cardWidth - CARD_PAD * 2 - (showLeave ? LEAVE_W : 0)) / 4
  );
  const ACT_ICON = 19;
  const actionsCount = actions?.length ?? 0;
  const actionsNeeded =
    actionsCount > 0
      ? actionsCount * ACT_W + Math.floor((actionsCount - 1) / 4) * ACTION_GROUP_GAP + CARD_PAD * 2
      : 0;
  // How much the card widens beyond today's phone-capped width, and who
  // pays for it - a real window's own extra room, first, and only what
  // that room cannot cover comes out of the content zone's own share.
  //
  // Getting this backwards is exactly what shipped first: the divider's
  // 17pt was added to the row's width UNCONDITIONALLY once both a
  // context and actions existed, even on a plain phone with no extra
  // window room to pay for it - so the actions zone was left at zero
  // width while the row itself grew 17pt past the screen's own safe
  // width, and a real button (icon + label) rendered into that zero-
  // width slot spilled out past the card's edge instead of being
  // contained by it: "видно опцію в доці" on the narrow (outer) screen,
  // jammed against the create bead. A phone has no room to spare, so
  // content and actions have to share the SAME card there - actions
  // capped to a fraction of it rather than added on top.
  const roomAvailable = hasContent ? Math.max(0, windowW - EDGE_INSET * 2 - rowWidth) : 0;
  let actionsZoneWidth = 0;
  let contentZoneWidth = 0;
  let cardWidthNow = cardWidth;
  if (hasContent && hasActions) {
    let wanted = actionsNeeded;
    let extraNeeded = dividerSpace + wanted;
    if (extraNeeded > roomAvailable) {
      // The window alone cannot pay for this - cap what actions claim
      // so the content zone keeps the larger share of the base card
      // instead of the two splitting whatever falls short.
      //
      // Rounded down to a WHOLE number of buttons, never a fraction of
      // one: a cap that lands mid-button clips a label in half at the
      // zone's own edge - "Поря[док]" - which reads as broken, not as
      // "more to scroll to". A ScrollView's own natural preview of the
      // next item already says that; a severed word does not need to.
      const wholeButtons = Math.max(1, Math.floor((cardWidth * 0.4 - CARD_PAD * 2) / ACT_W));
      const sharedCap = wholeButtons * ACT_W + CARD_PAD * 2;
      wanted = Math.min(wanted, sharedCap);
      extraNeeded = dividerSpace + wanted;
    }
    const extraFromWindow = Math.min(extraNeeded, roomAvailable);
    const shrinkFromContent = extraNeeded - extraFromWindow;
    cardWidthNow = cardWidth + extraFromWindow;
    actionsZoneWidth = wanted;
    contentZoneWidth = Math.max(0, cardWidth - (showLeave ? LEAVE_W : 0) - shrinkFromContent);
  } else if (hasActions) {
    actionsZoneWidth = cardWidth - (showLeave ? LEAVE_W : 0);
  } else if (hasContent) {
    contentZoneWidth = cardWidth - (showLeave ? LEAVE_W : 0);
  }
  const cardWidthExtra = cardWidthNow - cardWidth;
  // A desk button is the biggest circle four of which fit side by side
  // in the room the content zone actually ended up with - not the room
  // it would have had alone, since that room shrinks the moment actions
  // also stand in this card.
  const DESK = Math.min(CARD_BUTTON, Math.floor(contentZoneWidth / 4));

  return (
    <GlassPortal>
      <View
        style={[styles.wrap, { bottom: DOCK_BOTTOM + bottomInset, paddingHorizontal: EDGE_INSET }]}
        pointerEvents="box-none"
      >
        <View style={[styles.row, { width: rowWidth + cardWidthExtra, gap: GAP, height: CARD_H }]}>
          {beads.left ? (
            <Bead bead={beads.left} theme={theme} lift={lift} size={BEAD} />
          ) : (
            <View style={[styles.beadSlot, dims.bead]} />
          )}
          <View style={[styles.stack, { width: cardWidthNow, height: CARD_H }]}>
            <View style={[dims.card, liftStyle(theme, theme.lift, 1)]}>
              <DockFrost style={[styles.front, styles.cardEdge, dims.card]} radius={CARD_H / 2}>
                {showLeave && (
                  <Pressable onPress={stepOut} style={[styles.leave, { height: CARD_H }]}>
                    <Ionicons name="chevron-back" size={24} color={theme.glass.ink} />
                    <View style={[styles.leaveRule, { backgroundColor: theme.glass.inkMuted, opacity: 0.4 }]} />
                  </Pressable>
                )}

                {hasContent && (
                  <View style={[styles.faceFixed, { width: contentZoneWidth }]}>
                    {desks && (
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
                                      <Circle cx={DESK / 2} cy={DESK / 2} r={DESK / 2 - HERE_SHRINK} fill={HERE_FILL} />
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

                    {strip && (
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
                                <View style={styles.stripMarks}>
                                  {!!item.marks?.length &&
                                    item.marks.map((mark, i) => (
                                      <View
                                        key={`${mark}-${i}`}
                                        style={[styles.stripMark, { backgroundColor: mark === 'accent' ? STRIP_MARK_ACCENT : theme.glass.ink }]}
                                      />
                                    ))}
                                </View>
                                {!!item.sub && <Text style={[styles.stripSub, { color: ink }]}>{item.sub}</Text>}
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

                    {trail && (
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
                  </View>
                )}

                {showDivider && (
                  <View style={[styles.splitDivider, { width: dividerSpace }]}>
                    <View style={[styles.splitDividerLine, { backgroundColor: theme.glass.inkMuted }]} />
                  </View>
                )}

                {hasActions && (
                  <View style={{ width: actionsZoneWidth, height: CARD_H, justifyContent: 'center' }}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionRow}>
                      <ActionGroups actions={actions!} buttonWidth={ACT_W} buttonHeight={CARD_BUTTON} iconSize={ACT_ICON} theme={theme} />
                    </ScrollView>
                  </View>
                )}
              </DockFrost>
            </View>
          </View>
          {beads.right ? (
            <Bead bead={beads.right} theme={theme} lift={lift} size={BEAD} />
          ) : (
            <View style={[styles.beadSlot, dims.bead]} />
          )}
        </View>
      </View>
    </GlassPortal>
  );
}

// One action button - pulled out on its own so the actions zone and any
// future caller draw the exact same button rather than a drifting copy.
function ActionButton({
  action,
  width,
  height,
  iconSize,
  theme,
}: {
  action: DockAction;
  width: number;
  height: number;
  iconSize: number;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <Pressable
      onPress={action.onPress}
      onLongPress={action.onLongPress}
      style={[
        styles.actionButton,
        { width, height, borderRadius: Math.round(height / 3) },
        action.active && styles.actionButtonActive,
      ]}
    >
      {/* Icon over word. The button is a quarter of the card wide and
          the whole card tall, so the word gets one line and no more - a
          label that wrapped would push the icon off centre and make one
          button taller than its neighbours. */}
      {action.icon.startsWith('mc:') ? (
        <MaterialCommunityIcons
          name={action.icon.slice(3) as keyof typeof MaterialCommunityIcons.glyphMap}
          size={iconSize}
          color={action.active ? theme.accent : theme.glass.ink}
        />
      ) : (
        <Ionicons name={action.icon as keyof typeof Ionicons.glyphMap} size={iconSize} color={action.active ? theme.accent : theme.glass.ink} />
      )}
      {!!action.label && (
        <Text
          numberOfLines={1}
          // A safety net, not a licence for long words: a label one
          // letter too wide shrinks rather than ending in an ellipsis,
          // which would hide the very thing the label was added for.
          adjustsFontSizeToFit
          minimumFontScale={0.75}
          style={[styles.actionLabel, { color: action.active ? theme.accent : theme.glass.ink }]}
        >
          {action.label}
        </Text>
      )}
      {!!action.badge && (
        <Ionicons name={action.badge as keyof typeof Ionicons.glyphMap} size={12} color={theme.glass.ink} style={styles.badge} />
      )}
      {/* A number in the badge's own corner instead of a glyph - how
          many things this action is about to act on. The two never
          appear together: a count belongs to acting on a selection, a
          glyph badge to creating something. */}
      {action.count !== undefined && (
        <Text style={[styles.badge, styles.countBadge, { color: theme.glass.ink }]}>{action.count}</Text>
      )}
    </Pressable>
  );
}

// Actions grouped four at a time, a thin divider between groups - the
// user's own idea for telling a long row apart.
function ActionGroups({
  actions,
  buttonWidth,
  buttonHeight,
  iconSize,
  theme,
}: {
  actions: DockAction[];
  buttonWidth: number;
  buttonHeight: number;
  iconSize: number;
  theme: ReturnType<typeof useTheme>;
}) {
  const groups: DockAction[][] = [];
  for (let i = 0; i < actions.length; i += 4) groups.push(actions.slice(i, i + 4));
  return (
    <>
      {groups.map((group, gi) => (
        <View key={group[0]?.key ?? gi} style={styles.actionGroup}>
          {gi > 0 && <View style={[styles.actionGroupDivider, { backgroundColor: theme.glass.inkMuted }]} />}
          {group.map((action) => (
            <ActionButton key={action.key} action={action} width={buttonWidth} height={buttonHeight} iconSize={iconSize} theme={theme} />
          ))}
        </View>
      ))}
    </>
  );
}

function Bead({
  bead,
  theme,
  lift,
  size,
}: {
  bead: DockBead;
  theme: ReturnType<typeof useTheme>;
  // Passed in rather than read here: a bead is drawn twice per dock and
  // the row above already knows the answer.
  lift: ViewStyle;
  size: number;
}) {
  return (
    <Pressable
      onPress={bead.onPress}
      onLongPress={bead.onLongPress}
      style={{ width: size, height: size, overflow: 'visible' }}
    >
      <DockFrost style={[styles.bead, { width: size, height: size }, lift]} radius={size / 2}>
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
      </DockFrost>
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
  // Thin, low-contrast - the divider between the context zone and the
  // actions zone needs SOME line or the eye cannot tell there are two
  // objects sharing the card rather than one thing misaligned.
  cardEdge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  front: {
    width: '100%',
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Deliberately not `flex: 1` - see the file's own comment on why every
  // zone in this card is given an explicit width rather than left to
  // flex: `flex: 1` in React Native is three properties, and overriding
  // only two of them once left a zone collapsed to zero width with its
  // icons landing on top of the other zone.
  faceFixed: {
    minWidth: 0,
    justifyContent: 'center',
  },
  splitDivider: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  splitDividerLine: {
    width: StyleSheet.hairlineWidth,
    height: 22,
    opacity: 0.35,
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
    flexShrink: 1,
    minWidth: 0,
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
  // A group of (up to) four buttons - no gap WITHIN the group, since
  // ACT_W already divides the available width evenly across them; the
  // divider between groups carries all the separation.
  actionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionGroupDivider: {
    width: 1,
    height: 22,
    marginHorizontal: 8,
    opacity: 0.35,
  },
  spread: {
    justifyContent: 'space-between',
    flex: 1,
  },
  beadSlot: {
    flexShrink: 0,
  },
  bead: {
    // Fixed: a bead never gives up room, it is the card that does.
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadge: {
    fontSize: 11,
    fontFamily: FONT_BOLD,
  },
  badge: {
    // Over the icon's own corner. It used to be measured from the
    // button's bottom, which was the icon's bottom while the button
    // held nothing else; with a word down there it would sit on the
    // word instead.
    position: 'absolute',
    right: 6,
    top: 6,
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
  actionLabel: {
    fontSize: 9.5,
    fontWeight: '600',
    marginTop: 2,
    paddingHorizontal: 2,
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
    flexDirection: 'row',
    gap: 3,
    minHeight: 5,
    marginTop: 2,
    alignItems: 'center',
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
