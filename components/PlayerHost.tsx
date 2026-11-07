import { useEffect } from "react";
import { BackHandler, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Ionicons } from "@/components/icons/Ionicons";
import InlineVideoPlayer from "@/components/InlineVideoPlayer";
import { TOP_NAV_H, topBarTop } from "@/components/ui/TopBar";
import { usePlayerStore } from "@/store/usePlayerStore";
import { enterPip, onPipChanged, setAutoPip, supportsPip } from "@/utils/cinemaNative";
import { getVideoEmbedInfo } from "@/utils/videoEmbed";

const MINI_VIDEO_W = 72;
const MINI_VIDEO_H = 40;
// For now the capsule sits just UNDER the screen's own top bar, so the bar's
// back button stays reachable while the video plays; where it finally lives
// (the top strip, like the thought player) is decided with the screens.
const capsuleTop = (insetTop: number) => topBarTop(insetTop) + TOP_NAV_H + 8;

// THE PLAYER, mounted once above every screen (see app/_layout.tsx). The
// WebView is ONE instance whose box changes with the state, so the video
// never restarts when the player is minimised to the capsule, expanded,
// or shrunk into the system's picture-in-picture window.
export function PlayerHost() {
  const { url, title, mode, pip, minimize, expand, close, setPip } = usePlayerStore();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const info = url ? getVideoEmbedInfo(url) : null;
  const wide = info?.provider !== "tiktok";
  const ratioW = wide ? 16 : 9;
  const ratioH = wide ? 9 : 16;

  // The system window opening / closing.
  useEffect(() => onPipChanged(setPip), [setPip]);

  // While something plays, going Home turns it into the small window.
  const playing = !!info;
  useEffect(() => {
    if (!supportsPip) return;
    setAutoPip(playing, ratioW, ratioH);
    return () => {
      setAutoPip(false, 16, 9);
    };
  }, [playing, ratioW, ratioH]);

  // Back minimises the big player instead of leaving the screen under it.
  useEffect(() => {
    if (!info || mode !== "full" || pip) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      minimize();
      return true;
    });
    return () => sub.remove();
  }, [info, mode, pip, minimize]);

  if (!url || !info) return null;

  const capsuleW = Math.min(width - 40, 560);

  // The video's box in each state.
  let frame: object;
  if (pip) {
    frame = { left: 0, top: 0, width, height };
  } else if (mode === "full") {
    const boxW = Math.min(width, (height - insets.top - 160) * (ratioW / ratioH));
    const boxH = boxW / (ratioW / ratioH);
    frame = { left: (width - boxW) / 2, top: insets.top + 64, width: boxW, height: boxH };
  } else {
    frame = {
      left: (width - capsuleW) / 2 + 8,
      top: capsuleTop(insets.top) + (TOP_NAV_H - MINI_VIDEO_H) / 2,
      width: MINI_VIDEO_W,
      height: MINI_VIDEO_H,
      borderRadius: 10,
      overflow: "hidden",
    };
  }

  const full = mode === "full" && !pip;
  const mini = mode === "mini" && !pip;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {full && <View style={[StyleSheet.absoluteFill, styles.black]} />}
      {mini && <View style={[styles.capsule, { top: capsuleTop(insets.top), width: capsuleW }]} />}

      <View style={[styles.video, frame]} pointerEvents={mini ? "none" : "auto"}>
        <InlineVideoPlayer url={url} />
      </View>

      {full && (
        <View style={[styles.fullBar, { top: insets.top + 8 }]}>
          <RoundButton icon="chevron-down" label="Згорнути" onPress={minimize} />
          <View style={{ flex: 1 }} />
          {supportsPip && <RoundButton icon="contract" label="Вікно поверх усього" onPress={() => enterPip(ratioW, ratioH)} />}
          <RoundButton icon="close" label="Закрити" onPress={close} />
        </View>
      )}

      {mini && (
        <View style={[styles.capsuleRow, { top: capsuleTop(insets.top), width: capsuleW }]} pointerEvents="box-none">
          <Pressable style={styles.capsuleTitle} onPress={expand} accessibilityLabel="Розгорнути">
            <Text style={styles.capsuleText} numberOfLines={1}>
              {title || "Відео"}
            </Text>
          </Pressable>
          <Pressable onPress={expand} hitSlop={8} style={styles.capsuleBtn} accessibilityLabel="Розгорнути">
            <Ionicons name="expand" size={20} color="#fff" />
          </Pressable>
          <Pressable onPress={close} hitSlop={8} style={styles.capsuleBtn} accessibilityLabel="Закрити">
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>
        </View>
      )}
    </View>
  );
}

function RoundButton({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} hitSlop={6} style={styles.round}>
      <Ionicons name={icon as any} size={22} color="#fff" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  black: { backgroundColor: "#000" },
  video: { position: "absolute", backgroundColor: "#000" },
  fullBar: { position: "absolute", left: 16, right: 16, flexDirection: "row", gap: 10, alignItems: "center" },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center" },
  capsule: {
    position: "absolute",
    alignSelf: "center",
    height: TOP_NAV_H,
    borderRadius: TOP_NAV_H / 2,
    backgroundColor: "#1E1E1C",
    boxShadow: "0px 6px 18px -6px rgba(0,0,0,0.45)",
  },
  capsuleRow: { position: "absolute", alignSelf: "center", height: TOP_NAV_H, flexDirection: "row", alignItems: "center", paddingRight: 8 },
  capsuleTitle: { flex: 1, height: TOP_NAV_H, justifyContent: "center", paddingLeft: 8 + MINI_VIDEO_W + 10 },
  capsuleText: { color: "#fff", fontSize: 14 },
  capsuleBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
});
