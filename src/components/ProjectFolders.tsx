import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { BackHandler, GestureResponderEvent, Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, Extrapolation, interpolate, interpolateColor, runOnJS, useAnimatedReaction, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';
import { GlassPortal } from './GlassPortal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePressSettle } from '../hooks/usePressSettle';
import { withFlipTarget } from '../utils/flipOpen';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import * as ImagePicker from 'expo-image-picker';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import BackgroundStylist from './BackgroundStylist';
import { useNavigation } from '@react-navigation/native';
import { deleteField } from '../firestore';
import { Ionicons } from './icons/Ionicons';
import FolderPattern, { patternKeyOf } from './FolderPattern';
import FolderItemCard from './FolderItemCard';
import { useCreateFlow } from '../hooks/useCreateFlow';
import { FOLDER_M_H, FrontPanel, PageStack, folderCardH, frontGeometry } from './folderShape';
import type { SharedValue } from 'react-native-reanimated';
import { SoftSurfaceContext } from '../theme/soft';
import AttachmentImage from './AttachmentImage';
import { FolderCardSheet, FolderPickSheet } from './FolderStyleSheets';
import { ask, notify } from './surfaces/Ask';
import RenamePrompt from './RenamePrompt';
import { useSoft } from '../theme/soft';
import { useTheme } from '../theme/ThemeProvider';
import { SOFT_MEDIUM, SOFT_SEMIBOLD } from '../utils/fonts';
import { useTags } from '../hooks/useTags';
import { useAllFolderItems, type FolderItem } from '../hooks/useAllFolderItems';
import { openFolderItem } from '../utils/openFolderItem';
import { useAddProjectFolderRequest } from '../utils/projectFoldersBus';
import CreateFan, { type FanItem } from './CreateFan';
import { openCapture } from './CaptureWindow';
import { GestureDetector } from 'react-native-gesture-handler';
import { useFanDragGesture } from '../utils/fanDrag';
import { cardSwatch, folderCardSize, type CardSize } from '../constants/cardPalette';
import { FEATURES } from '../features';
import { ALL_FOLDER_KINDS } from '../constants/folderKinds';
import type { Group, Tag } from '../types';

// «ПАПКИ» INSIDE A PROJECT (2026-10-10): at the top of a project's page on
// the «Проєкти» screen. The folders assigned to the project, as CARDS in the
// size and colour the user gave each - and the settings are made HERE
// (hold a card), so the explorer never has to be visited for them (the
// user: "щоб не пхатись у провідник налаштовувати вигляд папок").
//
// NOTHING IS INHERITED: a folder is in the project only if it was assigned
// it (Tag.groupIds). Nesting is read off the paths: an assigned folder sits
// in the nearest ASSIGNED folder above it, or at the top.

const PAGE_W = 124;
// The top bar's path, estimated: where it starts, a word's width, the gap and
// chevron between crumbs - used to fly a title to its place in it.
// Stands for «the project's top» where a parent folder is expected.
const ROOT_MARK = { id: '__root__', path: '', icon: '', color: '', types: [], usedIn: {} } as unknown as Tag;
// The page's own «+» stands where the folder pane's does: left of the back button.
const DOCK_PLUS_RIGHT = 114;
const DOCK_PLUS_BOTTOM = 56;
const PANE_PLUS_RIGHT = 114;
const PANE_PLUS_BOTTOM = 56;
export const PATH_X = 126;
export const TRAIL_WORD = 62;
export const CRUMB_GAP = 26;
const textW = (t: string) => t.length * 8.4;
const nameOf = (path: string) => path.split('/').pop() ?? path;
const noop = () => {};

function assignedParent(path: string, assigned: Set<string>): string | null {
  let p = path;
  while (p.includes('/')) {
    p = p.slice(0, p.lastIndexOf('/'));
    if (assigned.has(p)) return p;
  }
  return null;
}

export default function ProjectFolders({
  groupId,
  onTrail,
  groupName,
  groups,
  onNewProject,
  scope = 'group',
}: {
  // The project whose folders these are; none in the explorer's «Модерний» style (scope 'all').
  groupId?: string;
  // 'group': the folders assigned to the project (the «Проєкти» page). 'all': EVERY folder of the explorer, drawn
  // the same way - the explorer's «Стиль провідника: Модерний» (2026-10-12, the user's: «вигляд папок і спосіб їх
  // розкриття я хочу перенести... це те що вийшло добре»).
  scope?: 'group' | 'all';
  groupName?: string;
  // For the card editor's project row.
  groups?: Group[];
  // The fan's «Проєкт» (page level only).
  onNewProject?: () => void;
  // The folders open right now, as a path for the screen's top bar.
  // `top`/`closeTop`: the folder in front and the way out of it - for a host that keeps its own dock (the explorer).
  onTrail?: (
    crumbs: { label: string; onPress?: () => void }[],
    closeAll: () => void,
    anyOpen: boolean,
    top?: Tag | null,
    closeTop?: () => void,
    // Every open folder, from the outermost - whether or not its cover has scrolled away.
    chain?: { label: string; onPress?: () => void }[]
  ) => void;
}) {
  const S = useSoft();
  const theme = useTheme();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const tagApi = useTags();
  const { tags, setTagFields, createFolderTag, attachTag } = tagApi;
  const assigned = useMemo(() => {
    if (scope === 'all') {
      // One card per folder: a folder is one tag per kind of thing, so the same path stands several times - the
      // one that carries the card's look wins, else the first.
      const byPath = new Map<string, Tag>();
      tags.forEach((t) => {
        const had = byPath.get(t.path);
        if (!had || (!had.card && t.card)) byPath.set(t.path, t);
      });
      return Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path));
    }
    return tags.filter((t) => !!groupId && t.groupIds?.includes(groupId)).sort((a, b) => a.path.localeCompare(b.path));
  }, [tags, groupId, scope]);
  const assignedPaths = useMemo(() => new Set(assigned.map((t) => t.path)), [assigned]);
  // A folder is one tag per kind of thing (see folderTagOfKind): what lies in it is
  // whatever hangs on ANY tag of its path.
  const sameFolderTags = useMemo(() => tags.filter((t) => assignedPaths.has(t.path)), [tags, assignedPaths]);
  const items = useAllFolderItems(sameFolderTags);
  // The folder being opened and the card it grows out of (window coordinates).
  const [stack, setStack] = useState<{ tag: Tag; from: Rect4 }[]>([]);
  // What each open pane reports: its name and whether its cover has scrolled away.
  const [paneInfo, setPaneInfo] = useState<Record<number, { label: string; scrolled: boolean }>>({});
  const reportPane = (depth: number, info: { label: string; scrolled: boolean } | null) =>
    setPaneInfo((prev) => {
      if (!info) {
        if (!(depth in prev)) return prev;
        const { [depth]: _gone, ...rest } = prev;
        return rest;
      }
      const old = prev[depth];
      if (old && old.label === info.label && old.scrolled === info.scrolled) return prev;
      return { ...prev, [depth]: info };
    });
  const [picking, setPicking] = useState(false);
  const [styling, setStyling] = useState<Tag | null>(null);
  // A photo being toned for a card: once for the light theme, then the dark.
  const [job, setJob] = useState<{ tag: Tag; uri: string; stage: 'light' | 'dark'; light?: string } | null>(null);
  // The dock's «+» on the «Проєкти» screen asks for this window too.
  useAddProjectFolderRequest(groupId ?? '__explorer__', () => setFan({ folder: null, right: DOCK_PLUS_RIGHT, bottom: DOCK_PLUS_BOTTOM + insets.bottom }));
  // THE FAN: from the page's «+» (no folder) or a folder pane's «+».
  const [fan, setFan] = useState<{ folder: Tag | null; right: number; bottom: number } | null>(null);
  const [newSubOf, setNewSubOf] = useState<Tag | null>(null);
  // A folder is one tag PER KIND of thing (the Links explorer lists the tags
  // filed under its own kind, the Photos one its own): a folder of this
  // project is, say, the «document» tag «РЕР», and a photo put in it must hang
  // on the «photo» tag of the same path - made here when it does not exist yet,
  // exactly as an explorer makes it (useExplorer.tagForFolder). Remembered
  // for the session so several photos at once do not each make one.
  const kindTags = useRef(new Map<string, Tag>());
  async function folderTagOfKind(folder: Tag, kind: string): Promise<Tag> {
    const key = `${folder.path}|${kind}`;
    const known = kindTags.current.get(key);
    if (known) return known;
    // The LAST of them: an explorer keeps a map by path, and the later tag wins there,
    // so that is the one whose folder shows what is put in it.
    const same = tags.filter((t) => t.path === folder.path && (t.types ?? []).includes(kind as never)).pop();
    if (same) {
      kindTags.current.set(key, same);
      return same;
    }
    const id = await createFolderTag(folder.path, kind as never, folder.color || '#DAA587');
    const made: Tag = { id, path: folder.path, icon: 'folder-outline', color: folder.color, types: [kind as never], usedIn: {}, keep: true };
    kindTags.current.set(key, made);
    return made;
  }
  async function attachForKind(folder: Tag, kind: string, itemId: string, collection: string) {
    await attachTag(await folderTagOfKind(folder, kind), kind as never, itemId, collection);
  }

  // What the fan makes is made RIGHT HERE (the user, 2026-10-10: the fan threw things into the explorer) - the same
  // windows the explorer uses (hooks/useCreateFlow; this screen kept its own copy of them until 2026-10-16), filed
  // under the folder's tag of each kind.
  const create = useCreateFlow({
    navigation,
    tagApi,
    groups: groups ?? [],
    groupId,
    attach: attachForKind,
    cardFolder: (folder) => folderTagOfKind(folder, 'flashcard'),
  });
  async function fanPick(key: FanItem['key']) {
    const where = fan;
    setFan(null);
    if (!where) return;
    if (key === 'folder') {
      // A subfolder of the open folder, or - on the page - a new folder of the
      // project's own (named, made, and assigned to this project).
      setNewSubOf(where.folder ?? ROOT_MARK);
      return;
    }
    if (key === 'project') {
      onNewProject?.();
      return;
    }
    // What opens on its own screen (a task, a sketch...): the fan belongs to the pane in front, so the panes close.
    if (!['document', 'board', 'card', 'photo', 'file', 'link', 'video', 'geo'].includes(key)) setStack([]);
    await create.start(key as never, where.folder);
  }
  // «+» in an opened folder.
  function addInside(parent: Tag) {
    setFan({ folder: parent, right: PANE_PLUS_RIGHT, bottom: PANE_PLUS_BOTTOM + insets.bottom });
  }
  // The path for the top bar: every open pane whose cover has scrolled away,
  // and every pane that has another one open over it.
  useEffect(() => {
    if (!onTrail) return;
    const crumbs = stack
      .map((entry, depth) => ({ entry, depth, info: paneInfo[depth] }))
      .filter(({ depth, info }) => depth < stack.length - 1 || (info && info.scrolled))
      .map(({ entry, depth }) => ({
        label: nameOf(entry.tag.path),
        // A way back to that folder: everything opened over it closes.
        onPress: depth < stack.length - 1 ? () => setStack((prev) => prev.slice(0, depth + 1)) : undefined,
      }));
    const chain = stack.map((entry, depth) => ({
      label: nameOf(entry.tag.path),
      onPress: depth < stack.length - 1 ? () => setStack((prev) => prev.slice(0, depth + 1)) : undefined,
    }));
    onTrail(crumbs, () => setStack([]), stack.length > 0, stack[stack.length - 1]?.tag ?? null, () => setStack((prev) => prev.slice(0, -1)), chain);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stack, paneInfo]);
  if (!FEATURES.projectFolders) return null;

  const childrenOf = (parent: string | null) => assigned.filter((t) => assignedParent(t.path, assignedPaths) === parent);
  const itemsIn = (tag: Tag) => {
    const ids = new Set(sameFolderTags.filter((t) => t.path === tag.path).map((t) => t.id));
    return items.filter((i) => i.tagIds.some((id) => ids.has(id)));
  };

  // A foreign picture is never put on a card as it is: it goes through the
  // same duotone that tones the databases' tile backgrounds, tinted to the
  // card's own swatch, so it cannot fight the colour (the user's rule).
  async function pickPhoto(tag: Tag) {
    if (!tag.card?.color) {
      notify('Спершу колір', 'Фото підлаштовується під колір картки. Вибери колір у «Вигляді картки».');
      return;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled || !result.assets[0]) return;
    setJob({ tag, uri: result.assets[0].uri, stage: 'light' });
  }

  async function keepToned(tag: Tag, stage: 'light' | 'dark', from: string): Promise<string> {
    const dir = `${LegacyFileSystem.documentDirectory}cardbg/`;
    await LegacyFileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    const to = `${dir}${tag.id}-${stage}-${Date.now()}.jpg`;
    await LegacyFileSystem.copyAsync({ from, to });
    return to;
  }

  async function holdMenu(tag: Tag) {
    const choice = await ask({
      title: nameOf(tag.path),
      actions: [
        { id: 'look', label: 'Вигляд картки', icon: 'color-palette-outline' },
        { id: 'photo', label: tag.card?.bg ? 'Змінити фото-фон' : 'Фото-фон', icon: 'image-outline' },
        ...(tag.card?.bg ? [{ id: 'nophoto', label: 'Прибрати фото-фон', icon: 'trash-outline' as const }] : []),
        ...(scope === 'group' ? [{ id: 'remove', label: 'Прибрати з проєкту', icon: 'close-circle-outline' as const, tone: 'danger' as const }] : []),
      ],
    });
    if (choice === 'look') setStyling(tag);
    if (choice === 'photo') pickPhoto(tag);
    if (choice === 'nophoto') {
      const { bg: _gone, ...rest } = tag.card ?? {};
      setTagFields(tag.id, { card: rest });
    }
    if (choice === 'remove' && groupId) setTagFields(tag.id, { groupIds: (tag.groupIds ?? []).filter((id) => id !== groupId) });
  }

  // Opening: the card itself grows to fill the screen (the App Store's
  // «Сьогодні»): measured where it stands, then a pane grows from that place.
  function openFolder(tag: Tag, event?: GestureResponderEvent) {
    const target = (event as unknown as { flipTarget?: { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void } } | undefined)?.flipTarget;
    if (!target) {
      setStack([{ tag, from: { x: 20, y: 300, w: 300, h: 160 } }]);
      return;
    }
    target.measureInWindow((x, y, w, h) => setStack([{ tag, from: { x, y, w, h } }]));
  }

  function renderCard(tag: Tag, half: boolean) {
    return (
      <FolderCard
        key={tag.id}
        tag={tag}
        half={half}
        mine={itemsIn(tag)}
        subs={childrenOf(tag.path).length}
        navigation={navigation}
        onOpen={openFolder}
        onHold={holdMenu}
      />
    );
  }

  // The page itself always stands at the project's top; a folder opens in
  // its own window.
  const topLevel = childrenOf(null);
  const pageLines: Tag[][] = [];
  topLevel.forEach((tag) => {
    const size: CardSize = folderCardSize(tag.card);
    const last = pageLines[pageLines.length - 1];
    // Middle and small cards stand two to a line, each with its own size (the small one is half a line too).
    if (size !== 'L' && last && last.length === 1 && folderCardSize(last[0].card) === size) last.push(tag);
    else pageLines.push([tag]);
  });

  return (
    <View style={styles.wrap}>
      {scope === 'group' && (
      <View style={styles.head}>
        <Text style={[styles.crumb, { color: S.ink }]}>Папки</Text>
        <Pressable onPress={() => setPicking(true)} hitSlop={8} style={[styles.add, { backgroundColor: S.fill }]}>
          <Ionicons name="add" size={16} color={S.ink2} />
          <Text style={[styles.addText, { color: S.ink2 }]}>Додати папку</Text>
        </Pressable>
      </View>
      )}

      <View style={styles.lines}>
        {pageLines.map((line) => (
          <View key={line[0].id} style={styles.line}>
            {line.map((tag) => renderCard(tag, line.length > 1 || folderCardSize(tag.card) !== 'L'))}
            {line.length === 1 && folderCardSize(line[0].card) !== 'L' && <View style={{ flex: 1 }} />}
          </View>
        ))}
      </View>

      {scope === 'group' && assigned.length === 0 && (
        <Text style={[styles.hint, { color: S.ink3 }]}>Папок у проєкті ще немає. «Додати папку» вибере їх зі списку.</Text>
      )}

      {stack.length > 0 && (
        // In the explorer (scope 'all') the panes lie UNDER its top bar and dock, which stay the explorer's own
        // (the user's: «кнопки і панель внизу повинні бути старі») - so the pane draws no buttons of its own there.
        <GlassPortal priority={scope === 'all' ? -1 : 0} name="projFolders">
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            {stack.map((entry, depth) => (
              <FolderPane
                key={`${depth}:${entry.tag.id}`}
                tag={entry.tag}
                depth={depth}
                ctx={{
                  crumbX: (depth: number) =>
                    PATH_X + (TRAIL_WORD + CRUMB_GAP) + textW(groupName ?? '') + CRUMB_GAP + stack.slice(0, depth).reduce((sum, e) => sum + textW(nameOf(e.tag.path)) + CRUMB_GAP, 0),
                  childrenOf,
                  itemsIn,
                  navigation,
                  onHold: holdMenu,
                  closeAll: () => setStack([]),
                  allTags: tags,
                  report: reportPane,
                  open: (kid, from) => setStack((prev) => [...prev.slice(0, depth + 1), { tag: kid, from }]),
                  plus: addInside,
                  isTop: (d: number) => d === stack.length - 1,
                  ownButtons: scope !== 'all',
                }}
                from={entry.from}
                onClose={() => setStack((prev) => prev.slice(0, depth))}
              />
            ))}
          </View>
        </GlassPortal>
      )}

      <CreateFan
        visible={fan !== null}
        right={fan?.right ?? 0}
        bottom={fan?.bottom ?? 0}
        extra={[
          { key: 'folder', icon: 'folder-outline', label: fan?.folder ? 'Підпапка' : 'Нова папка', into: 'base' },
          ...(!fan?.folder && onNewProject ? [{ key: 'project' as const, icon: 'albums-outline', label: 'Проєкт', into: 'base' as const }] : []),
        ]}
        onPick={fanPick}
        onChat={() => openCapture()}
        onClose={() => setFan(null)}
      />
      <RenamePrompt
        visible={newSubOf !== null}
        title={newSubOf === ROOT_MARK ? 'Нова папка' : 'Нова підпапка'}
        initialValue=""
        onCancel={() => setNewSubOf(null)}
        onSave={async (name) => {
          const parent = newSubOf;
          setNewSubOf(null);
          const clean = name.trim().replace(/\//g, '-');
          if (!parent || !clean) return;
          const isRoot = parent === ROOT_MARK;
          const id = await createFolderTag(isRoot ? clean : `${parent.path}/${clean}`, FEATURES.universalFolders ? ALL_FOLDER_KINDS : 'document', isRoot ? '#DAA587' : parent.color || '#DAA587');
          // Made inside a project's folder, so it belongs to the project too.
          if (groupId) setTagFields(id, { groupIds: [groupId] });
        }}
      />
      {create.nodes}
      {!!groupId && (
      <FolderPickSheet
        visible={picking}
        tags={tags}
        groupId={groupId}
        onClose={() => setPicking(false)}
        onSave={(changes) => {
          setPicking(false);
          changes.forEach(({ tag, assign }) => {
            const current = tag.groupIds ?? [];
            const next = assign ? [...current.filter((id) => id !== groupId), groupId] : current.filter((id) => id !== groupId);
            setTagFields(tag.id, { groupIds: next });
          });
        }}
      />
      )}
      <BackgroundStylist
        request={
          job
            ? { uri: job.uri, color: cardSwatch(job.tag.card?.color, job.stage)?.bg ?? '#E9E2D3' }
            : null
        }
        onDone={async (uri) => {
          if (!job) return;
          try {
            const kept = await keepToned(job.tag, job.stage, uri);
            if (job.stage === 'light') {
              setJob({ ...job, stage: 'dark', light: kept });
            } else {
              setTagFields(job.tag.id, { card: { ...(job.tag.card ?? {}), bg: { light: job.light as string, dark: kept } } });
              setJob(null);
            }
          } catch (e) {
            notify('Не вдалося зберегти фон', (e as Error).message);
            setJob(null);
          }
        }}
        onError={(message) => {
          notify('Не вдалося обробити фото', message);
          setJob(null);
        }}
      />
      <FolderCardSheet
        visible={styling !== null}
        folderName={styling ? nameOf(styling.path) : ''}
        card={styling?.card}
        onClose={() => setStyling(null)}
        onSave={(card) => {
          // The sheet knows nothing of the photo: it is carried over.
          if (styling) setTagFields(styling.id, { card: card ? { ...card, ...(styling.card?.bg ? { bg: styling.card.bg } : {}) } : (deleteField() as never) });
          setStyling(null);
        }}
      />
    </View>
  );
}


