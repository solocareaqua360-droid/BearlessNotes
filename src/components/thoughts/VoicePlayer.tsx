import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassPortal } from '../GlassPortal';
import SaveRing from '../SaveRing';
import { Ionicons } from '../icons/Ionicons';
import { useSoft } from '../../theme/soft';
import { SOFT_BOLD, SOFT_SEMIBOLD } from '../../utils/fonts';
import { CHROME_TOP } from '../../constants/rail';
import { useNavTopNavUp } from '../../navigation/navDock';
import { FEATURES } from '../../features';
import { pauseVoice, resumeVoice, seekVoice, skipVoice, stopVoice, subscribeVoice, voiceState, type VoiceState } from '../../utils/thoughtVoice';
import { openThoughtReader, subscribeShownReader } from '../../utils/thoughtBus';

// THE PLAYER IN THE TOP BAR (2026-10-15, the user's sketch, artifact 2jV7gmrXPP7pPBNhgFgQCK boards 5-9). While
// something is read aloud a capsule stands on the LEFT edge of the bar at the top - the theme's dot, the moving
// bars, a round pause/play - and a tap on it opens an island UNDER the bar (the bar itself does not grow): what
// plays, where in it, the controls, ✕ to stop and close. The capsule is gone while the island is open - one player,
// never two. White theme: a white island, a black play button; black theme: a black island, a white button and a
// warm glow behind it («або кантік або світіння ... світіння»). The card of what plays carries its own player, so
// with that card open neither shows.
// Replaced the island around the camera: the status bar is a system window over the top 42 dp and takes every
// touch there, so that island could be seen but never tapped (hiding the status bar was refused).
export const CAPSULE_W = 88;
export const CAPSULE_H = 34;
const ORANGE = '#D9793F';
const DOT = '#F7DCC0';

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// The island's open state, shared by every bar's capsule and the island itself.
let islandOpen = false;
const openListeners = new Set<() => void>();
function setIslandOpen(on: boolean) {
  if (on === islandOpen) return;
  islandOpen = on;
  openListeners.forEach((l) => l());
}
function useIslandOpen(): boolean {
  const [on, setOn] = useState(islandOpen);
  useEffect(() => {
    const l = () => setOn(islandOpen);
    openListeners.add(l);
    l();
    return () => {
      openListeners.delete(l);
    };
  }, []);
  return on;
}

function useVoice(): VoiceState {
  const [v, setV] = useState<VoiceState>(voiceState);
  useEffect(() => subscribeVoice(setV), []);
  return v;
}

// Something plays and its card is not the one open.
function usePlayerShown(): { v: VoiceState; shown: boolean } {
  const v = useVoice();
  const [shownReader, setShownReader] = useState<string | null>(null);
  useEffect(() => subscribeShownReader(setShownReader), []);
  const shown = FEATURES.thoughts && v.playing && !(v.thoughtId && shownReader === v.thoughtId);
  useEffect(() => {
    if (!v.playing) setIslandOpen(false);
  }, [v.playing]);
  return { v, shown };
}

// For the top bar: whether it keeps room for the capsule on its left.
export function useVoiceCapsuleOn(): boolean {
  const { shown } = usePlayerShown();
  const open = useIslandOpen();
  return shown && !open;
}

function Bars({ paused }: { paused: boolean }) {
  const beat = useSharedValue(0);
  useEffect(() => {
    beat.value = paused ? withTiming(0, { duration: 200 }) : withRepeat(withSequence(withTiming(1, { duration: 420 }), withTiming(0, { duration: 420 })), -1, false);
  }, [beat, paused]);
  const b1 = useAnimatedStyle(() => ({ height: paused ? 4 : 5 + beat.value * 7 }));
  const b2 = useAnimatedStyle(() => ({ height: paused ? 4 : 12 - beat.value * 6 }));
  const b3 = useAnimatedStyle(() => ({ height: paused ? 4 : 7 + beat.value * 5 }));
  return (
    <View style={styles.bars}>
      <Animated.View style={[styles.bar, b1]} />
      <Animated.View style={[styles.bar, b2]} />
      <Animated.View style={[styles.bar, b3]} />
    </View>
  );
}

