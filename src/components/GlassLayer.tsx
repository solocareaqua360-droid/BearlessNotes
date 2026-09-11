import { ReactNode, useEffect } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useBlurTarget } from './GlassTarget';
import { GLASS_BACKDROP } from '../constants/glass';

// What a bottom sheet sits in, now that a sheet is a layer rather than a
// window. The reason is the blur: on Android it blurs what is inside ITS
// OWN window, and a Modal is a window of its own - so a sheet in one had
// nothing behind it to blur and the screen showed through sharp. Inside
// the screen, the screen is what it blurs.
//
// Two things a Modal used to provide have to be provided here: the
// hardware back button, and the gesture root - App.tsx's own reaches this
// now that it isn't a separate window.
export default function GlassLayer({
  visible,
  onClose,
  children,
  intensity = 50,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  intensity?: number;
}) {
  // Without this ref expo-blur falls back to a plain translucent view on
  // Android - which is what made the first two attempts look like a dim.
  const blurTarget = useBlurTarget();

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  if (!visible) return null;

  return (
    <View style={styles.layer}>
      {/* The blur covers the whole screen, not just the sheet: what is
          beside a sheet is as much "behind the glass" as what is under it,
          and blurring only the sheet's own rectangle looks like a cut-out. */}
      <BlurView
        intensity={intensity}
        tint="dark"
        blurMethod="dimezisBlurView"
        blurTarget={blurTarget ?? undefined}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {/* The dim, and the tap that closes. A SIBLING behind the sheet, not
          its parent: as a parent it took the touch responder for every drag
          that didn't land on a deeper child, which is what used to keep
          these lists from scrolling. */}
      <Pressable style={[StyleSheet.absoluteFill, styles.dim]} onPress={onClose} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    zIndex: 50,
  },
  dim: {
    backgroundColor: GLASS_BACKDROP,
  },
});
