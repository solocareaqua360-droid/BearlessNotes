import { WINDOW_INNER_RADIUS } from '../theme/scale';
import { deskGlass } from '../theme/desktopTheme';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardRide } from '../hooks/useKeyboardRide';
import { TOP_NAV_SPACE } from './TopNavBar';
import { Ionicons } from './icons/Ionicons';
import AddExistingItemModal from './AddExistingItemModal';
import GlassDrop, { GlassIcon } from './GlassDrop';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import { useReferenceDrag } from '../hooks/useReferenceDrag';
import type { Block } from '../types';
import type { SoftTokens } from '../theme/soft';
import SoftIcon from './SoftIcon';
import { SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';
import { useDensity } from '../hooks/useDensity';
import { useSoft } from '../theme/soft';

// «Референси» - the user's own idea: browse everything this app already
// knows how to list (files, photos, links, custom databases, and another
// document's own blocks) beside the note, and drag pieces of it in as raw
// material. AddExistingItemModal already IS that browser (opened from the
// "/" menu as «З бази»), so this docks a standing copy of it rather than
// building a second one, and wires ITS rows to useReferenceDrag.
//
// WHERE a drop lands is the caller's business, not this panel's: on the
// canvas it is a point on a surface, on the page it is a gap between two
// blocks. Both are answered asynchronously because both are measured
// against the window (see DocumentCanvasHandle.screenToSurface and
// BlockListHandle.hoverExternal), hence `respond` rather than a return.
export default function ReferencePanel({
  visible,
  onClose,
  onDrop,
  onDragMove,
  onDragFinished,
  hint,
  excludeIds,
  soft,
  sheet = false,
  width,
  onResizeWidth,
}: {
  visible: boolean;
  onClose: () => void;
  onDrop: (block: Block, screenX: number, screenY: number, respond: (accepted: boolean) => void) => void;
  // Every move of the finger while something is in hand, so the target
  // can show where it would land. Left out where there is nothing to
  // show - the canvas takes a drop anywhere on itself.
  onDragMove?: (screenX: number, screenY: number) => void;
  // Nothing in hand any more - see useReferenceDrag's onFinished.
  onDragFinished?: () => void;
  hint: string;
  excludeIds?: Set<string>;
  // The soft style (theme/soft), when the note beside it wears it: the
  // quiet ground, Inter, the soft icons, and a card in hand instead of
  // a glass drop.
  soft?: SoftTokens | null;
  // A SHEET FROM THE BOTTOM instead of a drawer at the side (the user's
  // pick of three, 2026-09-29: "давай спробуємо 1"). The drawer had no
  // place of its own - it slid under the note's bar and lay over half
  // the text. The sheet takes the lower part of the screen at full
  // width, the bar and the top of the note stay clear above it, and
  // things are dragged UP out of it into the note. Pulled up by its
  // grabber it stands just under the bar; pulled down, it goes. Kept
  // mounted by the caller while closed, so it can slide away rather
  // than vanish.
  sheet?: boolean;
  // At a pointer the panel is as wide as the editor says, and its left edge
  // is a handle that moves that width (told to onResizeWidth).
  width?: number;
  onResizeWidth?: (width: number) => void;
}) {
  const theme = useTheme();
  // The laptop's panel is one of the app's soft cards, like the side panels
  // (RightColumn): a header row with the icon and the name, a round close,
  // a soft shadow - not a flat slab with a rule down its side.
  const pointer = useDensity() === 'pointer' && !sheet;
  const S = useSoft();
  const styles = useStyles(makeStyles);
  const drag = useReferenceDrag({ onDrop, onMove: onDragMove, onFinished: onDragFinished });

  // Plainly positioned, NOT through useAnimatedStyle - and that is the
  // whole of the white screen this panel opened with.
  //
  // Reanimated collects a worklet's closure by IDENTIFIER: a body that
  // says `drag.ghost` captures `drag`, the whole object this hook
  // returns, and tries to copy every property of it onto the UI thread.
  // One of them is the Pan itself - "[Worklets] Cannot copy value of
  // type `PanGesture`" - thrown asynchronously, so no error boundary saw
  // it and the JS root simply went away, leaving Android's own empty
  // white window and nothing to report. (CardCarryOverlay does the same
  // thing safely because its ghost arrives as a plain prop.)
  //
  // There was nothing to animate here anyway: the ghost's position is JS
  // state that re-renders on every finger move, so a worklet only ever
  // repeated what React had already done.
  const ghost = drag.ghost;

  // The sheet's resting places, as the top edge's distance from the
  // window's top: half the screen, just under the bar, and gone.
  const { height: windowH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const fullTop = insets.top + TOP_NAV_SPACE;
  const halfTop = Math.round(windowH * 0.42);
  const topSV = useSharedValue(windowH);
  const dragSV = useSharedValue(0);
  const keyboard = useKeyboardRide();
  const [shown, setShown] = useState(visible);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closeFromGesture = useCallback(() => onCloseRef.current(), []);
  useEffect(() => {
    if (!sheet) return;
    if (visible) {
      setShown(true);
      topSV.value = withTiming(halfTop, { duration: 320, easing: Easing.out(Easing.cubic) });
    } else {
      topSV.value = withTiming(windowH, { duration: 240, easing: Easing.in(Easing.cubic) }, (done) => {
        if (done) runOnJS(setShown)(false);
      });
    }
    // halfTop/windowH only move on a fold or rotation; a resting sheet
    // is re-placed by the next open.
  }, [visible, sheet]);
  // The grabber: follows the finger, then settles on the nearer of the
  // two places - or, pulled well below half, closes. Plain numbers and
  // shared values only inside the worklets (see reanimated_worklet_closure).
  const sheetPan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([-6, 6])
        .onUpdate((e) => {
          dragSV.value = e.translationY;
        })
        .onEnd((e) => {
          const from = topSV.value + e.translationY;
          const projected = from + e.velocityY * 0.15;
          topSV.value = Math.max(fullTop, from);
          dragSV.value = 0;
          if (projected > halfTop + 110) {
            runOnJS(closeFromGesture)();
            return;
          }
          const target = Math.abs(projected - fullTop) < Math.abs(projected - halfTop) ? fullTop : halfTop;
          topSV.value = withTiming(target, { duration: 260, easing: Easing.out(Easing.cubic) });
        }),
    [fullTop, halfTop, topSV, dragSV, closeFromGesture]
  );
  const sheetStyle = useAnimatedStyle(() => {
    // With the keyboard up (typing in its search) the sheet stands on
    // the keyboard and reaches up to the bar, or there would be no list
    // left to see.
    const lift = Math.max(0, -keyboard.height.value);
    const resting = Math.max(fullTop, topSV.value + dragSV.value);
    const top = resting + (fullTop - resting) * Math.min(1, keyboard.progress.value);
    return { top, bottom: lift };
  });

  if (sheet ? !visible && !shown : !visible) return null;

  const header = pointer ? (
    <>
      <View style={[styles.deskHeader, { borderBottomColor: S.line }]}>
        <SoftIcon name="doc" size={16} color={S.ink2} />
        <Text style={[styles.deskTitle, { color: S.ink }]}>Референси</Text>
        <Pressable
          onPress={onClose}
          hitSlop={6}
          accessibilityLabel="Закрити"
          style={(state) => [styles.deskClose, (state as { hovered?: boolean }).hovered && { backgroundColor: S.fill }]}
        >
          <Ionicons name="close" size={17} color={S.ink2} />
        </Pressable>
      </View>
      <Text style={[styles.deskHint, { color: S.ink3 }]}>{hint}</Text>
    </>
  ) : (
    <>
      <View style={[styles.header, soft && styles.softHeader]}>
          {soft ? (
            <Text style={[styles.softTitle, { color: soft.ink }]}>Референси</Text>
          ) : (
            <>
              <Ionicons name="albums-outline" size={16} color={theme.ink.muted} />
              <Text style={styles.headerLabel}>Референси</Text>
            </>
          )}
          <View style={{ flex: 1 }} />
          {soft ? (
            <Pressable
              onPress={onClose}
              hitSlop={8}
              accessibilityLabel="Закрити"
              style={[styles.softClose, { backgroundColor: soft.fill }]}
            >
              <SoftIcon name="close" size={18} color={soft.ink2} />
            </Pressable>
          ) : (
            <Ionicons name="close" size={20} color={theme.ink.muted} onPress={onClose} />
          )}
        </View>
        <Text style={[styles.hint, soft && [styles.softHint, { color: soft.ink3 }]]}>{hint}</Text>
    </>
  );
  const list = (
        <GestureDetector gesture={drag.gesture}>
          <View style={{ flex: 1 }}>
            <AddExistingItemModal
              visible
              docked
              soft={soft}
              excludeIds={excludeIds}
              includeCustomDatabases
              includeDocuments
              rowRef={drag.registerRow}
              onPick={() => {}}
              onClose={() => {}}
            />
          </View>
        </GestureDetector>
  );

  return (
    <>
      {sheet && soft ? (
        <Animated.View
          style={[styles.sheet, { backgroundColor: soft.bg, boxShadow: soft.popShadow }, sheetStyle]}
        >
          <GestureDetector gesture={sheetPan}>
            <View collapsable={false}>
              <View style={styles.grabberRow}>
                <View style={[styles.grabber, { backgroundColor: soft.ink3 }]} />
              </View>
              {header}
            </View>
          </GestureDetector>
          {list}
        </Animated.View>
      ) : pointer ? (
        // Standing off the window's edges by a gap, the way the side panels
        // do, so its shadow has room.
        <View style={styles.deskFrame}>
          {!!onResizeWidth && !!width && <ResizeEdge width={width} onResize={onResizeWidth} />}
          <View style={[styles.deskCard, { backgroundColor: deskGlass(S).panel, boxShadow: S.shadow, borderColor: S.line }]}>
            {header}
            {list}
          </View>
        </View>
      ) : (
        <View style={[styles.panel, soft && [styles.softPanel, { backgroundColor: soft.bg, boxShadow: soft.popShadow }]]}>
          {header}
          {list}
        </View>
      )}

      <View ref={drag.ghostAnchor} pointerEvents="none" collapsable={false} style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0 }} />
      {ghost && (
        <View style={[styles.ghostWrap, { left: ghost.x, top: ghost.y }]} pointerEvents="none">
          {soft ? (
            // What is in hand is a card lifted off the ground - the soft
            // surface and its floating shadow, not a glass drop.
            <View style={[styles.ghost, styles.softGhost, { backgroundColor: soft.card, boxShadow: soft.popShadow }]}>
              <SoftIcon name="doc" size={17} color={soft.ink2} />
              <Text style={[styles.ghostLabel, { color: soft.ink, fontFamily: SOFT_SEMIBOLD, fontWeight: 'normal' }]} numberOfLines={1}>
                {ghost.label}
              </Text>
            </View>
          ) : (
            <GlassDrop radius={16} lift="shadow" style={styles.ghost}>
              <GlassIcon name="albums-outline" size={16} />
              <Text style={styles.ghostLabel} numberOfLines={1}>
                {ghost.label}
              </Text>
            </GlassDrop>
          )}
        </View>
      )}
    </>
  );
}