// The capsule itself - drawn by the top bar on its left edge, or on its own where a screen has no bar.
export function VoiceCapsule() {
  const S = useSoft();
  const v = useVoice();
  const dark = S.dark;
  return (
    <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(160)}>
      <Pressable
        onPress={() => setIslandOpen(true)}
        accessibilityLabel={`Програвач: ${v.title}`}
        style={[styles.capsule, { backgroundColor: dark ? '#2A2A2C' : '#F2F1ED' }]}
      >
        <View style={styles.dot} />
        {/* Still being voiced: the bars rest and the outline runs, as the listen button's does (ListenMarks). */}
        <Bars paused={v.paused || v.source === null} />
        <Pressable
          onPress={() => (v.paused ? resumeVoice() : pauseVoice())}
          hitSlop={6}
          accessibilityLabel={v.paused ? 'Грати' : 'Пауза'}
          style={[styles.capsuleButton, { backgroundColor: dark ? '#fff' : '#1E1E1C' }]}
        >
          <Ionicons name={(v.paused ? 'play' : 'pause') as never} size={12} color={dark ? '#000' : '#fff'} />
        </Pressable>
        <SaveRing saving={v.source === null} color={ORANGE} radius={CAPSULE_H / 2} />
      </Pressable>
    </Animated.View>
  );
}

// Mounted once (ThoughtsHost): the island under the bar, and the capsule on screens that have no bar.
export default function VoicePlayer() {
  const { v, shown } = usePlayerShown();
  const open = useIslandOpen();
  const barUp = useNavTopNavUp();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const S = useSoft();
  const dark = S.dark;
  if (!shown) return null;
  const side = 20;
  const frameW = Math.min(width - side * 2, 560);
  const left = (width - frameW) / 2;
  const barTop = insets.top + CHROME_TOP;
  const share = v.duration > 0 ? Math.min(1, v.position / v.duration) : 0;
  const ink = dark ? '#fff' : '#1E1E1C';
  const sub = '#8C8A83';
  const soft = dark ? '#2A2A2E' : '#F2F1ED';
  const main = dark ? '#fff' : '#1E1E1C';
  const mainInk = dark ? '#000' : '#fff';

  return (
    <>
    {/* A screen with no bar at the top: the capsule stands alone where the bar would be, on the right. */}
    {!barUp && !open && (
      <GlassPortal priority={2} name="voiceCapsule">
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <View style={{ position: 'absolute', top: barTop + (46 - CAPSULE_H) / 2, right: left + 6 }}>
            <VoiceCapsule />
          </View>
        </View>
      </GlassPortal>
    )}
    {/* Above the thought windows too (space, canvas: 15-16), whose own bars carry the capsule. */}
    <GlassPortal priority={30} name="voiceIsland">
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {open && (
          <>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setIslandOpen(false)} accessibilityLabel="Згорнути програвач" />
            <Animated.View
              entering={FadeIn.duration(200)}
              exiting={FadeOut.duration(160)}
              style={[
                styles.island,
                {
                  top: barTop + 46 + 8,
                  // A hair wider than the bar: edge on edge, the dark card under it showed along both sides.
                  left: left - 1,
                  width: frameW + 2,
                  backgroundColor: dark ? '#000' : '#fff',
                  // A hairline only on the black theme (with the glow); on white a transparent border let the dark
                  // card under the island show along its edges.
                  borderWidth: dark ? 1 : 0,
                  borderColor: 'rgba(255,255,255,0.08)',
                  boxShadow: dark
                    ? '0px 0px 0px 1px rgba(217,121,63,0.18), 0px 0px 34px 2px rgba(217,121,63,0.32), 0px 16px 46px -8px rgba(217,121,63,0.28)'
                    : '0px 18px 40px -14px rgba(30,30,28,0.35)',
                },
              ]}
            >
              <View style={styles.titleRow}>
                <View style={styles.bigDot} />
                <Pressable
                  style={{ flex: 1, minWidth: 0 }}
                  onPress={() => {
                    if (!v.thoughtId) return;
                    setIslandOpen(false);
                    openThoughtReader(v.thoughtId);
                  }}
                  accessibilityLabel="Відкрити картку"
                >
                  <Text style={[styles.title, { color: ink }]} numberOfLines={1}>
                    {v.title}
                  </Text>
                  <Text style={[styles.sub, { color: sub }]} numberOfLines={1}>
                    {`${v.total > 1 ? `${v.index} з ${v.total} · ` : ''}${v.source === 'gemini' ? 'голос Gemini' : v.source === 'phone' ? 'голос телефона' : 'готую голос…'}`}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setIslandOpen(false);
                    stopVoice();
                  }}
                  hitSlop={6}
                  accessibilityLabel="Зупинити й закрити"
                  style={[styles.close, { backgroundColor: soft }]}
                >
                  <Ionicons name={'close' as never} size={16} color={ink} />
                </Pressable>
              </View>
              <View>
                <View style={[styles.track, { backgroundColor: dark ? '#2A2A2E' : '#ECEAE4' }]}>
                  <View style={[styles.fill, { width: `${share * 100}%` }]} />
                  <View style={[styles.knob, { left: `${share * 100}%` }]} />
                </View>
                <View style={styles.times}>
                  <Text style={[styles.time, { color: sub }]}>{mmss(v.position)}</Text>
                  <Text style={[styles.time, { color: sub }]}>{v.duration > 0 ? mmss(v.duration) : ''}</Text>
                </View>
              </View>
              <View style={styles.controls}>
                <Pressable onPress={() => skipVoice(-1)} hitSlop={6} accessibilityLabel="Попередня картка" style={styles.ghost}>
                  <View style={{ transform: [{ rotate: '180deg' }] }}>
                    <Ionicons name={'play-skip-forward' as never} size={20} color={ink} />
                  </View>
                </Pressable>
                <Pressable onPress={() => seekVoice(-15)} accessibilityLabel="Назад на 15 секунд" style={[styles.round, { backgroundColor: soft }]}>
                  <Text style={[styles.roundText, { color: ink }]}>−15</Text>
                </Pressable>
                <Pressable onPress={() => (v.paused ? resumeVoice() : pauseVoice())} accessibilityLabel={v.paused ? 'Грати' : 'Пауза'} style={[styles.main, { backgroundColor: main }]}>
                  <Ionicons name={(v.paused ? 'play' : 'pause') as never} size={24} color={mainInk} />
                </Pressable>
                <Pressable onPress={() => seekVoice(15)} accessibilityLabel="Вперед на 15 секунд" style={[styles.round, { backgroundColor: soft }]}>
                  <Text style={[styles.roundText, { color: ink }]}>+15</Text>
                </Pressable>
                <Pressable onPress={() => skipVoice(1)} hitSlop={6} accessibilityLabel="Наступна картка" style={styles.ghost}>
                  <Ionicons name={'play-skip-forward' as never} size={20} color={ink} />
                </Pressable>
              </View>
              <Text style={[styles.hint, { color: sub }]}>Торкнись назви — відкриється картка</Text>
            </Animated.View>
          </>
        )}
      </View>
    </GlassPortal>
    </>
  );
}

