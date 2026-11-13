import { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Image, Keyboard, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import TextInput from '../AppTextInput';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Line } from 'react-native-svg';
import { GlassPortal } from '../GlassPortal';
import { ask, confirm } from '../surfaces/Ask';
import { Ionicons } from '../icons/Ionicons';
import { useSoft } from '../../theme/soft';
import { useKeyboardHeight } from '../../hooks/useKeyboardHeight';
import { DOCK_BOTTOM } from '../../navigation/dockGeometry';
import { hapticDrop, hapticPickUp, hapticSnapTick } from '../../utils/haptics';
import { SOFT_BOLD, SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../../utils/fonts';
import {
  deleteThought,
  editThoughtText,
  finishAiCard,
  hueOf,
  linkThoughts,
  markAiPending,
  moveThought,
  placeThought,
  saveTextCard,
  setConclusion,
  setVideoGist,
  startAiCard,
  unlinkThought,
  type Thought,
  type ThoughtTheme,
} from '../../hooks/useThoughts';
import { askAboutThoughts, isYouTube, summarizeThoughts, videoGist } from '../../utils/thoughtAI';
import { speakThoughts } from '../../utils/thoughtVoice';
import { notify } from '../surfaces/Ask';
import { cardTitle, voiceTextOf } from './thoughtText';
import WriteSheet from './WriteSheet';
import LiveSurface from './LiveSurface';
import ThoughtView from './ThoughtView';
import AttachmentImage from '../AttachmentImage';
import { CAPSULE_H, CAPSULE_W, VoiceCapsule, useVoiceCapsuleOn } from './VoicePlayer';
import { ListenMarks, useListenMarks } from './ListenMarks';
import { TOP_NAV_H } from '../TopNavBar';
import { CHROME_TOP } from '../../constants/rail';

// ONE THEME'S CANVAS (2026-10-15, sketch 4 - «треба на практиці пройти»). On top the theme's conclusion - «Що з
// цього ти вже точно знаєш?» - written right there. Below, its thoughts as cards on a surface: carried by a finger
// with a little inertia, they stay where they are left; one let go onto another is joined to it by a line (the
// thought that came next to it). A tap opens what the thought is about; a hold moves, unlinks or deletes it.
// 2026-10-15 night, the user's: a double tap on empty canvas writes a card right there; «Вибрати» picks cards, and the
// picked ones are listened to, summarised, or asked a question about (utils/thoughtAI, utils/thoughtVoice) - the
// answer is a card of its own, joined to the cards it came from.

const CARD_W = 168;
const CARD_H = 112;

export default function ThemeCanvas({
  theme,
  thoughts,
  themes,
  onCatch,
  onClose,
}: {
  theme: ThoughtTheme;
  thoughts: Thought[];
  themes: ThoughtTheme[];
  onCatch: () => void;
  onClose: () => void;
}) {
  const S = useSoft();
  const insets = useSafeAreaInsets();
  // The voice player's capsule on the left edge of this window's own bar, as on every bar (VoicePlayer.tsx).
  const capsuleOn = useVoiceCapsuleOn();
  const { width: W, height: H } = useWindowDimensions();
  const kb = useKeyboardHeight();
  const look = hueOf(theme, S.dark);
  const shown = useSharedValue(0);
  // The surface's zoom: a carried card follows the finger at any zoom.
  const zoom = useSharedValue(1);
  const [editing, setEditing] = useState(false);
  // The thought open for reading (a tap on its card).
  const [reading, setReading] = useState<string | null>(null);
  // Picked cards (select mode on when the set is not null).
  const [picked, setPicked] = useState<Set<string> | null>(null);
  // The select bar's listen button: marked when every picked card is kept as voice, ringed while it is being made.
  const pickedMarks = useListenMarks(
    picked ? thoughts.filter((t) => picked.has(t.id)).map((t) => ({ id: t.id, text: voiceTextOf(t) })) : []
  );
  // A card being written: new at a place, or an existing one edited; or a question for the picked cards.
  const [writing, setWriting] = useState<{ kind: 'new'; x: number; y: number } | { kind: 'edit'; id: string; text: string } | { kind: 'ask' } | null>(null);
  const [draft, setDraft] = useState(theme.conclusion);
  useEffect(() => {
    if (!editing) setDraft(theme.conclusion);
  }, [theme.conclusion, editing]);

  useEffect(() => {
    shown.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) });
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (editing) {
        saveConclusion();
        return true;
      }
      if (picked) {
        setPicked(null);
        return true;
      }
      close();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, draft, picked]);

  // The keyboard put away = done writing: kept, and the panel folds back (it stood the whole screen tall, 2026-10-15).
  useEffect(() => {
    if (!editing) return;
    const sub = Keyboard.addListener('keyboardDidHide', () => saveConclusion());
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, draft]);

  const close = () => {
    shown.value = withTiming(0, { duration: 200 });
    setTimeout(onClose, 210);
  };
  const saveConclusion = () => {
    Keyboard.dismiss();
    setEditing(false);
    if (draft.trim() !== theme.conclusion.trim()) setConclusion(theme.id, draft.trim()).catch(() => {});
  };

  // THE SURFACE: below the conclusion, above the dock.
  const top = insets.top + 66 + 108;
  const area = { w: W - 24, h: Math.max(240, H - top - insets.bottom - DOCK_BOTTOM - 72) };

  // Where each card lies: its own place, or - not placed yet - the next free spot of a loose grid.
  const spots = useMemo(() => {
    const cols = Math.max(1, Math.floor(area.w / (CARD_W + 10)));
    const m = new Map<string, { x: number; y: number }>();
    let k = 0;
    thoughts.forEach((t) => {
      if (t.x != null && t.y != null) m.set(t.id, { x: t.x * (area.w - CARD_W), y: t.y * (area.h - CARD_H) });
      else {
        const c = k % cols;
        const r = Math.floor(k / cols);
        m.set(t.id, { x: 6 + c * (CARD_W + 10), y: 6 + r * (CARD_H + 14) });
        k++;
      }
    });
    return m;
  }, [thoughts, area.w, area.h]);

  // Live positions while a card is carried, so the lines follow it.
  const [live, setLive] = useState<{ id: string; x: number; y: number } | null>(null);
  const posOf = (id: string) => (live && live.id === id ? live : spots.get(id) ?? { x: 0, y: 0 });

  const lines = useMemo(() => {
    const out: { a: string; b: string }[] = [];
    const ids = new Set(thoughts.map((t) => t.id));
    thoughts.forEach((t) => t.links.forEach((l) => ids.has(l) && t.id < l && out.push({ a: t.id, b: l })));
    return out;
  }, [thoughts]);

  const dropped = async (id: string, x: number, y: number) => {
    setLive(null);
    // On another card: joined to it, and laid beside it.
    const cx = x + CARD_W / 2;
    const cy = y + CARD_H / 2;
    const onto = thoughts.find((t) => {
      if (t.id === id) return false;
      const p = spots.get(t.id)!;
      return cx > p.x && cx < p.x + CARD_W && cy > p.y && cy < p.y + CARD_H;
    });
    let nx = Math.min(Math.max(0, x), area.w - CARD_W);
    let ny = Math.min(Math.max(0, y), area.h - CARD_H);
    if (onto) {
      hapticDrop();
      const p = spots.get(onto.id)!;
      // Beside it - below and a little to the side - so the line between them shows.
      nx = Math.min(Math.max(0, p.x + CARD_W * 0.35), area.w - CARD_W);
      ny = p.y + CARD_H + 26 <= area.h - CARD_H ? p.y + CARD_H + 26 : Math.max(0, p.y - CARD_H - 26);
      linkThoughts(id, onto.id).catch(() => {});
    }
    placeThought(id, fx(nx), fy(ny)).catch(() => {});
    // The cards not placed yet stay where they stand: left to the loose grid, they all moved up a step the moment
    // one of them was placed (the video jumped into the place the carried card had left, 2026-10-15).
    thoughts
      .filter((t) => t.id !== id && (t.x == null || t.y == null))
      .forEach((t) => {
        const p = spots.get(t.id);
        if (p) placeThought(t.id, fx(p.x), fy(p.y)).catch(() => {});
      });
  };

  const fx = (px: number) => (area.w > CARD_W ? Math.min(1, Math.max(0, px / (area.w - CARD_W))) : 0);
  const fy = (py: number) => (area.h > CARD_H ? Math.min(1, Math.max(0, py / (area.h - CARD_H))) : 0);

  // THE ASSISTANT: the answer's card stands first (so nothing hangs on the network), below the picked cards, then the
  // call fills it in - or marks it failed, with a retry in its menu.
  const runAi = async (kind: 'summary' | 'answer', ids: string[], question?: string, existing?: string) => {
    const chosen = thoughts.filter((t) => ids.includes(t.id) && !t.aiState);
    if (chosen.length === 0) return;
    let cardId = existing;
    if (cardId) await markAiPending(cardId).catch(() => {});
    if (!cardId) {
      const ps = chosen.map((t) => spots.get(t.id)!).filter(Boolean);
      const x = ps.reduce((a, p) => a + p.x, 0) / ps.length;
      const y = Math.max(...ps.map((p) => p.y)) + CARD_H + 30;
      cardId = await startAiCard({ themeId: theme.id, ai: kind, question, from: chosen.map((t) => t.id), x: fx(x), y: fy(Math.min(y, area.h - CARD_H)) }).catch(() => undefined);
      if (!cardId) return;
    }
    try {
      const text = kind === 'answer' && question ? await askAboutThoughts(chosen, question) : await summarizeThoughts(chosen);
      await finishAiCard(cardId, { text });
    } catch (e) {
      await finishAiCard(cardId, { error: (e as Error).message }).catch(() => {});
    }
  };

  const listen = (list: Thought[]) => {
    const items = list
      .filter((t) => !t.aiState)
      .map((t) => ({ title: cardTitle(t) || 'Думка', text: voiceTextOf(t), thoughtId: t.id }))
      .filter((i) => i.text.trim());
    if (items.length) speakThoughts(items).catch(() => {});
  };

  const watchVideo = async (t: Thought) => {
    if (t.source?.kind !== 'link') return;
    notify('Дивлюсь відео', 'Gemini дивиться його - зміст зʼявиться на картці за хвилину.');
    try {
      const gist = await videoGist(t.source.url);
      await setVideoGist(t.id, gist);
    } catch (e) {
      notify('Не вдалося', (e as Error).message);
    }
  };

  const menu = async (t: Thought) => {
    const choice = await ask({
      title: (cardTitle(t) || t.felt || 'Думка').slice(0, 60),
      actions: [
        { id: 'pick', label: 'Вибрати', icon: 'checkmark-circle-outline' as const },
        ...(voiceTextOf(t).trim() ? [{ id: 'listen', label: 'Прослухати', icon: 'volume-high-outline' as const }] : []),
        ...(t.aiState === 'error' ? [{ id: 'retry', label: 'Спробувати ще раз', icon: 'refresh-outline' as const }] : []),
        ...(!t.source && !t.aiState ? [{ id: 'edit', label: 'Редагувати', icon: 'pencil-outline' as const }] : []),
        ...(t.source?.kind === 'link' && isYouTube(t.source.url) && !t.videoGist
          ? [{ id: 'video', label: 'Що в цьому відео?', icon: 'film-outline' as const }]
          : []),
        ...themes.filter((x) => x.id !== theme.id).map((x) => ({ id: `to:${x.id}`, label: `У «${x.name}»`, icon: 'arrow-forward-outline' as const })),
        { id: 'loose', label: 'У «Не розкладено»', icon: 'arrow-forward-outline' as const },
        ...(t.links.length ? [{ id: 'unlink', label: 'Прибрати звʼязки', icon: 'remove-circle-outline' as const }] : []),
        { id: 'delete', label: 'Видалити думку', icon: 'trash-outline' as const, tone: 'danger' as const },
      ],
    });
    if (choice === 'pick') setPicked(new Set([t.id]));
    else if (choice === 'listen') listen([t]);
    else if (choice === 'retry' && (t.ai === 'summary' || t.ai === 'answer')) runAi(t.ai, t.from ?? [], t.question, t.id);
    else if (choice === 'edit') setWriting({ kind: 'edit', id: t.id, text: t.felt });
    else if (choice === 'video') watchVideo(t);
    else if (choice === 'delete') {
      const yes = await confirm({ title: 'Видалити думку?', message: 'Її не можна буде повернути.', confirmLabel: 'Видалити' });
      if (yes) {
        if (t.links.length) await unlinkThought(t.id, t.links).catch(() => {});
        await deleteThought(t.id).catch(() => {});
      }
    } else if (choice === 'unlink') await unlinkThought(t.id, t.links).catch(() => {});
    else if (choice === 'loose') await moveThought(t.id, null).catch(() => {});
    else if (choice.startsWith('to:')) await moveThought(t.id, choice.slice(3)).catch(() => {});
  };

  const writeAt = (x: number, y: number) => {
    if (picked) return;
    setWriting({ kind: 'new', x: Math.max(0, x - CARD_W / 2), y: Math.max(0, y - CARD_H / 2) });
  };

  const fade = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ scale: 0.97 + shown.value * 0.03 }] }));

  return (
    <GlassPortal priority={16} name="themeCanvas">
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: S.bg === 'transparent' ? '#F6F5F2' : S.bg }, fade]}>
        <View style={[styles.bar, { top: insets.top + CHROME_TOP, backgroundColor: S.card, boxShadow: S.popShadow }, capsuleOn && { paddingHorizontal: CAPSULE_W + 16 }]}>
          {capsuleOn && (
            <View style={styles.capsuleSlot}>
              <VoiceCapsule />
            </View>
          )}
          <View style={[styles.barDot, { backgroundColor: look.to }]} />
          <Text style={[styles.barTitle, { color: S.ink }]} numberOfLines={1}>
            {theme.name}
          </Text>
        </View>

        {/* THE CONCLUSION, pinned over the canvas. */}
        <Pressable
          onPress={() => setEditing(true)}
          style={[styles.conclusion, { top: insets.top + 66, bottom: editing ? Math.max(kb, insets.bottom) + 14 : undefined }]}
        >
          <Text style={styles.conclusionLabel}>Висновок теми</Text>
          {editing ? (
            <TextInput
              value={draft}
              onChangeText={setDraft}
              autoFocus
              multiline
              autoCorrect={false}
              placeholder="Що з цього ти вже точно знаєш?"
              placeholderTextColor="#8C8A83"
              onBlur={saveConclusion}
              style={styles.conclusionInput}
            />
          ) : (
            <Text style={[styles.conclusionText, !theme.conclusion && { color: '#9E9C95' }]} numberOfLines={3}>
              {theme.conclusion || 'Що з цього ти вже точно знаєш?'}
            </Text>
          )}
        </Pressable>

        {!editing && (
          <View style={[styles.area, { top, width: area.w, height: area.h }]}>
            <LiveSurface width={area.w} height={area.h} scale={zoom}>
            {/* A double tap on empty canvas writes a card right there (the user's: «спочатку пишеш»). */}
            <GestureDetector
              gesture={Gesture.Tap()
                .numberOfTaps(2)
                .onEnd((e, ok) => {
                  if (ok) runOnJS(writeAt)(e.x, e.y);
                })}
            >
              <View style={StyleSheet.absoluteFill} />
            </GestureDetector>
            <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
              {lines.map((l) => {
                const a = posOf(l.a);
                const b = posOf(l.b);
                return (
                  <Line
                    key={`${l.a}-${l.b}`}
                    x1={a.x + CARD_W / 2}
                    y1={a.y + CARD_H / 2}
                    x2={b.x + CARD_W / 2}
                    y2={b.y + CARD_H / 2}
                    stroke={look.sub}
                    strokeOpacity={0.45}
                    strokeWidth={2}
                    strokeDasharray="6 5"
                  />
                );
              })}
            </Svg>
            {thoughts.map((t) => (
              <ThoughtCard
                key={t.id}
                thought={t}
                at={spots.get(t.id) ?? { x: 0, y: 0 }}
                bounds={area}
                accent={look.sub}
                zoom={zoom}
                onMove={(x, y) => setLive({ id: t.id, x, y })}
                onDrop={(x, y) => dropped(t.id, x, y)}
                picked={!!picked?.has(t.id)}
                onOpen={() => {
                  if (picked) {
                    const next = new Set(picked);
                    if (next.has(t.id)) next.delete(t.id);
                    else next.add(t.id);
                    setPicked(next.size ? next : null);
                  } else setReading(t.id);
                }}
                onHold={() => (picked ? undefined : menu(t))}
              />
            ))}
            {thoughts.length === 0 && (
              <View style={styles.empty}>
                <Text style={[styles.emptyText, { color: S.ink3 }]}>У темі ще немає думок</Text>
              </View>
            )}
            </LiveSurface>
          </View>
        )}

        {!editing && picked && (
          <View style={[styles.pickBar, { bottom: insets.bottom + DOCK_BOTTOM - 2 }]}>
            <Pressable onPress={() => setPicked(null)} hitSlop={8} accessibilityLabel="Скасувати вибір" style={styles.pickRound}>
              <Ionicons name={'close' as never} size={20} color="#fff" />
            </Pressable>
            <Pressable
              onPress={() => setPicked(picked.size === thoughts.length ? null : new Set(thoughts.filter((t) => !t.aiState).map((t) => t.id)))}
              style={styles.pickCount}
            >
              <Text style={styles.pickCountText}>{picked.size === thoughts.length ? `Усі ${picked.size}` : `${picked.size} · усі`}</Text>
            </Pressable>
            <View style={{ flex: 1 }} />
            <Pressable onPress={() => listen(thoughts.filter((t) => picked.has(t.id)))} accessibilityLabel="Прослухати вибрані" style={styles.pickRound}>
              <Ionicons name={'volume-high-outline' as never} size={20} color="#fff" />
              <ListenMarks offline={pickedMarks.offline} voicing={pickedMarks.voicing} making={pickedMarks.making} ink="#fff" ground="#3A3936" />
            </Pressable>
            <Pressable onPress={() => setWriting({ kind: 'ask' })} accessibilityLabel="Запитати про вибрані" style={styles.pickRound}>
              <Ionicons name={'help-circle-outline' as never} size={21} color="#fff" />
            </Pressable>
            <Pressable
              onPress={() => {
                const ids = [...picked];
                setPicked(null);
                runAi('summary', ids);
              }}
              style={[styles.pickMain, { backgroundColor: '#D9793F' }]}
            >
              <Text style={styles.pickMainText}>Зрезюмувати</Text>
            </Pressable>
          </View>
        )}

        {!editing && !picked && (
          <>
            <Pressable
              onPress={onCatch}
              accessibilityLabel="Нова думка в цю тему"
              style={[styles.dockRound, { right: 20 + 48 + 12, bottom: insets.bottom + DOCK_BOTTOM + 4, backgroundColor: S.ink }]}
            >
              <Ionicons name={'add' as never} size={26} color={S.card} />
            </Pressable>
            <Pressable
              onPress={close}
              accessibilityLabel="Назад"
              style={[styles.dockRound, { right: 20, bottom: insets.bottom + DOCK_BOTTOM + 4, backgroundColor: S.card, boxShadow: S.popShadow }]}
            >
              <Ionicons name={'chevron-back' as never} size={22} color={S.ink} />
            </Pressable>
          </>
        )}
      </Animated.View>
      <ThoughtView
        thought={thoughts.find((t) => t.id === reading) ?? null}
        accent={look.sub}
        onListen={(t) => listen([t])}
        onWatch={(t) => watchVideo(t)}
        onClose={() => setReading(null)}
      />
      <WriteSheet
        visible={writing !== null}
        title={writing?.kind === 'ask' ? 'Питання до вибраних' : writing?.kind === 'edit' ? 'Картка' : 'Нова картка'}
        placeholder={writing?.kind === 'ask' ? 'Що ти хочеш з них зрозуміти?' : 'Пиши…'}
        initial={writing?.kind === 'edit' ? writing.text : ''}
        doneLabel={writing?.kind === 'ask' ? 'Запитати' : 'Готово'}
        onClose={() => setWriting(null)}
        onDone={(text) => {
          const w = writing;
          setWriting(null);
          if (!w) return;
          if (w.kind === 'new') saveTextCard({ themeId: theme.id, text, x: fx(w.x), y: fy(w.y) }).catch(() => {});
          else if (w.kind === 'edit') editThoughtText(w.id, text).catch(() => {});
          else if (picked) {
            const ids = [...picked];
            setPicked(null);
            runAi('answer', ids, text);
          }
        }}
      />
    </GlassPortal>
  );
}

