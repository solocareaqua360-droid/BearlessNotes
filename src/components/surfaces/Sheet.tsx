import { ReactNode, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle, useWindowDimensions } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import GlassLayer from '../GlassLayer';
import type { FlipFrom } from '../../utils/flipOpen';
import { useStyles, useTheme } from '../../theme/ThemeProvider';
import EdgeFade from '../EdgeFade';
import type { Theme } from '../../theme/tokens';
import { useKeyboardHeight } from '../../hooks/useKeyboardHeight';
import { useKeyboardRide } from '../../hooks/useKeyboardRide';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDensity } from '../../hooks/useDensity';
import { useDockGlass } from '../../utils/dockGlass';
import { SHEET_FRAME, SHEET_WINDOW, PHONE_ONLY } from '../../constants/glass';
import { FONT_BOLD, FONT_REGULAR } from '../../utils/fonts';
import DockGlassFill, { useDockSurface } from '../DockGlassFill';
import { useSoft } from '../../theme/soft';

// «Аркуш» - a panel of content over the screen, and the second of the
// five named window styles (see «Питання» in Ask.tsx, «Меню» in
// Menu.tsx). Every sheet in the app was already built to this shape by
// hand, out of GlassLayer plus SHEET_FRAME/SHEET_WINDOW, in some
// twenty-odd places; this is that shape in one file, so the three
// things it is easy to get wrong cannot be got wrong again.
//
// THE SHAPE IS CENTRED, not pinned to the bottom edge - the user's own
// description of what they wanted: "по факту їх форма це зменшений до
// центру екран". A sheet stuck to the foot reads as part of the screen;
// this reads as a window over it.
//
// THE KEYBOARD is handled by the FRAME's own paddingBottom, never by a
// margin on the window - the window then stays centred in whatever room
// is left instead of hiding its own buttons behind the IME.
//
// THE BACKDROP IS A SIBLING behind the window, never its parent. A
// parent Pressable takes the touch responder for every drag that does
// not land on a deeper child, which on Android is most of a scroll (see
// the sheet-scroll trap: that plus a core ScrollView, which never sees
// a drag starting on a TextInput, is why sheets with a search field
// over a list barely scrolled). `scroll` here uses gesture-handler's
// ScrollView for the same reason. The third part of that old fix - a
// gesture root re-declared inside - is not needed: a layer is not a
// native window, so App.tsx's own root already reaches it.
export default function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  handle = true,
  header,
  scroll,
  maxHeight,
  fadeEdges,
  flipFrom,
  anchor,
  inset,
  priority,
  glass,
  children,
}: {
  // «Скло» (utils/dockGlass): the window wears the dock's glass, live from the first frame (the user: «спочатку біла, а
  // потім стає скляна, а не одразу»).
  glass?: boolean;
  // See GlassLayer's own.
  priority?: number;
  visible: boolean;
  onClose: () => void;
  // Opened from a card: the sheet comes round from its back (utils/flipOpen).
  flipFrom?: FlipFrom | null;
  title?: string;
  subtitle?: string;
  // The little grab bar at the top. On by default: it is what says
  // "this is a sheet and it closes" without a word.
  handle?: boolean;
  // Something that must stay PUT while the body scrolls - a search
  // field, most of the time. It cannot live in `children`, because with
  // `scroll` those go inside the ScrollView and scroll away with the
  // list they are meant to filter.
  header?: ReactNode;
  // A list inside, rather than a few rows - see the trap above.
  scroll?: boolean;
  // A cap for a sheet whose content could otherwise grow past the
  // screen - points, or a percentage of the frame (which fills the
  // layer, so "70%" means 70% of the screen).
  maxHeight?: ViewStyle['maxHeight'];
  // With `scroll`: what scrolls past the top or the bottom dissolves into
  // the sheet instead of being cut off at a hard edge (see EdgeFade) -
  // and only at an edge that really has more beyond it.
  fadeEdges?: boolean;
  // 'bottom': the window stands just above the keyboard (or the foot of the screen) instead of in the middle - a
  // sheet you TYPE in (the quick-create window), where the field belongs under the thumb.
  anchor?: 'bottom';
  // The same breathing room on all four sides (points), instead of the usual 20 / 12 / 24.
  inset?: number;
  children: ReactNode;
}) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const keyboardHeight = useKeyboardHeight();
  // A sheet you type in rides the keyboard FRAME BY FRAME (the keyboard's own animated height), so it rises at the
  // keyboard's pace instead of jumping once it has settled (the user, 2026-10-13: «не вистрілювати як з лука»).
  const keyboard = useKeyboardRide();
  const ride = useAnimatedStyle(() => ({ transform: [{ translateY: Math.min(0, keyboard.height.value) }] }));
  const S = useSoft();
  const insets = useSafeAreaInsets();
  const desk = useDensity() === 'pointer';
  const glassOn = useDockGlass();
  const scrollY = useRef(0);
  const viewportH = useRef(0);
  const contentH = useRef(0);
  const [edges, setEdges] = useState({ top: false, bottom: false });
  function updateEdges() {
    if (!fadeEdges) return;
    const top = scrollY.current > 2;
    const bottom = scrollY.current + viewportH.current < contentH.current - 2;
    setEdges((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
  }
  // With fadeEdges the ScrollView sits inside a wrapper that carries the
  // fades, and a PERCENTAGE maxHeight then resolves against that wrapper -
  // which is as tall as the whole content - so the list stopped at 78% of
  // its own length and left the rest of the wrapper as a blank "chin"
  // (the user's word). Resolved to points against the screen here, it no
  // longer depends on whatever the ScrollView happens to sit in.
  const { height: windowHeight } = useWindowDimensions();
  const scrollMaxHeight =
    fadeEdges && typeof maxHeight === 'string' && maxHeight.endsWith('%')
      ? (parseFloat(maxHeight) / 100) * (windowHeight - keyboardHeight)
      : maxHeight;
  const scrollView = scroll ? (
    <ScrollView
      style={scrollMaxHeight !== undefined ? { maxHeight: scrollMaxHeight } : undefined}
      scrollEventThrottle={16}
      onScroll={(e) => {
        scrollY.current = e.nativeEvent.contentOffset.y;
        viewportH.current = e.nativeEvent.layoutMeasurement.height;
        contentH.current = e.nativeEvent.contentSize.height;
        updateEdges();
      }}
      onLayout={(e) => {
        viewportH.current = e.nativeEvent.layout.height;
        updateEdges();
      }}
      onContentSizeChange={(_w, h) => {
        contentH.current = h;
        updateEdges();
      }}
      // RN's own ScrollView carries flexGrow: 1 in its base style, which
      // makes a short list eat the whole sheet - said out loud here so a
      // sheet is only ever as tall as what is in it.
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : null;
  const body = !scrollView ? (
    children
  ) : fadeEdges ? (
    <View>
      {scrollView}
      {edges.top && <EdgeFade edge="top" color={theme.raised} />}
      {edges.bottom && <EdgeFade edge="bottom" color={theme.raised} />}
    </View>
  ) : (
    scrollView
  );

  // THE SHEET FROM THE BOTTOM (the four windows, 2026-10-25): on the phone every sheet stands on the bottom edge, full width,
  // rises on a spring with the app stepping back behind it, and is dragged down by its top to close. A sheet opened from a
  // card still turns out of it (flipFrom); the Mac keeps its window in the middle.
  const fromBottom = !desk && !flipFrom;
  const anchored = anchor === 'bottom' || fromBottom;
  const glassy = !!glass || (fromBottom && glassOn);
  const sheetGlass = useDockSurface(S, glassy);
  const drag = useSharedValue(0);
  const dragStyle = useAnimatedStyle(() => ({ transform: [{ translateY: drag.value }] }));
  const close = () => onClose();
  const grab = Gesture.Pan()
    .activeOffsetY(6)
    .onUpdate((e) => {
      drag.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > 110 || e.velocityY > 900) runOnJS(close)();
      else drag.value = withSpring(0, { damping: 22, stiffness: 300 });
    });
  useEffect(() => {
    if (visible) drag.value = 0;
  }, [visible, drag]);
  return (
    <GlassLayer visible={visible} onClose={onClose} flipFrom={flipFrom} softDim={anchor === 'bottom'} rise={fromBottom} priority={priority}>
      <View
        style={[
          styles.frame,
          { paddingBottom: keyboardHeight },
          anchor === 'bottom' && { justifyContent: 'flex-end', paddingBottom: 24 },
          fromBottom && { justifyContent: 'flex-end', paddingBottom: 0, paddingHorizontal: 0 },
        ]}
        pointerEvents="box-none"
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View
          style={[
            anchored && ride,
            fromBottom && dragStyle,
            styles.window,
            fromBottom && [styles.bottomWindow, { paddingBottom: insets.bottom + 16 }],
            glassy && sheetGlass,
            fromBottom && glassy && { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
            inset !== undefined && { paddingHorizontal: inset, paddingTop: inset, paddingBottom: fromBottom ? insets.bottom + inset : inset },
            maxHeight !== undefined && !scroll && { maxHeight },
          ]}
        >
          {glassy && <DockGlassFill soft={S} radius={SHEET_WINDOW.borderRadius} />}
          {fromBottom ? (
            <GestureDetector gesture={grab}>
              <View style={styles.grab} collapsable={false}>
                <View style={styles.handle} />
                {!!title && <Text style={styles.title}>{title}</Text>}
              </View>
            </GestureDetector>
          ) : (
            <>
              {handle && <View style={styles.handle} />}
              {!!title && <Text style={styles.title}>{title}</Text>}
            </>
          )}
          {!!subtitle && (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
          {header}
          {body}
        </Animated.View>
      </View>
    </GlassLayer>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  frame: {
    ...SHEET_FRAME,
  },
  window: {
    ...SHEET_WINDOW,
    backgroundColor: t.raised,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
  },
  // The phone's sheet: on the bottom edge, its top corners round, its bottom square.
  bottomWindow: { maxWidth: '100%', borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderWidth: 0 },
  // The top of a bottom sheet, the part a finger drags it down by.
  grab: { paddingTop: 2, marginTop: -8, paddingBottom: 2 },
  handle: {
    ...PHONE_ONLY,
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: t.edge.hairline,
    alignSelf: 'center',
    marginBottom: 12,
  },
  // 17/13 because that is what the sheets being folded into this all
  // used - this slice unifies where a sheet is BUILT, it does not
  // restyle what one looks like.
  title: {
    fontSize: 17,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: t.ink.primary,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: t.ink.faint,
    marginTop: -4,
    marginBottom: 10,
  },
  scrollContent: {
    flexGrow: 0,
  },
});
