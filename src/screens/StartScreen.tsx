import { useContext } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { BOARDS_DESK, DesksControlContext, PERMANENT_DESK } from '../navigation/desks';
import { requestCreate } from '../navigation/startCreate';
import { navigationRef } from '../navigationRef';
import { onSnapshot } from '../firestore';
import { ownedQuery } from '../utils/owned';
import { listenError } from '../utils/listenError';
import type { CustomDatabase } from '../types';

// THE START DESK (2026-10-03, the user's own design, mocked up first):
// the phone's first desk. Under the desks' bar, a row of four big buttons
// - «Перейти до столу»: the documents and the boards (desks), the diary
// (the calendar's drawer, from the left) and the databases (their drawer,
// from the right) - and below it «Створити»: everything the app makes,
// one row each. The whole page scrolls. Next slices: the recents row, the
// sideways-scroll gesture zones, and the bar's «+».

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

  // The first desk: nowhere before it to go back to, so its way back
  // stands dimmed in its place.
  useTopBack(null, topNavOn);

  const create = (item: Create) => {
    // The boards' desk may have been closed: then the boards' own copy.
    if (item.key === 'board' && desksControl && !desksControl.desks.includes(BOARDS_DESK)) {
      requestCreate('BoardsCopy', undefined, 'BoardsCopy');
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

  const top = insets.top + CHROME_TOP + (topNavOn ? TOP_NAV_SPACE : 0);
  const tileGap = 8;
  const rows: { label: string; icon: string; onPress: () => void }[] = [
    ...CREATE.map((item) => ({ label: item.label, icon: item.icon, onPress: () => create(item) })),
    { label: 'Запис у базі…', icon: 'grid-outline', onPress: createRecord },
    { label: 'Повідомлення в чат', icon: 'chatbubbles-outline', onPress: () => openCapture() },
  ];

  return (
    <SoftSurfaceContext.Provider value={S}>
      <View style={styles.container}>
        <ScreenGround color={S.bg} />
        <ScrollView
          contentContainerStyle={{ paddingTop: top, paddingBottom: dockClear + insets.bottom + 24 }}
          showsVerticalScrollIndicator={false}
        >
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
  list: { marginHorizontal: SIDE, borderRadius: 22, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, height: 54 },
  seat: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, fontSize: 15, fontFamily: SOFT_MEDIUM },
});