// The panel's left edge: a drag along it moves the panel's width. Pointer
// events on the node, then on the window for the rest of the drag, so a
// fast move that outruns the strip is still followed.
function ResizeEdge({ width, onResize }: { width: number; onResize: (width: number) => void }) {
  const S = useSoft();
  const styles = useStyles(makeStyles);
  const ref = useRef<View | null>(null);
  const [hover, setHover] = useState(false);
  const latest = useRef({ width, onResize });
  latest.current = { width, onResize };
  useEffect(() => {
    const node = ref.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== 'function') return;
    const on = () => setHover(true);
    const off = () => setHover(false);
    function onDown(event: PointerEvent) {
      event.preventDefault();
      const from = event.clientX;
      const base = latest.current.width;
      const move = (e: PointerEvent) => latest.current.onResize(base + (from - e.clientX));
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.style.cursor = '';
      };
      document.body.style.cursor = 'col-resize';
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }
    node.addEventListener('mouseenter', on);
    node.addEventListener('mouseleave', off);
    node.addEventListener('pointerdown', onDown);
    return () => {
      node.removeEventListener('mouseenter', on);
      node.removeEventListener('mouseleave', off);
      node.removeEventListener('pointerdown', onDown);
    };
  }, []);
  return (
    <View ref={ref} style={styles.resizeEdge}>
      <View style={[styles.resizeLine, { backgroundColor: hover ? S.ink3 : 'transparent' }]} />
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    deskFrame: { flex: 1, paddingTop: 8, paddingBottom: 8, paddingRight: 8, paddingLeft: 6 },
    deskCard: { flex: 1, borderRadius: WINDOW_INNER_RADIUS, overflow: 'hidden' },
    deskHeader: {
      height: 38,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingLeft: 14,
      paddingRight: 8,
      borderBottomWidth: 0,
    },
    deskTitle: { flex: 1, fontSize: 13.5, fontFamily: SOFT_SEMIBOLD },
    deskClose: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
    deskHint: { fontSize: 12, fontFamily: SOFT_MEDIUM, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 2 },
    resizeEdge: { position: 'absolute', left: -2, top: 0, bottom: 0, width: 10, zIndex: 40, cursor: 'col-resize' } as never,
    resizeLine: { position: 'absolute', left: 4, top: '42%', height: '16%', minHeight: 50, width: 3, borderRadius: 1.5 },
    // Sized by whoever mounts this - a real side pane on the Fold's wide
    // inner screen, a narrower glass drawer over part of the canvas on a
    // phone. Either way it is never the full screen: the canvas has to
    // stay reachable as the drop target.
    // The THEME'S own ground, not a dark slab. Written as one it was a
    // black panel standing on white paper in the light themes, which is
    // the same mistake the editor's own "/" bar made and was fixed for:
    // this is a surface of its own, not a pill floating on glass, so it
    // wears what every other surface in the app wears.
    panel: {
      flex: 1,
      backgroundColor: t.ground,
      // The edge faces the note, and the note is to the LEFT of this
      // panel now that it docks against the window's right edge - see
      // referencePanelDock. It was on the other side, from when the
      // panel was.
      borderLeftWidth: 1,
      borderLeftColor: t.edge.hairline,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 14,
      paddingTop: 14,
    },
    headerLabel: {
      fontSize: 13,
      fontWeight: '700',
      color: t.ink.primary,
    },
    hint: {
      fontSize: 11,
      color: t.ink.faint,
      paddingHorizontal: 14,
      paddingTop: 2,
      paddingBottom: 8,
    },
    // A sheet drawn in from the right edge: rounded where it faces the
    // note, lifted off it by the soft floating shadow instead of a rule.
    softPanel: {
      borderLeftWidth: 0,
      borderTopLeftRadius: 26,
      borderBottomLeftRadius: 26,
    },
    sheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      overflow: 'hidden',
    },
    grabberRow: {
      alignItems: 'center',
      paddingTop: 10,
      paddingBottom: 2,
    },
    grabber: {
      width: 38,
      height: 5,
      borderRadius: 2.5,
      opacity: 0.6,
    },
    softHeader: {
      paddingHorizontal: 18,
      paddingTop: 16,
    },
    softTitle: {
      fontFamily: SOFT_SEMIBOLD,
      fontWeight: 'normal',
      fontSize: 20,
      letterSpacing: -0.3,
    },
    softClose: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
    },
    softHint: {
      fontFamily: SOFT_REGULAR,
      fontSize: 12.5,
      paddingHorizontal: 18,
      paddingTop: 4,
      paddingBottom: 12,
    },
    softGhost: {
      borderRadius: 18,
      elevation: 0,
      shadowOpacity: 0,
    },
    ghostWrap: {
      position: 'absolute',
      transform: [{ scale: 1.04 }],
    },
    ghost: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 14,
      shadowColor: '#000',
      shadowOpacity: 0.28,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 10,
    },
    ghostLabel: {
      fontSize: 13,
      fontWeight: '600',
      maxWidth: 180,
      color: t.ink.primary,
    },
  });
