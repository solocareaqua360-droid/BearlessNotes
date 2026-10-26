import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BackHandler, Image, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions, type GestureResponderEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { GlassPortal } from '../GlassPortal';
import Sheet from '../surfaces/Sheet';
import { ask, confirm } from '../surfaces/Ask';
import RenamePrompt from '../RenamePrompt';
import { Ionicons } from '../icons/Ionicons';
import { useSoft } from '../../theme/soft';
import { SOFT_BOLD, SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../../utils/fonts';
import { formatAddedOn } from '../../utils/documentPreview';
import { deleteTheme, deleteThought, hueOf, moveThought, renameTheme, type Thought, type ThoughtTheme } from '../../hooks/useThoughts';
import { Cloud, cloudDiameter, layoutClouds } from './ThemeClouds';
import { DOCK_BOTTOM } from '../../navigation/dockGeometry';
import { readable } from './ThoughtCapture';
import ThemeCanvas from './ThemeCanvas';
import LiveSurface from './LiveSurface';
import ThoughtsNetwork from './ThoughtsNetwork';
import ThoughtView from './ThoughtView';
import { speakThoughts } from '../../utils/thoughtVoice';
import { cardTitle, voiceTextOf } from './thoughtText';
import { CAPSULE_H, CAPSULE_W, VoiceCapsule, useVoiceCapsuleOn } from './VoicePlayer';
import { TOP_NAV_H } from '../TopNavBar';
import { CHROME_TOP } from '../../constants/rail';

// THE SPACE OF THEMES (2026-10-15, sketch 3, liked: «воно плаває, десь щось об'єднане»). Every theme a cloud - bigger
// for more thoughts, faded when it has not been touched for three weeks; the thoughts not laid out yet are a grey
// cloud of their own. A tap opens the theme: for now the list of what is in it (its own canvas is the next step).

const LOOSE = '__loose__';

// Two lenses over the same themes (2026-10-27): the clouds, and the network of neurons (ThoughtsNetwork - Skia, so
// the phone only for now). The last one chosen is kept for the session; the clouds stay until the user says otherwise.
type Lens = 'clouds' | 'network';
let lastLens: Lens = Platform.OS === 'web' ? 'clouds' : 'network';

// The space over the phone's desk lives in the glass layer; on the Mac (frame B, 2026-10-19) it is a screen of the
// stack in the main column, so it draws where it is put, with no layer and no phone chrome.
function Shell({ inline, children }: { inline: boolean; children: ReactNode }) {
  return inline ? (
    <>{children}</>
  ) : (
    <GlassPortal priority={15} name="space">
      {children}
    </GlassPortal>
  );
}

// How long since a theme was touched, short enough for a cloud: «сьогодні», «вчора», «3 дні», «2 тижні», «місяць».
function agoLabel(at: number) {
  const days = Math.floor((Date.now() - at) / 86400000);
  if (days <= 0) return 'сьогодні';
  if (days === 1) return 'вчора';
  if (days < 7) return `${days} ${days < 5 ? 'дні' : 'днів'}`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return weeks === 1 ? 'тиждень' : `${weeks} тижні`;
  const months = Math.floor(days / 30);
  return months <= 1 ? 'місяць' : `${months} міс.`;
}
const LOOSE_LOOK = { from: '#F1EFEA', to: '#E4E1D9', ink: '#5C5B56', sub: '#7A7871' };

export default function ThoughtsSpace({
  visible,
  themes,
  thoughts,
  countOf,
  onCatch,
  onClose,
  inline = false,
}: {
  visible: boolean;
  // Drawn in place (a screen of its own) instead of over everything: the Mac's frame B.
  inline?: boolean;
  themes: ThoughtTheme[];
  thoughts: Thought[];
  countOf: (id: string | null) => number;
  onCatch: (themeId?: string) => void;
  onClose: () => void;
}) {
  const S = useSoft();
  const insets = useSafeAreaInsets();
  // The voice player's capsule on the left edge of this window's own bar, as on every bar (VoicePlayer.tsx).
  const capsuleOn = useVoiceCapsuleOn();
  const win = useWindowDimensions();
  // In place, the space is as big as the column it is in, not the window.
  const [box, setBox] = useState({ w: 0, h: 0 });
  const W = inline ? box.w : win.width;
  const H = inline ? box.h : win.height;
  const [openId, setOpenId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<ThoughtTheme | null>(null);
  // The theme whose canvas is open (sketch 4); the loose thoughts keep their list.
  const [canvasId, setCanvasId] = useState<string | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [lens, setLensState] = useState<Lens>(lastLens);
  const setLens = (l: Lens) => {
    lastLens = l;
    setLensState(l);
  };
  const sky = lens === 'network' && !inline;
  const shown = useSharedValue(0);

  useEffect(() => {
    if (!visible) return;
    setOpenId(null);
    setCanvasId(null);
    shown.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  // Back: the canvas has its own (registered later, so it is asked first); the space closes when none is open.
  useEffect(() => {
    if (!visible || canvasId !== null) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, canvasId]);

  const close = () => {
    shown.value = withTiming(0, { duration: 200 });
    setTimeout(onClose, 210);
  };

  const top = inline ? INLINE_TOP : insets.top + 90;
  const areaH = Math.max(0, inline ? H - top - 80 : H - top - insets.bottom - 110);
  const loose = countOf(null);
  const places = useMemo(
    () =>
      layoutClouds(
        [...themes.map((t) => ({ id: t.id, d: cloudDiameter(countOf(t.id)) })), ...(loose > 0 ? [{ id: LOOSE, d: cloudDiameter(loose) - 10 }] : [])],
        W - 24,
        areaH
      ).map((p) => ({ ...p, x: p.x + 12 })),
    [themes, countOf, loose, W, areaH]
  );

  // The last thought moved or deleted out of the open theme: its window goes too, rather than saying «0 думок».
  const openCount = openId === null ? -1 : thoughts.filter((t) => (openId === LOOSE ? t.themeId === null : t.themeId === openId)).length;
  useEffect(() => {
    if (openCount === 0) setOpenId(null);
  }, [openCount]);

  // A tap, in the surface's own points (it may be moved and zoomed).
  const hitLocal = (x: number, y: number) => places.find((p) => Math.hypot(p.x - x, p.y - y) <= p.d / 2 + 10) ?? null;
  // Where a press landed, in the surface's own points. The phone reports it (locationX); a browser's locationX is
  // relative to whatever node was under the pointer, so there it is worked out from the pressed area's own box
  // (2026-10-16, the Mac: a click on a theme opened nothing).
  const pressAt = (e: GestureResponderEvent) => {
    if (Platform.OS !== 'web') return hitLocal(e.nativeEvent.locationX, e.nativeEvent.locationY);
    const target = e.currentTarget as unknown as { getBoundingClientRect?: () => { left: number; top: number; width: number; height: number } };
    const r = target.getBoundingClientRect?.();
    const ne = e.nativeEvent as unknown as { clientX?: number; clientY?: number; pageX: number; pageY: number };
    if (!r || !r.width || !r.height) return null;
    return hitLocal((((ne.clientX ?? ne.pageX) - r.left) * W) / r.width, (((ne.clientY ?? ne.pageY) - r.top) * areaH) / r.height);
  };

  const look = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ scale: 0.97 + shown.value * 0.03 }] }));

  if (!visible) return null;
  const openTheme = openId === LOOSE ? null : themes.find((t) => t.id === openId) ?? null;
  const inOpen = openId === null ? [] : thoughts.filter((t) => (openId === LOOSE ? t.themeId === null : t.themeId === openId));
  const word = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'думка' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'думки' : 'думок');

  return (
    <Shell inline={inline}>
      <Animated.View
        onLayout={inline ? (e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height }) : undefined}
        style={[StyleSheet.absoluteFill, { backgroundColor: sky ? '#05060B' : S.bg === 'transparent' ? '#F6F5F2' : S.bg }, look]}
      >
        {sky && (
          <ThoughtsNetwork width={W} height={H} top={insets.top + CHROME_TOP + TOP_NAV_H} themes={themes} thoughts={thoughts} onOpen={setReading} />
        )}
        {inline ? (
          <View style={styles.inlineHead}>
            <Text style={[styles.inlineTitle, { color: S.ink }]}>Думки</Text>
            <Text style={[styles.inlineHint, { color: S.ink3 }]}>
              {themes.length === 0 && loose === 0 ? 'Тут житимуть твої теми' : 'Більша — більше думок · бліда — давно не чіпав'}
            </Text>
          </View>
        ) : (
          <>
        {/* The app's own chrome, as everywhere (2026-10-15, the user: «там, де зараз плюс, зазвичай кнопка назад»):
            a title pill on top with no back in it, and at the foot the desk dock's right pair - «+» and, right of it,
            the round back. Same sizes and places as DeskDock (48 each, 12 apart, 20 from the edge). */}
        <View style={[styles.bar, { top: insets.top + CHROME_TOP, backgroundColor: S.card, boxShadow: S.popShadow }, capsuleOn && { paddingHorizontal: CAPSULE_W + 16 }]}>
          {capsuleOn && (
            <View style={styles.capsuleSlot}>
              <VoiceCapsule />
            </View>
          )}
          <Text style={[styles.barTitle, { color: S.ink }]}>Думки</Text>
        </View>
        {!sky && (
        <Text style={[styles.hint, { top: insets.top + 60, color: S.ink3 }]}>
          {themes.length === 0 && loose === 0 ? 'Тут житимуть твої теми' : 'Більша — більше думок · бліда — давно не чіпав'}
        </Text>
        )}
          </>
        )}

        {!sky && (
        <View style={[styles.area, { top, height: areaH }]}>
          {/* Moved by a finger, zoomed by two - never off where the themes are (LiveSurface). */}
          <LiveSurface width={W} height={areaH}>
          {places.map((p, i) => {
            if (p.id === LOOSE) return <Cloud key={p.id} place={p} look={LOOSE_LOOK} label="Не розкладено" sub={`${loose}`} beat={i} />;
            const t = themes.find((x) => x.id === p.id)!;
            return (
              <Cloud
                key={p.id}
                place={p}
                look={hueOf(t, S.dark)}
                label={t.name}
                sub={`${countOf(t.id)} · ${agoLabel(t.touchedAt)}`}
                beat={i}
                faded={Date.now() - t.touchedAt > 21 * 86400000}
              />
            );
          })}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={(e) => {
              const hit = pressAt(e);
              if (!hit) return;
              if (hit.id === LOOSE) setOpenId(LOOSE);
              else setCanvasId(hit.id);
            }}
            // A HELD THEME: rename it, or delete it - its thoughts are kept, not laid out yet.
            onLongPress={async (e) => {
              const hit = pressAt(e);
              const theme = hit ? themes.find((t) => t.id === hit.id) : undefined;
              if (!theme) return;
              const choice = await ask({
                title: theme.name,
                actions: [
                  { id: 'rename', label: 'Перейменувати', icon: 'pencil-outline' },
                  { id: 'delete', label: 'Видалити тему', icon: 'trash-outline', tone: 'danger' },
                ],
              });
              if (choice === 'rename') setRenaming(theme);
              else if (choice === 'delete') {
                const mine = thoughts.filter((t) => t.themeId === theme.id).map((t) => t.id);
                const yes = await confirm({
                  title: `Видалити тему «${theme.name}»?`,
                  message: mine.length ? `${mine.length} ${word(mine.length)} ${mine.length === 1 ? 'лишиться' : 'лишаться'} в «Не розкладено».` : 'Тема порожня.',
                  confirmLabel: 'Видалити',
                });
                if (yes) await deleteTheme(theme.id, mine).catch(() => {});
              }
            }}
            delayLongPress={400}
          />
          </LiveSurface>
        </View>
        )}

        {/* The lens switch: left of the dock's pair, where the desk dock keeps its own left bead. */}
        {Platform.OS !== 'web' && !inline && (
          <Pressable
            onPress={() => setLens(sky ? 'clouds' : 'network')}
            accessibilityLabel={sky ? 'Хмари' : 'Мережа думок'}
            style={[styles.dockRound, { left: 20, bottom: insets.bottom + DOCK_BOTTOM + 4, backgroundColor: S.card, boxShadow: S.popShadow }]}
          >
            <Ionicons name={(sky ? 'lc:cloud' : 'lc:share-2') as never} size={21} color={S.ink} />
          </Pressable>
        )}

        <Pressable
          onPress={() => onCatch()}
          accessibilityLabel="Нова думка"
          style={[styles.dockRound, inline ? { right: 20, bottom: 20 } : { right: 20 + 48 + 12, bottom: insets.bottom + DOCK_BOTTOM + 4 }, { backgroundColor: S.ink }]}
        >
          <Ionicons name={'add' as never} size={26} color={S.card} />
        </Pressable>
        {/* The round back is the phone's; a screen in the Mac's stack is a section, and a section has no «Назад». */}
        {!inline && (
        <Pressable
          onPress={close}
          accessibilityLabel="Назад"
          style={[styles.dockRound, { right: 20, bottom: insets.bottom + DOCK_BOTTOM + 4, backgroundColor: S.card, boxShadow: S.popShadow }]}
        >
          <Ionicons name={'chevron-back' as never} size={22} color={S.ink} />
        </Pressable>
        )}
      </Animated.View>

      <Sheet
        priority={25}
        visible={openId !== null}
        onClose={() => setOpenId(null)}
        title={openId === LOOSE ? 'Не розкладено' : openTheme?.name ?? ''}
        subtitle={`${inOpen.length} ${word(inOpen.length)}`}
        scroll
        maxHeight="78%"
      >
        <View style={{ gap: 10, paddingBottom: 8 }}>
          {inOpen.map((t) => {
            const src = t.source;
            const title = src?.kind === 'link' ? src.title || src.siteName || src.url : src?.kind === 'text' ? readable(src.text) : '';
            return (
              <Pressable
                key={t.id}
                onPress={() => setReading(t.id)}
                onLongPress={async () => {
                  const choice = await ask({
                    title: (title || t.felt || 'Думка').slice(0, 60),
                    actions: [
                      ...themes.filter((x) => x.id !== t.themeId).map((x) => ({ id: `to:${x.id}`, label: `У «${x.name}»`, icon: 'arrow-forward-outline' as const })),
                      ...(t.themeId ? [{ id: `to:${LOOSE}`, label: 'У «Не розкладено»', icon: 'arrow-forward-outline' as const }] : []),
                      { id: 'delete', label: 'Видалити думку', icon: 'trash-outline' as const, tone: 'danger' as const },
                    ],
                  });
                  if (choice === 'delete') {
                    const yes = await confirm({ title: 'Видалити думку?', message: 'Її не можна буде повернути.', confirmLabel: 'Видалити' });
                    if (yes) await deleteThought(t.id).catch(() => {});
                    return;
                  }
                  if (!choice.startsWith('to:')) return;
                  const to = choice.slice(3);
                  await moveThought(t.id, to === LOOSE ? null : to).catch(() => {});
                }}
                delayLongPress={350}
                style={[styles.row, { backgroundColor: S.card, boxShadow: S.shadow }]}
              >
                {src?.kind === 'link' && src.imageUrl ? (
                  <Image source={{ uri: src.imageUrl }} style={styles.thumb} resizeMode="cover" />
                ) : (
                  <View style={[styles.thumb, { backgroundColor: S.fill, alignItems: 'center', justifyContent: 'center' }]}>
                    <Ionicons name={(src?.kind === 'link' ? 'link-outline' : 'create-outline') as never} size={18} color={S.ink2} />
                  </View>
                )}
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  {!!title && (
                    <Text style={[styles.rowTitle, { color: S.ink }]} numberOfLines={2}>
                      {title}
                    </Text>
                  )}
                  {!!t.felt && (
                    <Text style={[styles.rowFelt, { color: openTheme ? hueOf(openTheme, S.dark).sub : S.ink2 }]} numberOfLines={3}>
                      {`«${t.felt}»`}
                    </Text>
                  )}
                  <Text style={[styles.rowWhen, { color: S.ink3 }]}>{formatAddedOn(t.createdAt, true)}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </Sheet>
      {canvasId !== null && themes.some((t) => t.id === canvasId) && (
        <ThemeCanvas
          theme={themes.find((t) => t.id === canvasId)!}
          thoughts={thoughts.filter((t) => t.themeId === canvasId)}
          themes={themes}
          onCatch={() => onCatch(canvasId)}
          onClose={() => setCanvasId(null)}
        />
      )}
      <ThoughtView
        thought={thoughts.find((t) => t.id === reading) ?? null}
        onListen={(t) => speakThoughts([{ title: cardTitle(t) || 'Думка', text: voiceTextOf(t), thoughtId: t.id }]).catch(() => {})}
        onClose={() => setReading(null)}
      />
      <RenamePrompt
        visible={renaming !== null}
        title="Назва теми"
        initialValue={renaming?.name ?? ''}
        onCancel={() => setRenaming(null)}
        onSave={(name) => {
          const theme = renaming;
          setRenaming(null);
          if (theme && name.trim()) renameTheme(theme.id, name).catch(() => {});
        }}
      />
    </Shell>
  );
}

// In place: a heading like the other screens' (title, then the hint), and the clouds under it.
const INLINE_TOP = 96;

const styles = StyleSheet.create({
  inlineHead: { position: 'absolute', left: 40, right: 40, top: 28, gap: 4 },
  inlineTitle: { fontSize: 26, fontFamily: SOFT_BOLD },
  inlineHint: { fontSize: 13, fontFamily: SOFT_MEDIUM },
  bar: { position: 'absolute', left: 20, right: 20, height: TOP_NAV_H, borderRadius: TOP_NAV_H / 2, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
  capsuleSlot: { position: 'absolute', left: 6, top: (TOP_NAV_H - CAPSULE_H) / 2 },
  barTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontFamily: SOFT_SEMIBOLD, letterSpacing: -0.2 },
  hint: { position: 'absolute', left: 24, right: 24, textAlign: 'center', fontSize: 13, fontFamily: SOFT_MEDIUM },
  area: { position: 'absolute', left: 0, right: 0 },
  dockRound: { position: 'absolute', width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', gap: 12, padding: 10, borderRadius: 18, alignItems: 'flex-start' },
  thumb: { width: 48, height: 64, borderRadius: 10, overflow: 'hidden' },
  rowTitle: { fontSize: 15, fontFamily: SOFT_SEMIBOLD },
  rowFelt: { fontSize: 14, lineHeight: 20, fontFamily: SOFT_REGULAR, fontStyle: 'italic' },
  rowWhen: { fontSize: 12, fontFamily: SOFT_MEDIUM },
});
