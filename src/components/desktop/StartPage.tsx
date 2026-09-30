import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { doc, onSnapshot } from '../../firestore';
import { db } from '../../firebase';
import { Ionicons } from '../icons/Ionicons';
import AttachmentImage from '../AttachmentImage';
import DocumentPageMiniature from '../DocumentPageMiniature';
import { navigationRef } from '../../navigationRef';
import { useNavDockBeads } from '../../navigation/navDock';
import { addTab, leaveStart, useRecentPlaces, type RecentPlace } from '../../navigation/desktopTabs';
import { useWorkspace } from '../../navigation/workspace';
import { groupHits, useGlobalSearch, type SearchHit, type SearchTarget } from '../../hooks/useGlobalSearch';
import { useDocumentIndex } from '../../hooks/useDocumentIndex';
import { ownedQuery } from '../../utils/owned';
import { listenError } from '../../utils/listenError';
import { ask } from '../surfaces/Ask';
import { useSoft } from '../../theme/soft';
import { SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../../utils/fonts';
import type { Block, CustomDatabase } from '../../types';

// THE START PAGE - what a new tab opens on the laptop (the «+» in the tab
// row). Three things, top to bottom, the order a hand reaches for them:
//
//   a search over everything, the cursor already in it - type a name and
//   Enter opens it (a record of a personal database opens as its own card);
//   «Створити» - one tile for every kind of thing the app makes;
//   «Нещодавні» - what was worked with lately on this Mac, as pictures.
//
// Making a thing does not skip its list: the list opens first and the new
// thing on top of it, so «Назад» from a new note lands in the documents
// (the user's own «спочатку вікно документів, а потім вікно документа»).
// That is done by going to the list and pressing its own «+» - the dock's
// right bead, which every list publishes - so each list makes its things
// exactly the way it always has, and nothing here has to know how.

type Create = { key: string; label: string; icon: string; route: string; params?: Record<string, unknown> };

const CREATE: Create[] = [
  { key: 'doc', label: 'Документ', icon: 'document-text-outline', route: 'Tabs', params: { screen: 'Документи' } },
  { key: 'board', label: 'Дошка', icon: 'easel-outline', route: 'BoardsCopy' },
  { key: 'task', label: 'Справа', icon: 'checkbox-outline', route: 'Tasks' },
  { key: 'sticker', label: 'Стікер', icon: 'reader-outline', route: 'Stickers' },
  { key: 'card', label: 'Картка', icon: 'albums-outline', route: 'Flashcards' },
  { key: 'link', label: 'Посилання', icon: 'link-outline', route: 'Links', params: { category: 'other' } },
  { key: 'photo', label: 'Зображення', icon: 'image-outline', route: 'Photos' },
  { key: 'file', label: 'Файл', icon: 'document-outline', route: 'Files' },
];

// Which route name the navigator reports once it stands on the list.
const ARRIVED: Record<string, string> = {
  Tabs: 'Документи',
  BoardsCopy: 'BoardsCopy',
  Tasks: 'Tasks',
  Stickers: 'Stickers',
  Flashcards: 'Flashcards',
  Links: 'Links',
  Photos: 'Photos',
  Files: 'Files',
  CustomDatabase: 'CustomDatabase',
};

function navigate(route: string, params?: Record<string, unknown>) {
  if (!navigationRef.isReady()) return;
  (navigationRef.navigate as (name: string, p?: unknown) => void)(route, params);
}

function openTarget(target: SearchTarget) {
  leaveStart();
  switch (target.kind) {
    case 'document':
      navigate('Editor', { documentId: target.documentId });
      return;
    case 'links':
      navigate('Links', { category: target.category });
      return;
    case 'screen':
      navigate(target.route);
      return;
    case 'customDatabase':
      navigate('CustomDatabase', { databaseId: target.databaseId, openRowId: target.rowId });
      return;
    case 'board':
      navigate('BoardCopy', { boardId: target.boardId });
  }
}

function openRecent(place: RecentPlace) {
  leaveStart();
  if (place.kind === 'note') navigate('Editor', { documentId: place.ref });
  else if (place.kind === 'board') navigate('BoardCopy', { boardId: place.ref });
  else navigate('CustomDatabase', { databaseId: place.ref });
}

// ---- «Нещодавні»: a card per place, drawn the way its own list draws it ----

const CARD_W = 180;
const CARD_H = 224;

function RecentNote({ id, onPress }: { id: string; onPress: () => void }) {
  const S = useSoft();
  const [data, setData] = useState<{ title?: string; blocks?: Block[] } | null>(null);
  useEffect(
    () =>
      onSnapshot(
        doc(db, 'documents', id),
        (snapshot) => setData((snapshot.data() as typeof data) ?? null),
        () => setData(null)
      ),
    [id]
  );
  return (
    <RecentFrame onPress={onPress} label={data?.title?.trim() || 'Без назви'} icon="document-text-outline">
      <View style={[styles.cardPicture, { backgroundColor: S.card }]}>
        {data && (
          <DocumentPageMiniature
            title={data.title ?? ''}
            blocks={data.blocks ?? []}
            tagIds={[]}
            tags={[]}
            project={null}
            width={CARD_W}
            height={CARD_H - 40}
          />
        )}
      </View>
    </RecentFrame>
  );
}

function RecentBoard({ id, onPress }: { id: string; onPress: () => void }) {
  const S = useSoft();
  const [data, setData] = useState<{ title?: string; previewImageUri?: string; previewDriveFileId?: string } | null>(null);
  useEffect(
    () =>
      onSnapshot(
        doc(db, 'boards', id),
        (snapshot) => setData((snapshot.data() as typeof data) ?? null),
        () => setData(null)
      ),
    [id]
  );
  return (
    <RecentFrame onPress={onPress} label={data?.title?.trim() || 'Дошка'} icon="easel-outline">
      <View style={[styles.cardPicture, { backgroundColor: S.fill, alignItems: 'center', justifyContent: 'center' }]}>
        {data?.previewImageUri ? (
          <AttachmentImage
            uri={data.previewImageUri}
            driveFileId={data.previewDriveFileId}
            style={StyleSheet.absoluteFill}
            countsAsUse={false}
          />
        ) : (
          <Ionicons name="easel-outline" size={34} color={S.ink3} />
        )}
      </View>
    </RecentFrame>
  );
}

function RecentDatabase({ id, onPress }: { id: string; onPress: () => void }) {
  const S = useSoft();
  const [data, setData] = useState<{ name?: string; icon?: string; color?: string } | null>(null);
  useEffect(
    () =>
      onSnapshot(
        doc(db, 'customDatabases', id),
        (snapshot) => setData((snapshot.data() as typeof data) ?? null),
        () => setData(null)
      ),
    [id]
  );
  return (
    <RecentFrame onPress={onPress} label={data?.name || 'База'} icon={data?.icon ?? 'grid-outline'}>
      <View style={[styles.cardPicture, { backgroundColor: S.fill, alignItems: 'center', justifyContent: 'center' }]}>
        <Ionicons name={(data?.icon ?? 'grid-outline') as never} size={40} color={data?.color ?? S.ink2} />
      </View>
    </RecentFrame>
  );
}

function RecentFrame({
  label,
  icon,
  onPress,
  children,
}: {
  label: string;
  icon: string;
  onPress: () => void;
  children: React.ReactNode;
}) {
  const S = useSoft();
  return (
    <Pressable
      onPress={onPress}
      style={(state) => [
        styles.card,
        { backgroundColor: S.card, boxShadow: (state as { hovered?: boolean }).hovered ? S.popShadow : S.shadow },
      ]}
    >
      {children}
      <View style={styles.cardFoot}>
        <Ionicons name={icon as never} size={14} color={S.ink3} />
        <Text style={[styles.cardLabel, { color: S.ink }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

// ---- «Створити», finished after the page has gone ---------------------------

let pendingCreate: { wanted: string; since: number; arrivedAt: number } | null = null;

// Mounted with the shell for good (StartPageHost): once the list asked for
// is the one standing, and has had a beat to publish its own «+» over the
// last screen's, that «+» is pressed.
export function CreateWatcher() {
  const beads = useNavDockBeads();
  const beadsRef = useRef(beads);
  beadsRef.current = beads;
  useEffect(() => {
    const timer = setInterval(() => {
      const job = pendingCreate;
      if (!job) return;
      if (Date.now() - job.since > 4000) {
        pendingCreate = null;
        return;
      }
      const here = navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : undefined;
      if (here !== job.wanted) return;
      if (!job.arrivedAt) job.arrivedAt = Date.now();
      if (Date.now() - job.arrivedAt < 250) return;
      const right = beadsRef.current.right;
      if (!right || right.badge !== 'add-circle-outline') return;
      pendingCreate = null;
      right.onPress();
    }, 80);
    return () => clearInterval(timer);
  }, []);
  return null;
}

// ---- the page ----------------------------------------------------------------

export default function StartPage() {
  const S = useSoft();
  const workspace = useWorkspace();
  const recent = useRecentPlaces();
  const index = useDocumentIndex();
  const [query, setQuery] = useState('');
  const [focus, setFocus] = useState(0);
  const hits = useGlobalSearch(query);
  const flat = useMemo(() => groupHits(hits).flatMap((g) => g.hits).slice(0, 40), [hits]);
  const grouped = useMemo(() => groupHits(flat), [flat]);

  // A note that is gone (in the bin, or deleted) is not offered.
  const shownRecent = recent
    .filter((r) => r.kind !== 'note' || (index.has(r.ref) && !index.get(r.ref)?.deletedAt) || index.size === 0)
    .slice(0, 12);

  // «Створити»: the list first, then its own «+» (see the top of the file).
  // The page is gone the moment it is left, so the waiting is done by
  // CreateWatcher, which stays mounted.
  const create = (item: { route: string; params?: Record<string, unknown> }) => {
    pendingCreate = { wanted: ARRIVED[item.route], since: Date.now(), arrivedAt: 0 };
    leaveStart();
    navigate(item.route, item.params);
  };

  // A record in a database of one's own: which database first.
  const createRecord = async () => {
    const snapshot = await new Promise<CustomDatabase[]>((resolve) => {
      const stop = onSnapshot(
        ownedQuery('customDatabases'),
        (s) => {
          stop();
          resolve(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CustomDatabase, 'id'>) }) as CustomDatabase));
        },
        (e) => {
          listenError('StartPage:databases')(e);
          resolve([]);
        }
      );
    });
    if (snapshot.length === 0) return;
    const id = await ask({
      title: 'У яку базу?',
      actions: snapshot
        .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))
        .map((d) => ({ id: d.id, label: d.name || 'Без назви', icon: (d.icon as never) ?? 'grid-outline' })),
    });
    if (!id || id === 'cancel') return;
    create({ route: 'CustomDatabase', params: { databaseId: id } });
  };

  const sections: { key: string; label: string; icon: string; ref: string }[] = [
    { key: 'cal', label: 'Календар', icon: 'calendar-outline', ref: 'Календар' },
    { key: 'boards', label: 'Дошки', icon: 'easel-outline', ref: 'Дошки' },
    { key: 'dbs', label: 'Бази', icon: 'apps-outline', ref: 'Більше' },
    { key: 'tasks', label: 'Справи', icon: 'checkbox-outline', ref: 'Tasks' },
  ];

  return (
    <View style={[styles.page, { backgroundColor: S.bg }]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.column}>
          {/* Search - the cursor is already in it. */}
          <View style={[styles.search, { backgroundColor: S.card, boxShadow: S.shadow }]}>
            <Ionicons name="search-outline" size={18} color={S.ink3} />
            <TextInput
              autoFocus
              value={query}
              onChangeText={(text) => {
                setQuery(text);
                setFocus(0);
              }}
              placeholder="Знайти документ, дошку, запис у базі…"
              placeholderTextColor={S.ink3}
              style={[styles.searchInput, { color: S.ink }]}
              onKeyPress={(e) => {
                const key = (e.nativeEvent as { key: string }).key;
                if (key === 'ArrowDown') setFocus((f) => Math.min(flat.length - 1, f + 1));
                else if (key === 'ArrowUp') setFocus((f) => Math.max(0, f - 1));
                else if (key === 'Escape') setQuery('');
              }}
              onSubmitEditing={() => {
                const hit = flat[focus];
                if (hit) openTarget(hit.target);
              }}
            />
            {!!query && (
              <Pressable hitSlop={8} onPress={() => setQuery('')}>
                <Ionicons name="close" size={16} color={S.ink3} />
              </Pressable>
            )}
          </View>

          {query.trim() ? (
            <View style={styles.results}>
              {flat.length === 0 && <Text style={[styles.empty, { color: S.ink3 }]}>Нічого не знайдено</Text>}
              {grouped.map((group) => (
                <View key={group.section.key} style={styles.group}>
                  <Text style={[styles.groupLabel, { color: S.ink3 }]}>{group.section.label}</Text>
                  {group.hits.map((hit: SearchHit) => {
                    const at = flat.indexOf(hit);
                    const on = at === focus;
                    return (
                      <Pressable
                        key={hit.key}
                        onPress={() => openTarget(hit.target)}
                        style={(state) => [
                          styles.hit,
                          (on || (state as { hovered?: boolean }).hovered) && { backgroundColor: S.fill },
                        ]}
                      >
                        <Ionicons name={hit.section.icon} size={16} color={hit.section.color} />
                        <Text style={[styles.hitTitle, { color: S.ink }]} numberOfLines={1}>
                          {hit.title}
                        </Text>
                        {!!hit.match && `${hit.match.before}${hit.match.match}${hit.match.after}`.trim() !== hit.title && (
                          <Text style={[styles.hitSnippet, { color: S.ink3 }]} numberOfLines={1}>
                            {`${hit.match.before}${hit.match.match}${hit.match.after}`.trim()}
                          </Text>
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>
          ) : (
            <>
              <Text style={[styles.heading, { color: S.ink3 }]}>Створити</Text>
              <View style={styles.tiles}>
                {CREATE.map((item) => (
                  <CreateTile key={item.key} label={item.label} icon={item.icon} onPress={() => create(item)} />
                ))}
                <CreateTile label="Запис у базі…" icon="grid-outline" onPress={createRecord} />
                <CreateTile
                  label="Повідомлення в чат"
                  icon="chatbubbles-outline"
                  onPress={() => {
                    leaveStart();
                    workspace?.open({ kind: 'chat' });
                  }}
                />
              </View>

              <Text style={[styles.heading, { color: S.ink3 }]}>Відкрити</Text>
              <View style={styles.tiles}>
                {sections.map((section) => (
                  <CreateTile
                    key={section.key}
                    label={section.label}
                    icon={section.icon}
                    quiet
                    onPress={() => {
                      leaveStart();
                      const tab = addTab('section', section.ref);
                      if (tab.ref === 'Tasks') navigate('Tasks');
                      else navigate('Tabs', { screen: tab.ref });
                    }}
                  />
                ))}
              </View>

              {shownRecent.length > 0 && (
                <>
                  <Text style={[styles.heading, { color: S.ink3 }]}>Нещодавні</Text>
                  <View style={styles.recent}>
                    {shownRecent.map((place) =>
                      place.kind === 'note' ? (
                        <RecentNote key={`n:${place.ref}`} id={place.ref} onPress={() => openRecent(place)} />
                      ) : place.kind === 'board' ? (
                        <RecentBoard key={`b:${place.ref}`} id={place.ref} onPress={() => openRecent(place)} />
                      ) : (
                        <RecentDatabase key={`d:${place.ref}`} id={place.ref} onPress={() => openRecent(place)} />
                      )
                    )}
                  </View>
                </>
              )}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function CreateTile({ label, icon, onPress, quiet }: { label: string; icon: string; onPress: () => void; quiet?: boolean }) {
  const S = useSoft();
  return (
    <Pressable
      onPress={onPress}
      style={(state) => [
        styles.tile,
        { backgroundColor: quiet ? S.fill : S.card },
        !quiet && { boxShadow: (state as { hovered?: boolean }).hovered ? S.popShadow : S.shadow },
        quiet && (state as { hovered?: boolean }).hovered && { backgroundColor: S.card },
      ]}
    >
      <Ionicons name={icon as never} size={18} color={S.ink2} />
      <Text style={[styles.tileLabel, { color: S.ink }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 25 },
  scroll: { paddingVertical: 48, paddingHorizontal: 24, alignItems: 'center' },
  column: { width: '100%', maxWidth: 900, gap: 12 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, borderRadius: 24, paddingHorizontal: 18 },
  searchInput: { flex: 1, fontSize: 16, fontFamily: SOFT_REGULAR, outlineStyle: 'none' } as never,
  heading: { fontSize: 12.5, fontFamily: SOFT_MEDIUM, marginTop: 20, paddingLeft: 4 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 44, paddingHorizontal: 16, borderRadius: 14 },
  tileLabel: { fontSize: 14, fontFamily: SOFT_MEDIUM },
  recent: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  card: { width: CARD_W, height: CARD_H, borderRadius: 16, overflow: 'hidden' },
  cardPicture: { flex: 1, overflow: 'hidden' },
  cardFoot: { height: 40, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12 },
  cardLabel: { flex: 1, fontSize: 13, fontFamily: SOFT_MEDIUM },
  results: { gap: 10, marginTop: 8 },
  empty: { fontSize: 14, fontFamily: SOFT_REGULAR, paddingTop: 12, textAlign: 'center' },
  group: { gap: 2 },
  groupLabel: { fontSize: 12, fontFamily: SOFT_MEDIUM, paddingLeft: 12, paddingBottom: 4 },
  hit: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 34, paddingHorizontal: 12, borderRadius: 9 },
  hitTitle: { fontSize: 14, fontFamily: SOFT_MEDIUM, flexShrink: 1 },
  hitSnippet: { flex: 1, fontSize: 12.5, fontFamily: SOFT_REGULAR },
});
