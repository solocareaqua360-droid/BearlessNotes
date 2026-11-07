import { BlurTargetView, BlurView } from "expo-blur";
import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

// Android's blur samples ONE named view (BlurTargetView): the screens live
// inside it, and a BlurView must be drawn OUTSIDE it - a blur nested in its
// own target recurses and kills the app. So:
//  - GlassProvider  : shares the target's ref with everything (wrap the app);
//  - GlassTarget    : wraps the stack of screens;
//  - GlassPortal    : moves an overlay (the tag panel) out to GlassPortalHost,
//                     which sits beside the target, not inside it;
//  - GlassBlur      : draws nothing on Android while it is still inside the
//                     target (callers lay a plain dim under/over it anyway).
const TargetRefContext = createContext<RefObject<View | null> | null>(null);
const InsideTargetContext = createContext(false);

export function GlassProvider({ children }: { children: ReactNode }) {
  const ref = useRef<View | null>(null);
  return <TargetRefContext.Provider value={ref}>{children}</TargetRefContext.Provider>;
}

export function GlassTarget({ children }: { children: ReactNode }) {
  const ref = useContext(TargetRefContext);
  return (
    <InsideTargetContext.Provider value={true}>
      <BlurTargetView ref={ref ?? undefined} style={{ flex: 1 }}>
        {children}
      </BlurTargetView>
    </InsideTargetContext.Provider>
  );
}

export function GlassBlur({
  intensity = 50,
  tint = "dark",
  style,
}: {
  intensity?: number;
  tint?: "light" | "dark";
  style?: StyleProp<ViewStyle>;
}) {
  const target = useContext(TargetRefContext);
  const inside = useContext(InsideTargetContext);
  if (Platform.OS === "android" && (inside || !target)) return null;
  return (
    <BlurView
      intensity={intensity}
      tint={tint}
      blurMethod={Platform.OS === "android" ? "dimezisBlurView" : undefined}
      blurTarget={Platform.OS === "android" ? target ?? undefined : undefined}
      style={[StyleSheet.absoluteFill, style]}
    />
  );
}

// --- portal -----------------------------------------------------------
type Entry = { id: string; node: ReactNode };
let entries: Entry[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function GlassPortal({ children }: { children: ReactNode }) {
  const id = useId();
  useLayoutEffect(() => {
    entries = entries.some((e) => e.id === id)
      ? entries.map((e) => (e.id === id ? { id, node: children } : e))
      : [...entries, { id, node: children }];
    emit();
  });
  useEffect(
    () => () => {
      entries = entries.filter((e) => e.id !== id);
      emit();
    },
    [id]
  );
  return null;
}

export function GlassPortalHost() {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {entries.map((e) => (
        <View key={e.id} style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {e.node}
        </View>
      ))}
    </View>
  );
}
