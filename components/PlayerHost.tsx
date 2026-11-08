import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import * as ScreenOrientation from "expo-screen-orientation";
import { router } from "expo-router";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useEffect, useRef, useState } from "react";
import { AppState, BackHandler, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Ionicons } from "@/components/icons/Ionicons";
import InlineVideoPlayer, { type VideoControl } from "@/components/InlineVideoPlayer";
import { DOCK_BEAD, DOCK_BOTTOM } from "@/components/ui/Dock";
import { usePlayerStore } from "@/store/usePlayerStore";
import {
  configurePip,
  enterPip,
  mediaStart,
  mediaStop,
  onPipAction,
  onPipChanged,
  requestNotificationPermission,
  supportsMedia,
  supportsPip,
} from "@/utils/cinemaNative";
import { getVideoEmbedInfo } from "@/utils/videoEmbed";
import { watchBox } from "@/utils/watchLayout";

// The SMALL WINDOW (YouTube's mini player): where the video sits when it is
// folded away inside the app - bottom right, just above the dock.
function miniBox(width: number, height: number, insetBottom: number, wide: boolean) {
  const w = wide ? Math.min(240, width * 0.58) : 96;
  const h = wide ? (w * 9) / 16 : (w * 16) / 9;
  const bottom = insetBottom + DOCK_BOTTOM + DOCK_BEAD + 12;
  return { left: width - 16 - w, top: height - bottom - h, w, h };
}

