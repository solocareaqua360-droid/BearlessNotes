import { usePaneBar } from '../navigation/paneBar';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { IS_POINTER } from '../utils/pointer';
import { bindRightClick } from '../utils/rightClick';
import { ActivityIndicator, FlatList, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import AttachmentImage from '../components/AttachmentImage';
import { FileRow, LinkRow, PhotoRow } from '../components/ItemCards';
import { Ionicons } from '../components/icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import ScreenBackdrop from '../components/ScreenBackdrop';
import ContentColumn from '../components/ContentColumn';
import RenamePrompt from '../components/RenamePrompt';
import SaveDestinationSheet from '../components/SaveDestinationSheet';
import SearchField from '../components/SearchField';
import Menu from '../components/surfaces/Menu';
import { ChatAttachment } from '../utils/chatAttach';
import { categoryFromSiteName } from '../utils/linkCategory';
import * as Clipboard from 'expo-clipboard';
import { ask, confirm, notify } from '../components/surfaces/Ask';
import { openCapture, openCaptureForEdit } from '../components/CaptureWindow';
import ProjectTabsRow from '../components/ProjectTabsRow';
import ChatMessageMenu, { type ChatMenuAction } from '../components/ChatMessageMenu';
import { addDoc } from '../utils/owned';
import { groupKindFields } from '../utils/groups';
import { hapticPickUp } from '../utils/haptics';
import { collection, doc, getDoc, getDocs } from '../firestore';
import { db } from '../firebase';
import { ownedQuery } from '../utils/owned';
import { onSnapshot } from '../firestore';
import type { Group } from '../types';
import { askGemini } from '../utils/gemini';
import { getGeminiKey } from '../utils/geminiKey';
import { useChromeStyle, useDockActions, useDockBeads, useDockLeave, useDockShowContext, useStableTopExtras, useTopBack, useTopExtras } from '../navigation/navDock';
import type { DockAction, DockBead } from '../navigation/navDock';
import { ChatLayerContext } from '../navigation/sideDrawers';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import InlineDock from '../components/InlineDock';
import { addBoardCopy, moveBoardCopy, removeBoardCopy, watchBoardCopies, type BoardCopy } from '../utils/chatBoardCopies';
import ChatMessageMedia from '../components/ChatMessageMedia';
import ChatGlueSheet from '../components/ChatGlueSheet';
import { addToGlue, clearGlue, glueId, glueToNote, watchGlue, type GlueState } from '../utils/chatGlue';
import ChatBinSheet from '../components/ChatBinSheet';
import ChatDayCamera, { cameraCardWidth } from '../components/ChatDayCamera';
import ChatDayBoard, { BOARD_COLS, boardCardWidth, type BoardDay } from '../components/ChatDayBoard';
import { useFrameDimensions } from '../hooks/useResponsiveLayout';
import TopNavBar, { TOP_NAV_H, TOP_NAV_SPACE, useTopNavOn } from '../components/TopNavBar';
import EdgeFade from '../components/EdgeFade';
import { MAX_CONTENT_WIDTH } from '../components/ContentColumn';
import { CHROME_TOP } from '../constants/rail';
import { useDockClearance } from '../navigation/dockGeometry';
import { ChatMessage, CHAT_BIN_DAYS, deleteChatMessage, groupChatMessages, purgeChatMessage, restoreChatMessage, watchChatBin, isChatMessageSorted, markChatMessageTask, markChatMessagesUsed, sendGeminiReply, setChatMessagesDeferred, watchChat, setChatMessagesInProject, setChatProjectContext } from '../utils/chat';
import { FEATURES } from '../features';
import { useChatSortedBefore } from '../utils/chatSorting';
import {
  appendBlocksToToday,
  clipBlocksToNote,
  copyObjectsToNote,
  blockFromFile,
  blockFromPhoto,
  createTaskInToday,
} from '../utils/copyToNote';
import { formatShortDate } from '../utils/dateLocale';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD, SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';
import { SoftSurfaceContext, softenStyles, useSoftDatabase, type SoftTokens } from '../theme/soft';
import { Block } from '../types';
import { usePhotosAlive, useTaskClosedMap } from '../hooks/useChatLinks';
import { RootStackParamList } from '../navigation';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { mutedForTheme, type Theme } from '../theme/tokens';


// The history side of «загальний чат». The capture window is where things
// go IN; this is where they are read back and harvested. Nothing is ever
// consumed: a message gathered into a note stays here with a line saying
// which note took it - the user's own rule, and the reason they are not
// troubled by the history growing forever.

type Row =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'message'; key: string; message: ChatMessage };

// The groups the filter offers - the user's own words: "фото, youtube,
// геоточка, посилання", plus files, which the capture window can attach
// too. A video sits under a 'file' record (see chatAttach), so telling
// it apart from a real file needs its mime type.
type AttachmentGroup = 'photo' | 'video' | 'geo' | 'link' | 'file';

function attachmentGroup(item: ChatAttachment): AttachmentGroup {
  if (item.kind === 'photo') return 'photo';
  if (item.kind === 'file') return (item.mimeType ?? '').startsWith('video/') ? 'video' : 'file';
  const category = categoryFromSiteName(item.siteName);
  return category === 'geo' ? 'geo' : category === 'video' ? 'video' : 'link';
}

function attachmentLabel(item: ChatAttachment): string {
  if (item.kind === 'photo') return 'Зображення';
  if (item.kind === 'file') return item.name;
  return item.title || item.url;
}

const FILTER_LABELS: Record<AttachmentGroup, string> = {
  photo: 'Фото',
  video: 'Відео',
  geo: 'Геоточки',
  link: 'Посилання',
  file: 'Файли',
};
const FILTER_ICONS: Record<AttachmentGroup, keyof typeof Ionicons.glyphMap> = {
  photo: 'image-outline',
  video: 'videocam-outline',
  geo: 'location-outline',
  link: 'link-outline',
  file: 'document-outline',
};

// A project made from a held message gets the same colour the project
// picker would give it (GroupPickerSheet's own set).
const PROJECT_COLORS = ['#3B82F6', '#16A34A', '#8B5CF6', '#F97316', '#EC4899', '#14B8A6', '#EAB308'];

function newBlockId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// A photo in a message, drawn as its database draws it. The message keeps
// only the id and the address of the copy on the phone that took it; the
// photo's OWN record is what knows where its Drive copy is, which is all a
// laptop can show - so the record is looked up, and the row is given that.
// THE PICTURE ON A BOARD CARD (the chat's board, ChatDayBoard): the first
// photo - read from its own record, as the tape's card does, so a picture
// no longer on this phone is restored from Drive - or the first link's
// preview image. A file or a link without a picture has none, and its card
// says what it carries in words.
function BoardCardPicture({ attachment, width, height }: { attachment: ChatAttachment; width: number; height: number }) {
  const photoId = attachment.kind === 'photo' ? attachment.id : null;
  const [driveFileId, setDriveFileId] = useState<string | undefined>();
  useEffect(() => {
    if (!photoId) return;
    return onSnapshot(
      doc(db, 'photos', photoId),
      (snapshot) => setDriveFileId((snapshot.data() as { driveFileId?: string } | undefined)?.driveFileId),
      () => {}
    );
  }, [photoId]);
  const style = { width, height, borderRadius: 8 };
  if (attachment.kind === 'photo') {
    return <AttachmentImage uri={attachment.uri} driveFileId={driveFileId} style={style} resizeMode="cover" />;
  }
  if (attachment.kind === 'link' && attachment.imageUrl) {
    return <Image source={{ uri: attachment.imageUrl }} style={style} resizeMode="cover" resizeMethod="resize" />;
  }
  return null;
}

function ChatPhoto({ id, uri, onPress }: { id: string; uri: string; onPress: () => void }) {
  const [record, setRecord] = useState<{ driveFileId?: string; title?: string; createdAt?: number } | null>(null);
  useEffect(
    () =>
      onSnapshot(
        doc(db, 'photos', id),
        (snapshot) => setRecord((snapshot.data() as typeof record) ?? null),
        () => setRecord(null)
      ),
    [id]
  );
  return (
    <PhotoRow
      photo={{
        id,
        imageUri: uri,
        driveFileId: record?.driveFileId,
        title: record?.title,
        createdAt: record?.createdAt,
        documentIds: [],
        tagIds: [],
      }}
      tags={[]}
      onPress={onPress}
    />
  );
}

