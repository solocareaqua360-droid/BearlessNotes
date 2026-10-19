import { useEffect, useState, type ReactNode } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import AttachmentImage from './AttachmentImage';
import GeoThumbnail from './GeoThumbnail';
import { FOLDER_M_H } from './folderShape';
import { Ionicons } from './icons/Ionicons';
import { useSoft } from '../theme/soft';
import { SOFT_BOLD, SOFT_MEDIUM, SOFT_SEMIBOLD } from '../utils/fonts';
import type { FolderItem } from '../hooks/useAllFolderItems';

// THE FACE OF A COLLECTION (the user, 2026-10-15: «зовнішній вигляд картки підбірки повинен відрізнятись від папки... 2
// стилі список і сітка + для режиму модерн» - and, shown the sketch, «хочу все»). A folder is an icon; a collection's
// face is WHAT IS IN IT - its photos, its points on a real map, its videos' frames:
//   list  · «Стос» (the first three stacked, askew) or «Стрічка» (the name over the first ones in a row);
//   grid  · «Мозаїка» (one big and two small, the name under the cover, as iOS albums) or «Роздруківки» (a pile of
//           prints, the frame the photos themselves wear);
//   «Модерний» · S a capsule of three little rounds, M a cover with the name on a white band, L a cover with a strip
//           of three and a half under it - what its own window opens onto.
// Only the face: the press, the hold and the carrying stay with whoever places it.
export type CollectionCardKind = 'photo' | 'geo' | 'video';
export type CollectionFaceStyle = 'listStack' | 'listStrip' | 'gridMosaic' | 'gridPrints' | 'S' | 'M' | 'L';
export type CollectionPreview = { id: string; title: string; uri?: string; driveFileId?: string; thumb?: string; lat?: number; lng?: number };

const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const GREEN = '#35A56A';
const RED = '#E0484A';

// WHICH FACE, from the card's size and its «Стос / Розкладка» (2026-10-15: «розмір картки ютуб підбірки не
// змінюється» - the size was saved and only «Модерний» read it). In a grid - a base, the explorer's «Сітка» - L is a
// whole line (the cover and the strip), S a capsule, M the tile; the list keeps its rows whatever the size.
export function collectionFaceFor(card: { size?: 'S' | 'M' | 'L'; face?: 'stack' | 'spread' } | undefined, view: 'grid' | 'list'): { face: CollectionFaceStyle; wide: boolean } {
  if (view === 'list') return { face: card?.face === 'spread' ? 'listStrip' : 'listStack', wide: true };
  const size = card?.size ?? 'M';
  if (size === 'L') return { face: 'L', wide: true };
  if (size === 'S') return { face: 'S', wide: false };
  return { face: card?.face === 'stack' ? 'gridPrints' : 'gridMosaic', wide: false };
}

export function previewOf(item: FolderItem): CollectionPreview {
  const raw = (item.raw ?? {}) as Record<string, unknown>;
  return {
    id: item.id,
    title: item.title,
    uri: item.imageUri ?? str(raw.imageUri),
    driveFileId: item.driveFileId ?? str(raw.driveFileId),
    thumb: str(raw.imageUrl),
    lat: num(raw.geoLat),
    lng: num(raw.geoLng),
  };
}

function plural(n: number, one: string, few: string, many: string) {
  const d = n % 10;
  const h = n % 100;
  if (d === 1 && h !== 11) return one;
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return few;
  return many;
}
export function collectionCountLabel(kind: CollectionCardKind, n: number) {
  if (kind === 'photo') return `${n} фото`;
  if (kind === 'video') return `${n} відео`;
  return `${n} ${plural(n, 'точка', 'точки', 'точок')}`;
}

