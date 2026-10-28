import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Image, Keyboard, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import TextInput from '../AppTextInput';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import * as Clipboard from 'expo-clipboard';
import { GlassPortal } from '../GlassPortal';
import StableTextInput from '../StableTextInput';
import { Ionicons } from '../icons/Ionicons';
import { useSoft } from '../../theme/soft';
import { useKeyboardRide } from '../../hooks/useKeyboardRide';
import { useKeyboardHeight } from '../../hooks/useKeyboardHeight';
import { hapticDrop, hapticPickUp, hapticSnapTick, hapticSuccess } from '../../utils/haptics';
import { SOFT_BOLD, SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../../utils/fonts';
import { createTheme, hueOf, saveThought, THEME_HUES, type ThoughtSource, type ThoughtTheme } from '../../hooks/useThoughts';
import { backupThoughtImages, clipboardHasImage, keepThoughtImage, pasteClipboardImage, pickThoughtImages } from '../../utils/thoughtImages';
import { Cloud, cloudDiameter, layoutClouds, type CloudPlace } from './ThemeClouds';
import FeelRow from './FeelRow';
import type { Feeling } from './feelings';

// CATCHING A THOUGHT (2026-10-15, the user's sketch corrections: «забагато кнопок і мало візуалу ... одна кнопка
// "Куди?", і переді мною з'являються мої хмарки, на яку тицьну - туди і додасться»). Two moments in one window:
//   write - what came in (a video, a link, a text) big, ONE field «Що зачепило?» with a mic, ONE button «Куди?»;
//   pick  - the screen darkens, the theme clouds drift over it, and the caught thing waits at the bottom: drag it onto
//           a cloud, or just tap one; the dashed cloud is a new theme.
// Nothing is lost: closing the window with anything in it keeps the thought, not laid out yet («спершу зберегти»).

const NEW_ID = '__new__';

// Markdown as it comes from a copied reply, made plain to read: bold/italic marks, heading hashes, list dashes.
export function readable(text: string) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|\s)\*(\S.*?)\*(?=\s|$)/g, '$1$2')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/`([^`]+)`/g, '$1');
}
const MAX_CLOUDS = 9;

export default function ThoughtCapture({
  visible,
  source: given,
  images: givenImages,
  themes,
  countOf,
  onElsewhere,
  themeId,
  onClose,
}: {
  visible: boolean;
  source?: ThoughtSource;
  // Pictures it arrives with (a share of photos, a photo alone).
  images?: string[];
  themes: ThoughtTheme[];
  countOf: (id: string | null) => number;
  onElsewhere?: () => void;
  themeId?: string;
  onClose: () => void;
}) {
  const S = useSoft();
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const keyboard = useKeyboardRide();
  const kb = useKeyboardHeight();
  const [felt, setFelt] = useState('');
  const [feel, setFeel] = useState<Feeling | null>(null);
  const [stage, setStage] = useState<'write' | 'pick' | 'name'>('write');
  const [newName, setNewName] = useState('');
  const [listening, setListening] = useState(false);
  const [pulseId, setPulseId] = useState<string | null>(null);
  const committed = useRef('');
  const saving = useRef(false);
  // WHAT IS CAUGHT: what the share sheet brought, or - a copied reply of Claude, which has no «Поділитися» for one
  // message (2026-10-15) - the clipboard, taken in by one tap on «Вставити скопійоване». Only WHETHER the clipboard
  // holds text is asked on opening; it is read when tapped, so Android does not announce a read every time.
  const [pasted, setPasted] = useState<ThoughtSource | undefined>(undefined);
  const [canPaste, setCanPaste] = useState(false);
  const source = given ?? pasted;
  // THE PICTURES: any number, from the share sheet, the gallery or the clipboard; kept into the app's folder when saved.
  const [images, setImages] = useState<string[]>([]);
  const [canPasteImage, setCanPasteImage] = useState(false);

  const shown = useSharedValue(0);
  const pick = useSharedValue(0);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const sc = useSharedValue(1);
  const op = useSharedValue(1);
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (!visible) return;
    setFelt('');
    setFeel(null);
    setStage('write');
    setNewName('');
    setPulseId(null);
    committed.current = '';
    saving.current = false;
    tx.value = 0;
    ty.value = 0;
    sc.value = 1;
    op.value = 1;
    pick.value = 0;
    setPasted(undefined);
    setCanPaste(false);
    setImages(givenImages ?? []);
    setCanPasteImage(false);
    if (!given) Clipboard.hasStringAsync().then(setCanPaste).catch(() => {});
    clipboardHasImage().then(setCanPasteImage);
    shown.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const hasSomething = !!source || images.length > 0 || felt.trim().length > 0;
  const preset = themeId ? themes.find((t) => t.id === themeId) : undefined;

  // THE CLOUDS TO PICK FROM: the most recently touched themes, and the dashed «new» one. Laid out in the space above
  // the waiting card.
  const cardH = 92;
  const areaTop = insets.top + 64;
  const areaH = Math.max(260, H - areaTop - insets.bottom - cardH - 56);
  const shownThemes = useMemo(() => [...themes].sort((a, b) => b.touchedAt - a.touchedAt).slice(0, MAX_CLOUDS), [themes]);
  const places = useMemo<CloudPlace[]>(
    () =>
      layoutClouds(
        [...shownThemes.map((t) => ({ id: t.id, d: cloudDiameter(countOf(t.id)) })), { id: NEW_ID, d: 96 }],
        W - 24,
        areaH
      ).map((p) => ({ ...p, x: p.x + 12 })),
    [shownThemes, countOf, W, areaH]
  );

  const hitAt = (x: number, y: number) => {
    const local = y - areaTop;
    return places.find((p) => Math.hypot(p.x - x, p.y - local) <= p.d / 2 + 14) ?? null;
  };

  // DICTATION - the chat's own way (CaptureWindow): Ukrainian, continuous, words appearing while they are said.
  const stopListening = useCallback(() => {
    ExpoSpeechRecognitionModule.stop();
    setListening(false);
  }, []);
  const startListening = useCallback(async () => {
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) return;
    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) return;
    committed.current = felt;
    ExpoSpeechRecognitionModule.start({ lang: 'uk-UA', interimResults: true, continuous: true, addsPunctuation: true });
    setListening(true);
  }, [felt]);
  useSpeechRecognitionEvent('result', (event) => {
    if (!visible) return;
    const heard = event.results?.[0]?.transcript ?? '';
    const before = committed.current;
    const merged = before ? `${before} ${heard}`.replace(/\s+/g, ' ') : heard;
    setFelt(merged);
    if (event.isFinal) committed.current = merged;
  });
  useSpeechRecognitionEvent('end', () => setListening(false));

  const finish = useCallback(
    async (themeId: string | null) => {
      if (saving.current) return;
      saving.current = true;
      if (listening) stopListening();
      try {
        if (source || images.length || felt.trim()) {
          // The pictures first into the app's own folder (a picker's address does not live long), then the thought.
          const kept = await Promise.all(images.map((u) => keepThoughtImage(u).catch(() => u)));
          const mine = kept.map((uri) => ({ uri }));
          const id = await saveThought({ felt, feel, source, images: mine, themeId });
          if (mine.length) backupThoughtImages(id, mine).catch(() => {});
        }
      } catch {
        // Kept offline by Firestore's own queue; a failure here is the rare case of no account at all.
      }
      shown.value = withTiming(0, { duration: 200 });
      setTimeout(onClose, 210);
    },
    [felt, feel, source, images, listening, stopListening, onClose, shown]
  );

  // Closing: anything caught is kept, not laid out yet.
  const close = useCallback(() => {
    Keyboard.dismiss();
    if (stage === 'pick') {
      pick.value = withTiming(0, { duration: 220 });
      setStage('write');
      return;
    }
    if (stage === 'name') {
      setStage('pick');
      return;
    }
    if (hasSomething) finish(null);
    else {
      shown.value = withTiming(0, { duration: 180 });
      setTimeout(onClose, 190);
    }
  }, [stage, hasSomething, finish, onClose, pick, shown]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [visible, close]);

  const toPick = () => {
    if (!hasSomething) return;
    if (listening) stopListening();
    Keyboard.dismiss();
    setStage('pick');
    pick.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) });
  };

  // THE SWALLOW: the card flies into the cloud and shrinks away, the cloud gives a little pulse - then it is kept.
  const land = (place: CloudPlace, fromX: number, fromY: number) => {
    hapticDrop();
    const targetX = place.x - restX;
    const targetY = areaTop + place.y - restY;
    tx.value = withTiming(targetX, { duration: 300, easing: Easing.in(Easing.cubic) });
    ty.value = withTiming(targetY, { duration: 300, easing: Easing.in(Easing.cubic) });
    sc.value = withTiming(0.12, { duration: 300, easing: Easing.in(Easing.cubic) });
    op.value = withTiming(0, { duration: 320 });
    setPulseId(place.id);
    pulse.value = withSequence(withTiming(0, { duration: 260 }), withSpring(1, { damping: 8, stiffness: 260 }), withSpring(0, { damping: 14, stiffness: 180 }));
    if (place.id === NEW_ID) {
      setTimeout(() => {
        setStage('name');
        tx.value = 0;
        ty.value = 0;
        sc.value = withSpring(1);
        op.value = withTiming(1, { duration: 180 });
      }, 340);
      return;
    }
    setTimeout(() => {
      hapticSuccess();
      finish(place.id);
    }, 520);
  };

  const dropAt = (absX: number, absY: number, fromX: number, fromY: number) => {
    const hit = hitAt(absX, absY);
    if (hit) land(hit, fromX, fromY);
    else {
      tx.value = withSpring(0, { damping: 18, stiffness: 200 });
      ty.value = withSpring(0, { damping: 18, stiffness: 200 });
      sc.value = withSpring(1);
    }
  };

  // CARRYING (2026-10-15, the user: «велика картка закриває інші кружечки - як не промахнутися?»): the FINGER aims, not
  // the card. Picked up, the card shrinks to a small preview that rides a little ABOVE the finger, so nothing under the
  // finger is covered; the cloud under the finger swells and glows (with a tick), and a release off every cloud sends
  // the card home.
  const restX = W / 2;
  const restY = H - insets.bottom - 24 - cardH / 2;
  const hover = useSharedValue('');
  const placesSV = useSharedValue<{ id: string; x: number; y: number; r: number }[]>([]);
  useEffect(() => {
    placesSV.value = places.map((p) => ({ id: p.id, x: p.x, y: areaTop + p.y, r: p.d / 2 + 14 }));
  }, [places, areaTop, placesSV]);
  const tick = () => hapticSnapTick();
  const drag = Gesture.Pan()
    .onStart((e) => {
      sc.value = withSpring(0.42, { damping: 16, stiffness: 240 });
      tx.value = withSpring(e.absoluteX - restX, { damping: 18, stiffness: 300 });
      ty.value = withSpring(e.absoluteY - 70 - restY, { damping: 18, stiffness: 300 });
      runOnJS(hapticPickUp)();
    })
    .onUpdate((e) => {
      tx.value = e.absoluteX - restX;
      ty.value = e.absoluteY - 70 - restY;
      let found = '';
      const list = placesSV.value;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const ddx = p.x - e.absoluteX;
        const ddy = p.y - e.absoluteY;
        if (ddx * ddx + ddy * ddy <= p.r * p.r) {
          found = p.id;
          break;
        }
      }
      if (found !== hover.value) {
        hover.value = found;
        if (found) runOnJS(tick)();
      }
    })
    .onEnd((e) => {
      hover.value = '';
      runOnJS(dropAt)(e.absoluteX, e.absoluteY, e.absoluteX - restX, e.absoluteY - 70 - restY);
    });

  const makeTheme = async () => {
    const name = newName.trim();
    if (!name) return;
    Keyboard.dismiss();
    try {
      const id = await createTheme(name, themes.length % THEME_HUES.length);
      hapticSuccess();
      await finish(id);
    } catch {
      finish(null);
    }
  };

  const backdrop = useAnimatedStyle(() => ({
    opacity: shown.value,
    backgroundColor: pick.value > 0.5 ? 'rgba(26,25,23,0.96)' : 'rgba(237,235,230,0.92)',
  }));
  const writeCard = useAnimatedStyle(() => ({
    opacity: shown.value * (1 - pick.value),
    transform: [{ translateY: (1 - shown.value) * 40 + Math.min(0, keyboard.height.value) + pick.value * 60 }],
  }));
  const pickLayer = useAnimatedStyle(() => ({ opacity: pick.value }));
  const held = useAnimatedStyle(() => ({
    opacity: op.value,
    transform: [{ translateX: tx.value }, { translateY: ty.value + (1 - pick.value) * 80 }, { scale: sc.value }],
  }));

  if (!visible) return null;

  const title = source?.kind === 'link' ? source.title || source.siteName || source.url : undefined;
  const image = source?.kind === 'link' ? source.imageUrl : undefined;
  const bigPreview = kb > 0 ? 110 : 230;

  return (
    <GlassPortal priority={20} name="capture">
      <Animated.View style={[StyleSheet.absoluteFill, backdrop]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Закрити" />
      </Animated.View>

      {/* WRITE */}
      {stage === 'write' && (
        <Animated.View style={[styles.writeCard, { bottom: insets.bottom + 14, backgroundColor: S.card, boxShadow: S.popShadow }, writeCard]}>
          {source?.kind === 'link' && (
            <View style={[styles.preview, { height: image ? bigPreview : undefined, backgroundColor: image ? '#2A2A2E' : S.fill }]}>
              {!!image && <Image source={{ uri: image }} style={StyleSheet.absoluteFill} resizeMode="cover" />}
              {!!image && <View style={[StyleSheet.absoluteFill, { experimental_backgroundImage: 'linear-gradient(180deg, rgba(0,0,0,0) 45%, rgba(0,0,0,0.55) 100%)' }]} />}
              <View style={image ? styles.previewTextOver : styles.previewTextPlain}>
                <Text style={[styles.previewTitle, { color: image ? '#fff' : S.ink }]} numberOfLines={2}>
                  {title}
                </Text>
                {!!source.siteName && <Text style={[styles.previewSite, { color: image ? 'rgba(255,255,255,0.8)' : S.ink3 }]}>{source.siteName}</Text>}
              </View>
            </View>
          )}
          {!source && canPaste && (
            <Pressable
              onPress={async () => {
                const text = (await Clipboard.getStringAsync().catch(() => '')).trim();
                if (text) setPasted({ kind: 'text', text });
                setCanPaste(false);
              }}
              style={[styles.pasteChip, { backgroundColor: S.fill }]}
            >
              <Ionicons name={'clipboard-outline' as never} size={18} color={S.ink2} />
              <Text style={[styles.pasteText, { color: S.ink }]}>Вставити скопійоване</Text>
            </Pressable>
          )}
          {source?.kind === 'text' && (
            // A COPIED TEXT CAN BE LONG (a whole reply of Claude): it is the thing caught, not the field - shown in its
            // own box that scrolls, the Markdown marks (**, list dashes) taken off for reading; kept as it came.
            <ScrollView
              style={[styles.quote, { backgroundColor: S.fill, maxHeight: kb > 0 ? 96 : Math.round(H * 0.34) }]}
              contentContainerStyle={{ padding: 14 }}
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
            >
              <Text style={[styles.quoteText, { color: S.ink }]}>{readable(source.text)}</Text>
            </ScrollView>
          )}
          {/* THE PICTURES of this thought: a row of small squares, each with its ✕, and a «+» to add more (the gallery);
              what the clipboard holds as a picture can be taken in with one tap. */}
          <View style={styles.imagesRow}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 14, alignItems: 'center' }}>
              {images.map((uri) => (
                <View key={uri} style={styles.imageTile}>
                  <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                  <Pressable onPress={() => setImages((list) => list.filter((u) => u !== uri))} hitSlop={6} accessibilityLabel="Прибрати картинку" style={styles.imageX}>
                    <Ionicons name={'close' as never} size={12} color="#fff" />
                  </Pressable>
                </View>
              ))}
              <Pressable
                onPress={async () => {
                  const picked = await pickThoughtImages().catch(() => []);
                  if (picked.length) setImages((list) => [...list, ...picked.filter((u) => !list.includes(u))]);
                }}
                accessibilityLabel="Додати картинки"
                style={[styles.imageAdd, { backgroundColor: S.fill }]}
              >
                <Ionicons name={'image-outline' as never} size={20} color={S.ink2} />
                <Text style={[styles.imageAddText, { color: S.ink2 }]}>{images.length ? 'Ще' : 'Картинки'}</Text>
              </Pressable>
              {canPasteImage && (
                <Pressable
                  onPress={async () => {
                    const uri = await pasteClipboardImage();
                    if (uri) setImages((list) => [...list, uri]);
                    setCanPasteImage(false);
                  }}
                  accessibilityLabel="Вставити картинку з буфера"
                  style={[styles.imageAdd, { backgroundColor: S.fill }]}
                >
                  <Ionicons name={'clipboard-outline' as never} size={20} color={S.ink2} />
                  <Text style={[styles.imageAddText, { color: S.ink2 }]}>Вставити</Text>
                </Pressable>
              )}
            </ScrollView>
          </View>
          <View style={styles.writeBody}>
            <View style={styles.feltRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.feltLabel, { color: S.ink3 }]}>{source || images.length ? 'Що зачепило?' : 'Що в голові?'}</Text>
                <StableTextInput
                  value={felt}
                  onChangeText={setFelt}
                  placeholder={listening ? 'Слухаю…' : 'Скажи або напиши…'}
                  placeholderTextColor={S.ink3}
                  multiline
                  autoCorrect={false}
                  spellCheck={false}
                  style={[styles.feltInput, { color: S.ink }]}
                />
              </View>
              <Pressable
                onPress={listening ? stopListening : startListening}
                accessibilityLabel={listening ? 'Зупинити диктування' : 'Надиктувати'}
                style={[styles.mic, { backgroundColor: listening ? '#D9793F' : S.fill }]}
              >
                <Ionicons name={(listening ? 'stop' : 'mic-outline') as never} size={22} color={listening ? '#fff' : S.ink} />
              </Pressable>
            </View>
            <FeelRow value={feel} onChange={setFeel} />
            <Pressable
              onPress={() => {
                if (!hasSomething) return;
                if (preset) {
                  hapticSuccess();
                  finish(preset.id);
                } else toPick();
              }}
              disabled={!hasSomething}
              style={[styles.where, { backgroundColor: hasSomething ? S.ink : S.fill }]}
            >
              <Text style={[styles.whereText, { color: hasSomething ? S.card : S.ink3 }]} numberOfLines={1}>
                {preset ? `У «${preset.name}»` : 'Куди?'}
              </Text>
              <View style={styles.whereDots}>
                <View style={[styles.dot, { backgroundColor: THEME_HUES[0].to, width: 10, height: 10 }]} />
                <View style={[styles.dot, { backgroundColor: THEME_HUES[1].to, width: 13, height: 13, marginTop: -4 }]} />
                <View style={[styles.dot, { backgroundColor: THEME_HUES[3].to, width: 8, height: 8 }]} />
              </View>
            </Pressable>
            {!!onElsewhere && (
              <Pressable
                hitSlop={8}
                onPress={() => {
                  shown.value = withTiming(0, { duration: 160 });
                  setTimeout(() => {
                    onClose();
                    onElsewhere();
                  }, 170);
                }}
              >
                <Text style={[styles.elsewhere, { color: S.ink3 }]}>Інше місце…</Text>
              </Pressable>
            )}
          </View>
        </Animated.View>
      )}

      {/* PICK */}
      {stage !== 'write' && (
        <Animated.View style={[StyleSheet.absoluteFill, pickLayer]} pointerEvents="box-none">
          <Text style={[styles.pickHint, { top: insets.top + 24 }]}>{stage === 'name' ? 'Нова тема' : 'Торкнись хмаринки або перетягни'}</Text>
          <View style={[styles.area, { top: areaTop, height: areaH }]}>
            {places.map((p, i) => {
              if (p.id === NEW_ID) {
                return (
                  <Cloud
                    key={p.id}
                    place={p}
                    look={{ from: 'transparent', to: 'transparent', ink: '#D8D5CD', sub: '#B9B6AE' }}
                    label="+ Нова тема"
                    beat={i + 3}
                    dashed
                    hover={hover}
                    pulse={pulseId === p.id ? pulse : undefined}
                  />
                );
              }
              const t = shownThemes.find((x) => x.id === p.id)!;
              const n = countOf(t.id);
              return (
                <Cloud
                  key={p.id}
                  place={p}
                  look={hueOf(t, S.dark)}
                  label={t.name}
                  sub={`${n}`}
                  beat={i}
                  faded={Date.now() - t.touchedAt > 21 * 86400000}
                  hover={hover}
                  pulse={pulseId === p.id ? pulse : undefined}
                />
              );
            })}
            {stage === 'pick' && (
              <Pressable
                style={StyleSheet.absoluteFill}
                onPress={(e) => {
                  const hit = hitAt(e.nativeEvent.pageX, e.nativeEvent.pageY);
                  if (hit) land(hit, 0, 0);
                }}
              />
            )}
          </View>

          {stage === 'name' ? (
            <View style={[styles.nameCard, { bottom: Math.max(kb, insets.bottom) + 14, backgroundColor: S.card }]}>
              <TextInput
                value={newName}
                onChangeText={setNewName}
                placeholder="Назва теми"
                placeholderTextColor={S.ink3}
                autoFocus
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={makeTheme}
                style={[styles.nameInput, { color: S.ink }]}
              />
              <Pressable onPress={makeTheme} disabled={!newName.trim()} style={[styles.nameGo, { backgroundColor: newName.trim() ? S.ink : S.fill }]}>
                <Ionicons name={'checkmark' as never} size={22} color={newName.trim() ? S.card : S.ink3} />
              </Pressable>
            </View>
          ) : (
            <GestureDetector gesture={drag}>
              <Animated.View style={[styles.heldCard, { bottom: insets.bottom + 24, height: cardH, backgroundColor: S.card }, held]}>
                {image || images[0] ? (
                  <Image source={{ uri: (image ?? images[0]) as string }} style={styles.heldThumb} resizeMode="cover" />
                ) : (
                  <View style={[styles.heldThumb, { backgroundColor: S.fill, alignItems: 'center', justifyContent: 'center' }]}>
                    <Ionicons name={(source?.kind === 'link' ? 'link-outline' : 'create-outline') as never} size={20} color={S.ink2} />
                  </View>
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  {!!(title || source?.kind === 'text') && (
                    <Text style={[styles.heldTitle, { color: S.ink }]} numberOfLines={1}>
                      {title ?? (source?.kind === 'text' ? readable(source.text) : '')}
                    </Text>
                  )}
                  {!!felt.trim() && (
                    <Text style={[styles.heldFelt, { color: S.ink2 }]} numberOfLines={title || source ? 2 : 3}>
                      {felt.trim()}
                    </Text>
                  )}
                </View>
              </Animated.View>
            </GestureDetector>
          )}
        </Animated.View>
      )}
    </GlassPortal>
  );
}

const styles = StyleSheet.create({
  writeCard: { position: 'absolute', left: 12, right: 12, borderRadius: 30, overflow: 'hidden' },
  preview: { justifyContent: 'flex-end' },
  previewTextOver: { padding: 16 },
  previewTextPlain: { padding: 16, paddingBottom: 6 },
  previewTitle: { fontSize: 18, fontFamily: SOFT_BOLD },
  previewSite: { fontSize: 13, fontFamily: SOFT_MEDIUM, marginTop: 2 },
  imagesRow: { paddingTop: 12 },
  imageTile: { width: 64, height: 64, borderRadius: 14, overflow: 'hidden', backgroundColor: '#E4E1DA' },
  imageX: { position: 'absolute', right: 4, top: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  imageAdd: { height: 64, minWidth: 64, paddingHorizontal: 12, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 2 },
  imageAddText: { fontSize: 11.5, fontFamily: SOFT_SEMIBOLD },
  pasteChip: { margin: 14, marginBottom: 0, borderRadius: 18, height: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  pasteText: { fontSize: 15, fontFamily: SOFT_SEMIBOLD },
  quote: { margin: 14, marginBottom: 0, borderRadius: 18, flexGrow: 0 },
  quoteText: { fontSize: 15, lineHeight: 22, fontFamily: SOFT_REGULAR },
  writeBody: { padding: 16, paddingTop: 14, gap: 14 },
  feltRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  feltLabel: { fontSize: 11.5, fontFamily: SOFT_BOLD, letterSpacing: 0.5, textTransform: 'uppercase' },
  feltInput: { fontSize: 18, lineHeight: 25, fontFamily: SOFT_REGULAR, paddingVertical: 4, paddingHorizontal: 0, maxHeight: 150 },
  mic: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  where: { height: 56, borderRadius: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  whereText: { fontSize: 18, fontFamily: SOFT_BOLD },
  whereDots: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  dot: { borderRadius: 7 },
  elsewhere: { fontSize: 13, fontFamily: SOFT_SEMIBOLD, textAlign: 'center', marginTop: -2 },
  pickHint: { position: 'absolute', left: 0, right: 0, textAlign: 'center', color: '#D8D5CD', fontSize: 15, fontFamily: SOFT_SEMIBOLD },
  area: { position: 'absolute', left: 0, right: 0 },
  heldCard: { position: 'absolute', left: 16, right: 16, borderRadius: 22, padding: 10, flexDirection: 'row', gap: 12, alignItems: 'center', boxShadow: '0px 18px 40px -14px rgba(0,0,0,0.5)' },
  heldThumb: { width: 54, height: 72, borderRadius: 10, overflow: 'hidden' },
  heldTitle: { fontSize: 15, fontFamily: SOFT_BOLD },
  heldFelt: { fontSize: 13.5, lineHeight: 19, fontFamily: SOFT_REGULAR, marginTop: 2 },
  nameCard: { position: 'absolute', left: 16, right: 16, borderRadius: 24, padding: 8, paddingLeft: 18, flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameInput: { flex: 1, fontSize: 18, fontFamily: SOFT_SEMIBOLD, paddingVertical: 10 },
  nameGo: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
});