// ONE OPENED FOLDER, App Store style (the user, 2026-10-10: no turning over -
// "просто заставка"): the card ITSELF grows from where it stands to fill the
// whole screen, and its colour (with the pattern or the photo) stays on top as
// the cover; the folder's text, subfolders and records lie under it and scroll
// with it. A folder inside grows the same way out of its own card, over this
// one. «×» shrinks the pane back into its card.
type PaneCtx = {
  // Where this level's crumb stands in the top bar's path (dp from the left).
  crumbX: (depth: number) => number;
  childrenOf: (parent: string | null) => Tag[];
  itemsIn: (tag: Tag) => FolderItem[];
  navigation: unknown;
  onHold: (tag: Tag) => void;
  closeAll: () => void;
  allTags: Tag[];
  report: (depth: number, info: { label: string; scrolled: boolean } | null) => void;
  open: (tag: Tag, from: Rect4) => void;
  // «+» inside a folder: a new subfolder, or an existing one added here.
  plus: (tag: Tag) => void;
  isTop: (depth: number) => boolean;
  ownButtons: boolean;
};
export type Rect4 = { x: number; y: number; w: number; h: number };
// Quicker since 2026-10-19 (the user's: faster, «але так щоб анімація все ще була видною»): 420 -> 320, the same
// ease-out - the widening is still a motion you see, not a jump.
const GROW_MS = 320;