// ONE PICTURE of the collection: a photo, a video frame, or nothing (a grey seat) when it has none.
function Pic({ p, kind, style, play }: { p?: CollectionPreview; kind: CollectionCardKind; style: object; play?: boolean }) {
  const S = useSoft();
  return (
    <View style={[style, { backgroundColor: kind === 'video' ? '#3A3A40' : S.fill, overflow: 'hidden' }]}>
      {kind === 'photo' && p?.uri ? (
        <AttachmentImage uri={p.uri} driveFileId={p.driveFileId} style={StyleSheet.absoluteFill} />
      ) : kind === 'video' && p?.thumb ? (
        <Image source={{ uri: p.thumb }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : null}
      {play && (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <View style={styles.play}>
            <Ionicons name={'play' as never} size={11} color="#fff" />
          </View>
        </View>
      )}
    </View>
  );
}

// THE GUST THAT OPENS A COLLECTION (2026-10-15, the user's, sketch artifact HrQ4bhfcGnhnXUSZQ9XzGa boards Б and В: «картинки
// здуваються вітром, а потім картка розвертається», «не за екран, а за межі картки»). A picture shivers once - its free
// edge lifts - and is torn off sideways and up, turning and tipping as it goes; the card clips it, so it leaves the
// card, not the screen. The photos go one after another, the front first; then the card turns over (flipOpen).
// Quicker since 2026-10-19 (the user's: faster, still seen): 720 -> 520, the prints 60/120 apart instead of 90/170.
export const GUST_MS = 520;
const LAST_PRINT_DELAY = 120;
const SHIVER = 0.14;
// When the window may start turning the card: as the last picture is leaving it.
export function gustLeadMs(kind: CollectionCardKind) {
  return kind === 'photo' ? LAST_PRINT_DELAY + Math.round(GUST_MS * 0.72) : Math.round(GUST_MS * 0.72);
}
type Gust = { delay: number; fx: number; fy: number; spin: number; flip: number; tilt: number };
function useGust(blowing: boolean, g: Gust) {
  const t = useSharedValue(0);
  useEffect(() => {
    // Back in place at once when it stops: by then the window covers the card, which turns back later.
    t.value = blowing ? withDelay(g.delay, withTiming(1, { duration: GUST_MS, easing: Easing.linear })) : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blowing]);
  return useAnimatedStyle(() => {
    const v = t.value;
    let tx = 0;
    let ty = 0;
    let rot = g.tilt;
    let ry = 0;
    let rx = 0;
    if (v <= SHIVER) {
      const a = Math.sin((v / SHIVER) * (Math.PI / 2));
      tx = 2 * a;
      ty = -2 * a;
      rot = g.tilt + 4 * a;
      ry = 26 * a;
    } else {
      const b = (v - SHIVER) / (1 - SHIVER);
      // Torn off: it gathers speed, as a thing the wind has just caught.
      const e = b * b * (1.3 - 0.3 * b);
      tx = 2 + (g.fx - 2) * e;
      ty = -2 + (g.fy + 2) * e;
      rot = g.tilt + 4 + (g.spin - 4) * e;
      ry = 26 + (g.flip - 26) * e;
      rx = 20 * e;
    }
    return {
      transform: [{ perspective: 600 }, { translateX: tx }, { translateY: ty }, { rotate: `${rot}deg` }, { rotateY: `${ry}deg` }, { rotateX: `${rx}deg` }],
    };
  });
}
// A folded map's side panels catch the wind at the creases before the sheet goes.
function useFlap(blowing: boolean, side: -1 | 1) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = blowing ? withTiming(1, { duration: GUST_MS, easing: Easing.linear }) : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blowing]);
  return useAnimatedStyle(() => {
    const v = t.value;
    const deg = (side < 0 ? 30 : 26) * (0.5 - 0.5 * Math.cos(v * Math.PI * 2 * (side < 0 ? 1.6 : 1.8))) + 10 * v;
    return { transform: [{ perspective: 500 }, { rotateY: `${side < 0 ? -deg : deg}deg` }] };
  });
}
function GustView({ blowing, g, style, children }: { blowing: boolean; g: Gust; style: object; children?: ReactNode }) {
  const moving = useGust(blowing, g);
  return (
    <Animated.View pointerEvents="none" style={[style, { transformOrigin: '15% 50%' }, moving]}>
      {children}
    </Animated.View>
  );
}
function FlapPanel({ blowing, side, style, children }: { blowing: boolean; side: -1 | 0 | 1; style: object; children?: ReactNode }) {
  const flap = useFlap(blowing, side === 0 ? 1 : side);
  return (
    <Animated.View pointerEvents="none" style={[style, side !== 0 && { transformOrigin: side < 0 ? '100% 50%' : '0% 50%' }, side !== 0 && flap]}>
      {children}
    </Animated.View>
  );
}

