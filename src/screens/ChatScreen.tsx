import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
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
import { collection, getDocs } from '../firestore';
import { db } from '../firebase';
import { ownedQuery } from '../utils/owned';
import { onSnapshot } from '../firestore';
import type { Group } from '../types';
import { askGemini } from '../utils/gemini';
import { getGeminiKey } from '../utils/geminiKey';
import { useChromeStyle, useDockActions, useDockBeads, useDockLeave, useDockShowContext } from '../navigation/navDock';
import { CHROME_TOP } from '../constants/rail';
import { useDockClearance } from '../navigation/dockGeometry';
import { ChatMessage, deleteChatMessage, groupChatMessages, markChatMessageTask, markChatMessagesUsed, sendGeminiReply, watchChat, setChatMessagesInProject, setChatProjectContext } from '../utils/chat';
import {
  appendBlocksToToday,
  clipBlocksToNote,
  copyObjectsToNote,
  createTaskInToday,
} from '../utils/copyToNote';
import { formatShortDate } from '../utils/dateLocale';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD, SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';
import { SoftSurfaceContext, softenStyles, useSoftDatabase, type SoftTokens } from '../theme/soft';
import { Block } from '../types';
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

export default function ChatScreen() {
  const theme = useTheme();
  // THE CHAT IN THE SOFT STYLE (theme/soft) - the last screen still in
  // glass ("чат"). On a phone: the soft bar and dock, the soft ground,
  // messages as soft cards, Inter.
  const softChat = useSoftDatabase();
  useChromeStyle('soft', !!softChat);
  const styles = softenStyles(useStyles(makeStyles), softChat, softChatRecipe);
  const insets = useSafeAreaInsets();
  const dockClear = useDockClearance();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const isFocused = useIsFocused();
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
    setChatProjectContext(isFocused && projectFilter ? projectFilter : null);
    return () => setChatProjectContext(null);
  }, [isFocused, projectFilter]);

  useEffect(
    () =>
      watchChat(setMessages, (e) => notify('Чат не завантажився', e.message)),
    []
  );

  const needle = searchQuery.trim().toLowerCase();
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
          messageMatchesSearch(m) &&
          (!projectFilter || (m.projectIds ?? []).includes(projectFilter))
      ),
    [messages, filterKind, needle, projectFilter]
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
  const listRef = useRef<FlatList<Row>>(null);

  useDockLeave('chatbubbles-outline', () => navigation.goBack());
  useDockBeads(
    isFocused
      ? {
          icon: isSelectMode ? 'close-outline' : 'checkmark-circle-outline',
          active: isSelectMode,
          onPress: () => {
            setSelected(new Set());
            setIsSelectMode((prev) => !prev);
            if (isSelectMode) showContext();
          },
        }
      : null,
    isFocused ? { icon: 'mic-outline', onPress: openCapture } : null
  );
  useDockActions(
    !isFocused
      ? null
      : isSelectMode
        ? selected.size > 0
          ? [
              {
                key: 'note',
                icon: 'document-text-outline',
                label: 'У нотатку',
                onPress: () => setSending([...selected]),
                closesStack: true,
              },
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
              active: filterKind !== null,
              onPress: () => setFilterMenuOpen((v) => !v),
            },
          ]
  );

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
  const [pressed, setPressed] = useState<{ message: ChatMessage; rect: { x: number; y: number; width: number; height: number } } | null>(null);
  const [recentNotes, setRecentNotes] = useState<{ id: string; title: string }[] | null>(null);
  function liftMessage(message: ChatMessage) {
    const node = bubbleRefs.current[message.id];
    if (!node) return;
    node.measureInWindow((x, y, width, height) => {
      hapticPickUp();
      setPressed({ message, rect: { x, y, width, height } });
    });
  }
  function loadRecentNotes() {
    if (recentNotes) return;
    getDocs(ownedQuery('documents'))
      .then((snapshot) =>
        setRecentNotes(
          snapshot.docs
            .filter((d) => !d.id.startsWith('day_') && !d.data().deletedAt)
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
        { key: 'edit', label: 'Виправити', icon: 'pencil-outline', onPress: () => openCaptureForEdit(pressedLive) },
        { key: 'copy', label: 'Копіювати', icon: 'copy-outline', onPress: () => Clipboard.setStringAsync(pressedLive.text) },
        { key: 'project', label: 'У проект', icon: 'albums-outline', page: 'projects' },
        { key: 'note', label: 'У нотатку', icon: 'document-text-outline', page: 'notes' },
        { key: 'task', label: 'Зробити справою', icon: 'checkbox-outline', onPress: () => makeTask(pressedLive) },
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
        {
          key: 'delete',
          label: 'Видалити',
          icon: 'trash-outline',
          tone: 'danger',
          confirmLabel: 'Точно видалити?',
          onPress: () => deleteChatMessage(pressedLive.id).catch((e: Error) => notify('Не вдалося', e.message)),
        },
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
      const { taskId, documentId } = await createTaskInToday(message.text);
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
      message: 'Це єдине, що справді прибирає їх з чату.',
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
    const picked = !lifted && selected.has(message.id);
    const fromGemini = message.from === 'gemini';
    return (
      <Pressable
        ref={
          lifted
            ? undefined
            : (node: View | null) => {
                bubbleRefs.current[message.id] = node;
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
        {(message.attachments ?? []).map((item, index) => (
          <View key={`${item.kind}-${item.id}-${index}`} style={styles.attachment}>
            {item.kind === 'photo' ? (
              <PhotoRow
                photo={{ id: item.id, imageUri: item.uri, documentIds: [], tagIds: [] }}
                tags={[]}
                onPress={() =>
                  isSelectMode ? toggle(message.id) : navigation.navigate('Photos')
                }
              />
            ) : item.kind === 'file' ? (
              <FileRow
                file={{ id: item.id, fileName: item.name, fileUri: item.uri, tagIds: [] }}
                tags={[]}
                onPress={() =>
                  isSelectMode ? toggle(message.id) : navigation.navigate('Files')
                }
              />
            ) : (
              <LinkRow
                link={{
                  id: item.id,
                  url: item.url,
                  title: item.title,
                  siteName: item.siteName,
                  imageUrl: item.imageUrl,
                  tagIds: [],
                }}
                tags={[]}
                onPress={() => {
                  if (isSelectMode) return toggle(message.id);
                  Linking.openURL(item.url).catch(() => {});
                }}
              />
            )}
          </View>
        ))}
        {!!message.text && <Text style={styles.bubbleText}>{message.text}</Text>}
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
        <View style={{ height: insets.top + CHROME_TOP + 8 }} />
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

        {messages.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="chatbubbles-outline" size={32} color={theme.ink.faint} />
            <Text style={styles.emptyLabel}>Поки порожньо</Text>
            <Text style={styles.emptyHint}>
              Затисніть док будь-де в застосунку і скажіть, що думаєте
            </Text>
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="search-outline" size={32} color={theme.ink.faint} />
            <Text style={styles.emptyLabel}>Нічого не знайдено</Text>
            {filterKind !== null && (
              <Pressable onPress={() => setFilterKind(null)}>
                <Text style={[styles.emptyHint, { color: theme.accent }]}>Скинути фільтр</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <FlatList
            ref={listRef}
            inverted
            data={listRows}
            keyExtractor={(row) => row.key}
            // Inverted, so top and bottom swap: paddingTop is the visual
            // bottom (clear of the dock), paddingBottom the visual top.
            contentContainerStyle={[styles.list, { paddingTop: dockClear + insets.bottom, paddingBottom: 8 }]}
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
        )}
      </ContentColumn>

      {/* Above the dock, where the button that opens it lives - the same
          spot every other database's own menus stand in. */}
      <Menu
        soft={softChat}
        visible={filterMenuOpen}
        onClose={() => setFilterMenuOpen(false)}
        style={{ position: 'absolute', right: 16, bottom: dockClear + insets.bottom }}
        entries={[
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
        anchor={pressed?.rect ?? null}
        bubble={pressedLive ? renderMessageBubble(pressedLive, true) : null}
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
    bubbleText: { fontFamily: SOFT_REGULAR, fontSize: 16.5, lineHeight: 24, color: S.ink },
    bubbleTime: { fontFamily: SOFT_MEDIUM, color: S.ink3 },
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
    bubbleText: {
      fontSize: 16,
      lineHeight: 22,
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