// THE PLAYER, mounted once above every screen (see app/_layout.tsx). The
// WebView is ONE instance whose box changes with the state, so the video
// never restarts when the player is minimised to the capsule, expanded,
// or shrunk into the system's picture-in-picture window.
export function PlayerHost() {
  const { url, title, videoId, folderId, mode, pip, minimize, expand, close, setPip, setMode } = usePlayerStore();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const info = url ? getVideoEmbedInfo(url) : null;
  const wide = info?.provider !== "tiktok";
  const ratioW = wide ? 16 : 9;
  const ratioH = wide ? 9 : 16;

  // The system window opening / closing.
  useEffect(() => onPipChanged(setPip), [setPip]);

  // Each time the system window opens or closes, the player is told to
  // redraw (see InlineVideoPlayer's `nudge`).
  const [nudge, setNudge] = useState(0);
  const firstPip = useRef(true);
  useEffect(() => {
    if (firstPip.current) {
      firstPip.current = false;
      return;
    }
    setNudge((n) => n + 1);
  }, [pip]);

  // The system window was CLOSED (its cross, or swiped away by the system) - not
  // opened back into the app: the app is still in the background a moment after
  // the window is gone. Then the video stops too (and its notification with it).
  const wasPip = useRef(false);
  useEffect(() => {
    const left = wasPip.current && !pip;
    wasPip.current = pip;
    if (!left) return;
    const t = setTimeout(() => {
      if (AppState.currentState !== "active") close();
    }, 700);
    return () => clearTimeout(t);
  }, [pip, close]);

  // Whether the video is playing right now, as the player reports it, and
  // where it is (for the window's ±10 s buttons).
  const [isPlaying, setIsPlaying] = useState(false);
  // What the USER wants (play or pause) - told apart from the system pausing
  // the page on its own (screen lock), which is undone below.
  const wantPlay = useRef(false);
  const time = useRef(0);
  const control = useRef<VideoControl | null>(null);
  useEffect(() => {
    if (!url) setIsPlaying(false);
  }, [url]);

  // While a video PLAYS, leaving the app (Home, the swipe up) turns it into
  // the small window, whose buttons follow the play state.
  const armed = !!info && isPlaying;
  useEffect(() => {
    if (!supportsPip) return;
    configurePip(armed, isPlaying, ratioW, ratioH);
  }, [armed, isPlaying, ratioW, ratioH]);
  useEffect(
    () => () => {
      configurePip(false, false, 16, 9);
    },
    []
  );

  // The window's and the notification's buttons.
  const playingRef = useRef(false);
  playingRef.current = isPlaying;
  useEffect(
    () =>
      onPipAction((action) => {
        const c = control.current;
        console.log("[cinema] button", action, "control:", !!c, "playing:", playingRef.current, "t:", time.current);
        if (!c) return;
        if (action === "play") {
          wantPlay.current = true;
          c.play();
        } else if (action === "pause") {
          wantPlay.current = false;
          c.pause();
        } else if (action === "toggle") {
          wantPlay.current = !playingRef.current;
          (playingRef.current ? c.pause : c.play)();
        } else c.seekTo(time.current + (action === "fwd" ? 10 : -10));
      }),
    []
  );

  // The page paused by itself (the system hides it when the screen locks)
  // while the user did not ask for that: play again.
  const onPlayerState = (playing: boolean) => {
    console.log("[cinema] state", playing ? "playing" : "paused", "app:", AppState.currentState, "want:", wantPlay.current);
    setIsPlaying(playing);
    if (playing) wantPlay.current = true;
    else if (AppState.currentState === "active") wantPlay.current = false;
    else if (wantPlay.current) control.current?.play();
  };
  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => console.log("[cinema] app", st));
    return () => sub.remove();
  }, []);

  // THE BACKGROUND PLAYER: once a video has played, a notification with the
  // buttons (lock screen too) and a service that keeps the sound with the
  // screen off; it ends when the player is closed.
  const mediaStarted = useRef(false);
  const heading = title || "Відео";
  useEffect(() => {
    if (!supportsMedia || !info) return;
    if (!isPlaying && !mediaStarted.current) return;
    if (mediaStarted.current) {
      mediaStart(heading, isPlaying);
      return;
    }
    mediaStarted.current = true;
    requestNotificationPermission().finally(() => mediaStart(heading, isPlaying));
  }, [info, isPlaying, heading]);
  useEffect(() => {
    if (!url && mediaStarted.current) {
      mediaStarted.current = false;
      mediaStop();
    }
  }, [url]);

  // The screen stays on while a video plays in front of the user.
  const watching = isPlaying && (mode === "full" || mode === "watch" || pip);
  useEffect(() => {
    if (!watching) return;
    activateKeepAwakeAsync("cinema-player").catch(() => {});
    return () => {
      deactivateKeepAwake("cinema-player").catch(() => {});
    };
  }, [watching]);

  // The big wide video may turn sideways; everything else stays upright.
  const allowSideways = !!info && wide && mode === "full" && !pip;
  useEffect(() => {
    ScreenOrientation.lockAsync(allowSideways ? ScreenOrientation.OrientationLock.DEFAULT : ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, [allowSideways]);

  // From the big player: back to the watch screen when it is a library video
  // (the screen it came from), else down to the strip.
  const showWatch = () => {
    if (!videoId) return minimize();
    setMode("watch");
    router.navigate({ pathname: "/watch", params: { id: videoId, folder: folderId ?? "" } });
  };
  // Back from the big player does the same, instead of leaving the screen under it.
  useEffect(() => {
    if (!info || mode !== "full" || pip) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      showWatch();
      return true;
    });
    return () => sub.remove();
  });

  // Swiping the small window down closes the video: it follows the finger.
  const dragY = useSharedValue(0);
  useEffect(() => {
    dragY.value = 0;
  }, [mode, url, dragY]);
  const dragStyle = useAnimatedStyle(() => ({ transform: [{ translateY: dragY.value }], opacity: 1 - Math.min(0.6, dragY.value / 260) }));

  if (!url || !info) return null;

  // The small window's tap: back to the watch screen for a library video, else the big player.
  const openFromMini = () => {
    expand();
    if (videoId) router.navigate({ pathname: "/watch", params: { id: videoId, folder: folderId ?? "" } });
  };
  // Folding the video away from the watch screen: it goes to the small window, the screen goes back.
  const foldToMini = () => {
    minimize();
    router.back();
  };

  // The video's box in each state.
  let frame: object;
  if (pip) {
    // Edges, not numbers: the small window's real size reaches JS late (and
    // sometimes only once the user resizes the window), so the box is "all
    // of whatever window there is", never `width`/`height` from before.
    frame = { left: 0, top: 0, right: 0, bottom: 0 };
  } else if (mode === "watch") {
    const b = watchBox(width, height, insets.top, wide);
    frame = { left: b.left, top: b.top, width: b.w, height: b.h };
  } else if (mode === "full" && wide && width > height) {
    // Turned sideways: the video takes the whole screen.
    frame = { left: 0, top: 0, right: 0, bottom: 0 };
  } else if (mode === "full") {
    const boxW = Math.min(width, (height - insets.top - 160) * (ratioW / ratioH));
    const boxH = boxW / (ratioW / ratioH);
    frame = { left: (width - boxW) / 2, top: insets.top + 64, width: boxW, height: boxH };
  } else {
    const m = miniBox(width, height, insets.bottom, wide);
    frame = { left: m.left, top: m.top, width: m.w, height: m.h, borderRadius: 14, overflow: "hidden" };
  }

  const full = mode === "full" && !pip;
  const mini = mode === "mini" && !pip;
  const watch = mode === "watch" && !pip;
  const wb = watchBox(width, height, insets.top, wide);

  // Dragging the playing video DOWN folds it into the small window.
  const foldPan = Gesture.Pan()
    .enabled(watch)
    .activeOffsetY(18)
    .failOffsetX([-40, 40])
    .onEnd((e) => {
      if (e.translationY > 70 || e.velocityY > 700) runOnJS(foldToMini)();
    });
  // The small window: swipe down = close, tap = open the watch screen again.
  const miniGesture = Gesture.Race(
    Gesture.Pan()
      .activeOffsetY(8)
      .failOffsetX([-30, 30])
      .onUpdate((e) => {
        dragY.value = Math.max(0, e.translationY);
      })
      .onEnd((e) => {
        if (e.translationY > 40 || e.velocityY > 500) {
          dragY.value = withTiming(320, { duration: 170 }, (done) => {
            if (done) runOnJS(close)();
          });
        } else {
          dragY.value = withTiming(0, { duration: 140 });
        }
      }),
    Gesture.Tap().onEnd(() => runOnJS(openFromMini)())
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {(full || pip) && <View style={[StyleSheet.absoluteFill, styles.black]} />}
      <GestureDetector gesture={foldPan}>
        <Animated.View style={[styles.video, frame, mini && dragStyle]} pointerEvents={mini ? "none" : "auto"}>
          <InlineVideoPlayer
            url={url}
            nudge={nudge}
            controlRef={control}
            onState={onPlayerState}
            onTime={(t) => {
              time.current = t;
            }}
          />
        </Animated.View>
      </GestureDetector>

      {full && (
        <View style={[styles.fullBar, { top: insets.top + 8 }]}>
          <RoundButton icon="chevron-down" label="Згорнути" onPress={showWatch} />
          <View style={{ flex: 1 }} />
          {supportsPip && <RoundButton icon="contract" label="Вікно поверх усього" onPress={() => enterPip(ratioW, ratioH)} />}
          <RoundButton icon="close" label="Закрити" onPress={close} />
        </View>
      )}

      {watch && (
        <View style={[styles.watchBar, { top: wb.top + 8, left: wb.left + 8, right: wb.left + 8 }]} pointerEvents="box-none">
          <RoundButton icon="chevron-down" label="Згорнути" small onPress={foldToMini} />
          <View style={{ flex: 1 }} />
          <RoundButton icon="expand" label="На весь екран" small onPress={() => setMode("full")} />
          {supportsPip && <RoundButton icon="contract" label="Вікно поверх усього" small onPress={() => enterPip(ratioW, ratioH)} />}
          <RoundButton icon="close" label="Закрити" small onPress={close} />
        </View>
      )}

      {mini && (
        <>
          <GestureDetector gesture={miniGesture}>
            <Animated.View style={[styles.miniTouch, frame, dragStyle]} accessibilityLabel="Відкрити відео" />
          </GestureDetector>
          <Animated.View style={[styles.miniClose, { left: (frame as any).left + (frame as any).width - 30, top: (frame as any).top + 6 }, dragStyle]}>
            <Pressable onPress={close} hitSlop={8} accessibilityLabel="Закрити" style={styles.miniCloseBtn}>
              <Ionicons name="close" size={14} color="#fff" />
            </Pressable>
          </Animated.View>
        </>
      )}
    </View>
  );
}

function RoundButton({ icon, label, onPress, small }: { icon: string; label: string; onPress: () => void; small?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} hitSlop={6} style={[styles.round, small && styles.roundSmall]}>
      <Ionicons name={icon as any} size={small ? 18 : 22} color="#fff" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  black: { backgroundColor: "#000" },
  video: { position: "absolute", backgroundColor: "#000" },
  fullBar: { position: "absolute", left: 16, right: 16, flexDirection: "row", gap: 10, alignItems: "center" },
  watchBar: { position: "absolute", flexDirection: "row", gap: 8, alignItems: "center" },
  roundSmall: { width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(0,0,0,0.45)" },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center" },
  miniTouch: { position: "absolute", backgroundColor: "transparent" },
  miniClose: { position: "absolute", width: 24, height: 24 },
  miniCloseBtn: { width: 24, height: 24, borderRadius: 12, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" },
});
