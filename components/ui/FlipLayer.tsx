import { useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { BackHandler } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { GlassBlur, GlassPortal } from "@/components/ui/Glass";
import { FLIP_MS, flipProgress, type FlipFrom } from "@/utils/flipOpen";

// A window that opens FROM a card: blurred, dimmed backdrop on the flip
// clock, content that comes round from the card's place. Without a measured
// card (web, or no rect) it simply grows in.
export function FlipLayer({
  visible,
  onClose,
  flipFrom,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  flipFrom: FlipFrom | null;
  children: ReactNode;
}) {
  // `leaving` must begin in the SAME render as visible=false, or the window
  // remounts instead of playing out.
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);
  const leaving = mounted && !visible;

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setMounted(false), FLIP_MS + 40);
    return () => clearTimeout(t);
  }, [leaving]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  const grow = useSharedValue(0);
  const p = flipFrom ? flipProgress : grow;

  useEffect(() => {
    if (!mounted) return;
    p.value = withTiming(leaving || !visible ? 0 : 1, {
      duration: flipFrom ? FLIP_MS : 220,
      easing: flipFrom ? Easing.inOut(Easing.cubic) : Easing.bezier(0.22, 1, 0.36, 1),
    });
  }, [mounted, leaving, visible, flipFrom, p]);

  const { width: ww, height: wh } = useWindowDimensions();
  const rect = flipFrom?.rect;

  const backdrop = useAnimatedStyle(() => ({ opacity: p.value }));
  const content = useAnimatedStyle(() => {
    if (!rect) {
      return { opacity: p.value, transform: [{ scale: 0.96 + 0.04 * p.value }] };
    }
    const q = Math.max(0, (p.value - 0.5) * 2);
    const s0 = ww > 0 ? rect.width / ww : 1;
    return {
      opacity: p.value < 0.5 ? 0 : 1,
      transform: [
        { perspective: 1100 },
        { translateX: (rect.x + rect.width / 2 - ww / 2) * (1 - q) },
        { translateY: (rect.y + rect.height / 2 - wh / 2) * (1 - q) },
        { rotateY: `${-90 * (1 - q)}deg` },
        { scale: s0 + (1 - s0) * q },
      ],
    };
  });

  if (!mounted) return null;
  return (
    <GlassPortal>
      <View style={styles.layer} pointerEvents="box-none">
        <Animated.View style={[StyleSheet.absoluteFill, backdrop]}>
          <GlassBlur intensity={50} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(17,24,39,0.45)" }]} />
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>
        <Animated.View style={[styles.content, content]} pointerEvents={leaving ? "none" : "box-none"}>
          {children}
        </Animated.View>
      </View>
    </GlassPortal>
  );
}

const styles = StyleSheet.create({
  layer: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 50 },
  content: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, justifyContent: "center", alignItems: "center", paddingHorizontal: 16 },
});
