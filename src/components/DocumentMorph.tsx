import { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { View as RNView } from 'react-native';
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

type Flight = {
  doc: MorphDoc;
  rect: MorphRect;
  // 0 sits on the card, 1 fills the window.
  open: number;
  // Fading out at the very end of either direction.
  alpha: number;
};

const easeOutCubic = (k: number) => 1 - Math.pow(1 - k, 3);

export function useDocumentMorph() {
  const { width: windowW, height: windowH } = useWindowDimensions();
  const [flight, setFlight] = useState<Flight | null>(null);
  const raf = useRef<number | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Every card on screen, so the way back knows where its own card is.
  const nodes = useRef(new Map<string, RNView>());

  const stop = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
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

  const drive = useCallback(
    (from: number, to: number, ms: number, done: () => void) => {
      const t0 = Date.now();
      const step = () => {
        const k = Math.min(1, (Date.now() - t0) / ms);
        setFlight((live) => (live ? { ...live, open: from + (to - from) * easeOutCubic(k) } : live));
        if (k < 1) {
          raf.current = requestAnimationFrame(step);
          return;
        }
        raf.current = null;
        done();
      };
      raf.current = requestAnimationFrame(step);
    },
    []
  );

  const fadeOut = useCallback(() => {
    const t0 = Date.now();
    const step = () => {
      const k = Math.min(1, (Date.now() - t0) / FADE_MS);
      setFlight((live) => (live ? { ...live, alpha: 1 - k } : live));
      if (k < 1) {
        raf.current = requestAnimationFrame(step);
        return;
      }
      raf.current = null;
      setFlight(null);
    };
    raf.current = requestAnimationFrame(step);
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
        stop();
        setFlight({ doc, rect: { x, y, width, height }, open: 0, alpha: 1 });
        drive(0, 1, OUT_MS, () => {
          then();
          timers.current.push(setTimeout(fadeOut, HANDOVER_MS));
        });
      });
    },
    [drive, fadeOut, stop, windowW, windowH]
  );

  // Coming back: the page is already full screen (the pop carried no
  // animation), so this starts where it ended and folds onto the card.
  // With no card to fold onto - the list has been scrolled, or the note
  // was made somewhere else - it simply fades, which is the honest thing
  // to do rather than flying to a place nothing is at.
  const close = useCallback(
    (doc: MorphDoc) => {
      const node = nodes.current.get(doc.id);
      if (!node) return;
      node.measureInWindow((x, y, width, height) => {
        if (!width || !height) return;
        stop();
        setFlight({ doc, rect: { x, y, width, height }, open: 1, alpha: 1 });
        drive(1, 0, BACK_MS, fadeOut);
      });
    },
    [drive, fadeOut, stop]
  );

  const overlay = flight ? (
    <MorphSurface flight={flight} windowW={windowW} windowH={windowH} />
  ) : null;

  return { registerCard, open, close, overlay, flying: flight !== null };
}

function MorphSurface({
  flight,
  windowW,
  windowH,
}: {
  flight: Flight;
  windowW: number;
  windowH: number;
}) {
  const theme = useTheme();
  // The editor's OWN title style, not a copy of its numbers: the page
  // this becomes draws the title with exactly these, and a hand-over
  // where the title jumps a size is the one thing the eye would catch.
  const editorStyles = useStyles(makeEditorStyles);
  const insets = useSafeAreaInsets();
  const t = flight.open;
  const { rect } = flight;
  const x = rect.x * (1 - t);
  const y = rect.y * (1 - t);
  const w = rect.width + (windowW - rect.width) * t;
  const h = rect.height + (windowH - rect.height) * t;
  const radius = CARD_RADIUS * (1 - t);
  // The page is laid out at the width it will really have and scaled to
  // whatever width the surface has right now - the same trick the
  // calendar's miniatures use, for the same reason: a page squeezed into
  // a card's width is not that page, it is a different layout.
  const scale = Math.max(0.05, w / windowW);
  let numbered = 0;
  const shown = flight.doc.blocks.slice(0, MAX_ROWS);
  return (
    <GlassPortal priority={90}>
      <View
        pointerEvents="none"
        style={[
          styles.surface,
          {
            left: x,
            top: y,
            width: w,
            height: h,
            borderRadius: radius,
            opacity: flight.alpha,
            backgroundColor: theme.paper.fill,
          },
        ]}
      >
        <View
          style={[
            styles.page,
            {
              width: windowW,
              height: windowH,
              left: (w - windowW) / 2,
              top: (h - windowH) / 2,
              transform: [{ scale }],
            },
          ]}
        >
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
        </View>
        {/* Where the editor's own rail puts it, in the page's own
            coordinates - it scales with everything else. */}
        <View style={[styles.badge, { top: insets.top + CHROME_TOP, right: RAIL_RIGHT }]} pointerEvents="none">
          <ProjectBadge project={flight.doc.project} glass />
        </View>
      </View>
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
