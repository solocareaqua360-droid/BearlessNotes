import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AttachmentImage from './AttachmentImage';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Path, Text as SvgText } from 'react-native-svg';
import { FONT_BOLD, FONT_REGULAR } from '../utils/fonts';
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
};

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
}: Props) {
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

  const gesture = Gesture.Simultaneous(pinchGesture, panGesture);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value + swipeX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <View style={styles.backdrop}>
      <Pressable style={styles.closeButton} hitSlop={12} onPress={onClose}>
        <Ionicons name="close" size={28} color="#fff" />
      </Pressable>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.imageWrap, animatedStyle]}>
          {/* The one picture that must NOT be decoded down to its frame:
              this is the viewer, and it is meant to be zoomed into. */}
          <AttachmentImage
            uri={uri}
            driveFileId={driveFileId}
            style={styles.image}
            resizeMode="contain"
            resizeMethod="scale"
            countsAsUse
          />
          {!!sketchElements?.length && (
            <Svg
              style={StyleSheet.absoluteFill}
              viewBox={`0 0 ${sketchWidth || 1} ${sketchHeight || 1}`}
              pointerEvents="none"
            >
              {sketchElements.map((el, i) =>
                el.kind === 'text' ? (
                  <SvgText key={i} x={el.x} y={el.y} fill={el.color} fontSize={el.fontSize}>
                    {el.text}
                  </SvgText>
                ) : (
                  <Path
                    key={i}
                    d={el.d}
                    stroke={el.color}
                    strokeWidth={el.width}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )
              )}
            </Svg>
          )}
        </Animated.View>
      </GestureDetector>
      {/* The arrows, for a finger that would rather tap - and the one
          sign on screen that there is anything either side. */}
      {!!onPrev && (
        <Pressable style={[styles.pageButton, styles.pagePrev]} hitSlop={10} onPress={onPrev}>
          <Ionicons name="chevron-back" size={26} color="#fff" />
        </Pressable>
      )}
      {!!onNext && (
        <Pressable style={[styles.pageButton, styles.pageNext]} hitSlop={10} onPress={onNext}>
          <Ionicons name="chevron-forward" size={26} color="#fff" />
        </Pressable>
      )}

      {!!actions?.length && (
        <View style={styles.actionBar}>
          {actions.map((action) => (
            <Pressable
              key={action.key}
              style={styles.actionButton}
              // The viewer closes ITSELF before the action runs, and that
              // is the whole rule, kept here rather than in every caller.
              //
              // This is a Modal - its own native window on Android - and
              // almost everything an action opens is not: the app's
              // question windows, RenamePrompt, the tag picker, the "saved
              // to..." toast are all layers drawn inside the screen. Opened
              // from here they land UNDERNEATH and surface only when the
              // picture is dismissed, which reads as a window arriving on
              // the wrong tap.
              //
              // Two screens build their own action lists for this viewer,
              // so the rule was remembered in one and forgotten in the
              // other - which is exactly why it cannot live in the lists.
              onPress={() => {
                onClose();
                action.onPress();
              }}
            >
              <View>
                <Ionicons name={action.icon} size={20} color={action.color ?? '#fff'} />
                {!!action.badge && action.badge > 1 && (
                  <View style={styles.actionBadge}>
                    <Text style={styles.actionBadgeLabel}>{action.badge}</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.actionLabel, action.color && { color: action.color }]}>{action.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

// Far enough that a pinch that drifted sideways is not a page turn.
const SWIPE_DISTANCE = 70;

const styles = StyleSheet.create({
  pageButton: {
    position: 'absolute',
    top: '46%',
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    zIndex: 5,
  },
  pagePrev: {
    left: 12,
  },
  pageNext: {
    right: 12,
  },
  backdrop: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: 48,
    right: 20,
    zIndex: 1,
    padding: 8,
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
  actionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(20,20,20,0.92)',
    paddingTop: 14,
    paddingBottom: 30,
    paddingHorizontal: 24,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  actionButton: {
    alignItems: 'center',
    gap: 6,
  },
  actionLabel: {
    fontSize: 11,
    fontFamily: FONT_REGULAR,
    color: '#D4D4D8',
  },
  actionBadge: {
    position: 'absolute',
    top: -4,
    right: -10,
    minWidth: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: '#3B82F6',
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
