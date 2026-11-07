import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { INK } from '../utils/sketchGeometry';
import SketchLayer from './SketchLayer';
import { Ionicons } from './icons/Ionicons';
import AttachmentImage from './AttachmentImage';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Path, Text as SvgText } from 'react-native-svg';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import { FONT_BOLD, SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';
import { useSoft } from '../theme/soft';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SketchElement } from '../types';

export type ViewerAction = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color?: string;
  // Small count badge on the icon - used by the "document" action when a
  // photo is used in more than one document, mirroring the same badge on
  // the Links/Photos database rows.
  badge?: number;
  onPress: () => void;
};

type Props = {
  uri: string;
  // The Drive copy, for a browser: the uri is a path on the phone and the
  // page cannot open it, so without this the viewer opened onto nothing.
  // See AttachmentImage.
  driveFileId?: string;
  onClose: () => void;
  // Optional bottom action row (rename/go-to-document/share/download/delete)
  // - shared between the in-document viewer (DocumentEditorScreen, no
  // "document" action since you're already there) and the Photos database
  // screen's viewer (all of them, including a document picker for a photo
  // used in more than one document).
  actions?: ViewerAction[];
  // The pictures either side of this one, when the viewer was opened from
  // a list that HAS a side - swipe across, or tap an arrow, instead of
  // closing and opening the next one by hand. Absent (a picture opened
  // from inside a note) the viewer is one picture, as it was.
  onPrev?: () => void;
  onNext?: () => void;
  // A drawing over this picture (see SketchEditor) - the viewBox is the
  // canvas size it was captured against, same as the inline block preview,
  // so a stroke lands where it was put. Default preserveAspectRatio (not
  // "none") deliberately matches the image's own resizeMode="contain"
  // letterboxing, since sketchWidth/sketchHeight always share the image's
  // aspect ratio.
  sketchElements?: SketchElement[];
  sketchWidth?: number;
  sketchHeight?: number;
  // The top capsule (sketch VVSA5sAqHLfsbJmmDM8btC, 2026-10-24): where the picture lives («Тест», a note's name), its own
  // name, and which of how many it is when there is a side to page to.
  place?: string;
  title?: string;
  position?: { index: number; count: number };
  // THE STRIP OF THE NEIGHBOURS, as galleries have it (2026-10-31, the user's): small pictures along the foot, the one on
  // show lit; a tap goes to that one. Given only where the viewer has a side to page to.
  thumbs?: { key: string; uri: string; driveFileId?: string; active: boolean; onPress: () => void }[];
};

// THE FOUR IN THE DOCK (the user's «ок підходить» to the sketch): share, draw, read the text, folders - whichever of them the
// screen offers, in this order. Everything else goes under «⋯», «Видалити» last, after a line.
const PRIMARY = ['share', 'draw', 'ocr', 'folders', 'tags'];
const ICON: Record<string, keyof typeof Ionicons.glyphMap> = { folders: 'folder-outline', tags: 'folder-outline' };
const LABEL: Record<string, string> = { document: 'У документах', tags: 'Папки', ocr: 'Текст' };