function FolderPane({ tag, depth, ctx, from, onClose }: { tag: Tag; depth: number; ctx: PaneCtx; from: Rect4; onClose: () => void }) {
  const S = useSoft();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const plusDrag = useFanDragGesture(() => ctx.plus(tag));
  const { width: W, height: H } = useWindowDimensions();
  const heroH = Math.round(Math.min(H * 0.46, 400));
  // Where the title has left the cover: near its bottom.
  // The title's place on the cover, measured; it has reached the bar when it
  // has scrolled up to the bar's own height.
  const [titleBox, setTitleBox] = useState({ y: heroH - 70, h: 40 });
  // The cover grows while the pane opens, so the title's place is only real
  // once it has stopped; until then the title in the cover is the one seen.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), GROW_MS + 80);
    return () => clearTimeout(t);
  }, []);
  const PILL_MID = 69;
  const heroLimit = Math.max(40, titleBox.y - (PILL_MID - 8));
  const p = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  // The cover's title goes up into the bar's path once it has scrolled out.
  const label = nameOf(tag.path);
  useAnimatedReaction(
    () => scrollY.value > heroLimit,
    (now, was) => {
      if (now !== was) runOnJS(ctx.report)(depth, { label, scrolled: now });
    }
  );
  useEffect(() => {
    ctx.report(depth, { label, scrolled: false });
    return () => ctx.report(depth, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    p.value = withTiming(1, { duration: GROW_MS, easing: Easing.bezier(0.22, 1, 0.36, 1) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const fx = from.x;
  const fy = from.y;
  const fw = from.w;
  const fh = from.h;
  // The pane: the card's rectangle widening to the screen.
  const frameStyle = useAnimatedStyle(() => ({
    position: 'absolute',
    left: fx * (1 - p.value),
    top: fy * (1 - p.value),
    width: fw + (W - fw) * p.value,
    height: fh + (H - fh) * p.value,
    borderRadius: 26 * (1 - p.value),
  }));
  // The cover: the card's own height, growing to its full one.
  const heroStyle = useAnimatedStyle(() => ({
    height: fh + (heroH + insets.top - fh) * p.value,
    paddingTop: 16 + insets.top * p.value,
    paddingHorizontal: 16 + 4 * p.value,
  }));
  // THE TITLE FLIES to the bar (the user, 2026-10-10): it stays where it is
  // on the cover until it rises to the bar, then keeps level with the bar
  // while it shrinks to the bar's size and slides right to its place in the
  // path; there it hands over to the real crumb.
  const targetX = ctx.crumbX(depth);
  const titleStyle = useAnimatedStyle(() => {
    const naturalY = titleBox.y - scrollY.value;
    // 0 while the title is still down on the cover, 1 when it has risen to the bar.
    const prog = Math.max(0, Math.min(1, (PILL_MID + 150 - naturalY) / 150));
    return {
      position: 'absolute',
      left: 20 + (targetX - 20) * prog,
      top: Math.max(PILL_MID - 8, naturalY),
      opacity: !settled || prog >= 1 ? 0 : 1,
      transform: [{ scale: 1 - 0.58 * prog }],
      transformOrigin: 'left top',
    };
  });
  const bodyStyle = useAnimatedStyle(() => ({ opacity: Math.max(0, (p.value - 0.55) / 0.45) }));
  const closeStyle = useAnimatedStyle(() => ({ opacity: Math.max(0, (p.value - 0.6) / 0.4) }));
  const closing = useRef(false);
  const close = () => {
    if (closing.current) return;
    closing.current = true;
    p.value = withTiming(0, { duration: GROW_MS - 100, easing: Easing.in(Easing.cubic) }, (done) => {
      if (done) runOnJS(onClose)();
    });
  };
  // The phone's own back closes the pane in front - the one registered last.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mine = ctx.itemsIn(tag);
  const kids = ctx.childrenOf(tag.path);
  const lines: Tag[][] = [];
  kids.forEach((k) => {
    const sz: CardSize = folderCardSize(k.card);
    const last = lines[lines.length - 1];
    if (sz !== 'L' && last && last.length === 1 && folderCardSize(last[0].card) === sz) last.push(k);
    else lines.push([k]);
  });
  const openChild = (kid: Tag, event?: GestureResponderEvent) => {
    const target = (event as unknown as { flipTarget?: { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void } } | undefined)?.flipTarget;
    if (!target) {
      ctx.open(kid, { x: 20, y: H / 2 - 60, w: W - 40, h: 120 });
      return;
    }
    target.measureInWindow((x, y, w, h) => ctx.open(kid, { x, y, w, h }));
  };

  const sw = cardSwatch(tag.card?.color, theme.scheme);
  const coverBg = sw?.bg ?? S.fill;
  const ink = sw?.ink ?? S.ink;
  const density = tag.card?.pattern ?? 'normal';
  const photo = tag.card?.bg ? tag.card.bg[theme.scheme] : undefined;
  const kinds: Record<string, number> = {};
  mine.forEach((i) => {
    const icon = KIND_ICON[i.kind];
    kinds[icon] = (kinds[icon] ?? 0) + 1;
  });
  if (kids.length) kinds['folder-outline'] = kids.length;
  const n = mine.length;

  return (
    <Animated.View style={[{ overflow: 'hidden', backgroundColor: theme.raised }, frameStyle]}>
      <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 40, minHeight: H + heroLimit }}>
        <Animated.View style={[{ backgroundColor: coverBg, justifyContent: 'flex-end', paddingBottom: 18, overflow: 'hidden' }, heroStyle]}>
          {photo && <CardPhoto uri={photo} color={coverBg} />}
          {!photo && density !== 'none' && sw && <FolderPattern kinds={kinds} color={sw.pattern} density={density} />}
          <Text style={[styles.eyebrow, { color: ink }]}>{`${n} ${n === 1 ? 'предмет' : 'предметів'}${kids.length ? ` · ${kids.length} ${kids.length === 1 ? 'папка' : 'папок'}` : ''}`}</Text>
          <Text
            key={settled ? 'on' : 'off'}
            style={[styles.coverTitle, { color: ink, opacity: settled ? 0 : 1 }]}
            numberOfLines={3}
            onLayout={(e) => {
              if (settled) setTitleBox({ y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height });
            }}
          >
            {nameOf(tag.path)}
          </Text>
          {!!tag.card?.outer && <Text style={[styles.descL, { color: ink }]}>{tag.card.outer}</Text>}
        </Animated.View>
        <Animated.View style={[{ padding: 16, paddingTop: 20 }, bodyStyle]}>
          {!!tag.card?.inner && <Text style={[styles.winInner, { color: S.ink2 }]}>{tag.card.inner}</Text>}
          {kids.length > 0 && (
            <View style={styles.lines}>
              {lines.map((line) => (
                <View key={line[0].id} style={styles.line}>
                  {line.map((k) => (
                    <FolderCard
                      key={k.id}
                      tag={k}
                      half={line.length > 1 || folderCardSize(k.card) !== 'L'}
                      mine={ctx.itemsIn(k)}
                      subs={ctx.childrenOf(k.path).length}
                      navigation={ctx.navigation}
                      onOpen={openChild}
                      onHold={ctx.onHold}
                    />
                  ))}
                  {line.length === 1 && folderCardSize(line[0].card) === 'M' && <View style={{ flex: 1 }} />}
                </View>
              ))}
            </View>
          )}
          {mine.length > 0 && (
            // The portal stands outside the screen's providers: the cards
            // are told which look they are in.
            <SoftSurfaceContext.Provider value={S}>
              <View style={styles.cards}>
                {mine.map((item) => (
                  <FolderItemCard
                    key={item.id}
                    item={item}
                    tags={ctx.allTags}
                    onPress={() => {
                      ctx.closeAll();
                      openFolderItem(ctx.navigation, item);
                    }}
                  />
                ))}
              </View>
            </SoftSurfaceContext.Provider>
          )}
          {mine.length === 0 && kids.length === 0 && <Text style={[styles.hint, { color: S.ink3 }]}>У цій папці ще порожньо.</Text>}
        </Animated.View>
      </Animated.ScrollView>
      <Animated.Text pointerEvents="none" style={[styles.coverTitle, { color: ink }, titleStyle]} numberOfLines={1}>
        {nameOf(tag.path)}
      </Animated.Text>
      {ctx.isTop(depth) && ctx.ownButtons && (
        <Animated.View pointerEvents="box-none" style={[styles.cornerBtns, { bottom: insets.bottom + 28 }, closeStyle]}>
          <GestureDetector gesture={plusDrag}>
            <Pressable onPress={() => ctx.plus(tag)} onLongPress={() => openCapture()} delayLongPress={450} hitSlop={6} style={[styles.cornerBtn, { backgroundColor: theme.raised }]}>
              <Ionicons name="add-outline" size={26} color={S.ink} />
            </Pressable>
          </GestureDetector>
          <Pressable onPress={close} hitSlop={6} style={[styles.cornerBtn, { backgroundColor: theme.raised }]}>
            <Ionicons name="chevron-back" size={26} color={S.ink} />
          </Pressable>
        </Animated.View>
      )}
    </Animated.View>
  );
}

// ONE FOLDER CARD. A component of its own so the card can carry the press and
// the turn (usePressSettle / flipOpen) - the whole card is what turns over.
export function FolderCard({
  tag,
  half,
  mine,
  subs,
  subNames,
  navigation,
  onOpen,
  onHold,
}: {
  tag: Tag;
  half: boolean;
  mine: FolderItem[];
  subs: number;
  // The names of the nested folders, for the copies of the front panel behind it (a folder with no documents).
  subNames?: string[];
  navigation: unknown;
  onOpen: (tag: Tag, event?: GestureResponderEvent) => void;
  onHold: (tag: Tag) => void;
}) {
  const S = useSoft();
  const theme = useTheme();
  const size: CardSize = folderCardSize(tag.card);
  const sw = cardSwatch(tag.card?.color, theme.scheme);
  const bg = sw?.bg ?? S.card;
  const ink = sw?.ink ?? S.ink;
  const n = mine.length;
  const count = `${n} ${n === 1 ? 'предмет' : 'предметів'}${subs ? ` · ${subs} ${subs === 1 ? 'папка' : 'папок'}` : ''}`;
  const settle = usePressSettle(`folder:${tag.id}`);
  const own = useRef<View | null>(null);
  const [cardW, setCardW] = useState(0);
  const press = (e: GestureResponderEvent) => onOpen(tag, withFlipTarget(e, own.current));
  const common = { onPress: press, onLongPress: () => onHold(tag), delayLongPress: 350, ...settle.handlers };
  const big = size === 'L';
  // THE SMALL CARD is the middle one's shape at half its height (folderShape's FOLDER_S_H) - it used to be a capsule
  // with the name alone (2026-10-15, the user's sketch 9WnDhBhzWyeXKLFJnLtDzr).
  const small = size === 'S';
  const density = tag.card?.pattern ?? 'normal';
  const photo = tag.card?.bg ? tag.card.bg[theme.scheme] : undefined;
  const kinds: Record<string, number> = {};
  mine.forEach((i) => {
    const icon = KIND_ICON[i.kind];
    kinds[icon] = (kinds[icon] ?? 0) + 1;
  });
  if (subs) kinds['folder-outline'] = subs;
  return (
    <Animated.View key={size} ref={own} collapsable={false} style={[big || half ? { flex: 1 } : undefined, settle.style]}>
      <Pressable
        {...common}
        onLayout={big ? undefined : (e) => setCardW(Math.round(e.nativeEvent.layout.width))}
        style={[big ? styles.cardL : small ? styles.cardStackS : styles.cardStack, { backgroundColor: bg, boxShadow: S.shadow }]}
      >
        {photo && <CardPhoto uri={photo} color={bg} />}
        {/* As ONE PICTURE once photographed (2026-10-16): drawn live, each card's ~50 tilted icons, each with its own
            opacity, were drawn again on every frame of a scroll - «Модерний» stuttered in a fling, the plain list not. */}
        {!photo && density !== 'none' && sw && (big || cardW > 0) && (
          <FolderPattern kinds={kinds} color={sw.pattern} density={density} size={big ? undefined : { w: cardW, h: small ? 95 : 200 }} shot={!big} />
        )}
        {!big && cardW > 0 && <FolderStack w={cardW} small={small} mine={mine} subNames={subNames ?? []} title={nameOf(tag.path)} count={n} subs={subs} />}
        {big && <Text style={[styles.titleL, { color: ink }]} numberOfLines={2}>{nameOf(tag.path)}</Text>}
        {big && !!tag.card?.outer && <Text style={[styles.descL, { color: ink }]} numberOfLines={3}>{tag.card.outer}</Text>}
        {big && mine.length > 0 && (
          // THE LEAVES: one page per record, swiped sideways; the next one
          // peeks in from the edge so it is plain there is more. A tap on a
          // page opens that record, a tap anywhere else turns the folder over.
          // THE LEAVES, still (2026-10-12): not pressable, so nothing to swipe either (the user: «якщо клікабельності
          // немає, то і гортання необовʼязкове») - only as many as the card shows, the last one cut by its edge;
          // half the cards drawn that a scrolling strip of eight drew.
          <View style={[styles.leaves, styles.leavesRow]} pointerEvents="none">
            {/* THE REAL THINGS, small (2026-10-12, the user's: «якщо це документ - превʼю реального документа»): each
                leaf is the same card the explorer draws for that record - a note as its page, a board as its
                preview, a photo as itself. A tap anywhere on the card opens the folder. */}
            {mine.slice(0, 4).map((item) => (
              <View key={item.id} style={styles.leafReal}>
                <FolderItemCard item={item} tags={[]} mode="grid" tileWidth={PAGE_W} columns={2} onPress={noop} noCount />
              </View>
            ))}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

// THE MIDDLE FOLDER CARD (2026-10-15, the user's sketch, artifact CWewE7V9nE7GSxQvdALFXh; the shape itself is in
// folderShape.tsx, shared with the collections). What lies in it:
//  - documents (a note, a board, a photo): the first as a small page with its own preview, the others only as edges
//    peeking out behind it, tilted a little - a pack of sheets;
//  - no documents but nested folders: copies of the FRONT panel behind it, each a step higher, every second one
//    mirrored, the nested folder's name on its tab, paler and smaller the further back.
const SHEETS = ['document', 'photo', 'board'];
const itemsWord = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'предмет' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'предмети' : 'предметів');
function FolderStack({ w, mine, subNames, title, count, subs, sheetSlide, frontSlide, small }: { w: number; mine: FolderItem[]; subNames: string[]; title: string; count: number; subs: number; sheetSlide?: SharedValue<number>; frontSlide?: SharedValue<number>; small?: boolean }) {
  const S = useSoft();
  const { H, T, d: front } = frontGeometry(w, small);
  // The copies behind the front step up less on the small card, and carry no names (only their corners show).
  const step = small ? 6 : 11;
  const dark = S.dark;
  const sheets = mine.filter((i) => SHEETS.includes(i.kind));
  const copies = sheets.length === 0 ? subNames.slice(0, 2) : [];
  const bar = dark ? '#3F3F42' : '#E4E1DA';
  const copyFill = dark ? ['#1A1A1B', '#151516'] : ['#F7F5F1', '#EEEBE5'];
  const copyEdge = dark ? '#2E2E30' : '#E1DED7';
  // A copy's name must stay inside its own tab (the tab is 37% of the card wide): short, small, cut early.
  const labelW = Math.max(30, Math.round(w * 0.37) - 26);
  const first = sheets[0];
  const photoUri = first && first.kind === 'photo' ? first.imageUri || first.imageUrl : undefined;
  const sheetsLayer = (
    <>
      {sheets.length > 0 && (
        <PageStack
          w={w}
          small={small}
          edges={Math.min(2, sheets.length - 1)}
          page={() =>
            photoUri ? (
              <Image source={{ uri: photoUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            ) : (
              <View style={{ padding: 10, gap: 6 }}>
                <Text style={{ color: S.ink, fontSize: 10.5, lineHeight: 13, fontFamily: SOFT_SEMIBOLD }} numberOfLines={2}>{first?.title}</Text>
                <View style={{ height: 4.5, width: '72%', borderRadius: 3, backgroundColor: bar }} />
                <View style={{ height: 4.5, width: '95%', borderRadius: 3, backgroundColor: bar }} />
                <View style={{ height: 4.5, width: '55%', borderRadius: 3, backgroundColor: bar }} />
              </View>
            )
          }
        />
      )}
      {copies.length > 1 && (
        <>
          <Svg pointerEvents="none" width={w} height={H} style={{ position: 'absolute', left: 0, top: -step * 2 }}>
            <Path d={front} fill={copyFill[1]} stroke={copyEdge} strokeWidth={1} />
          </Svg>
          {!small && (
            <Text pointerEvents="none" numberOfLines={1} ellipsizeMode="tail" style={{ position: 'absolute', left: 14, top: T - 22 + 3, width: labelW, fontSize: 10, fontFamily: SOFT_SEMIBOLD, color: S.ink3, opacity: 0.6 }}>
              {copies[1]}
            </Text>
          )}
        </>
      )}
      {copies.length > 0 && (
        <>
          <Svg pointerEvents="none" width={w} height={H} style={{ position: 'absolute', left: 0, top: -step, transform: [{ scaleX: -1 }] }}>
            <Path d={front} fill={copyFill[0]} stroke={copyEdge} strokeWidth={1} />
          </Svg>
          {!small && (
            <Text pointerEvents="none" numberOfLines={1} ellipsizeMode="tail" style={{ position: 'absolute', right: 14, top: T - 11 + 5, width: labelW, textAlign: 'right', fontSize: 10.5, fontFamily: SOFT_SEMIBOLD, color: S.ink3, opacity: 0.85 }}>
              {copies[0]}
            </Text>
          )}
        </>
      )}
    </>
  );
  const frontLayer = (
    <FrontPanel w={w} small={small} title={title} number={count} unit={`${itemsWord(count)}${subs ? ` · ${subs} ${subs === 1 ? 'папка' : 'папок'}` : ''}`} />
  );
  return (
    <>
      {sheetSlide ? <SlideLayer value={sheetSlide} small={small}>{sheetsLayer}</SlideLayer> : sheetsLayer}
      {frontSlide ? <SlideLayer value={frontSlide} small={small}>{frontLayer}</SlideLayer> : frontLayer}
    </>
  );
}

// THE OPENED FOLDER'S HEAD: the card it turned over from, not pressable any
// more - the same colour, pattern or photo, the title and the outer line.
export function FolderHeader({ tag, mine, subs }: { tag: Tag; mine: FolderItem[]; subs: number }) {
  const S = useSoft();
  const theme = useTheme();
  const sw = cardSwatch(tag.card?.color, theme.scheme);
  const bg = sw?.bg ?? S.fill;
  const ink = sw?.ink ?? S.ink;
  const density = tag.card?.pattern ?? 'normal';
  const photo = tag.card?.bg ? tag.card.bg[theme.scheme] : undefined;
  const kinds: Record<string, number> = {};
  mine.forEach((i) => {
    const icon = KIND_ICON[i.kind];
    kinds[icon] = (kinds[icon] ?? 0) + 1;
  });
  if (subs) kinds['folder-outline'] = subs;
  const n = mine.length;
  return (
    <View style={[styles.head2, { backgroundColor: bg }]}>
      {photo && <CardPhoto uri={photo} color={bg} />}
      {!photo && density !== 'none' && sw && <FolderPattern kinds={kinds} color={sw.pattern} density={density} />}
      <Text style={[styles.eyebrow, { color: ink }]}>{`${n} ${n === 1 ? 'предмет' : 'предметів'}`}</Text>
      <Text style={[styles.titleL, { color: ink }]} numberOfLines={2}>{nameOf(tag.path)}</Text>
      {!!tag.card?.outer && <Text style={[styles.descL, { color: ink }]}>{tag.card.outer}</Text>}
    </View>
  );
}

// THE OPENED FOLDER'S COVER for the explorer's «Модерний» (2026-10-12, the user's: «папки... розкриваються на весь
// екран, вгорі фон - цього не треба було прибирати»): the pane's own hero, edge to edge and up under the bar - the
// folder's colour, pattern or photo, its count and its big name - standing at the top of the explorer's folder view
// (the explorer keeps its own bar, dock and logic). `height` is the whole cover, the bar's part included.
// What a folder's cover pattern needs, for the explorer's warm-up (FolderPattern's PatternWarmup) - the same kinds,
// colour and box the cover itself draws with, or null when the cover has no pattern.
export function coverPatternJob(
  tag: Tag,
  mine: FolderItem[],
  subs: number,
  scheme: 'light' | 'dark',
  size: { w: number; h: number }
): { key: string; kinds: Record<string, number>; color: string; density: 'light' | 'normal' | 'dense'; size: { w: number; h: number } } | null {
  const sw = cardSwatch(tag.card?.color, scheme);
  const density = tag.card?.pattern ?? 'normal';
  if (!sw || density === 'none' || tag.card?.bg) return null;
  const kinds: Record<string, number> = {};
  mine.forEach((i) => {
    const icon = KIND_ICON[i.kind];
    kinds[icon] = (kinds[icon] ?? 0) + 1;
  });
  if (subs) kinds['folder-outline'] = subs;
  return { key: patternKeyOf(kinds, size, sw.pattern, density), kinds, color: sw.pattern, density, size };
}

export function folderCoverHeight(windowHeight: number, topInset: number): number {
  return Math.round(Math.min(windowHeight * 0.46, 400)) + topInset;
}
// `onReady`: the cover is fully drawn - its pattern's picture decoded (at once when it has none).
export function FolderCover({
  tag,
  mine,
  subs,
  height,
  topInset,
  onReady,
}: {
  tag: Tag;
  mine: FolderItem[];
  subs: number;
  height: number;
  topInset: number;
  onReady?: () => void;
}) {
  const S = useSoft();
  const { width: coverW } = useWindowDimensions();
  const theme = useTheme();
  const sw = cardSwatch(tag.card?.color, theme.scheme);
  const coverBg = sw?.bg ?? S.fill;
  const ink = sw?.ink ?? S.ink;
  const density = tag.card?.pattern ?? 'normal';
  const photo = tag.card?.bg ? tag.card.bg[theme.scheme] : undefined;
  const kinds: Record<string, number> = {};
  mine.forEach((i) => {
    const icon = KIND_ICON[i.kind];
    kinds[icon] = (kinds[icon] ?? 0) + 1;
  });
  if (subs) kinds['folder-outline'] = subs;
  const n = mine.length;
  const patterned = !photo && density !== 'none' && !!sw;
  useEffect(() => {
    if (!patterned) onReady?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patterned]);
  return (
    <View style={{ height, backgroundColor: coverBg, justifyContent: 'flex-end', paddingBottom: 18, paddingTop: topInset + 16, paddingHorizontal: 20, overflow: 'hidden' }}>
      {photo && <CardPhoto uri={photo} color={coverBg} />}
      {patterned && sw && <FolderPattern kinds={kinds} color={sw.pattern} density={density} size={{ w: coverW, h: height }} shot onShown={onReady} />}
      <Text style={[styles.eyebrow, { color: ink }]}>{`${n} ${n === 1 ? 'предмет' : 'предметів'}${subs ? ` · ${subs} ${subs === 1 ? 'папка' : 'папок'}` : ''}`}</Text>
      <Text style={[styles.coverTitle, { color: ink }]} numberOfLines={3}>
        {nameOf(tag.path)}
      </Text>
      {!!tag.card?.outer && <Text style={[styles.descL, { color: ink }]}>{tag.card.outer}</Text>}
    </View>
  );
}

// THE MIDDLE CARD'S OWN CONTENTS DURING THE OPENING AND THE CLOSING (2026-10-15, the animation plan, artifact
// 8rptWUAirpxhyg2n1DWThg, steps 1, 3 and 5): the card is a window onto its cover. Opening, what lies on it - the
// pages, the white front panel with the name - slides DOWN out of the window while the window widens to the cover,
// and the big name comes up in the cover's foot; closing is the same backwards: the contents come back up from below
// as the window narrows to the card. `p`: 0 = the card, 1 = the full cover (both FolderGrow and FolderShrink drive it).
// The contents hang from the window's BOTTOM edge, so that as the window grows they go on standing at its foot and
// leave through it.
// THE ORDER (2026-10-15, the user's: «спочатку документи в картці їдуть вниз, потім біла передня частина папки. Межею
// для них є нижній край папки, вони просто уїжджають і зникають за ним. Потім фон папки розтягується»): the pages
// first, then the white front panel, each sliding down behind the card's own bottom edge (the window is still the
// card's size and clips them there); only when both are gone does the background widen. Each layer has its OWN clock
// (0 = in place, 1 = gone) - tied to the widening's ease-out, which is nearly over in two frames, they were gone before
// they could be seen. Closing runs it backwards: the window narrows to the card, then the front comes back up, then the
// pages.
// Each phase shorter (2026-10-19: 170/110/165 -> 130/70/130), the order kept: still long enough to be seen sliding.
export const SHEETS_MS = 130;
export const FRONT_DELAY = 70;
export const FRONT_MS = 130;
// The closing: the window narrows in this long, then the front, then the pages come back (was 360).
const SHRINK_MS = 280;
// When the widening may begin: the contents have left.
export const CONTENT_MS = FRONT_DELAY + FRONT_MS + 10;
const SLIDE_EASE = Easing.bezier(0.4, 0, 0.2, 1);
// An ease-out read inside a worklet (the frame's width and height each run their own stretch of one clock).
function easeOutQuart(x: number) {
  'worklet';
  return 1 - Math.pow(1 - x, 4);
}
function SlideLayer({ value, children, small }: { value: SharedValue<number>; children: React.ReactNode; small?: boolean }) {
  const down = folderCardH(small) + 16;
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: value.value * down }] }));
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      {children}
    </Animated.View>
  );
}
// The card's contents inside the window: hung from the window's bottom edge, the card's own height.
function CardContents({ sheets, front, w, tag, mine, subs, subNames }: { sheets: SharedValue<number>; front: SharedValue<number>; w: number; tag: Tag; mine: FolderItem[]; subs: number; subNames?: string[] }) {
  const small = folderCardSize(tag.card) === 'S';
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, bottom: 0, width: w, height: folderCardH(small) }}>
      <FolderStack w={w} small={small} mine={mine} subNames={subNames ?? []} title={nameOf(tag.path)} count={mine.length} subs={subs} sheetSlide={sheets} frontSlide={front} />
    </View>
  );
}

