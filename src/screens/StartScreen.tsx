import { categoryFromSiteName } from '../utils/linkCategory';
import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useTags } from '../hooks/useTags';
import { requestFolder } from '../navigation/folderArrival';
import { usePullToSearch } from '../hooks/usePullToSearch';
import { openDeskSwitcher } from '../navigation/deskSwitcherBus';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '../components/icons/Ionicons';
import ScreenGround from '../components/ScreenGround';
import EdgeFade from '../components/EdgeFade';
import { TOP_NAV_H, TOP_NAV_SPACE, useTopNavOn } from '../components/TopNavBar';
import { ask } from '../components/surfaces/Ask';
import { CHROME_TOP } from '../constants/rail';
import { SoftSurfaceContext, useSoft } from '../theme/soft';
import { SOFT_MEDIUM, SOFT_SEMIBOLD } from '../utils/fonts';
import { useDockClearance } from '../navigation/dockGeometry';
import { useChromeStyle, useDockBeads, useTopBack } from '../navigation/navDock';
import { useSideDrawers } from '../navigation/sideDrawers';
import { BOARDS_DESK, DesksControlContext, PERMANENT_DESK, deskFace, deskKeyForCustom } from '../navigation/desks';
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

  // Pulled down from the top: let go and the search; hold and the open
  // desks (usePullToSearch) - the same as on every list.
  const pull = usePullToSearch(() => go('Search'), true, openDeskSwitcher);
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
  // «РОБОЧІ СТОЛИ» (the user's, 2026-10-04): «Перейти до столу» is gone,
  // and «Створити» became the way to every database. A row opens (it does
  // not go anywhere on a tap): inside, making one, opening the database as
  // a desk of its own («в новому вікні»), going to it, and then its root
  // folders - a tap on one lands in the database standing in it. A
  // database with no folders (the tasks, the stickers, the diary, the
  // chat) has nothing to open: its row goes straight there.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { tags } = useTags();
  const { customDatabases } = useDatabaseTiles();
  const isDesk = (key: string) => !!desksControl?.desks.includes(key);
  const goToBase = (deskKey: string, route: string, params?: Record<string, unknown>) => {
    if (isDesk(deskKey)) go('Tabs', { screen: deskKey });
    else go(route, params);
  };
  const rootFolders = (kind: string) => {
    const seen = new Map<string, string | undefined>();
    for (const tag of tags) {
      if (!tag.types.includes(kind as never)) continue;
      const root = tag.path.split('/')[0];
      if (!root) continue;
      if (!seen.has(root) || tag.path === root) seen.set(root, tag.path === root ? tag.color : seen.get(root));
    }
    return Array.from(seen.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, color]) => ({ name, color }));
  };
  const base = (
    key: string,
    label: string,
    icon: string,
    folderKind: string,
    createLabel: string,
    createItem: Create,
    deskKey: string,
    route: string,
    params?: Record<string, unknown>,
    root?: Omit<DeskRoot, 'kind' | 'folderTagIds' | 'onMore'>
  ): DeskRow => ({
    key,
    label,
    icon,
    root: root && {
      ...root,
      kind: folderKind,
      folderTagIds: new Set(tags.filter((t) => t.types.includes(folderKind as never)).map((t) => t.id)),
      onMore: () => goToBase(deskKey, route, params),
    },
    items: [
      { key: 'create', label: createLabel, short: 'Створити', icon: 'add-outline', onPress: () => create(createItem) },
      // Already one of the desks: a second window of it is not a thing.
      ...(isDesk(deskKey)
        ? []
        : [{ key: 'window', label: 'Відкрити в новому вікні', short: 'Нове вікно', icon: 'copy-outline', onPress: () => whenDeskIsThere(deskKey, () => go('Tabs', { screen: deskKey })) }]),
      { key: 'go', label: 'Перейти до бази', short: 'Перейти', icon: 'arrow-forward-outline', onPress: () => goToBase(deskKey, route, params) },
      ...rootFolders(folderKind).map((folder) => ({
        key: `f:${folder.name}`,
        label: folder.name,
        icon: 'folder-outline',
        color: folder.color,
        folder: true,
        onPress: () => {
          const onDesk = isDesk(deskKey);
          requestFolder(folderKind, folder.name, onDesk ? 'desk' : 'screen');
          goToBase(deskKey, route, params);
        },
      })),
    ],
  });
  const createOf = (key: string) => CREATE.find((c) => c.key === key) as Create;
  // A record opened from its database - on its desk when it is one, or a
  // pushed copy - the way the folders' canvas opens one (openRequest).
  const openIn = (collection: string, deskKey: string, route: string, params?: Record<string, unknown>) => (id: string) => {
    requestOpen(collection, id);
    goToBase(deskKey, route, params);
  };
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const deskRows: DeskRow[] = [
    base('doc', 'Документи', 'document-text-outline', 'document', 'Створити документ', createOf('doc'), PERMANENT_DESK, 'DocumentsCopy', undefined, {
      collection: 'documents',
      belongs: (r) => !r.calendarDate,
      titleOf: (r) => str(r.title),
      icon: 'document-text-outline',
      onOpen: (id) => go('Editor', { documentId: id }),
    }),
    base('board', 'Дошки', 'easel-outline', 'board', 'Створити дошку', createOf('board'), BOARDS_DESK, 'BoardsCopy', undefined, {
      collection: 'boards',
      titleOf: (r) => str(r.title),
      icon: 'easel-outline',
      onOpen: (id) => go('BoardCopy', { boardId: id }),
    }),
    { key: 'task', label: 'Справи', icon: 'checkbox-outline', direct: () => goToBase('db:tasks', 'Tasks') },
    { key: 'sticker', label: 'Стікери', icon: 'reader-outline', direct: () => goToBase('db:stickers', 'Stickers') },
    base('card', 'Картки', 'albums-outline', 'flashcard', 'Створити картку', createOf('card'), 'db:flashcards', 'Flashcards', undefined, {
      collection: 'flashcards',
      titleOf: (r) => str(r.term),
      icon: 'albums-outline',
      onOpen: openIn('flashcards', 'db:flashcards', 'Flashcards'),
    }),
    base('link', 'Посилання', 'link-outline', 'link-other', 'Додати посилання', createOf('link'), 'db:links', 'Links', { category: 'other' }, {
      collection: 'links',
      belongs: (r) => categoryFromSiteName(r.siteName as string | undefined) === 'other',
      titleOf: (r) => str(r.title) || str(r.url),
      icon: 'link-outline',
      onOpen: openIn('links', 'db:links', 'Links', { category: 'other' }),
    }),
    base('photo', 'Зображення', 'image-outline', 'photo', 'Додати зображення', createOf('photo'), 'db:photos', 'Photos', undefined, {
      collection: 'photos',
      titleOf: (r) => str(r.title) || 'Зображення',
      icon: 'image-outline',
      onOpen: openIn('photos', 'db:photos', 'Photos'),
    }),
    base('file', 'Файли', 'document-outline', 'file', 'Додати файл', createOf('file'), 'db:files', 'Files', undefined, {
      collection: 'files',
      titleOf: (r) => str(r.title) || str(r.fileName),
      icon: 'document-outline',
      onOpen: openIn('files', 'db:files', 'Files'),
    }),
    { key: 'diary', label: 'Щоденник', icon: 'book-outline', direct: openCalendar },
    {
      key: 'bases',
      label: 'Бази даних',
      icon: 'apps-outline',
      items: [
        { key: 'create', label: 'Створити запис у базі…', short: 'Новий запис', icon: 'add-outline', onPress: createRecord },
        { key: 'go', label: 'Перейти до баз', short: 'Перейти', icon: 'arrow-forward-outline', onPress: openDatabases },
        ...[...customDatabases]
          .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))
          .map((d) => ({
            key: `db:${d.id}`,
            label: d.name || 'Без назви',
            icon: (d.icon as string) ?? 'grid-outline',
            onPress: () => goToBase(deskKeyForCustom(d.id), 'CustomDatabase', { databaseId: d.id }),
          })),
      ],
    },
    { key: 'chat', label: 'Чат', icon: 'chatbubbles-outline', direct: () => go('Chat') },
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
        <Animated.View style={[styles.container, pull.pullStyle]}>
        <GestureDetector gesture={pull.gesture}>
        <ScrollView
          {...pull.listProps}
          contentContainerStyle={{ paddingTop: top, paddingBottom: dockClear + insets.bottom + 24 }}
          showsVerticalScrollIndicator={false}
          onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
            pull.listProps.onScroll(e);
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

          <Text style={[styles.heading, { color: S.ink3 }]}>Робочі столи</Text>
          <Animated.View layout={LinearTransition.duration(220)} style={[styles.list, { backgroundColor: S.card, boxShadow: S.shadow }]}>
            {deskRows.map((row, i) => (
              <DeskRowView
                key={row.key}
                row={row}
                first={i === 0}
                open={expanded.has(row.key)}
                onToggle={() =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(row.key)) next.delete(row.key);
                    else next.add(row.key);
                    return next;
                  })
                }
              />
            ))}
          </Animated.View>
        </ScrollView>
        </GestureDetector>
        </Animated.View>
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
// `short`: one of the actions at the top of an open row, drawn as a button
// with this word - the rest (folders, records) are the list under them.
type DeskItem = { key: string; label: string; icon: string; color?: string; folder?: boolean; short?: string; onPress: () => void };
type DeskRoot = {
  collection: string;
  // The folders' tag kind - a record in none of them is at the root.
  kind: string;
  folderTagIds: Set<string>;
  // Which of the collection's records belong to this database at all.
  belongs?: (row: Record<string, unknown>) => boolean;
  titleOf: (row: Record<string, unknown>) => string;
  icon: string;
  onOpen: (id: string) => void;
  onMore: () => void;
};
type DeskRow = { key: string; label: string; icon: string; items?: DeskItem[]; root?: DeskRoot; direct?: () => void };

