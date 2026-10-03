import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '../components/icons/Ionicons';
import ScreenGround from '../components/ScreenGround';
import EdgeFade from '../components/EdgeFade';
import { TOP_NAV_H, TOP_NAV_SPACE, useTopNavOn } from '../components/TopNavBar';
import { openCapture } from '../components/CaptureWindow';
import { ask } from '../components/surfaces/Ask';
import { CHROME_TOP } from '../constants/rail';
import { SoftSurfaceContext, useSoft } from '../theme/soft';
import { SOFT_MEDIUM, SOFT_SEMIBOLD } from '../utils/fonts';
import { useDockClearance } from '../navigation/dockGeometry';
import { useChromeStyle, useDockBeads, useTopBack } from '../navigation/navDock';
import { useSideDrawers } from '../navigation/sideDrawers';
import { BOARDS_DESK, DesksControlContext, PERMANENT_DESK, deskFace } from '../navigation/desks';
import { GRID_TILES, WIDE_TILES, openDatabaseTile } from '../constants/databaseTiles';
import { useDatabaseTiles } from '../hooks/useDatabaseTiles';
import { whenDeskIsThere } from '../navigation/deskRegistry';
import { requestCreate } from '../navigation/startCreate';
import { navigationRef } from '../navigationRef';
import { doc, onSnapshot } from '../firestore';
import { db } from '../firebase';
import AttachmentImage from '../components/AttachmentImage';
import DocumentPageMiniature from '../components/DocumentPageMiniature';
import { useDocumentIndex } from '../hooks/useDocumentIndex';
import { useRecentPlaces, type RecentPlace } from '../navigation/recentPlaces';
import { requestOpen } from '../utils/openRequest';
import { fileIconColorFor, fileIconFor } from '../utils/fileIcons';
import { ownedQuery } from '../utils/owned';
import { listenError } from '../utils/listenError';
import type { Block, CustomDatabase } from '../types';

// THE START DESK (2026-10-03, the user's own design, mocked up first):
// the phone's first desk. Under the desks' bar, a row of four big buttons
// - «Перейти до столу»: the documents and the boards (desks), the diary
// (the calendar's drawer, from the left) and the databases (their drawer,
// from the right) - and below it «Створити»: everything the app makes,
// one row each. Above them, «Нещодавні»: one row of cards, a document, a
// board, a file or a database, newest first, scrolling sideways. The
// whole page scrolls down. Over that row a sideways drag is the cards'
// own, so the drawers' swipe begins there only at the screen's very edge
// (sideDrawers' edgeZone); below it the swipe is free. Next: the bar's «+».

type Create = { key: string; label: string; icon: string; route: string; params?: Record<string, unknown>; wanted: string };

const CREATE: Create[] = [
  { key: 'doc', label: 'Документ', icon: 'document-text-outline', route: 'Tabs', params: { screen: PERMANENT_DESK }, wanted: PERMANENT_DESK },
  { key: 'board', label: 'Дошка', icon: 'easel-outline', route: 'Tabs', params: { screen: BOARDS_DESK }, wanted: 'BoardsList' },
  { key: 'task', label: 'Справа', icon: 'checkbox-outline', route: 'Tasks', wanted: 'Tasks' },
  { key: 'sticker', label: 'Стікер', icon: 'reader-outline', route: 'Stickers', wanted: 'Stickers' },
  { key: 'card', label: 'Картка', icon: 'albums-outline', route: 'Flashcards', wanted: 'Flashcards' },
  { key: 'link', label: 'Посилання', icon: 'link-outline', route: 'Links', params: { category: 'other' }, wanted: 'Links' },
  { key: 'photo', label: 'Зображення', icon: 'image-outline', route: 'Photos', wanted: 'Photos' },
  { key: 'file', label: 'Файл', icon: 'document-outline', route: 'Files', wanted: 'Files' },
];

function go(route: string, params?: Record<string, unknown>) {
  if (!navigationRef.isReady()) return;
  (navigationRef.navigate as (name: string, p?: unknown) => void)(route, params);
}

