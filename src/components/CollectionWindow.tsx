import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withDecay, withSpring } from 'react-native-reanimated';
import Sheet from './surfaces/Sheet';
import type { FlipFrom } from '../utils/flipOpen';
import AttachmentImage from './AttachmentImage';
import GeoMapView, { type GeoMapPoint } from './GeoMapView';
import { Ionicons } from './icons/Ionicons';
import { useSoft } from '../theme/soft';
import { SOFT_MEDIUM, SOFT_SEMIBOLD } from '../utils/fonts';
import type { FolderItem } from '../hooks/useAllFolderItems';

// A COLLECTION'S WINDOW (the user, 2026-10-14: «аналог ютуб-підбірки: згори велика картка, внизу всі інші»): one stage
// on top and the collection under it, the chosen one marked. Photos: the big photo; geo points: a map with every point.
// 2026-10-15, the user: «більше місця для перегляду за рахунок того, що постав в один ряд 3,5 іконки і зроби знизу
// карусель, і ще кнопка на весь екран і там вийти з нього» - the rest is ONE row under the stage that scrolls
// sideways (three and a half in view, so it is plain there is more), the stage takes the room the grid had, it is
// swiped through like the carousel, and a corner button opens it full screen, with its own button out.
export type CollectionKind = 'photo' | 'geo';

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
const GAP = 8;
const IN_VIEW = 3.5;

// ONE PAGE THAT ZOOMS (the user, 2026-10-15: «додай зум на зведенні-розведенні пальців»), as the iOS photos do: a pinch
// up to 5x, a double tap in and back out, a zoomed photo dragged with a fling that carries on and stops at the edge.
// The pan only takes the touch while zoomed in - at rest the finger belongs to the carousel's paging - and while zoomed
// the list does not page at all (onZoomed). Leaving the page puts it back to 1x.
function ZoomPage({
  item,
  w,
  h,
  active,
  onZoomed,
}: {
  item: FolderItem;
  w: number;
  h: number;
  active: boolean;
  onZoomed: (z: boolean) => void;
}) {
  const scale = useSharedValue(1);
  const saved = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  // No swing (the user: «занадто сильна інерція пружини... довго і сильно качається»): critically damped, no overshoot - as iOS zooms.
  const soft = { damping: 32, stiffness: 260, overshootClamping: true };
  useEffect(() => {
    if (active) return;
    scale.value = withSpring(1, soft);
    tx.value = withSpring(0, soft);
    ty.value = withSpring(0, soft);
    saved.value = 1;
  }, [active]);
  const report = (z: boolean) => onZoomed(z);
  // The point between the fingers stays under them (iOS): where the picture stood and how big, when the pinch began.
  const fx = useSharedValue(0);
  const fy = useSharedValue(0);
  const s0 = useSharedValue(1);
  const pinch = Gesture.Pinch()
    .onStart((e) => {
      fx.value = e.focalX - w / 2;
      fy.value = e.focalY - h / 2;
      s0.value = scale.value;
      startX.value = tx.value;
      startY.value = ty.value;
      runOnJS(report)(true);
    })
    .onUpdate((e) => {
      // Past the ends it gives, rather than stopping dead.
      const raw = saved.value * e.scale;
      const next = raw < 1 ? 1 - (1 - raw) * 0.35 : raw > 5 ? 5 + (raw - 5) * 0.2 : raw;
      scale.value = next;
      tx.value = fx.value - ((fx.value - startX.value) * next) / s0.value;
      ty.value = fy.value - ((fy.value - startY.value) * next) / s0.value;
    })
    .onEnd(() => {
      if (scale.value < 1.05) {
        scale.value = withSpring(1, soft);
        tx.value = withSpring(0, soft);
        ty.value = withSpring(0, soft);
        saved.value = 1;
        runOnJS(report)(false);
        return;
      }
      const s = Math.min(5, scale.value);
      scale.value = withSpring(s, soft);
      saved.value = s;
      const mx = (w * (s - 1)) / 2;
      const my = (h * (s - 1)) / 2;
      tx.value = withSpring(Math.min(mx, Math.max(-mx, tx.value)), soft);
      ty.value = withSpring(Math.min(my, Math.max(-my, ty.value)), soft);
    });
  const pan = Gesture.Pan()
    .manualActivation(true)
    .onTouchesMove((_e, state) => {
      if (saved.value > 1) state.activate();
      else state.fail();
    })
    .onStart(() => {
      startX.value = tx.value;
      startY.value = ty.value;
    })
    .onUpdate((e) => {
      tx.value = startX.value + e.translationX;
      ty.value = startY.value + e.translationY;
    })
    .onEnd((e) => {
      const mx = (w * (saved.value - 1)) / 2;
      const my = (h * (saved.value - 1)) / 2;
      tx.value = withDecay({
        velocity: e.velocityX,
        clamp: [-mx, mx],
        rubberBandEffect: true,
      });
      ty.value = withDecay({
        velocity: e.velocityY,
        clamp: [-my, my],
        rubberBandEffect: true,
      });
    });
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      if (saved.value > 1) {
        scale.value = withSpring(1, soft);
        tx.value = withSpring(0, soft);
        ty.value = withSpring(0, soft);
        saved.value = 1;
        runOnJS(report)(false);
      } else {
        // Into the place that was tapped, not the middle.
        const mx = (w * 1.5) / 2;
        const my = (h * 1.5) / 2;
        tx.value = withSpring(Math.min(mx, Math.max(-mx, -(e.x - w / 2) * 1.5)), soft);
        ty.value = withSpring(Math.min(my, Math.max(-my, -(e.y - h / 2) * 1.5)), soft);
        scale.value = withSpring(2.5, soft);
        saved.value = 2.5;
        runOnJS(report)(true);
      }
    });
  const look = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));
  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, doubleTap)}>
      <View style={{ width: w, height: h, overflow: 'hidden' }}>
        <Animated.View style={[StyleSheet.absoluteFill, look]}>
          {str(item.raw?.imageUri) ? (
            <AttachmentImage
              uri={String(item.raw?.imageUri)}
              driveFileId={str(item.raw?.driveFileId)}
              style={StyleSheet.absoluteFill}
              resizeMode="contain"
              resizeMethod="scale"
            />
          ) : null}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

