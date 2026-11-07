import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Animated, Dimensions, Easing, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { captureRef } from "react-native-view-shot";

import { Ionicons } from "@/components/icons/Ionicons";
import { GlassBlur } from "@/components/ui/Glass";
import { RADIUS, TYPE, useSoft } from "@/theme/soft";

// HOLD MENU - long-press lifts a photograph of the card over a blurred,
// dimmed screen and opens a panel of rows beside it.
export type HoldItem = { key: string; label: string; icon: string; destructive?: boolean };
type Req = { items: HoldItem[]; uri: string | null; rect: { x: number; y: number; width: number; height: number }; resolve: (k: string | null) => void };

let show: ((r: Req) => void) | null = null;

export async function holdMenu(ref: RefObject<View | null>, items: HoldItem[]): Promise<string | null> {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  const node = ref.current;
  if (!node || !show) return null;
  const rect = await new Promise<{ x: number; y: number; width: number; height: number }>((res) =>
    node.measureInWindow((x, y, width, height) => res({ x, y, width, height }))
  );
  let uri: string | null = null;
  try {
    uri = await captureRef(node, { format: "png", quality: 1 });
  } catch {
    uri = null;
  }
  return new Promise((resolve) => show?.({ items, uri, rect, resolve }));
}

const EASE = Easing.bezier(0.22, 1, 0.36, 1);
const PANEL_W = 272;
const ROW_H = 48;

export function HoldMenuHost() {
  const S = useSoft();
  const insets = useSafeAreaInsets();
  const [req, setReq] = useState<Req | null>(null);
  const current = useRef<Req | null>(null);
  const p = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    show = (r) => {
      current.current = r;
      setReq(r);
      p.setValue(0);
      Animated.timing(p, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    };
    return () => {
      show = null;
    };
  }, [p]);

  const close = (key: string | null) => {
    const r = current.current;
    if (!r) return;
    current.current = null;
    Animated.timing(p, { toValue: 0, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => setReq(null));
    r.resolve(key);
  };

  if (!req) return null;
  const { height: H, width: W } = Dimensions.get("window");
  const panelH = req.items.length * ROW_H + 8;
  const { rect } = req;
  // Where the card rests: kept clear of the status bar and the screen bottom
  // with room for the panel under it (or above it when there is none below).
  const minTop = insets.top + 12;
  let cardTop = Math.max(rect.y, minTop);
  const roomBelow = H - insets.bottom - 16 - (cardTop + rect.height);
  const panelBelow = roomBelow >= panelH + 12;
  if (!panelBelow) cardTop = Math.max(minTop + panelH + 12, Math.min(cardTop, H - insets.bottom - 16 - rect.height));
  const panelTop = panelBelow ? cardTop + rect.height + 12 : cardTop - panelH - 12;
  const panelLeft = Math.min(Math.max(16, rect.x + rect.width / 2 - PANEL_W / 2), W - PANEL_W - 16);
  const lift = p.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] });
  const dy = p.interpolate({ inputRange: [0, 1], outputRange: [rect.y - cardTop, 0] });
  const panelScale = p.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 900 }]}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: p }]}>
        <GlassBlur intensity={40} tint={S.dark ? "dark" : "light"} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: S.dark ? "rgba(0,0,0,0.35)" : "rgba(30,30,28,0.08)" }]} />
        <Pressable style={StyleSheet.absoluteFill} onPress={() => close(null)} />
      </Animated.View>
      {req.uri ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: rect.x,
            top: cardTop,
            width: rect.width,
            height: rect.height,
            borderRadius: 20,
            boxShadow: S.popShadow,
            transform: [{ translateY: dy }, { scale: lift }],
          }}
        >
          <Image source={{ uri: req.uri }} style={{ width: rect.width, height: rect.height }} />
        </Animated.View>
      ) : null}
      <Animated.View
        style={{
          position: "absolute",
          left: panelLeft,
          top: panelTop,
          width: PANEL_W,
          borderRadius: RADIUS.panel,
          padding: 4,
          backgroundColor: S.chrome,
          boxShadow: S.popShadow,
          opacity: p,
          transformOrigin: panelBelow ? "50% 0%" : "50% 100%",
          transform: [{ scale: panelScale }],
        }}
      >
        {req.items.map((it) => (
          <Pressable
            key={it.key}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              close(it.key);
            }}
            style={({ pressed }) => [styles.row, { backgroundColor: pressed ? S.fill : "transparent" }]}
          >
            <Text style={[TYPE.row, { flex: 1, color: it.destructive ? S.danger : S.ink }]}>{it.label}</Text>
            <Ionicons name={it.icon as any} size={19} color={it.destructive ? S.danger : S.ink2} />
          </Pressable>
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { height: ROW_H, borderRadius: 20, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 12 },
});