// THE POINTS ON A REAL MAP: the same static picture a point's own card has, centred and zoomed so that every point
// fits, with the pins laid over it where they stand (Web Mercator, 512-point tiles - MapLibre's vector maps). Without
// network or on the web there is no picture, and the pins still stand on the map-coloured ground.
function MapCover({ points, w, h }: { points: CollectionPreview[]; w: number; h: number }) {
  const S = useSoft();
  const pts = points.filter((p) => p.lat != null && p.lng != null) as (CollectionPreview & { lat: number; lng: number })[];
  if (w <= 0 || h <= 0) return null;
  const X = (lng: number) => (lng + 180) / 360;
  const Y = (lat: number) => {
    const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
    return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  };
  const xs = pts.map((p) => X(p.lng));
  const ys = pts.map((p) => Y(p.lat));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const spanX = Math.max(maxX - minX, 1e-9);
  const spanY = Math.max(maxY - minY, 1e-9);
  // The points take the middle ~60% of the cover; one point (or all in one place) - the street around it.
  const fit = Math.min(Math.log2((w * 0.6) / (spanX * 512)), Math.log2((h * 0.6) / (spanY * 512)));
  const zoom = pts.length < 2 || !isFinite(fit) ? 14 : Math.max(2, Math.min(15, fit));
  const scale = 512 * Math.pow(2, zoom);
  const lngC = cx * 360 - 180;
  const latC = (Math.atan(Math.sinh(Math.PI * (1 - 2 * cy))) * 180) / Math.PI;
  return (
    <View style={{ width: w, height: h, backgroundColor: '#F1EEE6', overflow: 'hidden' }}>
      {pts.length > 0 && (
        <GeoThumbnail lat={latC} lng={lngC} width={Math.round(w)} height={Math.round(h)} zoom={zoom} style={StyleSheet.absoluteFill} />
      )}
      {pts.slice(0, 40).map((p) => {
        const left = (X(p.lng) - cx) * scale + w / 2;
        const top = (Y(p.lat) - cy) * scale + h / 2;
        // On a stamp-sized map (the list's stack) a full pin covers the place it marks.
        const d = Math.min(w, h) < 90 ? 9 : 16;
        return (
          <View key={p.id} style={[styles.pin, { left: left - d / 2, top: top - d / 2, width: d, height: d, borderRadius: d / 2 }]}>
            <View style={[styles.pinDot, d < 12 && { width: 3, height: 3 }]} />
          </View>
        );
      })}
      {pts.length === 0 && (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <Ionicons name={'location-outline' as never} size={22} color={S.ink3} />
        </View>
      )}
    </View>
  );
}

// The little round in a cover's corner that says «a collection, not a folder».
function Badge({ kind }: { kind: CollectionCardKind }) {
  return (
    <View style={styles.badge}>
      <Ionicons name={(kind === 'geo' ? 'location-outline' : 'albums-outline') as never} size={14} color={kind === 'geo' ? GREEN : '#1E1E1C'} />
    </View>
  );
}

function Name({ name, count, kind, big }: { name: string; count: number; kind: CollectionCardKind; big?: boolean }) {
  const S = useSoft();
  return (
    <>
      <Text style={[big ? styles.nameBig : styles.name, { color: S.ink }]} numberOfLines={1}>
        {name}
      </Text>
      <Text style={[styles.count, { color: S.ink3 }]}>{collectionCountLabel(kind, count)}</Text>
    </>
  );
}

