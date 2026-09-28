import { ReactNode, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle, useWindowDimensions } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import GlassLayer from '../GlassLayer';
import { useStyles, useTheme } from '../../theme/ThemeProvider';
import EdgeFade from '../EdgeFade';
import type { Theme } from '../../theme/tokens';
import { useKeyboardHeight } from '../../hooks/useKeyboardHeight';
import { SHEET_FRAME, SHEET_WINDOW } from '../../constants/glass';
import { FONT_BOLD, FONT_REGULAR } from '../../utils/fonts';

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
  children,
}: {
  visible: boolean;
  onClose: () => void;
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
  children: ReactNode;
}) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const keyboardHeight = useKeyboardHeight();
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

  return (
    <GlassLayer visible={visible} onClose={onClose}>
      <View style={[styles.frame, { paddingBottom: keyboardHeight }]} pointerEvents="box-none">
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.window, maxHeight !== undefined && !scroll && { maxHeight }]}>
          {handle && <View style={styles.handle} />}
          {!!title && <Text style={styles.title}>{title}</Text>}
          {!!subtitle && (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
          {header}
          {body}
        </View>
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
  handle: {
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