// The same for a file: what the message keeps is a name and the phone's
// address; the record has the title it was given since, and when it was
// added - what its row in «Файли» shows.
function ChatFile({ id, name, uri, onPress }: { id: string; name: string; uri: string; onPress: () => void }) {
  const [record, setRecord] = useState<{ title?: string; fileName?: string; createdAt?: number; updatedAt?: number } | null>(null);
  useEffect(
    () =>
      onSnapshot(
        doc(db, 'files', id),
        (snapshot) => setRecord((snapshot.data() as typeof record) ?? null),
        () => setRecord(null)
      ),
    [id]
  );
  return (
    <FileRow
      file={{
        id,
        fileName: record?.fileName ?? name,
        fileUri: uri,
        title: record?.title,
        createdAt: record?.createdAt,
        updatedAt: record?.updatedAt,
        tagIds: [],
      }}
      tags={[]}
      onPress={onPress}
    />
  );
}

export default function ChatScreen() {
  const theme = useTheme();
  // What messages point at, live: a closed task strikes its message through, a cleaned picture is said so.
  const { value: taskClosed } = useTaskClosedMap();
  const { value: photosAlive, loaded: photosLoaded } = usePhotosAlive();
  // THE CHAT IN THE SOFT STYLE (theme/soft) - the last screen still in
  // glass ("чат"). On a phone: the soft bar and dock, the soft ground,
  // messages as soft cards, Inter.
  const softChat = useSoftDatabase();
  // THE LEFT LAYER'S PAGE (features.chatInLeftLayer): drawn inside the layer
  // with its own bar and dock, and telling nothing to the window's - the
  // layer is always mounted, so anything it published would be the
  // window's chrome at all times.
  const chatLayer = useContext(ChatLayerContext);
  const inLayer = !!chatLayer;
  useChromeStyle('soft', !!softChat && !inLayer);
  const styles = softenStyles(useStyles(makeStyles), softChat, softChatRecipe);
  const insets = useSafeAreaInsets();
  const dockClear = useDockClearance();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const isFocused = useIsFocused();
  // Speaks to the window's bar and dock: a chat that is a screen of its own.
  const publishing = isFocused && !inLayer;
  // In front, either way.
  const shown = inLayer ? chatLayer!.open : isFocused;
  const { width: frameWidth, height: frameHeight } = useFrameDimensions();
  const showContext = useDockShowContext();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Which messages are on their way somewhere - one from its own menu, or
  // everything chosen in select mode. The destination sheet and the name
  // prompt both read this, so one path serves both.
  const [sending, setSending] = useState<string[] | null>(null);
  const [naming, setNaming] = useState(false);
  // The id of the message currently awaiting a Gemini answer, so its own
  // bubble can show that instead of the whole screen locking up - Gemini
  // takes a few seconds and the rest of the chat stays usable while it
  // does.
  const [askingId, setAskingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // null = every message; 'any' = only ones carrying something;
  // otherwise one of the groups the user asked for - "фільтр по
  // вкладеннях (з групуванням фото, youtube, геоточка, посилання)".
  const [filterKind, setFilterKind] = useState<AttachmentGroup | 'any' | null>(null);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  // «НЕРОЗІБРАНЕ» / «ВІДКЛАДЕНЕ» (features.chatSorting): which part of the
  // chat is shown, besides the attachment filter above.
  const sorting = FEATURES.chatSorting;
  const [stateFilter, setStateFilter] = useState<'all' | 'unsorted' | 'deferred'>('all');
  const sortedBefore = useChatSortedBefore();
  // PROJECT CHATS (2026-09-29): the same chat, narrowed to one project -
  // "чати проектів". Projects are the app's one project concept (groups).
  const [projects, setProjects] = useState<Group[]>([]);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  useEffect(
    () =>
      onSnapshot(
        ownedQuery('groups'),
        (snapshot) =>
          setProjects(
            snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Group, 'id'>) })).sort((a, b) => a.name.localeCompare(b.name))
          ),
        (e) => notify('Проекти не завантажились', (e as Error).message)
      ),
    []
  );
  // Only the projects something has been put in - "лише ті, де вже є
  // повідомлення" - so the row is never a list of empty rooms.
  const chatProjects = useMemo(() => {
    const used = new Set(messages.flatMap((m) => m.projectIds ?? []));
    return projects.filter((p) => used.has(p.id));
  }, [projects, messages]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const openProject = projectFilter ? projectById.get(projectFilter) ?? null : null;
  // Writing from the capture window while a project's chat is open lands
  // in that project (and in the main chat, marked as written there).
  useEffect(() => {
    setChatProjectContext(shown && projectFilter ? projectFilter : null);
    return () => setChatProjectContext(null);
  }, [shown, projectFilter]);

  useEffect(
    () =>
      watchChat(setMessages, (e) => notify('Чат не завантажився', e.message)),
    []
  );
  // THE GLUE: pieces picked here and stuck together (utils/chatGlue).
  const [glue, setGlue] = useState<GlueState>({ blocks: [], chatIds: [], sources: {} });
  const [glueOpen, setGlueOpen] = useState(false);
  const [glueNaming, setGlueNaming] = useState(false);
  const [glueDest, setGlueDest] = useState(false);
  const [glueProject, setGlueProject] = useState<string | null>(null);
  useEffect(() => {
    if (!FEATURES.chatGlue) return;
    return watchGlue(setGlue, (e) => notify('Склейка не завантажилась', e.message));
  }, []);
  // THE BIN: deleted messages wait here, and the ones past their time go for good.
  const [bin, setBin] = useState<ChatMessage[]>([]);
  const [binOpen, setBinOpen] = useState(false);
  useEffect(
    () =>
      watchChatBin((list) => {
        setBin(list);
        const stale = Date.now() - CHAT_BIN_DAYS * 86400000;
        list.filter((m) => (m.deletedAt ?? 0) < stale).forEach((m) => purgeChatMessage(m.id).catch(() => {}));
      }, (e) => notify('Кошик не завантажився', e.message)),
    []
  );

  // How many wait. Hidden (zero) until the date the count starts from is
  // known, so the old messages never flash as unsorted.
  const sortCounts = useMemo(() => {
    if (!sorting || sortedBefore === null) return { unsorted: 0, deferred: 0 };
    let unsorted = 0;
    let deferred = 0;
    messages.forEach((m) => {
      if (m.deferred) deferred += 1;
      else if (!isChatMessageSorted(m, sortedBefore)) unsorted += 1;
    });
    return { unsorted, deferred };
  }, [messages, sorting, sortedBefore]);

  const needle = searchQuery.trim().toLowerCase();
  function messageMatchesState(message: ChatMessage): boolean {
    if (!sorting || stateFilter === 'all' || sortedBefore === null) return true;
    return stateFilter === 'deferred' ? !!message.deferred : !isChatMessageSorted(message, sortedBefore);
  }
  function messageMatchesFilter(message: ChatMessage): boolean {
    if (!filterKind) return true;
    const groups = (message.attachments ?? []).map(attachmentGroup);
    return filterKind === 'any' ? groups.length > 0 : groups.includes(filterKind);
  }
  function messageMatchesSearch(message: ChatMessage): boolean {
    if (!needle) return true;
    if (message.text.toLowerCase().includes(needle)) return true;
    return (message.attachments ?? []).some((a) => attachmentLabel(a).toLowerCase().includes(needle));
  }
  const visibleMessages = useMemo(
    () =>
      messages.filter(
        (m) =>
          messageMatchesFilter(m) &&
          messageMatchesState(m) &&
          messageMatchesSearch(m) &&
          (!projectFilter || (m.projectIds ?? []).includes(projectFilter))
      ),
    [messages, filterKind, needle, projectFilter, stateFilter, sortedBefore]
  );

  // "Затисканням на повідомленні його можна скопіювати в чат проекту":
  // the chosen messages go into a project (or come out of it, if every
  // one of them is already there). They stay in the main chat.
  async function putChosenInProject() {
    const ids = [...selected];
    if (projects.length === 0) {
      notify('Ще немає проектів', 'Створіть проект у будь-якій базі - і сюди можна буде складати повідомлення.');
      return;
    }
    const chosenMessages = messages.filter((m) => ids.includes(m.id));
    const picked = await ask({
      title: 'У чат проекту',
      message: 'Повідомлення лишаться й тут, з позначкою проекту.',
      actions: projects.map((p) => {
        const allIn = chosenMessages.every((m) => (m.projectIds ?? []).includes(p.id));
        return { id: p.id, label: p.name, hint: allIn ? 'Вже там - прибрати звідти' : undefined, icon: allIn ? 'checkmark-circle' : 'ellipse-outline' };
      }),
    });
    if (!picked || picked === 'cancel') return;
    const allIn = chosenMessages.every((m) => (m.projectIds ?? []).includes(picked));
    await setChatMessagesInProject(ids, picked, !allIn);
    setSelected(new Set());
    setIsSelectMode(false);
  }

  // Day headings, in the order a chat is read: oldest at the top, today
  // at the bottom, where the newest thing said always is.
  const rows = useMemo(() => {
    const out: Row[] = [];
    let lastDay = '';
    visibleMessages.forEach((message) => {
      const date = new Date(message.createdAt);
      const day = date.toDateString();
      if (day !== lastDay) {
        lastDay = day;
        out.push({ kind: 'day', key: `day-${day}`, label: formatShortDate(date) });
      }
      out.push({ kind: 'message', key: message.id, message });
    });
    return out;
  }, [visibleMessages]);

  // The list is INVERTED, as every messenger's is, so it opens on the
  // newest message by construction. It used to scroll to its end right
  // after the first render instead - but a FlatList has measured only its
  // first ~10 rows by then, and photos and link cards grow after that, so
  // "the end" it scrolled to was near the top: the chat opened on its
  // oldest messages. Reversed data keeps the day headings above their
  // messages once the list flips.
  const listRows = useMemo(() => [...rows].reverse(), [rows]);
  // How tall the floating head is (bar's room, projects, search) - the
  // list keeps its first message clear of it.
  const [headerH, setHeaderH] = useState(insets.top + CHROME_TOP + 8 + TOP_NAV_SPACE + 52);
  // The ground the fades melt into: the soft one, or none on the old
  // drifting backdrop (a fade of one colour over clouds would be a band).
  const ground = softChat ? softChat.bg : null;
  const listRef = useRef<FlatList<Row>>(null);

  useDockLeave('chatbubbles-outline', () => navigation.goBack(), publishing);
  // A BAR LIKE EVERY DESK'S (the user's, 2026-10-04): «Чат» at the top with
  // the way back and choosing at its edge; the dock below is the search
  // field holding «Фільтр» and the microphone, with back on the right.
  const bar = useTopNavOn();
  // Inside the databases' drawer the drawer draws the bar - see paneBar.
  const paneBar = usePaneBar();
  useTopBack(() => navigation.goBack(), bar && publishing);
  useTopExtras(
    null,
    {
      active: isSelectMode,
      onPress: () => {
        setSelected(new Set());
        setIsSelectMode((prev) => !prev);
        if (isSelectMode) showContext();
      },
    },
    bar && publishing
  );
  // The two beads, once: published to the window's dock when this chat is a
  // screen of its own, drawn by the layer's own dock when it is the layer's page.
  const leftBead: DockBead | null = bar
    ? {
        icon: isSelectMode ? 'close-outline' : isSearching ? 'close-outline' : 'search-outline',
        active: isSearching,
        onPress: () => {
          if (isSelectMode) {
            setSelected(new Set());
            setIsSelectMode(false);
            if (!inLayer) showContext();
            return;
          }
          if (isSearching) setSearchQuery('');
          setIsSearching((v) => !v);
        },
      }
    : {
        icon: isSelectMode ? 'close-outline' : 'checkmark-circle-outline',
        active: isSelectMode,
        onPress: () => {
          setSelected(new Set());
          setIsSelectMode((prev) => !prev);
          if (isSelectMode && !inLayer) showContext();
        },
      };
  const rightBead: DockBead = {
    icon: 'mic-outline',
    onPress: openCapture,
    extra: bar
      ? {
          icon: 'funnel-outline',
          label: 'Фільтр',
          active: filterKind !== null || (sorting && stateFilter !== 'all'),
          // With the sorting on: the circle turns dark while a filter is
          // in force, and carries the unsorted count.
          filled: sorting,
          count: sorting ? sortCounts.unsorted : undefined,
          onPress: () => setFilterMenuOpen((v) => !v),
        }
      : undefined,
  };
  useDockBeads(publishing ? leftBead : null, publishing ? rightBead : null);
  // The layer's own bar: «календар | чат» for a title, the way back closes
  // the layer, choosing at the bar's edge.
  const layerPages = chatLayer?.pages;
  const boardView = inLayer && chatLayer!.view === 'board';
  const layerTitle = useMemo(
    () => ({
      icon: 'chatbubbles-outline',
      label: 'Чат',
      // With the calendar a desk (features.calendarDesk) the layer is the chat alone: no «календар» word; on the
      // board view «чат» stays as the way back to the tape.
      ...(FEATURES.calendarDesk
        ? boardView
          ? { choices: [{ label: 'чат', active: false, onPress: layerPages?.chat }] }
          : {}
        : {
            choices: [
              { label: 'календар', active: false, onPress: layerPages?.calendar },
              // The board is the chat zoomed out (a pinch gets there), not a page of its own.
              { label: 'чат', active: true, onPress: boardView ? layerPages?.chat : undefined },
            ],
          }),
    }),
    [layerPages, boardView]
  );
  const layerClose = chatLayer?.close;
  const layerBack = useMemo(() => (layerClose ? { onPress: layerClose, dimmed: false } : null), [layerClose]);
  const layerExtras = useStableTopExtras(null, {
    active: isSelectMode,
    onPress: () => {
      setSelected(new Set());
      setIsSelectMode((prev) => !prev);
    },
  });
  const dockActionsList: DockAction[] | null =
    isSelectMode
        ? selected.size > 0
          ? [
              {
                key: 'note',
                icon: 'document-text-outline',
                label: 'У нотатку',
                onPress: () => setSending([...selected]),
                closesStack: true,
              },
              ...(FEATURES.chatGlue
                ? [
                    {
                      key: 'glue',
                      icon: 'link-outline' as const,
                      label: 'Склеїти',
                      onPress: () => {
                        addToGlue(messages.filter((m) => selected.has(m.id))).catch((e: Error) => notify('Не вдалося', e.message));
                        setSelected(new Set());
                        setIsSelectMode(false);
                      },
                      closesStack: true,
                    },
                  ]
                : []),
              // Only once there is something TO group - "думки
              // приходять поступово... хотілося, щоб вона лишилася
              // однією ідеєю".
              ...(selected.size >= 2
                ? [
                    {
                      key: 'group',
                      icon: 'git-merge-outline',
                      label: 'Згрупувати',
                      onPress: () => groupSelected(),
                      closesStack: true,
                    },
                  ]
                : []),
              {
                key: 'project',
                icon: 'albums-outline',
                label: 'У проект',
                onPress: () => putChosenInProject(),
                closesStack: true,
              },
              {
                key: 'delete',
                icon: 'trash-outline',
                label: 'Видалити',
                onPress: () => deleteChosen(),
                closesStack: true,
              },
            ]
          : null
        : bar
          ? null
          : [
            {
              key: 'search',
              icon: isSearching ? 'close-outline' : 'search-outline',
              label: 'Пошук',
              active: isSearching,
              onPress: () => {
                if (isSearching) setSearchQuery('');
                setIsSearching((v) => !v);
              },
            },
            {
              key: 'filter',
              icon: 'funnel-outline',
              label: 'Фільтр',
              active: filterKind !== null || (sorting && stateFilter !== 'all'),
              onPress: () => setFilterMenuOpen((v) => !v),
            },
          ];
  useDockActions(publishing ? dockActionsList : null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // The messages on their way somewhere, as blocks. New ids: the message
  // stays in the chat, so what lands in the note is a copy of it.
  function blocksFor(ids: string[]): { chosen: ChatMessage[]; blocks: Block[] } {
    const chosen = messages.filter((m) => ids.includes(m.id));
    return {
      chosen,
      blocks: chosen.map((m) => ({
        id: newBlockId(),
        text: m.text,
        type: 'paragraph' as const,
        createdAt: m.createdAt,
      })),
    };
  }

  function doneSending() {
    setSending(null);
    setNaming(false);
    setSelected(new Set());
    setIsSelectMode(false);
  }

  // Into a note that already exists, or into today's - the two that need
  // no name. A new one asks for one first (see gatherIntoNewNote).
  async function sendInto(where: 'today' | { id: string; title: string }, idsGiven?: string[]) {
    const ids = idsGiven ?? sending ?? [];
    const { chosen, blocks } = blocksFor(ids);
    if (chosen.length === 0) return doneSending();
    setBusy(true);
    try {
      const documentId =
        where === 'today'
          ? await appendBlocksToToday(blocks, [])
          : await copyObjectsToNote(where.id, blocks, []);
      const title = where === 'today' ? `Сьогодні · ${formatShortDate(new Date())}` : where.title;
      await markChatMessagesUsed(chosen.map((m) => m.id), documentId, title);
      doneSending();
      navigation.navigate('Editor', { documentId });
    } catch (e) {
      notify('Не збереглося', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function gatherIntoNewNote(title: string, idsGiven?: string[]) {
    const ids = idsGiven ?? sending ?? [];
    const { chosen, blocks } = blocksFor(ids);
    if (chosen.length === 0) return doneSending();
    setBusy(true);
    try {
      const name = title.trim() || 'Без назви';
      const documentId = await clipBlocksToNote(name, blocks);
      // The message stays where it is and says where it went.
      await markChatMessagesUsed(chosen.map((m) => m.id), documentId, name);
      doneSending();
      navigation.navigate('Editor', { documentId, offerBoard: true });
    } catch (e) {
      notify('Не збереглося', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // A MESSAGE HELD (see ChatMessageMenu): the list stays, blurred, and
  // this message is lifted above it with everything it can become.
  const bubbleRefs = useRef<Record<string, View | null>>({});
  const [pressed, setPressed] = useState<{ message: ChatMessage; copyId?: string; rect: { x: number; y: number; width: number; height: number } } | null>(null);
  const [recentNotes, setRecentNotes] = useState<{ id: string; title: string }[] | null>(null);
  function liftMessage(message: ChatMessage, copyId?: string) {
    const node = bubbleRefs.current[copyId ? `copy:${copyId}` : message.id];
    if (!node) return;
    node.measureInWindow((x, y, width, height) => {
      hapticPickUp();
      setPressed({ message, copyId, rect: { x, y, width, height } });
    });
  }
  // THE BOARD LOOK of the layer's chat (see ChatDayBoard): one frame per
  // day, newest day first, the cards in the order they were said.
  const camera = FEATURES.chatBoardCamera;
  const copiesOn = camera && FEATURES.chatBoardCopies;
  const [boardLevel, setBoardLevel] = useState(0);
  // The board's own zoom ends where the tape begins: nearer than the
  // nearest level is the tape, and a pinch out from the tape is the board.
  const boardLevelRef = useRef(boardLevel);
  boardLevelRef.current = boardLevel;
  const leaveBoard = layerPages?.chat;
  const stepBoard = useMemo(
    () => (step: 1 | -1) => {
      if (step === -1 && boardLevelRef.current === 0) {
        leaveBoard?.();
        return;
      }
      setBoardLevel((l) => Math.min(BOARD_COLS.length - 1, Math.max(0, l + step)));
    },
    [leaveBoard]
  );
  const enterBoard = layerPages?.board;
  const tapePinch = useMemo(
    () =>
      Gesture.Pinch().onEnd((e) => {
        'worklet';
        if (e.scale < 0.8 && enterBoard) runOnJS(enterBoard)();
      }),
    [enterBoard]
  );
  const boardDays = useMemo<BoardDay[]>(() => {
    if (!boardView) return [];
    const byDay = new Map<string, ChatMessage[]>();
    visibleMessages.forEach((m) => {
      const key = new Date(m.createdAt).toDateString();
      const list = byDay.get(key) ?? [];
      list.push(m);
      byDay.set(key, list);
    });
    return [...byDay.entries()]
      .map(([key, list]) => ({ key, label: formatShortDate(new Date(list[0].createdAt)), messages: list, at: list[0].createdAt }))
      .sort((a, b) => b.at - a.at)
      .map(({ key, label, messages: list }) => ({ key, label, messages: list }));
  }, [boardView, visibleMessages]);
  // The camera draws every day at once (no virtual list), so it starts with
  // the last month and asks for another one at a time.
  const [boardMonths, setBoardMonths] = useState(1);
  // Copies put on the table (see utils/chatBoardCopies): listened to only
  // while the camera board is what is on screen.
  const [boardCopies, setBoardCopies] = useState<BoardCopy[]>([]);
  useEffect(() => {
    if (!copiesOn || !boardView) return;
    return watchBoardCopies(setBoardCopies, (e) => notify('Копії не завантажились', e.message));
  }, [copiesOn, boardView]);
  const cameraDays = useMemo(() => {
    const since = Date.now() - boardMonths * 30 * 86400000;
    return boardDays.filter((d) => d.messages[0].createdAt >= since || d.messages.some((m) => m.createdAt >= since)).reverse();
  }, [boardDays, boardMonths]);
  const cameraHasEarlier = cameraDays.length < boardDays.length;
  function renderBoardCard(message: ChatMessage, cardWidth: number, lifted = false, copyId?: string) {
    const picked = !lifted && selected.has(message.id);
    const unsorted = sorting && sortedBefore !== null && !isChatMessageSorted(message, sortedBefore);
    // The camera never re-flows: its cards are always the two-to-a-row look.
    const cols = BOARD_COLS[camera ? 0 : boardLevel];
    const first = message.attachments?.[0];
    // The picture: the first attachment that has one.
    const pictured = (message.attachments ?? []).find((a) => a.kind === 'photo' || (a.kind === 'link' && !!a.imageUrl));
    const pictureW = cardWidth - (cols === 4 ? 12 : 20) - 3;
    const pictureH = Math.round(pictureW * 0.75);
    const own = message.text.trim();
    const text = own || (pictured ? '' : first ? attachmentLabel(first) : '…');
    const fontSize = cols === 2 ? 12.5 : 10;
    const lines = cols === 2 ? 6 : 5;
    const ink = softChat ? softChat.ink : theme.ink.primary;
    const muted = softChat ? softChat.ink3 : theme.ink.muted;
    return (
      <Pressable
        key={message.id}
        ref={
          lifted
            ? undefined
            : (node: View | null) => {
                bubbleRefs.current[copyId ? `copy:${copyId}` : message.id] = node;
                // The right button here too - spread as a second `ref` it
                // replaced this one, and the menu never found where the
                // message stood (the Mac, 2026-10-09).
                bindRightClick(node, isSelectMode ? undefined : () => liftMessage(message, copyId));
              }
        }
        collapsable={false}
        disabled={lifted}
        onPress={() => (isSelectMode ? toggle(message.id) : undefined)}
        onLongPress={() => {
          if (isSelectMode) return;
          liftMessage(message, copyId);
        }}
        style={[
          {
            width: cardWidth,
            borderRadius: cols === 4 ? 10 : 14,
            padding: cols === 4 ? 6 : 10,
            gap: 4,
            backgroundColor: softChat ? softChat.card : theme.surface,
            borderWidth: 1.5,
            borderColor: picked ? theme.accent : unsorted ? '#d9a441' : 'transparent',
          },
          softChat ? { boxShadow: softChat.shadow } : null,
          !lifted && pressed?.message.id === message.id && pressed.copyId === copyId && { opacity: 0 },
        ]}
      >
        {pictured && <BoardCardPicture attachment={pictured} width={pictureW} height={pictureH} />}
        {!!text && (
          <Text numberOfLines={pictured ? Math.max(2, lines - 3) : lines} style={{ color: ink, fontSize, lineHeight: Math.round(fontSize * 1.3) }}>
            {text}
          </Text>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          {cols < 4 && (
            <Text style={{ color: muted, fontSize: 10 }}>
              {new Date(message.createdAt).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}
            </Text>
          )}
          {Object.keys(message.tasks ?? {}).length > 0 && <Ionicons name="checkbox-outline" size={11} color={theme.accent} />}
          {Object.keys(message.usedIn ?? {}).length > 0 && <Ionicons name="document-text-outline" size={11} color={theme.accent} />}
          {!!message.groupedInto && <Ionicons name="git-merge-outline" size={11} color={theme.accent} />}
          {(message.projectIds ?? []).length > 0 && <Ionicons name="albums-outline" size={11} color={muted} />}
          {sorting && !!message.deferred && <Ionicons name="time-outline" size={11} color={muted} />}
          {(message.attachments?.length ?? 0) > 0 && <Ionicons name="attach-outline" size={11} color={muted} />}
        </View>
      </Pressable>
    );
  }
  function loadRecentNotes() {
    if (recentNotes) return;
    getDocs(ownedQuery('documents'))
      .then((snapshot) =>
        setRecentNotes(
          snapshot.docs
            .filter((d) => !d.id.startsWith('day_') && !d.data().deletedAt && d.data().owner?.kind !== 'chat')
            .map((d) => ({ id: d.id, title: (d.data().title as string) ?? '', updatedAt: (d.data().updatedAt as number) ?? 0 }))
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map(({ id, title }) => ({ id, title }))
        )
      )
      .catch((e: Error) => notify('Нотатки не завантажились', e.message));
  }
  const pressedLive = pressed ? messages.find((m) => m.id === pressed.message.id) ?? pressed.message : null;
  const menuActions: ChatMenuAction[] = pressedLive
    ? [
        // On the camera board: a card is put on the table as a copy (the
        // message stays in the chat), and a copy is taken off it again.
        ...(copiesOn && boardView
          ? [
              pressed?.copyId
                ? {
                    key: 'uncopy',
                    label: 'Прибрати копію',
                    icon: 'close-outline' as const,
                    onPress: () => {
                      removeBoardCopy(pressed.copyId!).catch((e: Error) => notify('Не вдалося', e.message));
                    },
                  }
                : {
                    key: 'copyout',
                    label: 'Копія на стіл',
                    icon: 'albums-outline' as const,
                    onPress: () => {
                      addBoardCopy(pressedLive.id, -1, -1).catch((e: Error) => notify('Не вдалося', e.message));
                    },
                  },
            ]
          : []),
        { key: 'edit', label: 'Виправити', icon: 'pencil-outline', onPress: () => openCaptureForEdit(pressedLive) },
        { key: 'copy', label: 'Копіювати', icon: 'copy-outline', onPress: () => Clipboard.setStringAsync(pressedLive.text) },
        { key: 'project', label: 'У проект', icon: 'albums-outline', page: 'projects' },
        { key: 'note', label: 'У нотатку', icon: 'document-text-outline', page: 'notes' },
        ...(FEATURES.chatGlue
          ? [
              {
                key: 'glue',
                label: 'У склейку',
                icon: 'link-outline' as const,
                onPress: () => {
                  addToGlue([pressedLive]).catch((e: Error) => notify('Не вдалося', e.message));
                },
              },
            ]
          : []),
        { key: 'task', label: 'Зробити справою', icon: 'checkbox-outline', onPress: () => makeTask(pressedLive) },
        // «Відкласти»: looked at, left for now - leaves «Необроблене».
        ...(sorting && pressedLive.from !== 'gemini'
          ? [
              {
                key: 'defer',
                label: pressedLive.deferred ? 'Зняти відкладення' : 'Відкласти',
                icon: 'time-outline' as const,
                onPress: () => {
                  setChatMessagesDeferred([pressedLive.id], !pressedLive.deferred).catch((e: Error) => notify('Не вдалося', e.message));
                },
              },
            ]
          : []),
        // Gemini's own words are not asked about again - a reply of a
        // reply is a rabbit hole nobody asked this screen to dig.
        ...(pressedLive.from !== 'gemini'
          ? [{ key: 'ask', label: 'Запитати Gemini', icon: 'sparkles-outline', onPress: () => askGeminiFor(pressedLive) }]
          : []),
        {
          key: 'select',
          label: 'Вибрати',
          icon: 'checkmark-circle-outline',
          onPress: () => {
            setIsSelectMode(true);
            setSelected(new Set([pressedLive.id]));
          },
        },
        // Not on a COPY: «Видалити» there would remove the message itself,
        // which is not what the person holding a copy thinks they are
        // deleting (2026-10-07: two messages went that way).
        ...(pressed?.copyId
          ? []
          : [
              {
                key: 'delete',
                label: 'Видалити',
                icon: 'trash-outline' as const,
                tone: 'danger' as const,
                confirmLabel: 'Точно видалити?',
                onPress: () => deleteChatMessage(pressedLive.id).catch((e: Error) => notify('Не вдалося', e.message)),
              },
            ]),
      ]
    : [];

  // "Спитати" - the ONE optional thing Gemini does here, per the plan.
  // No key configured is not an error, it is the expected first state:
  // point at Settings rather than failing silently or nagging on every
  // message.
  async function askGeminiFor(message: ChatMessage) {
    if (!message.text.trim()) return;
    const key = await getGeminiKey();
    if (!key) {
      const goSettings = await confirm({
        title: 'Немає ключа Gemini',
        message: 'Додай безкоштовний ключ у Налаштуваннях, щоб Gemini міг відповідати на повідомлення.',
        confirmLabel: 'Налаштування',
      });
      if (goSettings) navigation.navigate('Settings');
      return;
    }
    setAskingId(message.id);
    try {
      const answer = await askGemini(message.text, key);
      await sendGeminiReply(answer, message.id);
    } catch (e) {
      notify('Gemini не відповів', (e as Error).message);
    } finally {
      setAskingId((current) => (current === message.id ? null : current));
    }
  }

  // A checkbox in TODAY's daily note - which is where every task in this
  // app lives, so it shows up in the calendar's day and in Справи at once.
  async function makeTask(message: ChatMessage) {
    try {
      // The message's pictures and files go WITH the task (2026-10-09: «правки
      // та баги йдуть в комплекті зі скріном») - read from their own records,
      // so the Drive copy travels with them.
      const carried: Block[] = [];
      for (const a of message.attachments ?? []) {
        if (a.kind === 'photo') {
          const d = (await getDoc(doc(db, 'photos', a.id))).data();
          if (d?.imageUri) carried.push(blockFromPhoto({ id: a.id, ...(d as { imageUri: string }) }));
        } else if (a.kind === 'file') {
          const d = (await getDoc(doc(db, 'files', a.id))).data();
          if (d?.fileUri) carried.push(blockFromFile({ id: a.id, ...(d as { fileUri: string; fileName: string }) }));
        }
      }
      const { taskId, documentId } = await createTaskInToday(message.text, undefined, carried);
      await markChatMessageTask(message.id, taskId, documentId);
    } catch (e) {
      notify('Не вдалося створити справу', (e as Error).message);
    }
  }

  // Jump to a message that already scrolled off - used once a group's
  // new combined message lands, and from the "Об'єднано" chip on each
  // of the originals it was made from.
  function scrollToMessage(id: string) {
    const index = listRows.findIndex((row) => row.kind === 'message' && row.message.id === id);
    if (index >= 0) listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
  }

  // Several messages, folded into one - "думки приходять поступово...
  // хотілося, щоб вона лишилася однією ідеєю". Chronological order, same
  // as they were said: texts one under another, every attachment kept.
  // The originals stay right where they are (the user's own call, same
  // as a note already does) - each just says where it went.
  async function groupSelected() {
    const ids = [...selected];
    if (ids.length < 2) return;
    const chosen = [...messages].filter((m) => ids.includes(m.id)).sort((a, b) => a.createdAt - b.createdAt);
    const text = chosen.map((m) => m.text).filter(Boolean).join('\n\n');
    const attachments = chosen.flatMap((m) => m.attachments ?? []);
    setSelected(new Set());
    setIsSelectMode(false);
    try {
      const newId = await groupChatMessages(ids, text, attachments);
      scrollToMessage(newId);
    } catch (e) {
      notify('Не вдалося згрупувати', (e as Error).message);
    }
  }

  async function deleteChosen() {
    const ids = [...selected];
    if (ids.length === 0) return;
    const sure = await confirm({
      title: ids.length === 1 ? 'Видалити повідомлення?' : `Видалити ${ids.length} повідомлень?`,
      message: `Вони підуть у кошик на ${CHAT_BIN_DAYS} днів, звідти можна повернути.`,
      confirmLabel: 'Видалити',
    });
    if (!sure) return;
    try {
      await Promise.all(ids.map((id) => deleteChatMessage(id)));
      setSelected(new Set());
      setIsSelectMode(false);
    } catch (e) {
      notify('Не вдалося', (e as Error).message);
    }
  }

  // One message's bubble - in the list, and (lifted) above the blur while
  // its menu is open, so the two are exactly the same picture.
  function renderMessageBubble(message: ChatMessage, lifted: boolean) {
    const used = Object.entries(message.usedIn ?? {});
    // Struck through once EVERY task it made is closed (a task that is gone does not count).
    const madeTasks = Object.keys(message.tasks ?? {}).filter((id) => taskClosed.has(id));
    const taskDone = madeTasks.length > 0 && madeTasks.every((id) => taskClosed.get(id) === true);
    const allAttachments = message.attachments ?? [];
    const goneAttachments = photosLoaded ? allAttachments.filter((a) => a.kind === 'photo' && !photosAlive.has(a.id)) : [];
    const shownAttachments = goneAttachments.length ? allAttachments.filter((a) => !goneAttachments.includes(a)) : allAttachments;
    const picked = !lifted && selected.has(message.id);
    const fromGemini = message.from === 'gemini';
    return (
      <Pressable
        ref={
          lifted
            ? undefined
            : (node: View | null) => {
                bubbleRefs.current[message.id] = node;
                bindRightClick(node, isSelectMode ? undefined : () => liftMessage(message));
              }
        }
        collapsable={false}
        disabled={lifted}
        style={[
          styles.bubble,
          fromGemini && styles.bubbleGemini,
          picked && { borderColor: theme.accent },
          // The one being held stands in the overlay above; its place in
          // the list is kept, empty, so nothing below it moves.
          !lifted && pressed?.message.id === message.id && { opacity: 0 },
        ]}
        onPress={() => (isSelectMode ? toggle(message.id) : undefined)}
        onLongPress={() => {
          if (isSelectMode) return;
          liftMessage(message);
        }}
      >
        {fromGemini && (
          <View style={styles.geminiLabel}>
            <Ionicons name="sparkles" size={12} color={theme.accent} />
            <Text style={[styles.geminiLabelText, { color: theme.accent }]}>Gemini</Text>
          </View>
        )}
        {/* Each attachment is drawn as the CARD ITS OWN DATABASE
            draws it - the same component «Посилання», «Файли»
            and «Зображення» use, so a video arrives with its
            preview: "в чаті повинен бути вигляд картки з бази
            даних". It is the same record, not a copy, so
            touching it goes to where it lives. */}
        {/* Pictures that were cleaned away (a closed task's leftovers): said in small grey words. */}
        {goneAttachments.length > 0 && (
          <Text style={[styles.goneNote, { color: softChat ? softChat.ink3 : theme.ink.muted }]}>
            {taskDone ? 'Справу закрито, фото прибрано' : goneAttachments.length > 1 ? 'Фото прибрано' : 'Фото прибрано'}
          </Text>
        )}
        <ChatMessageMedia
          attachments={shownAttachments}
          padH={14}
          padTop={softChat ? 10 : 11}
          radius={softChat ? 20 : 16}
          ink={softChat ? softChat.ink : theme.ink.primary}
          muted={softChat ? softChat.ink3 : theme.ink.muted}
          line={softChat ? softChat.line : theme.ink.faint}
          onOpen={(item) => {
            if (isSelectMode) return toggle(message.id);
            if (item.kind === 'photo') navigation.navigate('Photos');
            else if (item.kind === 'file') navigation.navigate('Files');
            else Linking.openURL(item.url).catch(() => {});
          }}
        />
        {!!message.text && <Text style={[styles.bubbleText, taskDone && styles.bubbleTextDone]}>{message.text}</Text>}
        {askingId === message.id && (
          <View style={styles.askingRow}>
            <ActivityIndicator size="small" color={theme.ink.muted} />
            <Text style={styles.askingLabel}>Gemini думає…</Text>
          </View>
        )}
        <View style={styles.bubbleFoot}>
          <Text style={styles.bubbleTime}>
            {new Date(message.createdAt).toLocaleTimeString('uk-UA', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
          {Object.entries(message.tasks ?? {}).map(([taskId]) => (
            <Pressable
              key={taskId}
              style={styles.usedChip}
              onPress={() => navigation.navigate('Tasks')}
            >
              <Ionicons name="checkbox-outline" size={11} color={theme.accent} />
              <Text style={[styles.usedLabel, { color: theme.accent }]}>Справа</Text>
            </Pressable>
          ))}
          {used.map(([documentId, documentTitle]) => (
            <Pressable
              key={documentId}
              style={styles.usedChip}
              onPress={() => navigation.navigate('Editor', { documentId })}
            >
              <Ionicons name="document-text-outline" size={11} color={theme.accent} />
              <Text style={[styles.usedLabel, { color: theme.accent }]} numberOfLines={1}>
                {documentTitle}
              </Text>
            </Pressable>
          ))}
          {/* This message went into a group - "хотілося, щоб
              вона лишилася однією ідеєю". It stays right here
              (same rule as usedIn above), this just says where
              the combined one is. */}
          {/* Where else this message is shown - its projects, and
              the project it was written in. In a project's own
              chat that project is the place itself, so it is
              not repeated. */}
          {(message.projectIds ?? [])
            .filter((id) => id !== projectFilter)
            .map((id) => {
              const project = projectById.get(id);
              if (!project) return null;
              return (
                <Pressable key={`project-${id}`} style={styles.usedChip} onPress={() => setProjectFilter(id)}>
                  <View style={[styles.projectDot, { backgroundColor: project.color }]} />
                  <Text style={[styles.usedLabel, { color: theme.ink.muted }]} numberOfLines={1}>
                    {message.createdInProject === id ? `Створено в чаті «${project.name}»` : project.name}
                  </Text>
                </Pressable>
              );
            })}
          {sorting && !!message.deferred && (
            <View style={styles.usedChip}>
              <Ionicons name="time-outline" size={11} color={theme.ink.muted} />
              <Text style={[styles.usedLabel, { color: theme.ink.muted }]}>Відкладено</Text>
            </View>
          )}
          {!!message.groupedInto && (
            <Pressable
              style={styles.usedChip}
              onPress={() => scrollToMessage(message.groupedInto!)}
            >
              <Ionicons name="git-merge-outline" size={11} color={theme.accent} />
              <Text style={[styles.usedLabel, { color: theme.accent }]}>Об'єднано</Text>
            </Pressable>
          )}
        </View>
        {isSelectMode && !lifted && (
          <View style={styles.tick}>
            <Ionicons
              name={picked ? 'checkmark-circle' : 'ellipse-outline'}
              size={20}
              color={picked ? theme.accent : theme.ink.faint}
            />
          </View>
        )}
      </Pressable>
    );
  }

  // The tape: the chat's messages, newest last (the list is inverted).
  const tapeList = (
    <FlatList
    ref={listRef}
    inverted
    data={listRows}
    keyExtractor={(row) => row.key}
    // Inverted, so top and bottom swap: paddingTop is the visual
    // bottom (clear of the dock), paddingBottom the visual top.
    // The list runs edge to edge, under the bar and the projects'
    // row at the top and the dock below; what passes under them
    // melts into the ground (EdgeFade), as on every other list.
    contentContainerStyle={[styles.list, { paddingTop: dockClear + insets.bottom, paddingBottom: headerH + 8 }]}
    onScrollToIndexFailed={() => {}}
    renderItem={({ item }) => {
      if (item.kind === 'day') {
        return (
          <View style={styles.dayRow}>
            <Text style={styles.dayLabel}>{item.label}</Text>
          </View>
        );
      }
      return renderMessageBubble(item.message, false);
    }}
            />
  );

  return (
    <SoftSurfaceContext.Provider value={softChat}>
    <View style={styles.container}>
      {softChat ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: softChat.bg }]} pointerEvents="none" />
      ) : (
        <ScreenBackdrop id="chatBg" />
      )}
      {/* A project's chat stands on its project's own colour, faintly -
          so it cannot be mistaken for the main one ("щоб не плутатись"). */}
      {openProject && (
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: openProject.color, opacity: theme.scheme === 'dark' ? 0.16 : 0.1 }]}
          pointerEvents="none"
        />
      )}
      <ContentColumn>
        {messages.length === 0 ? (
          <View style={[styles.empty, { paddingTop: headerH }]}>
            <Ionicons name="chatbubbles-outline" size={32} color={theme.ink.faint} />
            <Text style={styles.emptyLabel}>Поки порожньо</Text>
            <Text style={styles.emptyHint}>
              Затисніть док будь-де в застосунку і скажіть, що думаєте
            </Text>
          </View>
        ) : rows.length === 0 ? (
          <View style={[styles.empty, { paddingTop: headerH }]}>
            <Ionicons name="search-outline" size={32} color={theme.ink.faint} />
            <Text style={styles.emptyLabel}>Нічого не знайдено</Text>
            {(filterKind !== null || (sorting && stateFilter !== 'all')) && (
              <Pressable
                onPress={() => {
                  setFilterKind(null);
                  setStateFilter('all');
                }}
              >
                <Text style={[styles.emptyHint, { color: theme.accent }]}>Скинути фільтр</Text>
              </Pressable>
            )}
          </View>
        ) : boardView && camera ? (
          <ChatDayCamera
            days={cameraDays}
            width={frameWidth}
            height={Math.max(0, frameHeight - headerH - dockClear - insets.bottom)}
            snap={boardLevel}
            onSnap={setBoardLevel}
            onLeave={() => leaveBoard?.()}
            copies={boardCopies
              .map((c) => ({ copy: c, message: messages.find((m) => m.id === c.messageId) }))
              .filter((c): c is { copy: BoardCopy; message: ChatMessage } => !!c.message)
              .sort((a, b) => a.copy.createdAt - b.copy.createdAt)
              .map(({ copy, message }) => ({
                id: copy.id,
                messageId: message.id,
                x: copy.x,
                y: copy.y,
                node: renderBoardCard(message, cameraCardWidth(frameWidth), false, copy.id),
              }))}
            onMoveCopy={(id, x, y) => {
              moveBoardCopy(id, x, y).catch((e: Error) => notify('Не вдалося', e.message));
            }}
            onEarlier={cameraHasEarlier ? () => setBoardMonths((n) => n + 1) : undefined}
            paddingTop={headerH + 8}
            paddingBottom={dockClear + insets.bottom}
            renderCard={(m, w) => renderBoardCard(m, w)}
            labelColor={softChat ? softChat.ink3 : theme.ink.muted}
            frameColor={softChat ? softChat.line : theme.ink.faint}
            frameFill={softChat ? 'rgba(255,255,255,0.35)' : 'transparent'}
          />
        ) : boardView ? (
          <ChatDayBoard
            days={boardDays}
            width={frameWidth}
            level={boardLevel}
            onLevel={stepBoard}
            paddingTop={headerH + 8}
            paddingBottom={dockClear + insets.bottom}
            renderCard={(m, w) => renderBoardCard(m, w)}
            labelColor={softChat ? softChat.ink3 : theme.ink.muted}
            frameColor={softChat ? softChat.line : theme.ink.faint}
            frameFill={softChat ? 'rgba(255,255,255,0.35)' : 'transparent'}
          />
        ) : inLayer ? (
          <GestureDetector gesture={tapePinch}>
            <View style={{ flex: 1 }}>{tapeList}</View>
          </GestureDetector>
        ) : (
          tapeList
        )}
      </ContentColumn>

      {ground && (
        <>
          <EdgeFade edge="top" color={ground} height={Math.max(insets.top + CHROME_TOP + TOP_NAV_H, headerH)} />
          <EdgeFade edge="bottom" color={ground} height={Math.round((dockClear + insets.bottom) * 0.85)} />
        </>
      )}
      {/* The bar's room, the projects' row and the search field, floating
          over the top of the list. */}
      <View style={styles.headerLayer} pointerEvents="box-none">
        <View
          style={styles.headerColumn}
          pointerEvents="box-none"
          onLayout={(e) => setHeaderH(Math.round(e.nativeEvent.layout.height))}
        >
        <View pointerEvents="none" style={{ height: insets.top + CHROME_TOP + 8 + (bar ? TOP_NAV_SPACE : 0) }} />
        {publishing && bar && !paneBar && <TopNavBar title={{ icon: 'chatbubbles-outline', label: 'Чат' }} />}
        {chatProjects.length > 0 && (
          <ProjectTabsRow
            items={chatProjects}
            selected={projectFilter}
            onSelect={(id) => setProjectFilter(id)}
            hideUnassigned
            endPadding={16}
          />
        )}
        {isSearching && (
          <SearchField
            autoFocus
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Пошук у чаті"
            onClose={() => {
              setSearchQuery('');
              setIsSearching(false);
            }}
            style={styles.searchRow}
          />
        )}

        </View>
      </View>

      {/* Above the dock, where the button that opens it lives - the same
          spot every other database's own menus stand in. */}
      <Menu
        soft={softChat}
        visible={filterMenuOpen}
        onClose={() => setFilterMenuOpen(false)}
        style={{ position: 'absolute', right: 16, bottom: dockClear + insets.bottom }}
        entries={[
          ...(sorting
            ? [
                { label: 'Все', checked: stateFilter === 'all', onPress: () => setStateFilter('all') },
                { label: 'Необроблене', count: sortCounts.unsorted, checked: stateFilter === 'unsorted', onPress: () => setStateFilter('unsorted') },
                { label: 'Відкладене', count: sortCounts.deferred, checked: stateFilter === 'deferred', onPress: () => setStateFilter('deferred') },
                { kind: 'rule' as const },
              ]
            : []),
          ...(filterKind !== null
            ? [
                {
                  label: 'Скинути фільтр',
                  icon: 'close-outline' as const,
                  onPress: () => setFilterKind(null),
                },
                { kind: 'rule' as const },
              ]
            : []),
          ...(bin.length > 0
            ? [
                { kind: 'rule' as const },
                {
                  label: 'Кошик',
                  icon: 'trash-outline' as const,
                  count: bin.length,
                  onPress: () => setBinOpen(true),
                },
                { kind: 'rule' as const },
              ]
            : []),
          {
            label: 'Усі вкладення',
            icon: 'attach-outline' as const,
            checked: filterKind === 'any',
            onPress: () => setFilterKind('any'),
          },
          ...(['photo', 'video', 'geo', 'link', 'file'] as AttachmentGroup[]).map((kind) => ({
            label: FILTER_LABELS[kind],
            icon: FILTER_ICONS[kind],
            checked: filterKind === kind,
            onPress: () => setFilterKind(kind),
          })),
        ]}
      />

      {FEATURES.chatGlue && glue.blocks.length > 0 && !glueOpen && (
        <Pressable
          onPress={() => setGlueOpen(true)}
          style={[
            styles.glueButton,
            { bottom: dockClear + insets.bottom + 12, backgroundColor: theme.surface, borderColor: theme.accent },
          ]}
        >
          <Ionicons name="link-outline" size={18} color={theme.accent} />
          <Text style={{ color: theme.ink.primary, fontSize: 14, fontWeight: '600' }}>Склейка · {glue.blocks.length}</Text>
        </Pressable>
      )}
      <ChatGlueSheet
        visible={glueOpen}
        onClose={() => setGlueOpen(false)}
        blocks={glue.blocks}
        sources={glue.sources}
        onShow={(chatId) => {
          setGlueOpen(false);
          setTimeout(() => scrollToMessage(chatId), 250);
        }}
        onToProject={async () => {
          if (projects.length === 0) {
            notify('Ще немає проектів', 'Створіть проект у будь-якій базі - і сюди можна буде скласти склейку.');
            return;
          }
          const picked = await ask({
            title: 'Склейка в проект',
            message: 'З неї буде нотатка, і вона стане в проекті.',
            actions: projects.map((p) => ({ id: p.id, label: p.name, icon: 'albums-outline' as const })),
          });
          if (!picked || picked === 'cancel') return;
          setGlueProject(picked);
          setGlueNaming(true);
        }}
        onEdit={() => {
          setGlueOpen(false);
          navigation.navigate('Editor', { documentId: glueId() });
        }}
        onToNote={() => setGlueDest(true)}
        onClear={async () => {
          const sure = await confirm({ title: 'Розклеїти все?', message: 'Склейка спорожніє. Повідомлення в чаті лишаться як були.', confirmLabel: 'Розклеїти' });
          if (sure) {
            clearGlue().catch((e: Error) => notify('Не вдалося', e.message));
            setGlueOpen(false);
          }
        }}
      />
      <SaveDestinationSheet
        visible={glueDest && !glueNaming}
        notesOnly
        title="Склейка у…"
        onPickToday={async () => {
          setGlueDest(false);
          setGlueOpen(false);
          try {
            const documentId = await glueToNote('', { into: 'today' });
            if (documentId) navigation.navigate('Editor', { documentId });
          } catch (e) {
            notify('Не збереглося', (e as Error).message);
          }
        }}
        onPickNew={() => setGlueNaming(true)}
        onPickExisting={async (documentId, documentTitle) => {
          setGlueDest(false);
          setGlueOpen(false);
          try {
            const id = await glueToNote('', { into: { id: documentId, title: documentTitle } });
            if (id) navigation.navigate('Editor', { documentId: id });
          } catch (e) {
            notify('Не збереглося', (e as Error).message);
          }
        }}
        onClose={() => setGlueDest(false)}
      />
      <RenamePrompt
        visible={glueNaming}
        title="Нотатка зі склейки"
        initialValue={`Думки · ${formatShortDate(new Date())}`}
        placeholder="Назва нотатки"
        busy={false}
        onCancel={() => {
          setGlueNaming(false);
          setGlueProject(null);
        }}
        onSave={async (name: string) => {
          const groupId = glueProject ?? undefined;
          setGlueDest(false);
          setGlueNaming(false);
          setGlueProject(null);
          setGlueOpen(false);
          try {
            const documentId = await glueToNote(name, { groupId });
            if (documentId) navigation.navigate('Editor', { documentId });
          } catch (e) {
            notify('Не збереглося', (e as Error).message);
          }
        }}
      />
      <ChatBinSheet
        visible={binOpen}
        onClose={() => setBinOpen(false)}
        items={bin}
        label={(m) => (m.attachments?.[0] ? attachmentLabel(m.attachments[0]) : '…')}
        onRestore={(id) => restoreChatMessage(id).catch((e: Error) => notify('Не вдалося', e.message))}
        onPurge={async (id) => {
          const sure = await confirm({ title: 'Видалити назавжди?', message: 'Це повідомлення не можна буде повернути.', confirmLabel: 'Видалити' });
          if (sure) purgeChatMessage(id).catch((e: Error) => notify('Не вдалося', e.message));
        }}
      />

      {/* Where the chosen messages go. Notes only: a message is text, and
          what it becomes is a note - putting it straight on a board is
          what the note's own offer is for. */}
      <SaveDestinationSheet
        visible={!!sending && !naming}
        notesOnly
        title={sending && sending.length > 1 ? `${sending.length} повідомлень у…` : 'Повідомлення у…'}
        onPickToday={() => sendInto('today')}
        onPickNew={() => setNaming(true)}
        onPickExisting={(documentId, documentTitle) => sendInto({ id: documentId, title: documentTitle })}
        onClose={() => setSending(null)}
      />

      <RenamePrompt
        visible={naming}
        title="Нотатка з думок"
        initialValue={`Думки · ${formatShortDate(new Date())}`}
        placeholder="Назва нотатки"
        busy={busy}
        onCancel={() => {
          setNaming(false);
          setSending(null);
        }}
        onSave={gatherIntoNewNote}
      />
      <ChatMessageMenu
        anchor={
          pressed && camera && boardView
            ? // The camera draws cards smaller than they are lifted: the lifted
              // one is shown at its own size, kept on the screen.
              (() => {
                const natural = cameraCardWidth(frameWidth);
                return { ...pressed.rect, width: natural, x: Math.max(16, Math.min(pressed.rect.x, frameWidth - natural - 16)) };
              })()
            : pressed?.rect ?? null
        }
        bubble={pressedLive ? (boardView ? renderBoardCard(pressedLive, camera ? cameraCardWidth(frameWidth) : boardCardWidth(frameWidth, boardLevel), true) : renderMessageBubble(pressedLive, true)) : null}
        actions={menuActions}
        projects={projects.map((p) => ({ id: p.id, name: p.name, color: p.color, on: (pressedLive?.projectIds ?? []).includes(p.id) }))}
        onToggleProject={(projectId) => {
          if (!pressedLive) return;
          const on = (pressedLive.projectIds ?? []).includes(projectId);
          setChatMessagesInProject([pressedLive.id], projectId, !on);
        }}
        onNewProject={async (name) => {
          if (!pressedLive) return;
          const ref = await addDoc(collection(db, 'groups'), {
            name,
            color: PROJECT_COLORS[projects.length % PROJECT_COLORS.length],
            ...groupKindFields([]),
          });
          setChatMessagesInProject([pressedLive.id], ref.id, true);
        }}
        recentNotes={recentNotes}
        onLoadNotes={loadRecentNotes}
        onToToday={() => pressedLive && sendInto('today', [pressedLive.id])}
        onToNewNote={(title) => pressedLive && gatherIntoNewNote(title, [pressedLive.id])}
        onToNote={(id, title) => pressedLive && sendInto({ id, title }, [pressedLive.id])}
        newNoteDefault={`Думки · ${formatShortDate(new Date())}`}
        onClose={() => setPressed(null)}
      />
      {/* The layer's page: its own bar and dock, inside it and moving with
          it - see CalendarDrawer. */}
      {inLayer && (
        <>
          <TopNavBar
            inline={{ width: frameWidth }}
            softInline={!!softChat}
            title={layerTitle}
            backOverride={layerBack}
            extrasOverride={layerExtras}
          />
          <InlineDock
            width={frameWidth}
            beads={{ left: leftBead, right: rightBead }}
            actions={dockActionsList}
            soft={softChat}
            back={chatLayer!.close}
          />
        </>
      )}
    </View>
    </SoftSurfaceContext.Provider>
  );
}

// The soft overlay (theme/soft's softenStyles).
const softChatRecipe = (S: SoftTokens) =>
  StyleSheet.create({
    dayLabel: { fontFamily: SOFT_MEDIUM, color: S.ink3 },
    bubble: { backgroundColor: S.card, borderWidth: 0, borderRadius: 20, boxShadow: S.shadow },
    // Gemini's answers: a warm tint of the accent rather than an outline.
    bubbleGemini: { borderWidth: 0, backgroundColor: S.dark ? 'rgba(232,154,98,0.14)' : 'rgba(217,121,63,0.10)', boxShadow: [] },
    geminiLabelText: { fontFamily: SOFT_SEMIBOLD, textTransform: 'none', letterSpacing: 0, fontSize: 12 },
    askingLabel: { fontFamily: SOFT_REGULAR, color: S.ink2 },
    bubbleText: { fontFamily: SOFT_REGULAR, fontSize: IS_POINTER ? 14.5 : 16.5, lineHeight: IS_POINTER ? 21 : 24, color: S.ink },
    bubbleTime: { fontFamily: SOFT_MEDIUM, color: S.ink3 },
    // A message whose task is closed: no longer news.
    bubbleTextDone: { textDecorationLine: 'line-through', color: S.ink3 },
    goneNote: { fontFamily: SOFT_REGULAR, fontSize: 12, marginBottom: 6 },
    usedLabel: { fontFamily: SOFT_MEDIUM },
    emptyLabel: { fontFamily: SOFT_SEMIBOLD, color: S.ink },
    emptyHint: { fontFamily: SOFT_REGULAR, color: S.ink3 },
  }) as Record<string, object>;

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
    },
    list: {
      paddingHorizontal: 20,
      gap: 8,
    },
    headerLayer: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
    },
    headerColumn: {
      width: '100%',
      maxWidth: MAX_CONTENT_WIDTH,
      alignSelf: 'center',
    },
    searchRow: {
      marginHorizontal: 20,
      marginBottom: 8,
    },
    dayRow: {
      alignItems: 'center',
      paddingVertical: 10,
    },
    dayLabel: {
      fontSize: 12,
      fontFamily: FONT_SEMIBOLD,
      color: t.ink.muted,
    },
    bubble: {
      backgroundColor: t.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: 'transparent',
      paddingHorizontal: 14,
      paddingVertical: 10,
      gap: 6,
    },
    // A tint, not a whole second style - the shape of the bubble stays
    // the same, only WHO wrote it changes. Same reasoning as everywhere
    // else colour is used sparingly in this app: one accent, spent on
    // purpose.
    bubbleGemini: {
      borderColor: t.accent,
      backgroundColor: mutedForTheme(t.accent, t, 0.85),
    },
    geminiLabel: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    geminiLabelText: {
      fontSize: 11,
      fontFamily: FONT_SEMIBOLD,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    askingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    askingLabel: {
      fontSize: 13,
      fontFamily: FONT_REGULAR,
      color: t.ink.muted,
    },
    bubbleTextDone: { textDecorationLine: 'line-through', opacity: 0.55 },
    goneNote: { fontFamily: FONT_REGULAR, fontSize: 12, marginBottom: 6 },
    bubbleText: {
      fontSize: IS_POINTER ? 14.5 : 16,
      lineHeight: IS_POINTER ? 21 : 22,
      fontFamily: FONT_REGULAR,
      color: t.ink.primary,
    },
    attachment: {
      marginBottom: 2,
    },
    bubbleFoot: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 8,
    },
    bubbleTime: {
      fontSize: 11,
      fontFamily: FONT_REGULAR,
      color: t.ink.faint,
    },
    projectDot: {
      width: 7,
      height: 7,
      borderRadius: 3.5,
    },
    usedChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      maxWidth: 200,
    },
    usedLabel: {
      fontSize: 11,
      fontFamily: FONT_SEMIBOLD,
    },
    tick: {
      position: 'absolute',
      right: 10,
      top: 10,
    },
    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingHorizontal: 40,
    },
    glueButton: {
      position: 'absolute',
      right: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      height: 44,
      paddingHorizontal: 16,
      borderRadius: 22,
      borderWidth: 1.5,
    },
    emptyLabel: {
      fontSize: 16,
      fontFamily: FONT_BOLD,
      color: t.ink.primary,
    },
    emptyHint: {
      fontSize: 13,
      fontFamily: FONT_REGULAR,
      color: t.ink.muted,
      textAlign: 'center',
    },
  });