export default function CollectionCard({
  kind,
  name,
  count,
  items,
  previews: given,
  face,
  blowing = false,
}: {
  kind: CollectionCardKind;
  name: string;
  count: number;
  // The explorer's records, or - a base, with records of its own shape - the pictures already picked out.
  items?: FolderItem[];
  previews?: CollectionPreview[];
  face: CollectionFaceStyle;
  // The collection is being opened: its pictures are blown off the card (the middle photo and map cards).
  blowing?: boolean;
}) {
  const S = useSoft();
  const [w, setW] = useState(0);
  const previews = given ?? (items ?? []).map(previewOf);
  const p = (i: number) => previews[i];
  const card = { backgroundColor: S.card, boxShadow: S.popShadow };
  const measure = (e: { nativeEvent: { layout: { width: number } } }) => {
    const next = Math.round(e.nativeEvent.layout.width);
    if (next !== w) setW(next);
  };
  const video = kind === 'video';
  // The cover a collection shows when one picture stands for it (modern M / L, the grid's map).
  const cover = (cw: number, ch: number): ReactNode =>
    kind === 'geo' ? (
      <MapCover points={previews} w={cw} h={ch} />
    ) : (
      <Pic p={p(0)} kind={kind} style={{ width: cw, height: ch }} play={video} />
    );

  if (face === 'listStack') {
    return (
      <View style={[styles.row, card]}>
        <View style={video ? styles.stackVideo : styles.stack}>
          {video ? (
            <>
              <Pic p={p(2)} kind={kind} style={[styles.vBack, { left: 8, top: 0, width: 68, height: 40, opacity: 0.45 }]} />
              <Pic p={p(1)} kind={kind} style={[styles.vBack, { left: 4, top: 5, width: 76, height: 44, opacity: 0.75 }]} />
              <Pic p={p(0)} kind={kind} style={[styles.vBack, { left: 0, top: 11, width: 84, height: 47 }]} play />
            </>
          ) : kind === 'geo' ? (
            <>
              <View style={[styles.sheet, { left: 8, top: 2, backgroundColor: '#E4EFE2', transform: [{ rotate: '9deg' }] }]} />
              <View style={[styles.sheet, { left: 5, top: 7, overflow: 'hidden' }]}>
                <MapCover points={previews} w={48} h={48} />
              </View>
            </>
          ) : (
            <>
              <Pic p={p(2)} kind={kind} style={[styles.sheet, { left: 8, top: 2, transform: [{ rotate: '9deg' }] }]} />
              <Pic p={p(1)} kind={kind} style={[styles.sheet, { left: 4, top: 4, transform: [{ rotate: '-7deg' }] }]} />
              <Pic p={p(0)} kind={kind} style={[styles.sheet, { left: 5, top: 7 }]} />
            </>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Name name={name} count={count} kind={kind} />
        </View>
        <Ionicons name={'chevron-forward' as never} size={18} color={S.ink3} />
      </View>
    );
  }

  if (face === 'listStrip') {
    const gap = 6;
    const cols = video ? 3 : 4;
    const cell = w > 0 ? Math.floor((w - 32 - gap * (cols - 1)) / cols) : 0;
    const more = count - cols;
    return (
      <View style={[styles.strip, card]} onLayout={measure}>
        <View style={styles.stripHead}>
          <Text style={[styles.name, { color: S.ink, flex: 1 }]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={[styles.count, { color: S.ink3 }]}>{collectionCountLabel(kind, count)}</Text>
        </View>
        {kind === 'geo' ? (
          <View style={{ height: 78, borderRadius: 12, overflow: 'hidden' }}>{w > 0 && <MapCover points={previews} w={w - 32} h={78} />}</View>
        ) : (
          <View style={{ flexDirection: 'row', gap }}>
            {Array.from({ length: Math.min(cols, Math.max(1, previews.length)) }).map((_, i) => (
              <View key={i}>
                <Pic p={p(i)} kind={kind} style={{ width: cell, height: video ? Math.round((cell * 9) / 16) : cell, borderRadius: 8 }} />
                {i === cols - 1 && more > 0 && (
                  <View style={[StyleSheet.absoluteFill, styles.center, styles.more]}>
                    <Text style={styles.moreText}>{`+${more}`}</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        )}
      </View>
    );
  }

  if (face === 'gridMosaic' || face === 'gridPrints') {
    const side = w;
    return (
      <View onLayout={measure} style={{ gap: 8 }}>
        {face === 'gridMosaic' ? (
          <View style={[styles.cover, { height: side, boxShadow: S.popShadow }]}>
            {side > 0 &&
              (kind === 'geo' ? (
                cover(side, side)
              ) : video ? (
                <View style={{ flex: 1, gap: 3 }}>
                  <Pic p={p(0)} kind={kind} style={{ flex: 1.4 }} play />
                  {/* Only cells there are videos for - two videos left a dark empty square. */}
                  {previews.length > 1 && (
                    <View style={{ flex: 1, flexDirection: 'row', gap: 3 }}>
                      {previews.slice(1, 3).map((q) => (
                        <Pic key={q.id} p={q} kind={kind} style={{ flex: 1 }} />
                      ))}
                    </View>
                  )}
                </View>
              ) : previews.length < 3 ? (
                <View style={{ flex: 1, flexDirection: 'row', gap: 3 }}>
                  <Pic p={p(0)} kind={kind} style={{ flex: 1 }} />
                  {previews.length === 2 && <Pic p={p(1)} kind={kind} style={{ flex: 1 }} />}
                </View>
              ) : (
                <View style={{ flex: 1, flexDirection: 'row', gap: 3 }}>
                  <Pic p={p(0)} kind={kind} style={{ flex: 2 }} />
                  <View style={{ flex: 1, gap: 3 }}>
                    <Pic p={p(1)} kind={kind} style={{ flex: 1 }} />
                    <Pic p={p(2)} kind={kind} style={{ flex: 1 }} />
                  </View>
                </View>
              ))}
            <Badge kind={kind} />
          </View>
        ) : (
          <View style={{ height: side }}>
            {side > 0 &&
              (kind === 'geo' ? (
                <>
                  <View style={[styles.print, styles.printBack, { transform: [{ rotate: '7deg' }], backgroundColor: '#E4EFE2' }]} />
                  <View style={[styles.print, { padding: 0, overflow: 'hidden', borderWidth: 4, borderColor: '#fff' }]}>
                    <MapCover points={previews} w={side * 0.82 - 8} h={side * 0.84 - 8} />
                  </View>
                </>
              ) : (
                <>
                  <View style={[styles.print, styles.printBack, { transform: [{ rotate: '8deg' }] }]}>
                    <Pic p={p(2)} kind={kind} style={styles.printPic} />
                  </View>
                  <View style={[styles.print, styles.printBack, { transform: [{ rotate: '-6deg' }] }]}>
                    <Pic p={p(1)} kind={kind} style={styles.printPic} />
                  </View>
                  <View style={styles.print}>
                    <Pic p={p(0)} kind={kind} style={styles.printPic} play={video} />
                  </View>
                </>
              ))}
          </View>
        )}
        <View style={{ paddingHorizontal: 4 }}>
          <Name name={name} count={count} kind={kind} />
        </View>
      </View>
    );
  }

  if (face === 'S') {
    return (
      <View style={[styles.capsule, card]}>
        {kind === 'geo' ? (
          <View style={[styles.round, { backgroundColor: '#E4EFE2', alignItems: 'center', justifyContent: 'center' }]}>
            <Ionicons name={'location-outline' as never} size={16} color={GREEN} />
          </View>
        ) : (
          <View style={{ flexDirection: 'row' }}>
            {[0, 1, 2].slice(0, Math.max(1, Math.min(3, previews.length))).map((i) => (
              <Pic key={i} p={p(i)} kind={kind} style={[styles.round, i > 0 && { marginLeft: -12 }]} />
            ))}
          </View>
        )}
        <Text style={[styles.capsuleName, { color: S.ink }]} numberOfLines={1}>
          {name}
        </Text>
      </View>
    );
  }

  if (face === 'M' && kind === 'photo') {
    // THE PHOTO COLLECTION, middle card (2026-10-15, the user's: «білий квадрат зі скругленими краями розміру середньої
    // папки ... декілька фото так, щоб видно було тільки перше, а інші тільки краєчками виглядали; одне фото
    // виглядає як на скріні з білими рамками»): a white rounded square the size of a middle folder card, the photos on
    // it as prints - a white frame round each (thin at the sides and top, wider below), the first in front, the others
    // behind it a little higher and to the right, tilted, so only their edges show. The name and the count under them.
    // Smaller by a fifth and the whole pack turned 20 degrees clockwise (the user: «зменши мініатюри на 20% і розверни за
    // годинниковою стрілкою градусів на 20 всю цю зміщену стопку разом, але так щоб не вилазило за край білої
    // картки»): the pack is one box, turned about its own centre and set so that its turned corners stay inside the card.
    const pw = Math.round(w * 0.64);
    const ph = 99;
    const dx = Math.round(w * 0.05);
    const boxW = pw + dx * 2;
    const boxH = ph + 11;
    // Each print's way off the card in the gust (the front one first). The pack is turned 20 degrees, so its «right and
    // up» already leans the way the wind blows.
    const GUSTS: Omit<Gust, 'tilt'>[] = [
      { delay: 0, fx: Math.round(w * 1.15), fy: -70, spin: 70, flip: 55 },
      { delay: 60, fx: Math.round(w * 1.08), fy: -30, spin: -50, flip: -45 },
      { delay: LAST_PRINT_DELAY, fx: Math.round(w * 1.04), fy: -110, spin: 85, flip: 60 },
    ];
    const print = (i: number, left: number, top: number, tilt: number, front: boolean) =>
      p(i) || front ? (
        <GustView
          key={i}
          blowing={blowing}
          g={{ ...GUSTS[i], tilt }}
          style={{
            position: 'absolute',
            left,
            top,
            width: pw,
            height: ph,
            borderRadius: 7,
            backgroundColor: S.card,
            borderWidth: 1,
            borderColor: S.dark ? '#3A3A3C' : '#E6E3DC',
            boxShadow: front ? '0px 2px 8px rgba(30,30,28,0.14)' : undefined,
          }}
        >
          <Pic p={p(i)} kind={kind} style={{ position: 'absolute', left: 5, right: 5, top: 5, bottom: 16, borderRadius: 3 }} />
        </GustView>
      ) : null;
    return (
      <View style={[styles.photoStack, { backgroundColor: S.card, boxShadow: S.popShadow }]} onLayout={measure}>
        {w > 0 && (
          <View pointerEvents="none" style={{ position: 'absolute', left: Math.round(w / 2 - boxW / 2), top: 78 - Math.round(boxH / 2), width: boxW, height: boxH, transform: [{ rotate: '20deg' }] }}>
            {count > 2 && print(2, dx * 2, 0, 6, false)}
            {count > 1 && print(1, dx, 5, 3, false)}
            {print(0, 0, 11, -1.5, true)}
          </View>
        )}
        <View style={styles.photoStackName} pointerEvents="none">
          <Name name={name} count={count} kind={kind} />
        </View>
      </View>
    );
  }

  if (face === 'M' && kind === 'geo') {
    // THE POINTS COLLECTION, middle card (2026-10-15, the user's: «раніше мапи використовували паперові і тому згинали
    // в декілька разів. Відобрази два місця згину, ніби на білому квадраті розміру папки лежить мапа не докінця
    // вирівняна, з двома згинами»): a white square of a middle folder's size with the map on it as a sheet of paper
    // folded in three - two creases, each with a pale side and a shaded side (a mountain fold, then a valley), the
    // sheet a little askew and lifted by a soft shadow, not quite flat. The name and the count under it.
    const sw = Math.round(w * 0.8);
    const sh = 112;
    const crease = (at: number, mountain: boolean) => {
      const light = 'rgba(255,255,255,0.38)';
      const dark = 'rgba(30,30,28,0.20)';
      const left = mountain ? light : dark;
      const right = mountain ? dark : light;
      return (
        <View key={at} pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: at - 9, width: 18 }}>
          <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 9, experimental_backgroundImage: `linear-gradient(to right, rgba(255,255,255,0), ${left})` }} />
          <View style={{ position: 'absolute', top: 0, bottom: 0, left: 9, width: 9, experimental_backgroundImage: `linear-gradient(to right, ${right}, rgba(255,255,255,0))` }} />
          <View style={{ position: 'absolute', top: 0, bottom: 0, left: 8.5, width: 1, backgroundColor: 'rgba(30,30,28,0.22)' }} />
        </View>
      );
    };
    return (
      <View style={[styles.photoStack, { backgroundColor: S.card, boxShadow: S.popShadow }]} onLayout={measure}>
        {w > 0 && (
          // The sheet in three panels (the folds), so that the side ones can flap in the gust; drawn as one map.
          <GustView
            blowing={blowing}
            g={{ delay: 0, fx: Math.round(w * 1.15), fy: -50, spin: 38, flip: 28, tilt: -4 }}
            style={{
              position: 'absolute',
              left: Math.round(w / 2 - sw / 2),
              top: 78 - sh / 2,
              width: sw,
              height: sh,
              borderRadius: 4,
              boxShadow: '0px 3px 9px rgba(30,30,28,0.22)',
            }}
          >
            {([-1, 0, 1] as const).map((side, i) => {
              const third = sw / 3;
              return (
                <FlapPanel
                  key={side}
                  blowing={blowing}
                  side={side}
                  style={{ position: 'absolute', top: 0, left: Math.floor(third * i), width: Math.ceil(third) + (i < 2 ? 1 : 0), height: sh, overflow: 'hidden', borderTopLeftRadius: i === 0 ? 4 : 0, borderBottomLeftRadius: i === 0 ? 4 : 0, borderTopRightRadius: i === 2 ? 4 : 0, borderBottomRightRadius: i === 2 ? 4 : 0 }}
                >
                  <View style={{ position: 'absolute', top: 0, left: -Math.floor(third * i) }}>
                    <MapCover points={previews} w={sw} h={sh} />
                  </View>
                </FlapPanel>
              );
            })}
            {crease(Math.round(sw / 3), true)}
            {crease(Math.round((sw * 2) / 3), false)}
          </GustView>
        )}
        <View style={styles.photoStackName} pointerEvents="none">
          <Name name={name} count={count} kind={kind} />
        </View>
      </View>
    );
  }

  if (face === 'M' && kind === 'video') {
    // THE VIDEO COLLECTION, middle card (2026-10-15, the user's: «зроби таку саму, тільки середню картку, і знизу
    // тоді влізе тільки 2 мініатюри»): the large card's layout at the size of a middle folder - the cover (the first
    // video's frame, its play mark and the collection's badge), the name with the count, and under them a strip of
    // only two thumbnails. The cover takes what the rest leaves of the card's 200.
    const gap = 6;
    const cell = w > 0 ? Math.floor((w - 28 - gap) / 2) : 0;
    const th = Math.round((cell * 9) / 16);
    const coverH = FOLDER_M_H - 32 - (8 + th + 12);
    return (
      <View style={[styles.videoM, { backgroundColor: S.card, boxShadow: S.popShadow }]} onLayout={measure}>
        <View style={{ height: coverH }}>
          {w > 0 && cover(w, coverH)}
          <Badge kind={kind} />
        </View>
        <View style={styles.headM}>
          <Text style={[styles.name, { color: S.ink, flex: 1 }]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={[styles.count, { color: S.ink3 }]}>{collectionCountLabel(kind, count)}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap, paddingHorizontal: 14, paddingTop: 8 }}>
          {previews.slice(1, 3).map((q) => (
            <Pic key={q.id} p={q} kind={kind} style={{ width: cell, height: th, borderRadius: 8 }} />
          ))}
        </View>
      </View>
    );
  }

  if (face === 'M') {
    return (
      <View style={[styles.modern, card]} onLayout={measure}>
        <View style={{ height: 150 }}>
          {w > 0 && cover(w, 150)}
          <Badge kind={kind} />
        </View>
        <View style={styles.band}>
          <Name name={name} count={count} kind={kind} />
        </View>
      </View>
    );
  }

  // L: the cover, the name, and the strip its window opens onto.
  const stripW = video ? 112 : 96;
  const stripFrom = kind === 'geo' ? 0 : kind === 'photo' && previews.length >= 3 ? 3 : 1;
  return (
    <View style={[styles.modern, card]} onLayout={measure}>
      <View style={{ height: kind === 'photo' ? 200 : 190 }}>
        {w > 0 &&
          (kind === 'photo' && previews.length >= 3 ? (
            <View style={{ flex: 1, flexDirection: 'row', gap: 3 }}>
              <Pic p={p(0)} kind={kind} style={{ flex: 2 }} />
              <View style={{ flex: 1, gap: 3 }}>
                <Pic p={p(1)} kind={kind} style={{ flex: 1 }} />
                <Pic p={p(2)} kind={kind} style={{ flex: 1 }} />
              </View>
            </View>
          ) : (
            cover(w, kind === 'photo' ? 200 : 190)
          ))}
        <Badge kind={kind} />
      </View>
      <View style={styles.lHead}>
        <Text style={[styles.nameBig, { color: S.ink, flex: 1 }]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[styles.count, { color: S.ink3 }]}>{collectionCountLabel(kind, count)}</Text>
      </View>
      <View style={styles.lStrip}>
        {/* What the cover did not already show: a map shows every point, so the strip starts at the first. */}
        {previews.slice(stripFrom, stripFrom + 4).map((q) =>
          kind === 'geo' ? (
            <View key={q.id} style={[styles.pointChip, { backgroundColor: S.fill }]}>
              <Ionicons name={'location-outline' as never} size={14} color={GREEN} />
              <Text style={[styles.pointText, { color: S.ink }]} numberOfLines={2}>
                {q.title}
              </Text>
            </View>
          ) : (
            <Pic key={q.id} p={q} kind={kind} style={{ width: stripW, height: video ? 63 : stripW, borderRadius: 9 }} />
          )
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  play: { width: 24, height: 17, borderRadius: 5, backgroundColor: RED, alignItems: 'center', justifyContent: 'center' },
  pin: { position: 'absolute', width: 16, height: 16, borderRadius: 8, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center', boxShadow: '0px 1px 3px rgba(0,0,0,0.25)' },
  pinDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  badge: { position: 'absolute', right: 8, top: 8, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 16, fontFamily: SOFT_SEMIBOLD },
  nameBig: { fontSize: 19, fontFamily: SOFT_BOLD },
  count: { fontSize: 12.5, fontFamily: SOFT_MEDIUM, marginTop: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10, paddingLeft: 12, paddingRight: 14, borderRadius: 22 },
  stack: { width: 64, height: 64 },
  stackVideo: { width: 84, height: 58 },
  sheet: { position: 'absolute', width: 52, height: 52, borderRadius: 9, borderWidth: 3, borderColor: '#fff', boxShadow: '0px 2px 6px rgba(0,0,0,0.18)' },
  vBack: { position: 'absolute', borderRadius: 7 },
  strip: { padding: 16, paddingTop: 13, gap: 10, borderRadius: 22 },
  stripHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  more: { borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.28)' },
  moreText: { color: '#fff', fontSize: 15, fontFamily: SOFT_BOLD },
  cover: { borderRadius: 18, overflow: 'hidden' },
  print: { position: 'absolute', left: '9%', right: '9%', top: '7%', bottom: '9%', backgroundColor: '#fff', borderRadius: 7, padding: 6, paddingBottom: 18, boxShadow: '0px 3px 12px rgba(0,0,0,0.16)' },
  printBack: { boxShadow: '0px 2px 8px rgba(0,0,0,0.12)' },
  printPic: { flex: 1, borderRadius: 4 },
  capsule: { height: 58, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 8, paddingRight: 14, borderRadius: 999 },
  capsuleName: { flex: 1, fontSize: 15, fontFamily: SOFT_SEMIBOLD },
  round: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: '#fff' },
  modern: { borderRadius: 22, overflow: 'hidden' },
  photoStack: { height: FOLDER_M_H, borderRadius: 24, overflow: 'hidden' },
  videoM: { height: FOLDER_M_H, borderRadius: 24, overflow: 'hidden' },
  headM: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 14, paddingTop: 9 },
  photoStackName: { position: 'absolute', left: 14, right: 14, bottom: 12 },
  band: { paddingHorizontal: 14, paddingTop: 11, paddingBottom: 13 },
  lHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 16, paddingTop: 13 },
  lStrip: { flexDirection: 'row', gap: 8, paddingLeft: 16, paddingTop: 10, paddingBottom: 16, overflow: 'hidden' },
  pointChip: { width: 112, height: 60, borderRadius: 12, padding: 8, gap: 3 },
  pointText: { fontSize: 12, fontFamily: SOFT_SEMIBOLD },
});