// How many of the root's own records a row shows before «Подивитись решту».
const ROOT_LIMIT = 10;

// What lies at a database's root, in no folder - newest first, the first
// ROOT_LIMIT of them (the user's, 2026-10-04: "повинні також показуватися
// файли"). Listened to only while its row is open.
function RootItems({ root }: { root: DeskRoot }) {
  const S = useSoft();
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  useEffect(
    () =>
      onSnapshot(
        ownedQuery(root.collection),
        (snapshot) => setRows(snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))),
        listenError(`StartScreen:root:${root.collection}`)
      ),
    [root.collection]
  );
  if (!rows) return null;
  const here = rows
    .filter((r) => !r.deletedAt && r.trashed !== true && (root.belongs ? root.belongs(r) : true))
    .filter((r) => !((r.tagIds as string[] | undefined) ?? []).some((id) => root.folderTagIds.has(id)))
    .sort(
      (a, b) =>
        Number(b.updatedAt ?? b.createdAt ?? 0) - Number(a.updatedAt ?? a.createdAt ?? 0)
    );
  return (
    <>
      {here.slice(0, ROOT_LIMIT).map((r) => (
        <Pressable
          key={r.id as string}
          onPress={() => root.onOpen(r.id as string)}
          style={({ pressed }) => [styles.insideRow, { borderTopColor: S.line }, pressed && { backgroundColor: S.fill }]}
        >
          <Ionicons name={root.icon as never} size={17} color={S.ink3} />
          <Text style={[styles.insideLabel, { color: S.ink }]} numberOfLines={1}>
            {root.titleOf(r) || 'Без назви'}
          </Text>
        </Pressable>
      ))}
      {here.length > ROOT_LIMIT && (
        <Pressable
          onPress={root.onMore}
          style={({ pressed }) => [styles.insideRow, { borderTopColor: S.line }, pressed && { backgroundColor: S.fill }]}
        >
          <Text style={[styles.insideLabel, { color: S.ink2 }]} numberOfLines={1}>
            Подивитись решту в базі ({here.length - ROOT_LIMIT})
          </Text>
          <Ionicons name="arrow-forward-outline" size={17} color={S.ink2} />
        </Pressable>
      )}
    </>
  );
}

