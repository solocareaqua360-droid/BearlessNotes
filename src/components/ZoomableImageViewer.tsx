import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

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
  onClose: () => void;
  // Optional bottom action row (rename/go-to-document/share/download/delete)
  // - shared between the in-document viewer (DocumentEditorScreen, no
  // "document" action since you're already there) and the Photos database
  // screen's viewer (all of them, including a document picker for a photo
  // used in more than one document).
  actions?: ViewerAction[];
};

// Full-screen viewer opened by tapping an image (a block in a document, or a
// grid cell in the Photos database) - pinch to zoom in, drag around once
// zoomed, pinching back below 1x snaps back to the original fit. Hand-built
// on the same gesture-handler/reanimated stack used elsewhere in the app
// rather than adding a dedicated image-viewer dependency for this one
// feature.
export default function ZoomableImageViewer({ uri, onClose, actions }: Props) {
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

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (savedScale.value <= 1) return;
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const gesture = Gesture.Simultaneous(pinchGesture, panGesture);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
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
          <Image source={{ uri }} style={styles.image} resizeMode="contain" />
        </Animated.View>
      </GestureDetector>
      {!!actions?.length && (
        <View style={styles.actionBar}>
          {actions.map((action) => (
            <Pressable key={action.key} style={styles.actionButton} onPress={action.onPress}>
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

const styles = StyleSheet.create({
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
    color: '#fff',
  },
});