// THE OPENING: the tapped card widening to the whole screen, its cover growing to the cover's height - the pane's
// motion - drawn OVER the explorer, which has already stepped into the folder underneath; when it has filled the
// screen it fades, and the folder's own cover (same colour, same place) is what is left.
// `onGrown`: the opening has started - the host steps into the folder NOW, its work hidden under this (the motion
// itself runs on the UI thread, so a busy JS thread does not stall it). `ready`: the folder is drawn
// underneath - only then does this fade.
export function FolderGrow({
  tag,
  from,
  ground,
  mine,
  subs,
  subNames,
  onGrown,
  ready,
  onDone,
}: {
  tag: Tag;
  from: Rect4;
  ground: string;
  mine: FolderItem[];
  subs: number;
  subNames?: string[];
  onGrown: () => void;
  ready: boolean;
  onDone: () => void;
}) {
  const S = useSoft();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const coverH = folderCoverHeight(H, insets.top);
  // ONE linear clock for the widening; the width and the height read it on their own curves (below).
  const t = useSharedValue(0);
  const sheets = useSharedValue(0);
  const front = useSharedValue(0);
  const words = useSharedValue(0);
  const fade = useSharedValue(1);
  // The frame's own ground (the page the card grows into) goes see-through once the host has stepped into the folder,
  // so the things underneath are SEEN while the cover is still growing - not after (2026-10-14: the beige ground hid
  // them for ~250 ms, the «lag» the user felt; their JS cost was only ~50 ms).
  const groundA = useSharedValue(1);
  const groundStyle = useAnimatedStyle(() => ({ opacity: groundA.value }));
  // Grows once its own pattern is on screen (its picture decoded) - started earlier, the first frames grew a
  // plain colour. A pattern-less cover starts at once; a picture slow to decode is not waited for long.
  const patternedGrow = !tag.card?.bg && (tag.card?.pattern ?? 'normal') !== 'none' && !!cardSwatch(tag.card?.color, theme.scheme);
  const [shown, setShown] = useState(!patternedGrow);
  useEffect(() => {
    if (shown) return;
    const timer = setTimeout(() => setShown(true), 120);
    return () => clearTimeout(timer);
  }, [shown]);

  // The card lifts a little at the tap (transform - it moves at once) and comes down to size as it widens.
  const lift = useSharedValue(0);
  useEffect(() => {
    lift.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // NOTE (2026-10-19, measured): putting the folder in underneath takes the UI thread for 0.2-0.5 s - no frame at
  // all is drawn then, transforms included (a screen copy behind, and a lift+veil while the folder went in, were both
  // tried and made it worse: the stop moved to the tap). Until that cost itself is cut, the order stays the one that
  // shows motion first: contents leave, the widening starts, the host steps in right after.
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    if (!shown) return;
    // A middle card first lets its contents go (pages, then the front panel); the widening waits for them.
    const wait = folderCardSize(tag.card) !== 'L' ? CONTENT_MS : 0;
    if (wait > 0) {
      sheets.value = withTiming(1, { duration: SHEETS_MS, easing: SLIDE_EASE });
      front.value = withDelay(FRONT_DELAY, withTiming(1, { duration: FRONT_MS, easing: SLIDE_EASE }));
      words.value = withDelay(wait, withTiming(1, { duration: 300 }));
    }
    t.value = withDelay(wait, withTiming(1, { duration: GROW_MS + 80, easing: Easing.linear }));
    // «Grown» for the hand-over at HALF the time: on this ease-out the screen is covered by then, and waiting for
    // the tail kept the folder's things hidden under the opening for ~0.3 s after they were drawn.
    const covered = setTimeout(() => setGrown(true), wait + Math.round(GROW_MS * 0.5));
    // The host steps in right after the opening has STARTED.
    const timer = setTimeout(() => {
      onGrown();
      if (FEATURES.openOneStep) groundA.value = withDelay(60, withTiming(0, { duration: 160 }));
    }, wait + 10);
    return () => {
      clearTimeout(timer);
      clearTimeout(covered);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);
  useEffect(() => {
    if (!grown || !ready) return;
    fade.value = withTiming(0, { duration: 120 }, (gone) => {
      if (gone) runOnJS(onDone)();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grown, ready]);
  const { x: fx, y: fy, w: fw, h: fh } = from;
  // THE WIDTH LEADS, THE HEIGHT FOLLOWS (2026-10-19, idea 1 the user took): the card first opens out sideways and then
  // drops to the screen's height - an unfolding, not a zoom. Each on its own ease-out over 80% of the clock.
  const frameStyle = useAnimatedStyle(() => {
    const pw = easeOutQuart(Math.min(1, t.value / 0.8));
    const ph = easeOutQuart(Math.max(0, (t.value - 0.2) / 0.8));
    return {
      position: 'absolute',
      left: fx * (1 - pw),
      top: fy * (1 - ph),
      width: fw + (W - fw) * pw,
      height: fh + (H - fh) * ph,
      // The corners stay round until the height has nearly arrived.
      borderRadius: 24 * (1 - ph),
      opacity: fade.value,
      // Lifted at the tap, coming down to size as it widens.
      transform: [{ scale: 1 + 0.05 * lift.value * (1 - pw) }],
    };
  });

  const sw = cardSwatch(tag.card?.color, theme.scheme);
  const coverBg = sw?.bg ?? S.fill;
  // A middle or small card stands on its own look (the stacked folder shape): its contents leave downwards, its words
  // give way to the cover's.
  const stacked = folderCardSize(tag.card) !== 'L';
  // The card's ground is white when the folder has no colour of its own; the cover's is the page's tint.
  const heroStyle = useAnimatedStyle(() => ({
    height: fh + (coverH - fh) * easeOutQuart(Math.max(0, (t.value - 0.2) / 0.8)),
    backgroundColor: stacked && !sw ? interpolateColor(words.value, [0, 0.5], [S.card, S.fill]) : coverBg,
  }));
  const wordsFade = useAnimatedStyle(() => ({ opacity: stacked ? words.value : 1 }));
  const ink = sw?.ink ?? S.ink;
  const density = tag.card?.pattern ?? 'normal';
  const photo = tag.card?.bg ? tag.card.bg[theme.scheme] : undefined;
  // The same pattern the cover underneath draws, so the hand-over shows no change.
  const growKinds: Record<string, number> = {};
  mine.forEach((i) => {
    const icon = KIND_ICON[i.kind];
    growKinds[icon] = (growKinds[icon] ?? 0) + 1;
  });
  if (subs) growKinds['folder-outline'] = subs;
  return (
    // Faded as ONE picture (needsOffscreenAlphaCompositing): faded layer by layer, Android let the frame's light
    // ground show through the cover on top of it - the «спалах розбілення» at the hand-over (2026-10-12, found in a
    // 60 fps screen recording: the cover band 5 levels lighter for ~100 ms exactly while this faded).
    <>
    <Animated.View
      pointerEvents="none"
      needsOffscreenAlphaCompositing
      renderToHardwareTextureAndroid
      style={[{ overflow: 'hidden' }, frameStyle]}
    >
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: ground }, groundStyle]} />
      <Animated.View style={[{ justifyContent: 'flex-end', paddingBottom: 18, paddingHorizontal: 20, overflow: 'hidden' }, heroStyle]}>
        {photo && <CardPhoto uri={photo} color={coverBg} />}
        {/* The pattern laid at the cover's FINAL size from the first frame, the growing frame only uncovering it:
            laid in the growing box it re-tiled at every size and handed over a different picture. */}
        {!photo && density !== 'none' && sw && (
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: W, height: coverH }}>
            <FolderPattern kinds={growKinds} color={sw.pattern} density={density} size={{ w: W, h: coverH }} shot onShown={() => setShown(true)} />
          </View>
        )}
        {stacked && <CardContents sheets={sheets} front={front} w={fw} tag={tag} mine={mine} subs={subs} subNames={subNames} />}
        {/* Line for line what the folder's cover draws (FolderCover), so the hand-over in the cover's band shows no
            change - without the count line, its fade read as a half-clear layer blinking at the count's height. */}
        <Animated.View style={wordsFade}>
          <Text style={[styles.eyebrow, { color: ink }]}>{`${mine.length} ${mine.length === 1 ? 'предмет' : 'предметів'}${subs ? ` · ${subs} ${subs === 1 ? 'папка' : 'папок'}` : ''}`}</Text>
          <Text style={[styles.coverTitle, { color: ink }]} numberOfLines={3}>
            {nameOf(tag.path)}
          </Text>
          {!!tag.card?.outer && <Text style={[styles.descL, { color: ink }]}>{tag.card.outer}</Text>}
        </Animated.View>
      </Animated.View>
    </Animated.View>
    </>
  );
}