export default function StartScreen() {
  const S = useSoft();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const topNavOn = useTopNavOn();
  const dockClear = useDockClearance();
  const { openCalendar, openDatabases } = useSideDrawers();
  const desksControl = useContext(DesksControlContext);
  // The soft style, as every database's chrome wears it (DatabaseChrome).
  useChromeStyle('soft', true);

  const recent = useRecentPlaces();
  const index = useDocumentIndex();
  const { setEdgeZone } = useSideDrawers();
  // A note in the bin is not offered; until the index has arrived, none is
  // judged (a list that blinked empty while loading would be worse).
  const shown = recent
    .filter((r) => r.kind !== 'document' || index.size === 0 || (index.has(r.ref) && !index.get(r.ref)?.deletedAt))
    .slice(0, 12);

  // WHERE THE ROW STANDS ON THE SCREEN, told to the drawers' swipe: the
  // page's own top in the window, where the row sits in the page, and how
  // far the page has scrolled.
  const containerRef = useRef<View>(null);
  const containerTop = useRef(0);
  const rowAt = useRef<{ y: number; h: number } | null>(null);
  const scrolled = useRef(0);
  const publishZone = useCallback(() => {
    const row = rowAt.current;
    if (!isFocused || !row) {
      setEdgeZone(-1, -1);
      return;
    }
    const top = containerTop.current + row.y - scrolled.current;
    setEdgeZone(top, top + row.h);
  }, [isFocused, setEdgeZone]);
  useEffect(() => {
    if (shown.length === 0) rowAt.current = null;
    publishZone();
    return () => setEdgeZone(-1, -1);
  }, [publishZone, shown.length, setEdgeZone]);

  // The first desk: nowhere before it to go back to, so its way back
  // stands dimmed in its place.
  useTopBack(null, topNavOn);

  const create = (item: Create) => {
    // The boards' desk may have been closed: then the boards' own copy.
    if (item.key === 'board' && desksControl && !desksControl.desks.includes(BOARDS_DESK)) {
      requestCreate('BoardsCopy', undefined, 'BoardsCopy');
      return;
    }
    // A closed documents desk is put back first.
    if (item.key === 'doc') {
      whenDeskIsThere(PERMANENT_DESK, () => requestCreate(item.route, item.params, item.wanted));
      return;
    }
    requestCreate(item.route, item.params, item.wanted);
  };

  // A record in a database of one's own: which database first.
  const createRecord = async () => {
    const databases = await new Promise<CustomDatabase[]>((resolve) => {
      const stop = onSnapshot(
        ownedQuery('customDatabases'),
        (snapshot) => {
          stop();
          resolve(snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CustomDatabase, 'id'>) }) as CustomDatabase));
        },
        (e) => {
          listenError('StartScreen:databases')(e);
          resolve([]);
        }
      );
    });
    if (databases.length === 0) return;
    const id = await ask({
      title: 'У яку базу?',
      actions: databases
        .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))
        .map((d) => ({ id: d.id, label: d.name || 'Без назви', icon: (d.icon as never) ?? 'grid-outline' })),
    });
    if (!id || id === 'cancel') return;
    requestCreate('CustomDatabase', { databaseId: id }, 'CustomDatabase');
  };

  const goToDesk = (key: string, copyRoute: string) => {
    if (key === PERMANENT_DESK) {
      // The documents are put back if they were closed.
      whenDeskIsThere(key, () => go('Tabs', { screen: key }));
      return;
    }
    if (desksControl?.desks.includes(key)) go('Tabs', { screen: key });
    else go(copyRoute);
  };

  // The dock: search on the left (the app's search over everything), and
  // on the right a pencil - a new document; held, the chat (the dock does
  // that for every pencil and plus).
  useDockBeads(
    isFocused ? { icon: 'search-outline', onPress: () => go('Search') } : null,
    isFocused ? { icon: 'create-outline', onPress: () => create(CREATE[0]) } : null
  );

  const openRecent = (place: RecentPlace) => {
    if (place.kind === 'document') go('Editor', { documentId: place.ref });
    else if (place.kind === 'board') go('BoardCopy', { boardId: place.ref });
    else if (place.kind === 'file') {
      requestOpen('files', place.ref);
      go('Files');
    } else if (place.ref.startsWith('tile:')) {
      // A built-in database: its desk when it is one, else its own screen.
      const tileKey = place.ref.slice('tile:'.length);
      const key = `db:${tileKey}`;
      const tile = [...WIDE_TILES, ...GRID_TILES].find((t) => t.key === tileKey);
      if (desksControl?.desks.includes(key)) go('Tabs', { screen: key });
      else if (tile && navigationRef.isReady()) openDatabaseTile(navigationRef as never, tile);
    } else {
      const key = `db:custom:${place.ref}`;
      if (desksControl?.desks.includes(key)) go('Tabs', { screen: key });
      else go('CustomDatabase', { databaseId: place.ref });
    }
  };

  const top = insets.top + CHROME_TOP + (topNavOn ? TOP_NAV_SPACE : 0);
  const tileGap = 8;
  const rows: { label: string; icon: string; onPress: () => void }[] = [
    ...CREATE.map((item) => ({ label: item.label, icon: item.icon, onPress: () => create(item) })),
    { label: 'Запис у базі…', icon: 'grid-outline', onPress: createRecord },
    { label: 'Повідомлення в чат', icon: 'chatbubbles-outline', onPress: () => openCapture() },
  ];

  return (
    <SoftSurfaceContext.Provider value={S}>
      <View
        ref={containerRef}
        style={styles.container}
        onLayout={() => containerRef.current?.measureInWindow((_x, y) => {
          containerTop.current = y;
          publishZone();
        })}
      >
        <ScreenGround color={S.bg} />
        <ScrollView
          contentContainerStyle={{ paddingTop: top, paddingBottom: dockClear + insets.bottom + 24 }}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
            scrolled.current = e.nativeEvent.contentOffset.y;
            publishZone();
          }}
        >
          {shown.length > 0 && (
            <View
              style={styles.recents}
              onLayout={(e) => {
                rowAt.current = { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height };
                publishZone();
              }}
            >
              <Text style={[styles.heading, { color: S.ink3 }]}>Нещодавні</Text>
              <ScrollView
                horizontal
                nestedScrollEnabled
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.recentRow}
              >
                {shown.map((place) => {
                  const press = () => openRecent(place);
                  if (place.kind === 'document') return <RecentDocument key={`d:${place.ref}`} id={place.ref} onPress={press} />;
                  if (place.kind === 'board') return <RecentBoard key={`b:${place.ref}`} id={place.ref} onPress={press} />;
                  if (place.kind === 'file') return <RecentFile key={`f:${place.ref}`} id={place.ref} onPress={press} />;
                  if (place.ref.startsWith('tile:')) return <RecentTile key={`x:${place.ref}`} tileKey={place.ref.slice(5)} onPress={press} />;
                  return <RecentDatabase key={`x:${place.ref}`} id={place.ref} onPress={press} />;
                })}
              </ScrollView>
            </View>
          )}

          <Text style={[styles.heading, { color: S.ink3 }]}>Перейти до столу</Text>
          <View style={[styles.tiles, { gap: tileGap }]}>
            <Tile label="Документи" icon="document-text-outline" onPress={() => goToDesk(PERMANENT_DESK, 'DocumentsCopy')} />
            <Tile label="Дошки" icon="easel-outline" onPress={() => goToDesk(BOARDS_DESK, 'BoardsCopy')} />
            <Tile label="Щоденник" icon="book-outline" pip="left" onPress={openCalendar} />
            <Tile label="Бази даних" icon="apps-outline" pip="right" onPress={openDatabases} />
          </View>

          <Text style={[styles.heading, { color: S.ink3, marginTop: 26 }]}>Створити</Text>
          <View style={[styles.list, { backgroundColor: S.card, boxShadow: S.shadow }]}>
            {rows.map((row, i) => (
              <Pressable
                key={row.label}
                onPress={row.onPress}
                style={({ pressed }) => [
                  styles.row,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: S.line },
                  pressed && { backgroundColor: S.fill },
                ]}
              >
                <View style={[styles.seat, { backgroundColor: S.fill }]}>
                  <Ionicons name={row.icon as never} size={18} color={S.ink2} />
                </View>
                <Text style={[styles.rowLabel, { color: S.ink }]} numberOfLines={1}>
                  {row.label}
                </Text>
                <Ionicons name="add" size={18} color={S.ink3} />
              </Pressable>
            ))}
          </View>
        </ScrollView>
        <EdgeFade edge="top" color={S.bg} height={insets.top + CHROME_TOP + TOP_NAV_H} />
        <EdgeFade edge="bottom" color={S.bg} height={Math.round((dockClear + insets.bottom) * 0.85)} />
      </View>
    </SoftSurfaceContext.Provider>
  );
}

