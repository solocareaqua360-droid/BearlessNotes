import { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { View as RNView } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import DocumentTagsBlock from './DocumentTagsBlock';
import ProjectBadge from './ProjectBadge';
import type { Group, Tag } from '../types';
import { CHROME_TOP, RAIL_RIGHT } from '../constants/rail';
import { makeStyles as makeEditorStyles } from './documentEditorStyles';
import type { Block } from '../types';
import BlockRow from './BlockRow';
import { GlassPortal } from './GlassPortal';

// A CARD THAT BECOMES THE PAGE, and the page that folds back into it.
//
// Deferred since 2026-09-11, when layout transitions were tried and the
// user's verdict was that "cheap" described them: animating a height is
// cosmetic, not the effect they meant. What they meant, in their own
// words, is a card visibly detaching, flying up over everything and
// unfolding into the full editor page.
//
// Why it is possible now without the fragile route: the calendar's
// overview built the same hand-over this month - a real page drawn by
// the editor's own BlockRow, scaled down, handed to and from the live
// screen - and it works. This is that, run as a move rather than as a
// resting state.
//
// HOW IT SITS IN THE APP. The surface is portalled (GlassPortal), so it
// draws above both screens; the list that owns it stays mounted under
// the pushed editor, so the same overlay can play the move out and, on
// the way back, play it in reverse. The push itself carries no animation
// of its own - see the Editor route's `morph` param in AppNavigator -
// because a stack slide under a growing page is two moves fighting.
//
// DRIVEN BY REANIMATED, not by React state, and that is not a
// preference. The surface is portalled, and a portal's child setting
// state re-renders the WHOLE portal host - the dock and its live blur
// included - so a move written as sixty state changes a second was
// sixty re-renders of the dock a second, and the end of it read as a
// blink even once nothing new appeared there: "екран всеодно блимає
// вкінці хоч нового нічого не з'являється". Now the host renders twice
// per flight, at its two ends, and everything between is a worklet.
//
// EVERY FAILURE FALLS BACK TO A PLAIN NAVIGATE. A card that cannot be
// measured, a window that is not there yet: the move is skipped and the
// screen simply opens, which is what it did before this existed.

// Growing out, and folding back. Out is slower: it is the move that has
// something to say.
const OUT_MS = 340;
const BACK_MS = 280;
// How long the page stands at full screen before it is handed to the
// real editor - room for that screen's first frame, during which what is
// on top is the same page it is about to draw.
const HANDOVER_MS = 150;
const FADE_MS = 120;
const CARD_RADIUS = 16;
// Past this nothing can be seen on even the tallest page.
const MAX_ROWS = 40;
const noop = () => {};

export type MorphRect = { x: number; y: number; width: number; height: number };
// Everything the page SHOWS, not everything it is: what the flight has
// to draw so that the screen it hands over to has nothing left to add.
// Both of these were missing at first and both announced themselves the
// same way - "бац блимає та з'являється в самому кінці", at the one
// moment when nothing should move at all.
export type MorphDoc = {
  id: string;
  title: string;
  blocks: Block[];
  tagIds: string[];
  tags: Tag[];
  project: Group | null;
};

type Flight = { doc: MorphDoc; rect: MorphRect };

export function useDocumentMorph() {
  const { width: windowW, height: windowH } = useWindowDimensions();
  // What is flying, and from where - set once at each end of a flight.
  const [flight, setFlight] = useState<Flight | null>(null);
  // 0 sits on the card, 1 fills the window.
  const open01 = useSharedValue(0);
  const alpha = useSharedValue(1);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Every card on screen, so the way back knows where its own card is.
  const nodes = useRef(new Map<string, RNView>());

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  // One callback per card, kept - a fresh function every render would
  // have React detach and reattach every card's ref on every render of
  // the list, which is a real cost for a list that can be long and a
  // feature that is idle almost all of the time.
  const refs = useRef(new Map<string, (node: RNView | null) => void>());
  const registerCard = useCallback((id: string) => {
    const kept = refs.current.get(id);
    if (kept) return kept;
    const fn = (node: RNView | null) => {
      if (node) nodes.current.set(id, node);
      else nodes.current.delete(id);
    };
    refs.current.set(id, fn);
    return fn;
  }, []);

  const land = useCallback(() => {
    alpha.value = withTiming(0, { duration: FADE_MS }, (finished) => {
      if (finished) runOnJS(setFlight)(null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The card grows into the page, and `then` opens the real screen once
  // there is nothing else left on screen to see.
  const open = useCallback(
    (doc: MorphDoc, then: () => void) => {
      const node = nodes.current.get(doc.id);
      if (!node || !windowW || !windowH) {
        then();
        return;
      }
      node.measureInWindow((x, y, width, height) => {
        if (!width || !height) {
          then();
          return;
        }
        clearTimers();
        open01.value = 0;
        alpha.value = 1;
        setFlight({ doc, rect: { x, y, width, height } });
        open01.value = withTiming(
          1,
          { duration: OUT_MS, easing: Easing.out(Easing.cubic) },
          (finished) => {
            if (finished) runOnJS(then)();
          }
        );
        // The real screen gets its first frame under a page that is
        // still whole, and only then is the page taken away.
        timers.current.push(setTimeout(land, OUT_MS + HANDOVER_MS));
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clearTimers, land, windowW, windowH]
  );

  // Coming back: the page is already full screen (the pop carried no
  // animation), so this starts where it ended and folds onto the card.
  // With no card to fold onto - the list has been scrolled, or the note
  // was made somewhere else - it simply does nothing, which is the
  // honest thing rather than flying to a place nothing is at.
  const close = useCallback(
    (doc: MorphDoc) => {
      const node = nodes.current.get(doc.id);
      if (!node) return;
      node.measureInWindow((x, y, width, height) => {
        if (!width || !height) return;
        clearTimers();
        open01.value = 1;
        alpha.value = 1;
        setFlight({ doc, rect: { x, y, width, height } });
        open01.value = withTiming(0, { duration: BACK_MS, easing: Easing.out(Easing.cubic) }, (finished) => {
          if (finished) runOnJS(land)();
        });
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clearTimers, land]
  );

  const overlay = flight ? (
    <MorphSurface flight={flight} windowW={windowW} windowH={windowH} open01={open01} alpha={alpha} />
  ) : null;

  return { registerCard, open, close, overlay, flying: flight !== null };
}

function MorphSurface({
  flight,
  windowW,
  windowH,
  open01,
  alpha,
}: {
  flight: Flight;
  windowW: number;
  windowH: number;
  open01: SharedValue<number>;
  alpha: SharedValue<number>;
}) {
  const theme = useTheme();
  // The editor's OWN title style, not a copy of its numbers: the page
  // this becomes draws the title with exactly these, and a hand-over
  // where the title jumps a size is the one thing the eye would catch.
  const editorStyles = useStyles(makeEditorStyles);
  const insets = useSafeAreaInsets();
  const { rect } = flight;
  // Both styles read the same two shared values, so the surface and the
  // page inside it can never be a frame apart.
  const surfaceStyle = useAnimatedStyle(() => {
    const t = open01.value;
    return {
      left: rect.x * (1 - t),
      top: rect.y * (1 - t),
      width: rect.width + (windowW - rect.width) * t,
      height: rect.height + (windowH - rect.height) * t,
      borderRadius: CARD_RADIUS * (1 - t),
      opacity: alpha.value,
    };
  });
  // The page is laid out at the width it will really have and scaled to
  // whatever width the surface has right now - the same trick the
  // calendar's miniatures use, for the same reason: a page squeezed into
  // a card's width is not that page, it is a different layout.
  const pageStyle = useAnimatedStyle(() => {
    const t = open01.value;
    const w = rect.width + (windowW - rect.width) * t;
    const h = rect.height + (windowH - rect.height) * t;
    return {
      left: (w - windowW) / 2,
      top: (h - windowH) / 2,
      transform: [{ scale: Math.max(0.05, w / windowW) }],
    };
  });
  let numbered = 0;
  const shown = flight.doc.blocks.slice(0, MAX_ROWS);
  return (
    <GlassPortal priority={90}>
      <Animated.View
        pointerEvents="none"
        style={[styles.surface, { backgroundColor: theme.paper.fill }, surfaceStyle]}
      >
        <Animated.View style={[styles.page, { width: windowW, height: windowH }, pageStyle]}>
          {/* The page's own name, where the page puts it. */}
          <Text style={[editorStyles.titleInput, styles.title]} numberOfLines={2}>
            {flight.doc.title || 'Без назви'}
          </Text>
          {/* The real one, not a picture of it: a row drawn by hand from
              the same tags would be a second thing to keep in step with
              this one, and it is the mismatch that would show. Inert -
              every handler here is a no-op, and the surface takes no
              touches at all. */}
          <DocumentTagsBlock
            tagIds={flight.doc.tagIds}
            tags={flight.doc.tags}
            onAttach={noop}
            onDetach={noop}
            onCreateAndAttach={noop}
            onRenameTag={noop}
          />
          {/* The rows live in a scroll view that never scrolls, because
              that is the shape they were written against - laid straight
              into a box of fixed height they lose every row that fills
              its line. See DayPageMiniature, which learned this the hard
              way. Deliberately its own copy rather than that component
              reshaped: this one's height is not its width's business. */}
          <View style={styles.rows}>
            {shown.map((item, index) => {
              if (item.type === 'numbered') {
                numbered = index > 0 && shown[index - 1].type === 'numbered' ? numbered + 1 : 1;
              } else {
                numbered = 0;
              }
              return (
                <BlockRow
                  key={item.id}
                  item={item}
                  hideHandle
                  isSelected={false}
                  isSelectMode={false}
                  isActive={false}
                  showBoundary={false}
                  listNumber={item.type === 'numbered' ? numbered : undefined}
                  textVersion={0}
                  onActivate={noop}
                  onBlur={noop}
                  onChangeText={noop}
                  onBackspaceEmpty={noop}
                  onToggleSelected={noop}
                  onToggleChecked={noop}
                  onOpenReminder={noop}
                  onUpdateBlock={noop}
                  onFocus={noop}
                  onSelectionChange={noop}
                  onOpenImage={noop}
                  onToggleImageFit={noop}
                  onDrawOverImage={noop}
                  onOpenFile={noop}
                  onDownloadFile={noop}
                  onOpenFileDatabase={noop}
                  onOpenLink={noop}
                  onOpenLinkDatabase={noop}
                  onOpenSketch={noop}
                  allTags={[]}
                  onOpenCustomRow={noop}
                  onOpenCustomView={noop}
                  inputRef={noop}
                  paperColor={null}
                />
              );
            })}
          </View>
        </Animated.View>
        {/* Where the editor's own rail puts it, in the page's own
            coordinates - it scales with everything else. */}
        <View style={[styles.badge, { top: insets.top + CHROME_TOP, right: RAIL_RIGHT }]} pointerEvents="none">
          <ProjectBadge project={flight.doc.project} glass />
        </View>
      </Animated.View>
    </GlassPortal>
  );
}

const styles = StyleSheet.create({
  surface: {
    position: 'absolute',
    overflow: 'hidden',
  },
  page: {
    position: 'absolute',
    overflow: 'hidden',
  },
  title: {
    // Clear of the status bar and the note's own floating capsule, which
    // is roughly where the editor's title sits on arrival.
    paddingTop: 72,
  },
  rows: {
    paddingHorizontal: 12,
  },
  badge: {
    position: 'absolute',
    alignItems: 'center',
  },
});