// THE CLOSING (2026-10-12, the user's: «дороби зворотню анімацію папки згортання»): the opening backwards. It
// stands over the screen as the folder's cover the moment back is pressed; the host steps up a level underneath,
// finds the folder's card there and hands its place in as `to` - the cover then shrinks into that card and fades
// on it. With no card to land on (`to` never comes) it simply fades.
export function FolderShrink({
  tag,
  to,
  ground,
  mine,
  subs,
  subNames,
  onDone,
}: {
  tag: Tag;
  to: Rect4 | null;
  ground: string;
  mine: FolderItem[];
  subs: number;
  subNames?: string[];
  onDone: () => void;
}) {
  const S = useSoft();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const coverH = folderCoverHeight(H, insets.top);
  // ONE linear clock, 1 = the screen, 0 = the card; the height and the width read it on their own curves - backwards
  // of the opening, so the height settles first and the width last.
  const t = useSharedValue(1);
  // The landing (2026-10-19, idea 4 the user took): the cover comes down onto the card a touch bigger and settles into
  // it - 0 rest, 1 the most (2.5% larger, around the card's own middle).
  const settle = useSharedValue(0);
  const sheets = useSharedValue(1);
  const front = useSharedValue(1);
  const words = useSharedValue(1);
  const fade = useSharedValue(1);
  const target = useSharedValue<Rect4>({ x: 0, y: 0, w: W, h: H });
  // The landing place may be corrected while folding (the explorer measures the card after the level above is
  // drawn): the first place starts the folding, a later one only moves the place, smoothly.
  const started = useRef(false);
  const rx = useSharedValue(0);
  const ry = useSharedValue(0);
  const rw = useSharedValue(W);
  const rh = useSharedValue(H);
  useEffect(() => {
    if (to && started.current) {
      const glide = { duration: 160, easing: Easing.out(Easing.cubic) };
      rx.value = withTiming(to.x, glide);
      ry.value = withTiming(to.y, glide);
      rw.value = withTiming(to.w, glide);
      rh.value = withTiming(to.h, glide);
      return;
    }
    if (to) {
      started.current = true;
      rx.value = to.x;
      ry.value = to.y;
      rw.value = to.w;
      rh.value = to.h;
    }
    if (!to) {
      const timer = setTimeout(() => {
        fade.value = withTiming(0, { duration: 160 }, (gone) => {
          if (gone) runOnJS(onDone)();
        });
      }, 500);
      return () => clearTimeout(timer);
    }
    target.value = to;
    // The window narrows to the card first; then the front panel comes back up, then the pages (the opening's order
    // reversed); the hand-over to the real card waits for them.
    const stackedClose = folderCardSize(tag.card) !== 'L';
    if (stackedClose) words.value = withTiming(0, { duration: 170 });
    t.value = withTiming(0, { duration: SHRINK_MS + 80, easing: Easing.linear }, (done) => {
      if (!done) return;
      settle.value = withSequence(
        withTiming(1, { duration: 90, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 150, easing: Easing.inOut(Easing.quad) })
      );
      // Then the front panel comes back up, then the pages; the hand-over to the real card waits for them.
      if (stackedClose) {
        front.value = withDelay(60, withTiming(0, { duration: FRONT_MS, easing: SLIDE_EASE }));
        sheets.value = withDelay(60 + FRONT_DELAY, withTiming(0, { duration: SHEETS_MS, easing: SLIDE_EASE }));
      }
      fade.value = withDelay(stackedClose ? 60 + FRONT_DELAY + SHEETS_MS : 240, withTiming(0, { duration: 120 }, (gone) => {
        if (gone) runOnJS(onDone)();
      }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to]);
  const frameStyle = useAnimatedStyle(() => {
    const r = { x: rx.value, y: ry.value, w: rw.value, h: rh.value };
    const pw = easeOutQuart(Math.min(1, t.value / 0.8));
    const ph = easeOutQuart(Math.max(0, (t.value - 0.2) / 0.8));
    const w = r.w + (W - r.w) * pw;
    const h = r.h + (H - r.h) * ph;
    const k = 0.025 * settle.value;
    return {
      position: 'absolute',
      left: r.x * (1 - pw) - (w * k) / 2,
      top: r.y * (1 - ph) - (h * k) / 2,
      width: w * (1 + k),
      height: h * (1 + k),
      borderRadius: 24 * (1 - ph),
      opacity: fade.value,
    };
  });
  const sw = cardSwatch(tag.card?.color, theme.scheme);
  const coverBg = sw?.bg ?? S.fill;
  const stacked = folderCardSize(tag.card) !== 'L';
  const heroStyle = useAnimatedStyle(() => ({
    height: (rh.value + (coverH - rh.value) * easeOutQuart(Math.max(0, (t.value - 0.2) / 0.8))) * (1 + 0.025 * settle.value),
    backgroundColor: stacked && !sw ? interpolateColor(words.value, [0, 0.5], [S.card, S.fill]) : coverBg,
  }));
  // The cover's own contents fade as it becomes the card, which has its own words in its own places.
  const wordsStyle = useAnimatedStyle(() => ({ opacity: stacked ? words.value : Math.max(0, (t.value - 0.35) / 0.65) }));
  const ink = sw?.ink ?? S.ink;
  const density = tag.card?.pattern ?? 'normal';
  const photo = tag.card?.bg ? tag.card.bg[theme.scheme] : undefined;
  const kinds: Record<string, number> = {};
  mine.forEach((i) => {
    const icon = KIND_ICON[i.kind];
    kinds[icon] = (kinds[icon] ?? 0) + 1;
  });
  if (subs) kinds['folder-outline'] = subs;
  return (
    <Animated.View pointerEvents="none" needsOffscreenAlphaCompositing renderToHardwareTextureAndroid style={[{ overflow: 'hidden', backgroundColor: ground }, frameStyle]}>
      <Animated.View style={[{ justifyContent: 'flex-end', paddingBottom: 18, paddingHorizontal: 20, overflow: 'hidden' }, heroStyle]}>
        {photo && <CardPhoto uri={photo} color={coverBg} />}
        {!photo && density !== 'none' && sw && (
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: W, height: coverH }}>
            <FolderPattern kinds={kinds} color={sw.pattern} density={density} size={{ w: W, h: coverH }} shot />
          </View>
        )}
        {stacked && to && <CardContents sheets={sheets} front={front} w={to.w} tag={tag} mine={mine} subs={subs} subNames={subNames} />}
        <Animated.View style={wordsStyle}>
          <Text style={[styles.eyebrow, { color: ink }]}>{`${mine.length} ${mine.length === 1 ? 'предмет' : 'предметів'}${subs ? ` · ${subs} ${subs === 1 ? 'папка' : 'папок'}` : ''}`}</Text>
          <Text style={[styles.coverTitle, { color: ink }]} numberOfLines={3}>
            {nameOf(tag.path)}
          </Text>
          {!!tag.card?.outer && <Text style={[styles.descL, { color: ink }]}>{tag.card.outer}</Text>}
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}

// The toned photo behind a card, under a wash of the card's own colour at the
// top and bottom so the words always read.
function CardPhoto({ uri, color }: { uri: string; color: string }) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const id = `wash${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      {box.w > 0 && (
        <Svg width={box.w} height={box.h} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity="0.85" />
              <Stop offset="0.55" stopColor={color} stopOpacity="0.12" />
              <Stop offset="1" stopColor={color} stopOpacity="0.7" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width={box.w} height={box.h} fill={`url(#${id})`} />
        </Svg>
      )}
    </View>
  );
}