// ---- «Нещодавні»: a card for each, drawn the way its own list draws it ----

const CARD_W = 150;
const PIC_H = 118;

function RecentFrame({ label, icon, onPress, children }: { label: string; icon: string; onPress: () => void; children: ReactNode }) {
  const S = useSoft();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, { backgroundColor: S.card, boxShadow: S.shadow }, pressed && { opacity: 0.75 }]}
    >
      <View style={[styles.cardPicture, { backgroundColor: S.fill }]}>{children}</View>
      <View style={styles.cardFoot}>
        <Ionicons name={icon as never} size={15} color={S.ink3} />
        <Text style={[styles.cardLabel, { color: S.ink }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

// A record is read live; gone (deleted) it draws nothing at all.
function useRecord<T>(collection: string, id: string): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(
    () =>
      onSnapshot(
        doc(db, collection, id),
        (snapshot) => setData(snapshot.exists() ? (snapshot.data() as T) : null),
        () => setData(null)
      ),
    [collection, id]
  );
  return data;
}

function RecentDocument({ id, onPress }: { id: string; onPress: () => void }) {
  const data = useRecord<{ title?: string; blocks?: Block[] }>('documents', id);
  if (!data) return null;
  return (
    <RecentFrame onPress={onPress} label={data.title?.trim() || 'Без назви'} icon="document-text-outline">
      <DocumentPageMiniature
        title={data.title ?? ''}
        blocks={data.blocks ?? []}
        tagIds={[]}
        tags={[]}
        project={null}
        width={CARD_W}
        height={PIC_H}
      />
    </RecentFrame>
  );
}

function RecentBoard({ id, onPress }: { id: string; onPress: () => void }) {
  const S = useSoft();
  const data = useRecord<{ title?: string; previewImageUri?: string; previewDriveFileId?: string }>('boards', id);
  if (!data) return null;
  return (
    <RecentFrame onPress={onPress} label={data.title?.trim() || 'Дошка'} icon="easel-outline">
      {data.previewImageUri ? (
        <AttachmentImage
          uri={data.previewImageUri}
          driveFileId={data.previewDriveFileId}
          style={StyleSheet.absoluteFill}
          countsAsUse={false}
        />
      ) : (
        <View style={styles.cardCenter}>
          <Ionicons name="easel-outline" size={34} color={S.ink3} />
        </View>
      )}
    </RecentFrame>
  );
}

function RecentFile({ id, onPress }: { id: string; onPress: () => void }) {
  const data = useRecord<{ title?: string; fileName?: string }>('files', id);
  if (!data) return null;
  const name = data.title || data.fileName || 'Файл';
  return (
    <RecentFrame onPress={onPress} label={name} icon="document-outline">
      <View style={styles.cardCenter}>
        <Ionicons name={fileIconFor(data.fileName ?? name) as never} size={42} color={fileIconColorFor(data.fileName ?? name)} />
      </View>
    </RecentFrame>
  );
}

// A built-in database: its own name and icon, as the desks' bar has them.
function RecentTile({ tileKey, onPress }: { tileKey: string; onPress: () => void }) {
  const S = useSoft();
  const { customDatabases, iconFor } = useDatabaseTiles();
  const face = deskFace(`db:${tileKey}`, customDatabases, iconFor);
  return (
    <RecentFrame onPress={onPress} label={face.label} icon={face.icon}>
      <View style={styles.cardCenter}>
        <Ionicons name={face.icon as never} size={40} color={S.ink2} />
      </View>
    </RecentFrame>
  );
}

function RecentDatabase({ id, onPress }: { id: string; onPress: () => void }) {
  const S = useSoft();
  const data = useRecord<{ name?: string; icon?: string; color?: string }>('customDatabases', id);
  if (!data) return null;
  return (
    <RecentFrame onPress={onPress} label={data.name || 'База'} icon={data.icon ?? 'grid-outline'}>
      <View style={styles.cardCenter}>
        <Ionicons name={(data.icon ?? 'grid-outline') as never} size={40} color={data.color ?? S.ink2} />
      </View>
    </RecentFrame>
  );
}

// One of the four big buttons. A small chevron in the corner it leaves
// toward says which drawer it pulls out.
function Tile({ label, icon, onPress, pip }: { label: string; icon: string; onPress: () => void; pip?: 'left' | 'right' }) {
  const S = useSoft();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tile, { backgroundColor: S.card, boxShadow: S.shadow }, pressed && { opacity: 0.7 }]}
    >
      {pip && (
        <View style={[styles.pip, pip === 'left' ? { left: 4 } : { right: 4 }]}>
          <Ionicons name={pip === 'left' ? 'chevron-back' : 'chevron-forward'} size={14} color={S.ink3} />
        </View>
      )}
      <View style={[styles.tileSeat, { backgroundColor: S.fill }]}>
        <Ionicons name={icon as never} size={19} color={S.ink2} />
      </View>
      <Text style={[styles.tileLabel, { color: S.ink }]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

const SIDE = 16;
const styles = StyleSheet.create({
  container: { flex: 1 },
  heading: { fontSize: 13, fontFamily: SOFT_SEMIBOLD, letterSpacing: 0.2, paddingHorizontal: SIDE + 4, marginBottom: 10 },
  tiles: { flexDirection: 'row', paddingHorizontal: SIDE },
  tile: { flex: 1, minWidth: 0, borderRadius: 20, paddingHorizontal: 10, paddingTop: 12, paddingBottom: 11, gap: 11 },
  tileSeat: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontSize: 12.5, fontFamily: SOFT_SEMIBOLD, letterSpacing: -0.1, lineHeight: 15 },
  pip: { position: 'absolute', top: 9 },
  recents: { marginBottom: 22 },
  recentRow: { gap: 10, paddingHorizontal: SIDE, paddingBottom: 6 },
  card: { width: CARD_W, borderRadius: 20, overflow: 'hidden' },
  cardPicture: { height: PIC_H, overflow: 'hidden' },
  cardCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cardFoot: { height: 40, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12 },
  cardLabel: { flex: 1, fontSize: 13, fontFamily: SOFT_MEDIUM },
  list: { marginHorizontal: SIDE, borderRadius: 22, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, height: 54 },
  seat: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, fontSize: 15, fontFamily: SOFT_MEDIUM },
});
