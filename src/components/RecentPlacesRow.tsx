import { memo, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from './icons/Ionicons';
import DocumentPageMiniature from './DocumentPageMiniature';
import BoardPreviewImage from './BoardPreviewImage';
import { useSoft } from '../theme/soft';
import { SOFT_MEDIUM, SOFT_SEMIBOLD } from '../utils/fonts';
import { doc, onSnapshot } from '../firestore';
import { db } from '../firebase';
import { useDocumentIndex } from '../hooks/useDocumentIndex';
import { useRecentPlaces, type RecentPlace } from '../navigation/recentPlaces';
import { useDeskGate } from '../navigation/deskVisibility';
import { useDatabaseTiles } from '../hooks/useDatabaseTiles';
import { DesksControlContext, deskFace } from '../navigation/desks';
import { GRID_TILES, WIDE_TILES, openDatabaseTile } from '../constants/databaseTiles';
import { navigationRef } from '../navigationRef';
import { requestOpen } from '../utils/openRequest';
import { fileIconColorFor, fileIconFor } from '../utils/fileIcons';
import { FEATURES } from '../features';
import { morph, morphCardRef } from '../utils/morph';
import type { Block, Tag } from '../types';

// «НЕЩОДАВНІ» (the old start screen's row, brought back to the explorer's start desk - the user, 2026-10-25: «додати
// нещодавні в стартовий екран перемикачем на показ приховання в трьох крапках»): one row of cards scrolling sideways,
// a note, a board, a file or a database, each drawn the way its own list draws it. The same pieces screens/StartScreen
// still carries for itself (switched off behind FEATURES.startIsExplorer).

function go(route: string, params?: Record<string, unknown>) {
  if (!navigationRef.isReady()) return;
  (navigationRef.navigate as (name: string, p?: unknown) => void)(route, params);
}

// `kinds`: only these kinds of place (the start desk's list keeps notes and boards).
export default function RecentPlacesRow({ side, kinds }: { side: number; kinds?: RecentPlace['kind'][] }) {
  const S = useSoft();
  const desksControl = useContext(DesksControlContext);
  const recent = useRecentPlaces();
  const index = useDocumentIndex();
  // THE CARDS OUT OF SIGHT COME LATER (optimisation day, 2026-10-27): twelve live page miniatures were built in the
  // first second after a start, each with its own listener - ~200 ms of a frozen app twice over. The row shows the first
  // few at once; the rest one by one once the start has settled (all at once they froze it 200 ms in one piece), or all
  // together the moment the hand reaches for them (the row scrolled).
  const [count, setCount] = useState(FIRST_CARDS);
  // One press function per card, kept: the cards are memos, and a new arrow each time the row grew redrew every card in
  // it (2026-10-27). What a press does is read fresh at the tap.
  const openRef = useRef<(place: RecentPlace) => void>(() => {});
  const presses = useRef(new Map<string, () => void>());
  const pressFor = (place: RecentPlace) => {
    const key = `${place.kind}:${place.ref}`;
    let fn = presses.current.get(key);
    if (!fn) {
      fn = () => openRef.current(place);
      presses.current.set(key, fn);
    }
    return fn;
  };
  useEffect(() => {
    if (count >= 12) return;
    const timer = setTimeout(() => setCount((n) => n + 1), count === FIRST_CARDS ? 3000 : 250);
    return () => clearTimeout(timer);
  }, [count]);
  // A note in the bin is not offered; until the index has arrived, none is judged.
  const shown = recent
    .filter((r) => r.kind !== 'document' || index.size === 0 || (index.has(r.ref) && !index.get(r.ref)?.deletedAt))
    .filter((r) => FEATURES.stickers || r.ref !== 'tile:stickers')
    .filter((r) => !kinds || kinds.includes(r.kind))
    .slice(0, count);
  if (shown.length === 0) return null;
  openRef.current = (place: RecentPlace) => open(place);
  const open = (place: RecentPlace) => {
    // A note grows out of its card and folds back into it on the way out, as from a folder (utils/morph) - from here it
    // only cross-faded and «dissolved into the start» (the user, 2026-10-28).
    if (place.kind === 'document')
      morph(`note:${place.ref}`, (morphing) => go('Editor', { documentId: place.ref, ...(morphing ? { morph: true } : {}) }));
    else if (place.kind === 'board') go('BoardCopy', { boardId: place.ref });
    else if (place.kind === 'file') {
      requestOpen('files', place.ref);
      go('Files');
    } else if (place.ref.startsWith('tile:')) {
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
  return (
    <View style={styles.recents}>
      <Text style={[styles.heading, { color: S.ink3, paddingHorizontal: side + 4 }]}>Нещодавні</Text>
      <ScrollView horizontal nestedScrollEnabled onScrollBeginDrag={() => setCount(12)} showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.recentRow, { paddingHorizontal: side }]}>
        {shown.map((place) => {
          const press = pressFor(place);
          if (place.kind === 'document') return <RecentDocument key={`d:${place.ref}`} id={place.ref} onPress={press} />;
          if (place.kind === 'board') return <RecentBoard key={`b:${place.ref}`} id={place.ref} onPress={press} />;
          if (place.kind === 'file') return <RecentFile key={`f:${place.ref}`} id={place.ref} onPress={press} />;
          if (place.ref.startsWith('tile:')) return <RecentTile key={`x:${place.ref}`} tileKey={place.ref.slice(5)} onPress={press} />;
          return <RecentDatabase key={`x:${place.ref}`} id={place.ref} onPress={press} />;
        })}
      </ScrollView>
    </View>
  );
}

const CARD_W = 150;
// As many as the widest screen shows at once, and one more peeking in.
const FIRST_CARDS = 4;
const PIC_H = 118;

function RecentFrame({ label, icon, onPress, children, morphKey }: { label: string; icon: string; onPress: () => void; children: ReactNode; morphKey?: string }) {
  const S = useSoft();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, { backgroundColor: S.card, boxShadow: S.shadow }, pressed && { opacity: 0.75 }]}>
      <View ref={morphKey ? morphCardRef(morphKey) : undefined} collapsable={false} style={[styles.cardPicture, { backgroundColor: S.fill }]}>
        {children}
      </View>
      <View style={styles.cardFoot}>
        <Ionicons name={icon as never} size={15} color={S.ink3} />
        <Text style={[styles.cardLabel, { color: S.ink }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

// A record is read live; gone (deleted) it draws nothing. Out of sight (deskVisibility), only the newest version waits.
function useRecord<T>(collection: string, id: string): T | null {
  const [data, setData] = useState<T | null>(null);
  const gated = useDeskGate();
  useEffect(
    () =>
      onSnapshot(
        doc(db, collection, id),
        (snapshot) => gated('record', () => setData(snapshot.exists() ? (snapshot.data() as T) : null)),
        () => setData(null)
      ),
    [collection, id, gated]
  );
  return data;
}

const NONE: Block[] = [];
const NO_IDS: string[] = [];
const NO_TAGS: Tag[] = [];

const RecentDocument = memo(function RecentDocument({ id, onPress }: { id: string; onPress: () => void }) {
  const data = useRecord<{ title?: string; blocks?: Block[]; noteFont?: string; noteFontMode?: string }>('documents', id);
  if (!data) return null;
  return (
    <RecentFrame onPress={onPress} label={data.title?.trim() || 'Без назви'} icon="document-text-outline" morphKey={`note:${id}`}>
      <DocumentPageMiniature font={data.noteFont} fontMode={data.noteFontMode} title={data.title ?? ''} blocks={data.blocks ?? NONE} tagIds={NO_IDS} tags={NO_TAGS} project={null} width={CARD_W} height={PIC_H} />
    </RecentFrame>
  );
});

const RecentBoard = memo(function RecentBoard({ id, onPress }: { id: string; onPress: () => void }) {
  const S = useSoft();
  const data = useRecord<{ title?: string; previewImageUri?: string; previewDriveFileId?: string; deletedAt?: number }>('boards', id);
  if (!data || data.deletedAt) return null;
  return (
    <RecentFrame onPress={onPress} label={data.title?.trim() || 'Дошка'} icon="easel-outline">
      <BoardPreviewImage
        boardId={id}
        uri={data.previewImageUri}
        driveFileId={data.previewDriveFileId}
        fallback={
          <View style={styles.cardCenter}>
            <Ionicons name="easel-outline" size={34} color={S.ink3} />
          </View>
        }
      />
    </RecentFrame>
  );
});

const RecentFile = memo(function RecentFile({ id, onPress }: { id: string; onPress: () => void }) {
  const data = useRecord<{ title?: string; fileName?: string; deletedAt?: number }>('files', id);
  if (!data || data.deletedAt) return null;
  const name = data.title || data.fileName || 'Файл';
  return (
    <RecentFrame onPress={onPress} label={name} icon="document-outline">
      <View style={styles.cardCenter}>
        <Ionicons name={fileIconFor(data.fileName ?? name) as never} size={42} color={fileIconColorFor(data.fileName ?? name)} />
      </View>
    </RecentFrame>
  );
});

const RecentTile = memo(function RecentTile({ tileKey, onPress }: { tileKey: string; onPress: () => void }) {
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
});

const RecentDatabase = memo(function RecentDatabase({ id, onPress }: { id: string; onPress: () => void }) {
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
});

const styles = StyleSheet.create({
  recents: { marginBottom: 18 },
  heading: { fontSize: 13, fontFamily: SOFT_SEMIBOLD, letterSpacing: 0.2, marginBottom: 10 },
  recentRow: { gap: 10, paddingBottom: 6 },
  card: { width: CARD_W, borderRadius: 20, overflow: 'hidden' },
  cardPicture: { height: PIC_H, overflow: 'hidden' },
  cardCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cardFoot: { height: 40, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12 },
  cardLabel: { flex: 1, fontSize: 13, fontFamily: SOFT_MEDIUM },
});