export default function CollectionWindow({
  visible,
  kind,
  title,
  items,
  flipFrom,
  onClose,
}: {
  visible: boolean;
  kind: CollectionKind;
  title: string;
  items: FolderItem[];
  // Opened from a card that turns over (utils/flipOpen): the window comes round from it.
  flipFrom?: FlipFrom | null;
  onClose: () => void;
}) {
  const S = useSoft();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const [full, setFull] = useState(false);
  // While a photo is zoomed in, its list does not page.
  const [zoomed, setZoomed] = useState(false);
  useEffect(() => setZoomed(false), [full]);
  // The sheet's inner width - measured; until then the sheet's usual margins (16 + 20 a side).
  const [innerW, setInnerW] = useState(Math.min(width, 520) - 72);
  const stageList = useRef<FlatList<FolderItem>>(null);
  const strip = useRef<FlatList<FolderItem>>(null);
  useEffect(() => {
    if (!visible) {
      setIndex(0);
      setFull(false);
    }
  }, [visible]);
  const at = Math.min(index, Math.max(0, items.length - 1));
  const chosen = items[at];
  const colour = kind === 'photo' ? '#2FA073' : '#35A56A';
  const points = useMemo<GeoMapPoint[]>(
    () =>
      kind !== 'geo'
        ? []
        : items
            .map((i) => {
              const raw = (i.raw ?? {}) as Record<string, unknown>;
              const lat = num(raw.geoLat);
              const lng = num(raw.geoLng);
              return lat != null && lng != null ? { id: i.id, title: i.title, lat, lng } : null;
            })
            .filter((p): p is GeoMapPoint => !!p),
    [items, kind]
  );

  const cell = Math.floor((innerW - GAP * 3) / IN_VIEW);
  const cellH = kind === 'photo' ? cell + 14 : 64;
  // Everything the sheet holds besides the stage: the title row, the strip, the gaps and the sheet's own padding.
  const stageH = Math.max(
    200,
    Math.round(Math.min(height * 0.9, 760) - 52 - cellH - 12 - 60 - (kind === 'geo' ? 26 : 0))
  );

  // One choice, three places: the stage, the strip and the full screen all follow it.
  function choose(i: number, from: 'stage' | 'strip' | 'full') {
    if (i < 0 || i >= items.length) return;
    setZoomed(false);
    setIndex(i);
    if (from !== 'stage' && kind === 'photo')
      stageList.current?.scrollToIndex({
        index: i,
        animated: from === 'strip',
      });
    strip.current?.scrollToIndex({
      index: i,
      animated: true,
      viewPosition: 0.5,
    });
  }

  const photoPage =
    (w: number, h: number) =>
    ({ item, index: i }: { item: FolderItem; index: number }) => (
      <ZoomPage item={item} w={w} h={h} active={i === at} onZoomed={setZoomed} />
    );

  const pointCard = (item: FolderItem, i: number, w: number, from: 'strip' | 'full') => {
    const on = i === at;
    return (
      <Pressable
        onPress={() => choose(i, from)}
        style={[
          styles.pointCard,
          { width: w, height: 64, backgroundColor: on ? S.fill : S.card, boxShadow: S.shadow },
          on && { borderColor: colour, borderWidth: 2 },
        ]}
      >
        <Ionicons name={'location-outline' as never} size={16} color={colour} />
        <Text style={[styles.pointTitle, { color: S.ink }]} numberOfLines={2}>
          {item.title}
        </Text>
      </Pressable>
    );
  };
  // The points along the foot of the full-screen map - three and a half in view, as in the window.
  const fullCell = Math.floor((Math.min(width, 640) - 32 - GAP * 3) / IN_VIEW);

  const expandBtn = (
    <Pressable
      onPress={() => setFull(true)}
      hitSlop={10}
      accessibilityLabel="На весь екран"
      style={[
        styles.cornerBtn,
        kind === 'geo' && { top: 10, bottom: undefined },
        { backgroundColor: 'rgba(255,255,255,0.88)' },
      ]}
    >
      <Ionicons name={'expand-outline' as never} size={18} color="#1E1E1C" />
    </Pressable>
  );

  const header = (
    <View style={{ gap: 10 }} onLayout={(e) => setInnerW(Math.round(e.nativeEvent.layout.width))}>
      <View style={styles.titleRow}>
        <Ionicons name={(kind === 'photo' ? 'image-outline' : 'location-outline') as never} size={22} color={colour} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.winTitle, { color: S.ink }]} numberOfLines={1}>
            {title}
          </Text>
          <Text style={[styles.sub, { color: S.ink3 }]}>
            {items.length > 0 ? `${at + 1} з ${items.length}` : ''}
            {kind === 'photo' ? ' фото' : ' точок'}
          </Text>
        </View>
        <Pressable
          onPress={onClose}
          hitSlop={10}
          accessibilityLabel="Закрити"
          style={[styles.closeBtn, { backgroundColor: S.fill }]}
        >
          <Ionicons name={'close-outline' as never} size={22} color={S.ink} />
        </Pressable>
      </View>

      <View style={[styles.stage, { height: stageH, backgroundColor: S.fill }]}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          {kind === 'photo' ? (
            <FlatList
              ref={stageList}
              data={items}
              keyExtractor={(i) => i.id}
              horizontal
              pagingEnabled
              disableIntervalMomentum
              scrollEnabled={!zoomed}
              showsHorizontalScrollIndicator={false}
              renderItem={photoPage(innerW, stageH)}
              initialScrollIndex={at}
              getItemLayout={(_, i) => ({
                length: innerW,
                offset: innerW * i,
                index: i,
              })}
              onMomentumScrollEnd={(e) => choose(Math.round(e.nativeEvent.contentOffset.x / innerW), 'stage')}
              initialNumToRender={2}
              windowSize={3}
            />
          ) : (
            <GeoMapView
              points={points}
              onPressPoint={(id) =>
                choose(
                  items.findIndex((i) => i.id === id),
                  'full'
                )
              }
              focusId={chosen?.id ?? null}
              bare
            />
          )}
          {items.length > 0 && expandBtn}
        </GestureHandlerRootView>
      </View>
      {kind === 'geo' && chosen && (
        <Text style={[styles.chosen, { color: S.ink }]} numberOfLines={1}>
          {chosen.title}
        </Text>
      )}

      <FlatList
        ref={strip}
        data={items}
        keyExtractor={(i) => i.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -4 }}
        contentContainerStyle={{
          gap: GAP,
          paddingHorizontal: 4,
          paddingVertical: 4,
        }}
        getItemLayout={(_, i) => ({
          length: cell + GAP,
          offset: 4 + (cell + GAP) * i,
          index: i,
        })}
        onScrollToIndexFailed={() => {}}
        initialScrollIndex={Math.max(0, at - 1)}
        renderItem={({ item, index: i }) => {
          const on = i === at;
          return kind === 'photo' ? (
            <Pressable
              onPress={() => choose(i, 'strip')}
              style={[styles.print, { width: cell }, on && { borderColor: colour, borderWidth: 2 }]}
            >
              <AttachmentImage
                uri={String(item.raw?.imageUri ?? '')}
                driveFileId={str(item.raw?.driveFileId)}
                style={{ width: '100%', aspectRatio: 1, borderRadius: 4 }}
              />
            </Pressable>
          ) : (
            pointCard(item, i, cell, 'strip')
          );
        }}
      />
    </View>
  );

  return (
    <>
      <Sheet visible={visible && !full} onClose={onClose} handle={false} header={header} flipFrom={flipFrom}>
        {null}
      </Sheet>

      {/* FULL SCREEN: black, the same collection swiped through page by page; the button in the corner comes back
          to the window, on the photo it was left at. */}
      <Modal
        visible={visible && full}
        transparent={false}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setFull(false)}
      >
        <GestureHandlerRootView style={[styles.full, { backgroundColor: kind === 'photo' ? '#000' : S.card }]}>
          {kind === 'photo' ? (
            <FlatList
              data={items}
              keyExtractor={(i) => i.id}
              horizontal
              pagingEnabled
              disableIntervalMomentum
              scrollEnabled={!zoomed}
              showsHorizontalScrollIndicator={false}
              initialScrollIndex={at}
              renderItem={photoPage(width, height)}
              getItemLayout={(_, i) => ({
                length: width,
                offset: width * i,
                index: i,
              })}
              onMomentumScrollEnd={(e) => choose(Math.round(e.nativeEvent.contentOffset.x / width), 'full')}
              initialNumToRender={2}
              windowSize={3}
            />
          ) : (
            <GeoMapView
              points={points}
              onPressPoint={(id) =>
                choose(
                  items.findIndex((i) => i.id === id),
                  'full'
                )
              }
              focusId={chosen?.id ?? null}
              bare
            />
          )}
          {kind === 'geo' && (
            <FlatList
              data={items}
              keyExtractor={(i) => i.id}
              horizontal
              showsHorizontalScrollIndicator={false}
              style={[styles.fullStrip, { bottom: insets.bottom + 44 }]}
              contentContainerStyle={{ gap: GAP, paddingHorizontal: 16, paddingVertical: 6 }}
              getItemLayout={(_, i) => ({ length: fullCell + GAP, offset: 16 + (fullCell + GAP) * i, index: i })}
              initialScrollIndex={Math.max(0, at - 1)}
              onScrollToIndexFailed={() => {}}
              renderItem={({ item, index: i }) => pointCard(item, i, fullCell, 'full')}
            />
          )}
          <View style={[styles.fullBar, { top: insets.top + 10 }]} pointerEvents="box-none">
            <Text style={[styles.fullCount, { color: kind === 'photo' ? '#fff' : S.ink }]}>
              {items.length > 0 ? `${at + 1} / ${items.length}` : ''}
            </Text>
            <Pressable
              onPress={() => setFull(false)}
              hitSlop={12}
              accessibilityLabel="Вийти з повного екрана"
              style={[styles.closeBtn, { backgroundColor: 'rgba(255,255,255,0.88)' }]}
            >
              <Ionicons name={'contract-outline' as never} size={20} color="#1E1E1C" />
            </Pressable>
          </View>
        </GestureHandlerRootView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  winTitle: { fontSize: 17, fontFamily: SOFT_SEMIBOLD },
  sub: { fontSize: 12, fontFamily: SOFT_MEDIUM },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cornerBtn: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stage: { width: '100%', borderRadius: 16, overflow: 'hidden' },
  chosen: { fontSize: 15, fontFamily: SOFT_SEMIBOLD, paddingHorizontal: 2 },
  print: {
    backgroundColor: '#FFFFFF',
    borderRadius: 7,
    padding: 4,
    paddingBottom: 10,
    boxShadow: '0px 1px 2px rgba(30,30,28,0.10), 0px 4px 8px -6px rgba(30,30,28,0.28)',
  },
  pointCard: { borderRadius: 14, padding: 8, gap: 4 },
  pointTitle: { fontSize: 12, fontFamily: SOFT_SEMIBOLD },
  full: { flex: 1 },
  fullStrip: { position: 'absolute', left: 0, right: 0, flexGrow: 0 },
  fullBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fullCount: { fontSize: 15, fontFamily: SOFT_SEMIBOLD },
});