const styles = StyleSheet.create({
  capsule: { width: CAPSULE_W, height: CAPSULE_H, borderRadius: CAPSULE_H / 2, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 6, paddingRight: 5 },
  dot: { width: 22, height: 22, borderRadius: 11, backgroundColor: DOT, flexShrink: 0 },
  bars: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 14, flexShrink: 0 },
  bar: { width: 3, borderRadius: 2, backgroundColor: ORANGE },
  capsuleButton: { marginLeft: 'auto', width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  island: { position: 'absolute', borderRadius: 30, padding: 16, gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bigDot: { width: 46, height: 46, borderRadius: 23, backgroundColor: DOT },
  title: { fontSize: 15, fontFamily: SOFT_BOLD },
  sub: { fontSize: 12.5, fontFamily: SOFT_SEMIBOLD },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  track: { height: 6, borderRadius: 3, justifyContent: 'center' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 3, backgroundColor: ORANGE },
  knob: { position: 'absolute', width: 16, height: 16, marginLeft: -8, borderRadius: 8, backgroundColor: '#fff', boxShadow: '0px 1px 4px rgba(0,0,0,0.3)' },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  time: { fontSize: 12, fontFamily: SOFT_SEMIBOLD },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  ghost: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  roundText: { fontSize: 12, fontFamily: SOFT_BOLD },
  main: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  hint: { fontSize: 12, fontFamily: SOFT_SEMIBOLD, textAlign: 'center' },
});