// One row of «Робочі столи»: a database, opened in place to show what can
// be done with it and its root folders - or, with nothing inside, a way
// straight there.
function DeskRowView({ row, first, open, onToggle }: { row: DeskRow; first: boolean; open: boolean; onToggle: () => void }) {
  const S = useSoft();
  const expandable = !!row.items;
  return (
    <Animated.View layout={LinearTransition.duration(220)}>
      <Pressable
        onPress={expandable ? onToggle : row.direct}
        style={({ pressed }) => [
          styles.row,
          !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: S.line },
          pressed && { backgroundColor: S.fill },
        ]}
      >
        <View style={[styles.seat, { backgroundColor: S.fill }]}>
          <Ionicons name={row.icon as never} size={18} color={S.ink2} />
        </View>
        <Text style={[styles.rowLabel, { color: S.ink }]} numberOfLines={1}>
          {row.label}
        </Text>
        <Ionicons name={expandable ? (open ? 'chevron-up' : 'chevron-down') : 'chevron-forward'} size={18} color={S.ink3} />
      </Pressable>
      {open && row.items && (
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)} style={styles.inside}>
          {/* What can be done with it: real buttons, a row of them - not
              lines of text one could miss (the user's worry, 2026-10-04). */}
          <View style={styles.actions}>
            {row.items
              .filter((item) => item.short)
              .map((item) => (
                <Pressable
                  key={item.key}
                  onPress={item.onPress}
                  accessibilityLabel={item.label}
                  style={({ pressed }) => [styles.action, { backgroundColor: pressed ? S.line : S.fill }]}
                >
                  <Ionicons name={item.icon as never} size={17} color={S.ink} />
                  <Text style={[styles.actionLabel, { color: S.ink }]} numberOfLines={1}>
                    {item.short}
                  </Text>
                </Pressable>
              ))}
          </View>
          {/* What is in it: a plain list, each line the whole width between
              hairlines, so where one ends is seen. */}
          {row.items
            .filter((item) => !item.short)
            .map((item) => (
              <Pressable
                key={item.key}
                onPress={item.onPress}
                style={({ pressed }) => [styles.insideRow, { borderTopColor: S.line }, pressed && { backgroundColor: S.fill }]}
              >
                <Ionicons name={item.icon as never} size={17} color={item.color || S.ink2} />
                <Text style={[styles.insideLabel, { color: S.ink }]} numberOfLines={1}>
                  {item.label}
                </Text>
              </Pressable>
            ))}
          {row.root && <RootItems root={row.root} />}
        </Animated.View>
      )}
    </Animated.View>
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
  inside: { paddingLeft: 60, paddingRight: 14, paddingBottom: 8 },
  actions: { flexDirection: 'row', gap: 8, paddingTop: 2, paddingBottom: 10 },
  action: { flex: 1, minWidth: 0, height: 40, borderRadius: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 8 },
  actionLabel: { fontSize: 13.5, fontFamily: SOFT_SEMIBOLD, flexShrink: 1 },
  insideRow: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 48, paddingHorizontal: 6, borderTopWidth: StyleSheet.hairlineWidth },
  insideLabel: { flex: 1, fontSize: 14.5, fontFamily: SOFT_MEDIUM },
});