// ONE CARD ON THE SURFACE: carried by the finger, let go with its own speed (it glides a little and stops at the
// edge), springing a touch bigger while held.
function ThoughtCard({
  thought,
  at,
  bounds,
  accent,
  zoom,
  picked,
  onMove,
  onDrop,
  onOpen,
  onHold,
}: {
  thought: Thought;
  at: { x: number; y: number };
  bounds: { w: number; h: number };
  accent: string;
  zoom: SharedValue<number>;
  picked: boolean;
  onMove: (x: number, y: number) => void;
  onDrop: (x: number, y: number) => void;
  onOpen: () => void;
  onHold: () => void;
}) {
  const S = useSoft();
  const x = useSharedValue(at.x);
  const y = useSharedValue(at.y);
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  const lift = useSharedValue(0);
  const carrying = useRef(false);
  useEffect(() => {
    if (carrying.current) return;
    x.value = withTiming(at.x, { duration: 240, easing: Easing.out(Easing.cubic) });
    y.value = withTiming(at.y, { duration: 240, easing: Easing.out(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at.x, at.y]);
  const maxX = Math.max(0, bounds.w - CARD_W);
  const maxY = Math.max(0, bounds.h - CARD_H);
  const setCarrying = (on: boolean) => {
    carrying.current = on;
  };
  const finish = (fx: number, fy: number) => {
    setCarrying(false);
    onDrop(fx, fy);
  };
  const pan = Gesture.Pan()
    .activateAfterLongPress(300)
    .onStart(() => {
      sx.value = x.value;
      sy.value = y.value;
      lift.value = withTiming(1, { duration: 140, easing: Easing.out(Easing.quad) });
      runOnJS(setCarrying)(true);
      runOnJS(hapticPickUp)();
    })
    .onUpdate((e) => {
      x.value = Math.min(maxX, Math.max(0, sx.value + e.translationX / zoom.value));
      y.value = Math.min(maxY, Math.max(0, sy.value + e.translationY / zoom.value));
      runOnJS(onMove)(x.value, y.value);
    })
    .onEnd((e) => {
      lift.value = withTiming(0, { duration: 180, easing: Easing.out(Easing.quad) });
      // Held and let go without moving: the card's menu (hold = menu, hold and drag = carry, as everywhere).
      if (Math.abs(e.translationX) < 6 && Math.abs(e.translationY) < 6) {
        runOnJS(setCarrying)(false);
        runOnJS(hapticSnapTick)();
        runOnJS(onHold)();
        return;
      }
      // A glide of a few points with the hand's speed, then rest; where it rests is where it is kept.
      // ONE calm move to where it will be kept, no swing (2026-10-15, the user: «інерція хитання нереалістична і
      // гіперболізована» - a glide and then a spring back to the kept place made a double move with an overshoot).
      const gx = Math.min(maxX, Math.max(0, x.value + (e.velocityX * 0.06) / zoom.value));
      const gy = Math.min(maxY, Math.max(0, y.value + (e.velocityY * 0.06) / zoom.value));
      x.value = withTiming(gx, { duration: 220, easing: Easing.out(Easing.cubic) });
      y.value = withTiming(gy, { duration: 220, easing: Easing.out(Easing.cubic) });
      runOnJS(finish)(gx, gy);
    });
  const tap = Gesture.Tap().onEnd((_e, ok) => {
    if (ok) runOnJS(onOpen)();
  });
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: 1 + lift.value * 0.05 }],
    zIndex: lift.value > 0.01 ? 10 : 1,
  }));
  const src = thought.source;
  const title = cardTitle(thought);
  return (
    <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
      <Animated.View
        style={[
          styles.card,
          { backgroundColor: thought.ai ? '#FFFBF5' : S.card },
          // The ring is always there, only coloured when picked: a border that came and went changed the card's
          // layout, and Android left its text unpainted afterwards (cards went blank, 2026-10-15).
          { borderColor: picked ? '#D9793F' : 'transparent' },
          style,
        ]}
      >
        {!!thought.ai && (
          <View style={styles.aiRow}>
            <Ionicons name={'sparkles-outline' as never} size={12} color="#B07A44" />
            <Text style={styles.aiLabel}>{thought.ai === 'summary' ? 'Резюме' : 'Відповідь'}</Text>
          </View>
        )}
        {thought.aiState === 'pending' ? (
          <Text style={[styles.cardFelt, { color: '#B07A44', fontStyle: 'normal' }]}>{thought.ai === 'summary' ? 'Пишу резюме…' : 'Думаю над питанням…'}</Text>
        ) : thought.aiState === 'error' ? (
          <Text style={[styles.cardFelt, { color: '#B4533C', fontStyle: 'normal' }]} numberOfLines={3}>
            {`Не вдалося: ${thought.aiError ?? ''}`}
          </Text>
        ) : null}
        {!thought.aiState && (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {src?.kind === 'link' && src.imageUrl ? <Image source={{ uri: src.imageUrl }} style={styles.cardThumb} resizeMode="cover" /> : null}
          {!!thought.images?.length && !(src?.kind === 'link' && src.imageUrl) && (
            // A THOUGHT WITH PICTURES shows the first one, and how many more lie behind it.
            <View style={styles.cardThumb}>
              <AttachmentImage uri={thought.images[0].uri} driveFileId={thought.images[0].driveFileId} style={styles.cardThumbImage} />
              {thought.images.length > 1 && (
                <View style={styles.cardMore}>
                  <Text style={styles.cardMoreText}>{`+${thought.images.length - 1}`}</Text>
                </View>
              )}
            </View>
          )}
          <Text style={[styles.cardTitle, { color: S.ink }]} numberOfLines={(src?.kind === 'link' && src.imageUrl) || thought.images?.length ? 3 : title ? 2 : 4}>
            {thought.ai === 'summary' ? thought.felt : title || thought.felt || (thought.images?.length ? (thought.images.length === 1 ? 'Зображення' : `${thought.images.length} зображень`) : '')}
          </Text>
        </View>
        )}
        {!thought.aiState && !!thought.felt && !!title && thought.ai !== 'summary' && (
          <Text style={[styles.cardFelt, { color: thought.ai ? S.ink2 : accent, fontStyle: thought.ai ? 'normal' : 'italic' }]} numberOfLines={thought.ai ? 3 : 2}>
            {thought.ai ? thought.felt : `«${thought.felt}»`}
          </Text>
        )}
        {/* In a browser a tap waiting on «hold to carry» never fires (the Mac, 2026-10-16): a plain click opens it there,
            a right click is the hold's menu. Over the card's content, under nothing. */}
        {Platform.OS === 'web' && (
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onOpen}
            {...({ onContextMenu: (e: { preventDefault: () => void }) => {
              e.preventDefault();
              onHold();
            } } as object)}
          />
        )}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', left: 20, right: 20, height: TOP_NAV_H, borderRadius: TOP_NAV_H / 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 20 },
  capsuleSlot: { position: 'absolute', left: 6, top: (TOP_NAV_H - CAPSULE_H) / 2 },
  barDot: { width: 12, height: 12, borderRadius: 6 },
  barTitle: { fontSize: 17, fontFamily: SOFT_SEMIBOLD, letterSpacing: -0.2, flexShrink: 1 },
  conclusion: { position: 'absolute', left: 20, right: 20, borderRadius: 20, backgroundColor: '#1E1E1C', paddingHorizontal: 16, paddingVertical: 12, minHeight: 92 },
  conclusionLabel: { fontSize: 11.5, fontFamily: SOFT_BOLD, letterSpacing: 0.5, textTransform: 'uppercase', color: '#B9B7B0' },
  conclusionText: { fontSize: 15, lineHeight: 21, fontFamily: SOFT_REGULAR, color: '#F1F0EC', marginTop: 4 },
  conclusionInput: { flex: 1, fontSize: 16, lineHeight: 23, fontFamily: SOFT_REGULAR, color: '#F1F0EC', marginTop: 4, padding: 0, textAlignVertical: 'top' },
  area: { position: 'absolute', left: 12 },
  card: { position: 'absolute', left: 0, top: 0, boxShadow: '0px 1px 2px rgba(30,30,28,0.08), 0px 8px 18px -12px rgba(30,30,28,0.3)', width: CARD_W, minHeight: CARD_H - 20, maxHeight: CARD_H, borderRadius: 16, borderWidth: 2.5, padding: 8, gap: 5, overflow: 'hidden' },
  cardThumb: { width: 38, height: 52, borderRadius: 7 },
  cardThumbImage: { width: 38, height: 52, borderRadius: 7 },
  cardMore: { position: 'absolute', right: 2, bottom: 2, paddingHorizontal: 4, height: 15, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  cardMoreText: { color: '#fff', fontSize: 10, fontFamily: SOFT_BOLD },
  cardTitle: { flex: 1, fontSize: 13, lineHeight: 17, fontFamily: SOFT_SEMIBOLD },
  cardFelt: { fontSize: 12, lineHeight: 16, fontFamily: SOFT_MEDIUM, fontStyle: 'italic' },
  empty: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 14, fontFamily: SOFT_SEMIBOLD },
  aiRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  aiLabel: { fontSize: 10.5, fontFamily: SOFT_BOLD, color: '#B07A44', letterSpacing: 0.4, textTransform: 'uppercase' },
  pickBar: { position: 'absolute', left: 14, right: 14, height: 60, borderRadius: 30, backgroundColor: '#1E1E1C', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, boxShadow: '0px 14px 30px -14px rgba(30,30,28,0.5)' },
  pickRound: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#3A3936', alignItems: 'center', justifyContent: 'center' },
  pickCount: { paddingHorizontal: 10, height: 44, justifyContent: 'center' },
  pickCountText: { color: '#fff', fontSize: 14, fontFamily: SOFT_SEMIBOLD },
  pickMain: { height: 44, borderRadius: 22, paddingHorizontal: 16, justifyContent: 'center' },
  pickMainText: { color: '#fff', fontSize: 14, fontFamily: SOFT_BOLD },
  dockRound: { position: 'absolute', width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
});