// Full-screen viewer opened by tapping an image (a block in a document, or a
// grid cell in the Photos database) - pinch to zoom in, drag around once
// zoomed, pinching back below 1x snaps back to the original fit. Hand-built
// on the same gesture-handler/reanimated stack used elsewhere in the app
// rather than adding a dedicated image-viewer dependency for this one
// feature.
export default function ZoomableImageViewer({
  uri,
  driveFileId,
  onClose,
  actions,
  onPrev,
  onNext,
  sketchElements,
  sketchWidth,
  sketchHeight,
  place,
  title,
  position,
  thumbs,
}: Props) {
  // PAGING WITHOUT BLACK (the user, 2026-10-10: «між перегортаннями блимає
  // проміжний кадр»): the new picture is decoded at full size and for a moment
  // draws nothing, so the dark backdrop showed through. The picture that was
  // on screen stays UNDER the new one until the new one has loaded.
  const [under, setUnder] = useState({ uri, driveFileId });
  useEffect(() => {
    // A different viewer opened on another picture altogether is not paging.
    if (under.uri === uri) return;
    const slow = setTimeout(() => setUnder({ uri, driveFileId }), 1500);
    return () => clearTimeout(slow);
  }, [uri]);
  const settled = under.uri === uri;
  // The soft chrome of the rest of the app (the sketch's frames 1 and 4): black under the picture in the dark theme, the
  // app's own paper in the light one, the capsules in the card tone.
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const S = useSoft();
  const insets = useSafeAreaInsets();
  const ground = S.dark ? '#000000' : S.bg;
  const surface = { backgroundColor: S.card, boxShadow: S.dark ? undefined : '0px 6px 22px rgba(30,30,28,0.12)' } as never;
  // A tap on the picture puts all of it away - only the picture and the dots (frame 3); a second tap brings it back.
  const [chromeOn, setChromeOn] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const chromeFade = useSharedValue(1);
  useEffect(() => {
    chromeFade.value = withTiming(chromeOn ? 1 : 0, { duration: 180 });
  }, [chromeOn, chromeFade]);
  const chromeStyle = useAnimatedStyle(() => ({ opacity: chromeFade.value }));
  const toggleChrome = () => {
    setMenuOpen(false);
    setChromeOn((v) => !v);
  };
  const list = actions ?? [];
  const primary = PRIMARY.map((k) => list.find((a) => a.key === k)).filter((a): a is ViewerAction => !!a).slice(0, 4);
  const rest = list.filter((a) => !primary.includes(a) && a.key !== 'delete');
  const remove = list.find((a) => a.key === 'delete');
  // The viewer closes ITSELF before the action runs, and that is the whole rule, kept here rather than in every caller.
  //
  // This is a Modal - its own native window on Android - and almost everything an action opens is not: the app's question
  // windows, RenamePrompt, the tag picker, the "saved to..." toast are all layers drawn inside the screen. Opened from here
  // they land UNDERNEATH and surface only when the picture is dismissed, which reads as a window arriving on the wrong tap.
  const run = (action: ViewerAction) => {
    setMenuOpen(false);
    onClose();
    action.onPress();
  };
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.max(1, savedScale.value * e.scale);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1) {
        scale.value = withTiming(1);
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
        savedScale.value = 1;
      }
    });

  // How far the unzoomed picture has been dragged sideways, so the swipe
  // is something the hand can see happening rather than a thing that
  // either fires or does not.
  const swipeX = useSharedValue(0);

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      // Zoomed in, a drag moves the picture around, as it always has.
      if (savedScale.value > 1) {
        translateX.value = savedTranslateX.value + e.translationX;
        translateY.value = savedTranslateY.value + e.translationY;
        return;
      }
      // At rest it is a page turn - and only towards a picture that is
      // there, so the end of the list has an edge you can feel.
      const wanted = e.translationX;
      const allowed = (wanted < 0 && !onNext) || (wanted > 0 && !onPrev) ? wanted * 0.15 : wanted;
      swipeX.value = allowed;
    })
    .onEnd((e) => {
      if (savedScale.value > 1) {
        savedTranslateX.value = translateX.value;
        savedTranslateY.value = translateY.value;
        return;
      }
      const far = Math.abs(e.translationX) > SWIPE_DISTANCE;
      const fast = Math.abs(e.velocityX) > 600;
      if (far || fast) {
        if (e.translationX < 0 && onNext) runOnJS(onNext)();
        else if (e.translationX > 0 && onPrev) runOnJS(onPrev)();
      }
      swipeX.value = withTiming(0, { duration: 160 });
    });

  const tapGesture = Gesture.Tap()
    .maxDuration(250)
    .onEnd((_e, ok) => {
      if (ok) runOnJS(toggleChrome)();
    });

  const gesture = Gesture.Simultaneous(pinchGesture, panGesture, tapGesture);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value + swipeX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const ink = S.ink;
  const showDots = !!position && position.count > 1 && !chromeOn;
  const dots = showDots ? dotWindow(position!.index, position!.count) : [];
  return (
    <View style={[styles.backdrop, { backgroundColor: ground }]}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.imageWrap, animatedStyle]}>
          {/* The one picture that must NOT be decoded down to its frame:
              this is the viewer, and it is meant to be zoomed into. */}
          {!settled && (
            <AttachmentImage
              uri={under.uri}
              driveFileId={under.driveFileId}
              style={[styles.image, StyleSheet.absoluteFill]}
              resizeMode="contain"
              resizeMethod="scale"
            />
          )}
          <AttachmentImage
            uri={uri}
            driveFileId={driveFileId}
            style={styles.image}
            resizeMode="contain"
            resizeMethod="scale"
            countsAsUse
            onLoad={() => setUnder({ uri, driveFileId })}
            onError={() => setUnder({ uri, driveFileId })}
          />
          {settled && !!sketchElements?.length && (
            <Svg
              style={StyleSheet.absoluteFill}
              viewBox={`0 0 ${sketchWidth || 1} ${sketchHeight || 1}`}
              pointerEvents="none"
            >
              <SketchLayer elements={sketchElements} ink={INK} />
            </Svg>
          )}
        </Animated.View>
      </GestureDetector>

      {/* Which of how many, while everything else is away. */}
      {showDots && (
        <View pointerEvents="none" style={[styles.dots, { bottom: insets.bottom + 24 }]}>
          {dots.map((d) => (
            <View key={d.i} style={[styles.dot, { width: d.current ? 18 : 6, backgroundColor: S.dark ? (d.current ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.3)') : d.current ? 'rgba(30,30,28,0.75)' : 'rgba(30,30,28,0.22)' }]} />
          ))}
        </View>
      )}

      {/* Clear of the status bar and the gesture bar by the app's own insets - a fixed number. (A native SafeAreaView here,
          inside the Modal's window, kept re-measuring and the top capsule jumped without end, 2026-10-24.) */}
      <Animated.View pointerEvents={chromeOn ? 'box-none' : 'none'} style={[StyleSheet.absoluteFill, chromeStyle]}>
        {/* THE TOP CAPSULE: the way the note's own top bar reads - where, what, and «⋯». */}
        <View style={[styles.pill, surface, { top: insets.top + 8 }]}>
          <Ionicons name="image-outline" size={17} color={S.ink2} />
          {!!place && (
            <>
              <Text numberOfLines={1} style={[styles.place, { color: S.ink2 }]}>
                {place}
              </Text>
              <Text style={[styles.place, { color: S.ink3 }]}>›</Text>
            </>
          )}
          <Text numberOfLines={1} style={[styles.title, { color: ink }]}>
            {title || 'Зображення'}
          </Text>
          {!!position && position.count > 1 && <Text style={[styles.count, { color: S.ink2 }]}>{`${position.index + 1} з ${position.count}`}</Text>}
          {rest.length + (remove ? 1 : 0) > 0 && (
            <Pressable
              onPress={() => setMenuOpen((v) => !v)}
              accessibilityLabel="Ще дії"
              hitSlop={6}
              style={[styles.more, menuOpen && { backgroundColor: S.dark ? '#3A3A3D' : S.fillSolid }]}
            >
              <Ionicons name="ellipsis-horizontal" size={20} color={ink} />
            </Pressable>
          )}
        </View>

        {/* «⋯»: the explorer's own drop-down - the rest of the actions, «Видалити» last after a line. Drawn here, inside the
            viewer's window: the app's own menus draw under a Modal. */}
        {menuOpen && (
          <>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuOpen(false)} accessible={false} />
            <View style={[styles.menu, { top: insets.top + 64,  backgroundColor: S.dark ? '#2C2C2F' : S.card, boxShadow: S.dark ? '0px 12px 36px rgba(0,0,0,0.55)' : '0px 12px 36px rgba(30,30,28,0.16)' } as never]}>
              {rest.map((a) => (
                <Pressable key={a.key} onPress={() => run(a)} style={({ pressed }) => [styles.menuRow, pressed && { backgroundColor: S.dark ? '#3A3A3D' : S.fillSolid }]}>
                  <Ionicons name={ICON[a.key] ?? a.icon} size={19} color={a.color ?? ink} />
                  <Text style={[styles.menuText, { color: a.color ?? ink }]}>{LABEL[a.key] ?? a.label}</Text>
                  {!!a.badge && a.badge > 0 && <Text style={[styles.menuBadge, { color: S.ink2 }]}>{a.badge}</Text>}
                </Pressable>
              ))}
              {!!remove && (
                <>
                  {rest.length > 0 && <View style={[styles.menuLine, { backgroundColor: S.line }]} />}
                  <Pressable onPress={() => run(remove)} style={({ pressed }) => [styles.menuRow, pressed && { backgroundColor: S.dark ? '#3A3A3D' : S.fillSolid }]}>
                    <Ionicons name={remove.icon} size={19} color="#F87171" />
                    <Text style={[styles.menuText, { color: '#F87171' }]}>{remove.label}</Text>
                  </Pressable>
                </>
              )}
            </View>
          </>
        )}

        {/* THE STRIP: the pictures of the same page or list, the current one framed, kept in view as the viewer pages. */}
        {!!thumbs && thumbs.length > 1 && (
          <View style={[styles.stripRow, { bottom: insets.bottom + 12 + 64 + 10 }]} pointerEvents="box-none">
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.strip}
              ref={(node) => {
                const at = thumbs.findIndex((t) => t.active);
                if (node && at >= 0) setTimeout(() => node.scrollTo({ x: Math.max(0, at * 54 - 120), animated: true }), 30);
              }}
            >
              {thumbs.map((t) => (
                <Pressable key={t.key} onPress={t.onPress} accessibilityLabel="Показати це зображення" style={[styles.thumb, t.active && { borderColor: ink, opacity: 1 }, !t.active && { opacity: 0.6 }]}>
                  <AttachmentImage uri={t.uri} driveFileId={t.driveFileId} style={StyleSheet.absoluteFill} />
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        {/* THE DOCK: the four, and the way back on the right - where it is everywhere else. */}
        <View style={[styles.dockRow, { bottom: insets.bottom + 12 }]} pointerEvents="box-none">
          {primary.length > 0 ? (
            <View style={[styles.dock, surface]}>
              {primary.map((a) => (
                <Pressable key={a.key} onPress={() => run(a)} style={styles.dockButton} accessibilityLabel={LABEL[a.key] ?? a.label}>
                  <View>
                    <Ionicons name={ICON[a.key] ?? a.icon} size={21} color={a.color ?? ink} />
                    {!!a.badge && a.badge > 1 && (
                      <View style={[styles.actionBadge, { backgroundColor: theme.accent }]}>
                        <Text style={[styles.actionBadgeLabel, { color: theme.onAccent }]}>{a.badge}</Text>
                      </View>
                    )}
                  </View>
                  <Text numberOfLines={1} style={[styles.dockLabel, { color: a.color ?? ink }]}>
                    {LABEL[a.key] ?? a.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <View style={{ flex: 1 }} />
          )}
          <Pressable onPress={onClose} accessibilityLabel="Назад" style={[styles.back, surface]}>
            <Ionicons name="chevron-back" size={24} color={ink} />
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

// Seven dots at most, the current one among them: a long row of pictures shows the stretch around where you are.
function dotWindow(index: number, count: number): { i: number; current: boolean }[] {
  const size = Math.min(7, count);
  const start = Math.max(0, Math.min(count - size, index - Math.floor(size / 2)));
  return Array.from({ length: size }, (_, k) => ({ i: start + k, current: start + k === index }));
}

// Far enough that a pinch that drifted sideways is not a page turn.
const SWIPE_DISTANCE = 70;

const makeStyles = (t: Theme) => StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageWrap: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  pill: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 14,
    height: 48,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 16,
    paddingRight: 4,
  },
  place: { fontSize: 14, fontFamily: SOFT_REGULAR, maxWidth: 110 },
  title: { flex: 1, minWidth: 0, fontSize: 14.5, fontFamily: SOFT_SEMIBOLD },
  count: { fontSize: 12.5, fontFamily: SOFT_MEDIUM },
  more: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  menu: { position: 'absolute', right: 12, top: 70, width: 256, borderRadius: 20, padding: 6 },
  menuRow: { height: 46, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12 },
  menuText: { flex: 1, fontSize: 15, fontFamily: SOFT_REGULAR },
  menuBadge: { fontSize: 12.5, fontFamily: SOFT_MEDIUM },
  menuLine: { height: StyleSheet.hairlineWidth, marginVertical: 4, marginHorizontal: 10 },
  stripRow: { position: 'absolute', left: 0, right: 0, height: 52 },
  strip: { gap: 6, paddingHorizontal: 16, alignItems: 'center' },
  thumb: { width: 48, height: 48, borderRadius: 9, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  dockRow: { position: 'absolute', left: 12, right: 12, bottom: 18, flexDirection: 'row', alignItems: 'center', gap: 10 },
  dock: { flex: 1, height: 64, borderRadius: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingHorizontal: 6 },
  dockButton: { minWidth: 64, height: 56, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 4 },
  dockLabel: { fontSize: 11, fontFamily: SOFT_MEDIUM },
  back: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  dots: { position: 'absolute', bottom: 30, alignSelf: 'center', flexDirection: 'row', gap: 6 },
  dot: { height: 6, borderRadius: 3 },
  actionBadge: {
    position: 'absolute',
    top: -4,
    right: -10,
    minWidth: 15,
    height: 15,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  actionBadgeLabel: {
    fontSize: 9,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: '#fff',
  },
});