const KIND_ICON: Record<FolderItem['kind'], string> = {
  document: 'document-text-outline',
  photo: 'image-outline',
  file: 'document-outline',
  link: 'link-outline',
  flashcard: 'albums-outline',
  board: 'easel-outline',
  row: 'grid-outline',
  shortcut: 'rocket-outline',
};
const KIND_LABEL: Record<FolderItem['kind'], string> = {
  document: 'Нотатка',
  photo: 'Фото',
  file: 'Файл',
  link: 'Посилання',
  flashcard: 'Картка',
  board: 'Дошка',
  row: 'Запис',
  shortcut: 'Ярлик',
};

const styles = StyleSheet.create({
  wrap: { marginBottom: 20 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 10 },
  crumbs: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, flex: 1 },
  crumbWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  crumb: { fontSize: 14, fontFamily: SOFT_SEMIBOLD },
  sep: { fontSize: 14 },
  add: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 32, paddingHorizontal: 12, borderRadius: 16 },
  addText: { fontSize: 12.5, fontFamily: SOFT_SEMIBOLD },
  inner: { fontSize: 13.5, lineHeight: 19, fontFamily: SOFT_MEDIUM, marginBottom: 12 },
  hint: { fontSize: 13, lineHeight: 19, fontFamily: SOFT_MEDIUM, marginTop: 4 },
  lines: { gap: 10 },
  line: { flexDirection: 'row', gap: 10 },
  cardL: { flex: 1, minHeight: 170, borderRadius: 26, padding: 16, gap: 4, overflow: 'hidden' },
  cardM: { minHeight: 140, borderRadius: 24, padding: 14, gap: 4, overflow: 'hidden' },
  cardStack: { height: 200, borderRadius: 24, overflow: 'hidden' },
  cardStackS: { height: 95, borderRadius: 20, overflow: 'hidden' },
  // The strip keeps one height; each leaf its own (no frame under it - a shorter card showed the frame below as a
  // second card, 2026-10-12), centred in the strip so a short one floats in the middle.
  leavesRow: { flexDirection: 'row', gap: 8, overflow: 'hidden', height: Math.round(PAGE_W * 1.3), alignItems: 'center' },
  leafReal: { width: PAGE_W, maxHeight: Math.round(PAGE_W * 1.3), borderRadius: 14, overflow: 'hidden' },
  leaves: { marginTop: 12, marginHorizontal: -16, paddingLeft: 16, marginBottom: -16, flexGrow: 0 },
  leaf: { width: PAGE_W, height: 132, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 8, gap: 4 },
  leafPic: { height: 54, borderRadius: 10, width: '100%' },
  leafGlyph: { alignItems: 'center', justifyContent: 'center' },
  leafTitle: { fontSize: 12, lineHeight: 15, fontFamily: SOFT_SEMIBOLD },
  leafKind: { fontSize: 10, fontFamily: SOFT_MEDIUM },
  cardS: { flex: 1, height: 58, borderRadius: 22, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  seatS: { width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  titleS: { fontSize: 14.5, fontFamily: SOFT_SEMIBOLD, flexShrink: 1 },
  descS: { flex: 1, fontSize: 11.5, fontFamily: SOFT_MEDIUM, opacity: 0.75 },
  countS: { fontSize: 12, fontFamily: SOFT_MEDIUM, opacity: 0.7, marginLeft: 'auto' },
  eyebrow: { fontSize: 10, fontFamily: SOFT_SEMIBOLD, letterSpacing: 0.6, textTransform: 'uppercase', opacity: 0.7 },
  titleL: { fontSize: 24, lineHeight: 27, fontFamily: SOFT_SEMIBOLD, letterSpacing: -0.4 },
  titleM: { fontSize: 17, lineHeight: 20, fontFamily: SOFT_SEMIBOLD, letterSpacing: -0.2 },
  descL: { fontSize: 13, lineHeight: 18, fontFamily: SOFT_MEDIUM, opacity: 0.85, marginTop: 2 },
  descM: { fontSize: 11.5, lineHeight: 16, fontFamily: SOFT_MEDIUM, opacity: 0.85 },
  cards: { marginTop: 14, gap: 10 },
  list: { marginTop: 12, borderRadius: 22, overflow: 'hidden' },
  fullWindow: { flex: 1, marginHorizontal: 8, borderRadius: 28, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  fullContent: { padding: 16, paddingTop: 20, paddingBottom: 40 },
  cornerBtns: { position: 'absolute', right: 20, flexDirection: 'row', gap: 10 },
  cornerBtn: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(0,0,0,0.16)' },
  closeTop: { position: 'absolute', right: 16 },
  closeBtnFloat: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 10px rgba(0,0,0,0.25)' },
  coverTitle: { fontSize: 34, lineHeight: 38, fontFamily: SOFT_SEMIBOLD, letterSpacing: -0.6 },
  closeBtn: { position: 'absolute', top: 12, right: 12, width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  head2: { minHeight: 120, borderRadius: 26, padding: 16, gap: 4, overflow: 'hidden', marginBottom: 12 },
  winCrumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 12, marginRight: 48, minHeight: 22 },
  winCrumb: { fontSize: 12.5, fontFamily: SOFT_MEDIUM },
  winInner: { fontSize: 14.5, lineHeight: 21, fontFamily: SOFT_MEDIUM, marginBottom: 14 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, height: 54 },
  itemSeat: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  itemTitle: { flex: 1, fontSize: 15, fontFamily: SOFT_MEDIUM },
  itemKind: { fontSize: 11.5, fontFamily: SOFT_MEDIUM },
});
