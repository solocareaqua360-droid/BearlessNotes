import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GlassDrop from './GlassDrop';
import { GlassPortal } from './GlassPortal';
import { useTheme } from '../theme/ThemeProvider';
import { NAV_BOTTOM, NAV_BUTTON, NAV_PADDING } from '../constants/rail';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { useNavDockContext, useNavDockHidden, useNavDockLeave, useNavDockTargets } from '../navigation/navDock';

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

export default function ContextDock() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const dock = useNavDockContext();
  // The way out of the SCREEN, which is true even at a database's root,
  // where there is no path to show. The user's own ask: standing in a
  // database, the way back to the databases was the small arrow in the
  // top-right corner of the rail, and it belongs under the thumb.
  const leave = useNavDockLeave();
  const [, setHidden] = useNavDockHidden();
  // A card being carried can step onto a crumb - the same registry the
  // folder rows use, handed up by whichever screen is carrying.
  const targets = useNavDockTargets();

  const trail = dock?.kind === 'path' ? dock : null;
  const strip = dock?.kind === 'strip' ? dock : null;
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

  if (!dock && !leave) return null;

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
  const stepOut = () => {
    if (trail) return trail.onGo('');
    if (strip) return setHidden(true);
    leave?.onLeave();
  };
  const icon = ((dock?.icon ?? leave?.icon) as keyof typeof Ionicons.glyphMap) ?? 'ellipse-outline';

  return (
    <GlassPortal>
      <View style={[styles.wrap, { bottom: NAV_BOTTOM + insets.bottom }]} pointerEvents="box-none">
        <View style={styles.row}>
          <Pressable onPress={stepOut}>
            <GlassDrop style={styles.exitBead}>
              <Ionicons name="chevron-back" size={11} color={theme.glass.inkMuted} />
              <Ionicons name={icon} size={20} color={theme.glass.ink} />
            </GlassDrop>
          </Pressable>

          {strip && (
            <GlassDrop style={styles.shell}>
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

          {trail && (
            <GlassDrop style={[styles.shell, styles.trailShell]}>
              <View style={styles.trailRow}>
                <ScrollView
                  ref={trailRef}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.trailStrip}
                >
                  <View ref={targets?.('')} collapsable={false}>
                    <Pressable onPress={() => trail.onGo('')} style={styles.trailSegment}>
                      <Text style={[styles.trailLabel, { color: theme.glass.inkMuted }]}>Всі</Text>
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
        </View>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: '96%',
  },
  exitBead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
    paddingLeft: 10,
    paddingRight: 13,
    height: NAV_BUTTON + NAV_PADDING * 2,
  },
  shell: {
    padding: NAV_PADDING,
  },
  trailShell: {
    flexShrink: 1,
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
  trailLabelCurrent: {
    fontFamily: FONT_SEMIBOLD,
    fontWeight: '600',
  },
});
