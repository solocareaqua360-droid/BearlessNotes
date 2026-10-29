import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { withTiming } from 'react-native-reanimated';
import TextInput from '../components/AppTextInput';
import Svg, { Circle } from 'react-native-svg';
import BalloonMark from '../components/BalloonMark';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { Ionicons } from '../components/icons/Ionicons';
import FormattedText from '../components/FormattedText';
import { ask, notify } from '../components/surfaces/Ask';
import { useSoft } from '../theme/soft';
import { SOFT_BOLD, SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import {
  askAssistant,
  blocksOf,
  foldOlder,
  groupsOf,
  deleteChat,
  listChats,
  loadChat,
  loadChatById,
  routeFirstMessage,
  updateChatFields,
  type ChatSummary,
  memoryTexts,
  newChat,
  ROOT_TOPIC,
  saveChat,
  splitStructure,
  titleOf,
  topicPath,
  type AssistantChat,
  type AssistantMessage,
  type AssistantStructure,
} from '../utils/assistant';
import { createChatBoard, listChatObjects, promoteChatObject } from '../utils/chatObjects';
import ChatsSheet from '../components/ChatsSheet';
import ChatFolderSheet from '../components/ChatFolderSheet';
import ChatInstructionSheet from '../components/ChatInstructionSheet';
import ChatInstructionChip from '../components/ChatInstructionChip';
import ChatRouteCard from '../components/ChatRouteCard';
import ChatMaterialsSheet from '../components/ChatMaterialsSheet';
import ChatOutlineSheet from '../components/ChatOutlineSheet';
import { useBoardCardCount } from '../utils/chatStructureRead';
import { folderOfPointer, folderOptions, type FolderOption } from '../utils/chatFolders';
import { useTags } from '../hooks/useTags';
import { peekDocument, useDocumentIndex } from '../hooks/useDocumentIndex';
import { branchCard, currentOutline, deepenCard, mergeStructure } from '../utils/chatBoardOps';
import { nodesFromOutline } from '../utils/chatOwned';
import ChatBoardWindow from '../components/ChatBoardWindow';
import ThinkingEffect, { useThinkingVariant } from '../components/ThinkingEffect';
import ChatComposer from '../components/chat/ChatComposer';
import ChatHintsStrip, { HINTS_STRIP_H } from '../components/chat/ChatHintsStrip';
import ChatStarterTiles from '../components/chat/ChatStarterTiles';
import ChatAttachSheet from '../components/chat/ChatAttachSheet';
import ChatCostWarning, { type CostRow } from '../components/chat/ChatCostWarning';
import ChatThresholdSheet from '../components/chat/ChatThresholdSheet';
import MessageAttachments from '../components/chat/MessageAttachments';
import type { HintKind } from '../components/chat/HintPicture';
import DocumentPickerModal from '../components/DocumentPickerModal';
import {
  attachmentParts,
  countTokens,
  folderAttachment,
  linkAttachment,
  noteAttachment,
  pickCamera,
  pickFile,
  pickGallery,
  priceOfTokens,
  useCostThreshold,
  type ChatAttachment,
  type GeminiPart,
} from '../utils/chatAttachments';
import Menu, { type MenuEntry } from '../components/surfaces/Menu';
import { writeMemoryNote, writeMemoryTree } from '../utils/assistantTree';
import { shortTitle } from '../utils/assistant';
import { FEATURES } from '../features';
import { navigationRef } from '../navigationRef';
import AssistantHome, { NO_THEME, ThemeChips } from '../components/chat/AssistantHome';
import RenamePrompt from '../components/RenamePrompt';
import { holdAsk } from '../components/surfaces/HoldAsk';
import { useChromeStyle, useDockBeads, useTopBack, useTopExtras } from '../navigation/navDock';
import { useDockDesksHere } from '../navigation/deskBeadsBus';
import { applySort, createTheme, deleteTheme, likelyThemes, listenThemes, pairsOf, renameThemeTo, similarChat, sortPlan, type ChatSection, type ChatTheme } from '../utils/assistant';
import { ASSIST_KEY, assistDockCover, assistFlown, assistReturned, assistWash, closeAssistant } from '../utils/assistMorph';
import { morphLanded } from '../utils/morph';
import { speakThoughts, stopVoice, subscribeVoice } from '../utils/thoughtVoice';
import { useGeminiUsage } from '../utils/geminiUsage';
import { hapticPickUp } from '../utils/haptics';
import { getDocs, where } from '../firestore';
import { ownedQuery } from '../utils/owned';
import { parseFormattedText } from '../utils/documentBlocks';
import { GlassPortal } from '../components/GlassPortal';
import { useIsFocused } from '@react-navigation/native';
import DockGlassFill, { useDockSurface } from '../components/DockGlassFill';
import { useDockGlass } from '../utils/dockGlass';

// THE CONVERSATION WITH THE AI (the sketch is the canvas DsJtJiEDSEMWdhomAgJreE; built 2026-10-22/23).
// Opened from the round button beside «+» on the start desks: a thought to talk over comes as suddenly as one for «Думки».
// Plain talk, no modes and no buttons hanging over it (the user: they «лякають»). Each answer is a stack of BLOCKS (bold and
// lists drawn as in a note). A block HELD starts picking: taps add more; while anything is picked the field gives way to the
// picked blocks' actions: remember them as ONE memory, ask about them in more detail (that opens a BRANCH under the branch
// they were said in), copy. «В нотатку» lays the memories as a tree of nested notes and a board that shows it. The AI reads
// a summary of the older part of the talk + what was picked + the last messages (utils/assistant). An answer can be listened to
// with the same voice as «Думки», and the field takes dictation.

const blockKey = (messageId: string, index: number) => `${messageId}:${index}`;
const plainOf = (text: string) =>
  text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();

// THE COST RING (sketch 2026-10-23): the conversation's total in dollars, always rounded UP to the next tenth, and the ring
// fills as that tenth is used. A tap opens the three sums. Nothing here is a budget - the app has none.
const tenthsOf = (usd: number) => Math.max(0.1, Math.ceil(usd * 10 - 1e-9) / 10);
const money = (usd: number, digits: number) => usd.toFixed(digits).replace('.', ',');

// «N карток» of the draft board, live (the number kept in the message is only what the AI made at first).
function StructCount({ boardId, fallback, style }: { boardId: string; fallback: number; style: object }) {
  const n = useBoardCardCount(boardId);
  return <Text style={style}>{`дошка · чернетка · ${n ?? fallback} карток`}</Text>;
}

// The ring under the conversation's name: the tenth of a dollar being used, small enough to stand in a line of text.
function MiniRing({ usd, color, track }: { usd: number; color: string; track: string }) {
  const r = 5.5;
  const c = 2 * Math.PI * r;
  const tenths = usd * 10;
  const used = tenths <= 0 ? 0 : tenths - Math.floor(tenths - 1e-9);
  return (
    <Svg width={15} height={15} viewBox="0 0 15 15">
      <Circle cx={7.5} cy={7.5} r={r} fill="none" stroke={track} strokeWidth={2} />
      <Circle cx={7.5} cy={7.5} r={r} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeDasharray={`${Math.max(0.06, Math.min(1, used)) * c} ${c}`} transform="rotate(-90 7.5 7.5)" />
    </Svg>
  );
}


// «Кожен запуск застосунку - нова розмова» (the user, 2026-10-24): the first time the conversation is opened since the app
// started it is a NEW one (an empty one is never kept in the list - saveChat writes nothing of it to the database); moving
// around the app and coming back finds the same one, the last. The older ones wait in the list of conversations.
let conversationStartedThisRun = false;
// The list as it was last read (features.aiHome): drawn at once on the next opening, then brought up to date - no empty frame.
// «1 пара», «3 пари», «5 пар».
function pairsWord(n: number): string {
  const d = n % 10;
  const t = n % 100;
  return `${n} ${d === 1 && t !== 11 ? 'пара' : d >= 2 && d <= 4 && (t < 12 || t > 14) ? 'пари' : 'пар'}`;
}
// The conversations being read by topic, for as long as the app runs (features.aiChatOutline).
const byTopicChats = new Set<string>();
let lastChats: ChatSummary[] = [];
let lastThemes: ChatTheme[] = [];

export default function AssistantScreen() {
  const S = useSoft();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<{ goBack: () => void; navigate: (name: string, params?: object) => void }>();
  const keyboard = useKeyboardHeight();
  const usage = useGeminiUsage();
  const [chat, setChat] = useState<AssistantChat | null>(null);
  const chatRef = useRef<AssistantChat | null>(null);
  const [draft, setDraft] = useState('');
  // «Скло» (utils/dockGlass): the top capsule and the composer are glass over the conversation, their blur's target.
  const chatFocused = useIsFocused();
  const [topH, setTopH] = useState(76);
  const glassOn = useDockGlass();
  const topGlass = useDockSurface(S, glassOn);
  const [busy, setBusy] = useState(false);
  // The blocks picked right now, in the order they were picked.
  const [picked, setPicked] = useState<string[]>([]);
  // The branch the talk is in now (ROOT_TOPIC = the main topic).
  const [topic, setTopic] = useState<string>(ROOT_TOPIC);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const [costOpen, setCostOpen] = useState(false);
  // The draft board open in its window over the conversation.
  const [boardOpen, setBoardOpen] = useState<AssistantStructure | null>(null);
  // What the AI is doing to the board's cards right now, and the way to take its last change back.
  const [opBusy, setOpBusy] = useState(false);
  const [lastOp, setLastOp] = useState<{ summary: string; undo: () => Promise<void> } | null>(null);
  const [boardTick, setBoardTick] = useState(0);
  const [fitTick, setFitTick] = useState(0);
  const [thinkingVariant, setThinkingVariant] = useThinkingVariant();
  // THE DOCK (sketches 2-9 of 2026-10-24): what is attached to the next message, the «+» sheet, the hints under the «?»,
  // the price check before sending, and the dock's own drawn height (the chat is kept clear of it).
  const [attached, setAttached] = useState<ChatAttachment[]>([]);
  const [attachOpen, setAttachOpen] = useState(false);
  const [notePickerOpen, setNotePickerOpen] = useState(false);
  const [folderPickOpen, setFolderPickOpen] = useState(false);
  const [linkChoices, setLinkChoices] = useState<{ id: string; title: string; url: string; siteName?: string }[] | null>(null);
  const [hintsOpen, setHintsOpen] = useState(false);
  const [dockH, setDockH] = useState(56);
  const [estimate, setEstimate] = useState<{ tokens: number; usd: number; rows: CostRow[] } | null>(null);
  const [warning, setWarning] = useState<{ cost: number; rows: CostRow[]; go: () => void } | null>(null);
  const [thresholdOpen, setThresholdOpen] = useState(false);
  const [threshold, setThreshold] = useCostThreshold();
  const { tags, attachTag, createAndAttachTag } = useTags();
  const docIndex = useDocumentIndex();
  const folders = useMemo(() => folderOptions(tags), [tags]);
  const [chatsOpen, setChatsOpen] = useState(false);
  const [chatList, setChatList] = useState<ChatSummary[]>(lastChats);
  const [folderFor, setFolderFor] = useState<{ chatId: string; purpose: 'chat' | 'save' } | null>(null);
  const [instructionFor, setInstructionFor] = useState<string | null>(null);
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [outlineBoard, setOutlineBoard] = useState<string | null>(null);
  const [routeOffer, setRouteOffer] = useState<{ text: string; chatId: string; title: string } | null>(null);
  const [materialsCount, setMaterialsCount] = useState(0);
  const inputRef = useRef<TextInput>(null);
  const committed = useRef('');
  const scroll = useRef<ScrollView>(null);

  // Opened out of the balloon (utils/assistMorph): drawn - the sheet over it may go; gone - the dock's capsule goes home.
  useEffect(() => {
    const t = setTimeout(() => morphLanded(ASSIST_KEY), 60);
    return () => {
      clearTimeout(t);
      assistReturned();
    };
  }, []);
  useEffect(() => {
    // The list comes first (features.aiHome): a conversation is made only when one is begun (newConversation) or opened.
    if (FEATURES.aiHome) return;
    const firstOpen = !conversationStartedThisRun;
    conversationStartedThisRun = true;
    const start = firstOpen
      ? Promise.resolve(newChat()).then((fresh) => {
          saveChat(fresh); // only the phone's own copy: it is what «the last one» means from now on
          return fresh;
        })
      : loadChat();
    start.then((c) => {
      chatRef.current = c;
      setChat(c);
      // Back to the branch the last message was said in.
      const last = [...c.messages].reverse().find((m) => m.topicId);
      if (last?.topicId && c.topics?.some((t) => t.id === last.topicId)) setTopic(last.topicId);
    });
  }, []);
  const update = (next: AssistantChat) => {
    chatRef.current = next;
    setChat(next);
    saveChat(next);
  };
  // THE FIRST SCREEN IS A LIST (features.aiHome): themes and conversations; a conversation opens from it and «‹» / × goes back.
  const [home, setHome] = useState<boolean>(FEATURES.aiHome);
  const [composing, setComposing] = useState(false);
  const [level, setLevel] = useState<string | null>(null);
  const [themes, setThemes] = useState<ChatTheme[]>(lastThemes);
  const [similar, setSimilar] = useState<ChatSummary | null>(null);
  const [themeSkip, setThemeSkip] = useState<string | null>(null);
  const [themeAsk, setThemeAsk] = useState(false);
  const [newThemeFor, setNewThemeFor] = useState<'chat' | 'list' | null>(null);
  const [renameTheme, setRenameTheme] = useState<ChatTheme | null>(null);
  const [renameChat, setRenameChat] = useState<ChatSummary | null>(null);
  // THE CONVERSATION BY TOPIC (features.aiChatOutline): the «Зміст розмови» card, which view is on (by time unless asked -
  // what is typed lands at the end), the AI at work on «Впорядкувати», a topic being renamed, where each topic stands.
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [byTopic, setByTopic] = useState(false);
  const [sortBusy, setSortBusy] = useState(false);
  const [renameSection, setRenameSection] = useState<ChatSection | null>(null);
  const sectionY = useRef<Record<string, number>>({});
  const jumpTo = useRef<string | null>(null);
  useEffect(() => {
    setByTopic(!!chat?.id && byTopicChats.has(chat.id));
    setOutlineOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat?.id]);
  useEffect(
    () =>
      FEATURES.aiHome
        ? listenThemes((t) => {
            lastThemes = t;
            setThemes(t);
          })
        : undefined,
    []
  );
  useEffect(() => {
    if (FEATURES.aiHome && home) refreshChats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home]);
  // What the draft looks like, read at each FINISHED word - no waiting for a pause: a pause that every letter put off again
  // meant the card came only once the typing stopped, 5-7 s after the first letter (the user, 2026-10-29). The word still
  // being typed is left out, so the card does not blink with each letter; it changes only when the match itself changes.
  const doneWords = draft.slice(0, Math.max(draft.search(/[\s.,;:!?]+[^\s.,;:!?]*$/), 0));
  useEffect(() => {
    if (!home || !composing) return;
    const next = similarChat(doneWords, chatList);
    setSimilar((prev) => (prev?.id === next?.id ? prev : next));
  }, [doneWords, home, composing, chatList]);
  // The window hides the app's dock (utils/assistMorph's cover, and the balloon's place stands empty while it is open); the LIST
  // stands under the dock, the balloon back in its place with «you are here» on it. The first time only after the window has
  // grown (the opening's own cover comes 140 ms in).
  const dockShownOnce = useRef(false);
  // Only while this window is in front: gone to a desk from the list's dock, it must not leave the dock hidden over the desk
  // (2026-10-29: the Start desk came back with no dock at all).
  useEffect(
    () => () => {
      if (!FEATURES.aiHome) return;
      assistDockCover.value = withTiming(0, { duration: 120 });
    },
    []
  );
  useEffect(() => {
    if (!FEATURES.aiHome) return;
    if (!chatFocused) {
      assistDockCover.value = withTiming(0, { duration: 120 });
      assistFlown.value = 0;
      // A desk picked from the list's dock pushed the desks again OVER this window (Tabs, Assistant, Tabs): the window is
      // left - only the desks stay, as they are now - so «back» does not bring the list up again under them.
      const t = setTimeout(() => {
        if (!navigationRef.isReady()) return;
        const st = navigationRef.getRootState() as unknown as { index: number; routes: { name: string }[] };
        const top = st.routes[st.index];
        if (top?.name === 'Tabs' && st.routes.slice(0, st.index).some((r) => r.name === 'Assistant')) {
          navigationRef.reset({ ...(st as object), index: 0, routes: [top] } as never);
        }
      }, 0);
      return () => clearTimeout(t);
    }
    const show = home && !composing;
    const apply = () => {
      assistDockCover.value = withTiming(show ? 0 : 1, { duration: 160 });
      assistFlown.value = show ? 0 : 1;
    };
    // Nothing grows any more (assistMorph: the list opens like a desk) - the dock is there from the first frame.
    if (dockShownOnce.current || FEATURES.aiHome) {
      dockShownOnce.current = true;
      apply();
      return;
    }
    const t = setTimeout(() => {
      dockShownOnce.current = true;
      apply();
    }, 420);
    return () => clearTimeout(t);
  }, [home, composing, chatFocused]);
  // «+»: the field comes up with the keyboard at once.
  useEffect(() => {
    if (!composing) return;
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [composing]);
  const goHome = () => {
    if (chatRef.current) saveChat(chatRef.current);
    setHome(true);
    setComposing(false);
    setSimilar(null);
  };
  const closeAll = () => closeAssistant(() => navigation.goBack(), S.bg, assistWash(S.dark));
  // The phone's back: out of the field, out of a theme, out of a conversation to the list - then the window itself.
  useEffect(() => {
    if (!FEATURES.aiHome || !chatFocused) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (home && composing) {
        setComposing(false);
        setDraft('');
        return true;
      }
      if (home && level !== null) {
        setLevel(null);
        return true;
      }
      if (!home) {
        goHome();
        return true;
      }
      return false;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home, composing, level, chatFocused]);
  // The list stands under the app's own dock: the desks with «you are here» on the balloon, and «+» for a new conversation.
  useChromeStyle('soft', FEATURES.aiHome && home && chatFocused);
  // The bar's «⋯» on the list.
  useTopExtras(
    FEATURES.aiHome && home && !composing ? ([{ label: 'Нова тема…', icon: 'add-circle-outline', onPress: () => setNewThemeFor('list') }] as MenuEntry[]) : null,
    null,
    FEATURES.aiHome && home && !composing && chatFocused
  );
  useDockDesksHere(FEATURES.aiHome && home && !composing && chatFocused);
  // The lens: the same field - what is typed finds the conversation it looks like, at the top (a search by meaning of words).
  useDockBeads(
    FEATURES.aiHome && home && !composing && chatFocused
      ? { icon: 'search-outline', onPress: () => {
          setDraft('');
          setSimilar(null);
          setComposing(true);
        } }
      : null,
    FEATURES.aiHome && home && !composing && chatFocused
      ? { icon: 'add-outline', badge: 'add-circle-outline', onPress: () => {
          setDraft('');
          setSimilar(null);
          setComposing(true);
        } }
      : null
  );
  // Not while writing: a dimmed «‹» stood at the bar's start over the field.
  useTopBack(closeAll, FEATURES.aiHome && home && !composing && chatFocused);
  // Enter on the list: a new conversation with the message (the motion of the message hides the window's building).
  const sendFromHome = () => {
    if (!draft.trim()) return;
    newConversation();
    // Started inside a theme: the conversation is in it from its first message.
    if (level && level !== NO_THEME && chatRef.current) chatRef.current = { ...chatRef.current, themeId: level };
    setHome(false);
    setComposing(false);
    setSimilar(null);
    // The similar conversation was already looked for here, on the phone: no second (paid) look by the AI.
    if (attached.length === 0) send(draft, undefined, true);
    else sendFromDock();
  };
  const continueThere = async (id: string) => {
    const text = draft;
    await openChat(id);
    setHome(false);
    setComposing(false);
    setSimilar(null);
    send(text, undefined, true);
  };
  useEffect(() => subscribeVoice((s) => !s.playing && setSpeaking(null)), []);
  useEffect(
    () => () => {
      ExpoSpeechRecognitionModule.stop();
      stopVoice().catch(() => {});
    },
    []
  );

  // The draft board the conversation made last (what «Зберегти» and «Матеріали» are about).
  const structure = useMemo(() => [...(chat?.messages ?? [])].reverse().find((m) => m.structure)?.structure ?? null, [chat]);
  const hasStructure = !!structure;
  useEffect(() => {
    if (!chat?.id || !hasStructure) {
      setMaterialsCount(0);
      return;
    }
    return listChatObjects(chat.id, (objects) => setMaterialsCount(objects.filter((o) => !o.partOfBoard).length), () => {});
  }, [chat?.id, hasStructure]);

  const groups = useMemo(() => (chat ? groupsOf(chat) : []), [chat]);
  // Each remembered block -> whether it is the last block of its memory (where «у пам'яті» is written).
  const memo = useMemo(() => {
    const m = new Map<string, { last: boolean }>();
    groups.forEach((g) => g.forEach((k, i) => m.set(k, { last: i === g.length - 1 })));
    return m;
  }, [groups]);
  // Every block's text and the branch its message belongs to, by key, in the order of the conversation.
  const blockInfo = useMemo(() => {
    const out: { key: string; text: string; topic: string }[] = [];
    (chat?.messages ?? []).forEach((m) => {
      if (m.role !== 'model' || m.error) return;
      blocksOf(m.text).forEach((text, i) => out.push({ key: blockKey(m.id, i), text, topic: m.topicId ?? ROOT_TOPIC }));
    });
    return out;
  }, [chat]);
  const textsOf = (keys: string[]) => blockInfo.filter((b) => keys.includes(b.key)).map((b) => b.text);
  const lastCost = [...(chat?.messages ?? [])].reverse().find((m) => m.role === 'model' && m.costUsd !== undefined)?.costUsd;
  const chatCost = (chat?.messages ?? []).reduce((sum, m) => sum + (m.costUsd ?? 0), 0);

  // `branch`: the answer opens a new branch under `parent` (null = the main topic) with this title.
  async function send(
    text: string,
    branch?: { title: string; parent: string },
    skipRoute?: boolean,
    withAttached?: { parts: GeminiPart[]; meta: NonNullable<AssistantMessage['attachments']> }
  ) {
    const base = chatRef.current;
    const clean = text.trim() || (withAttached ? 'Подивись вкладене.' : '');
    if (!clean || !base || busy) return;
    // The FIRST message of a conversation is checked against the others: if it looks like a continuation of one, the person
    // is offered to go there (nothing is sent until they choose). Any doubt, no key or no network sends it as usual.
    if (!branch && !skipRoute && base.messages.length === 0) {
      setBusy(true);
      try {
        const others = (await listChats()).filter((c) => c.id !== base.id);
        const routed = await routeFirstMessage(clean, others);
        if (routed.chatId) {
          const target = others.find((c) => c.id === routed.chatId);
          setRouteOffer({ text: clean, chatId: routed.chatId, title: target?.title ?? 'Розмова' });
          setDraft('');
          setBusy(false);
          return;
        }
      } catch {
        // Routing is a courtesy: never a reason not to answer.
      }
      setBusy(false);
    }
    setPicked([]);
    let here = topic;
    let withTopics = base;
    if (branch) {
      here = `t${Date.now()}`;
      withTopics = { ...base, topics: [...(base.topics ?? []), { id: here, parentId: branch.parent, title: branch.title }] };
      setTopic(here);
    }
    const mine: AssistantMessage = {
      id: `m${Date.now()}`,
      role: 'user',
      text: clean,
      at: Date.now(),
      ...(here !== ROOT_TOPIC ? { topicId: here } : {}),
      ...(withAttached && withAttached.meta.length ? { attachments: withAttached.meta } : {}),
    };
    const withMine = { ...withTopics, messages: [...withTopics.messages, mine] };
    update(withMine);
    setDraft('');
    setBusy(true);
    try {
      // A conversation that already has a scheme shows it to the AI, so a request to add to it is an UPDATE of that board.
      const known = [...withMine.messages].reverse().find((m) => m.structure)?.structure;
      let outlineNow: string | undefined;
      if (known) outlineNow = await currentOutline(known.boardId).catch(() => undefined);
      const { text: raw, costUsd } = await askAssistant(withMine, here, outlineNow, withAttached?.parts);
      // A topic laid out: the scheme in the answer becomes a draft board that lives in this conversation.
      let { text: answer, outline } = splitStructure(raw);
      let structure: AssistantStructure | undefined;
      if (outline) {
        try {
          const nodes = nodesFromOutline(outline);
          if (nodes.length >= 2 && known && outlineNow) {
            // An update: merged into the board the conversation already has.
            const merged = await mergeStructure(withMine.id, known.boardId, nodes);
            structure = { ...known, cards: known.cards + merged.added };
            answer = `${answer}\n\n${merged.summary}`.trim();
            setBoardTick((n) => n + 1);
            setTimeout(() => setFitTick((n) => n + 1), 500);
          } else if (nodes.length >= 2) {
            const made = await createChatBoard(withMine.id, nodes);
            structure = { boardId: made.boardId, title: made.title, cards: nodes.length };
          } else answer = `${answer}\n\n${outline}`.trim();
        } catch (e) {
          answer = `${answer}\n\nНе вдалося створити дошку: ${(e as Error).message}`.trim();
        }
      }
      const answered = {
        ...withMine,
        messages: [
          ...withMine.messages,
          {
            id: `a${Date.now()}`,
            role: 'model' as const,
            text: answer || (structure ? `Розклав на ${structure.cards} карток.` : raw),
            at: Date.now(),
            costUsd,
            ...(structure ? { structure } : {}),
            ...(here !== ROOT_TOPIC ? { topicId: here } : {}),
          },
        ],
      };
      update(answered);
      // The older part is folded into the summary now and then, off to the side of the answer.
      foldOlder(answered)
        .then((folded) => {
          if (folded && chatRef.current?.id === answered.id) update({ ...chatRef.current, ...folded });
        })
        .catch(() => {});
    } catch (e) {
      update({ ...withMine, messages: [...withMine.messages, { id: `e${Date.now()}`, role: 'model', text: (e as Error).message, at: Date.now(), error: true, ...(here !== ROOT_TOPIC ? { topicId: here } : {}) }] });
    } finally {
      setBusy(false);
    }
  }

  function hold(key: string) {
    hapticPickUp();
    setPicked((p) => (p.includes(key) ? p : [...p, key]));
  }
  function tap(key: string) {
    if (picked.length === 0) return;
    setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));
  }

  // All picked already remembered: forget them. Otherwise they become ONE memory, taken out of any they were in.
  const allRemembered = picked.length > 0 && picked.every((k) => memo.has(k));
  function rememberPicked() {
    if (!chat || picked.length === 0) return;
    const ordered = blockInfo.map((b) => b.key).filter((k) => picked.includes(k));
    const rest = groupsOf(chat)
      .map((g) => g.filter((k) => !picked.includes(k)))
      .filter((g) => g.length > 0);
    const next = allRemembered ? rest : [...rest, ordered];
    update({ ...chat, groups: next, remembered: next.flat() });
    setPicked([]);
  }
  // «Детальніше» opens a branch under the branch the first picked block was said in.
  function moreAboutPicked() {
    const texts = textsOf(picked);
    if (texts.length === 0) return;
    const first = blockInfo.find((b) => b.key === picked[0]);
    const title = shortTitle(plainOf(texts[0])) || 'Гілка';
    send(
      texts.length === 1 ? `Розкажи детальніше про це: «${plainOf(texts[0])}»` : `Розкажи детальніше про це:\n${texts.map((t) => `«${plainOf(t)}»`).join('\n')}`,
      { title, parent: first?.topic ?? ROOT_TOPIC }
    );
  }
  function copyPicked() {
    Clipboard.setStringAsync(textsOf(picked).join('\n\n')).catch(() => {});
    setPicked([]);
  }

  const memories = useMemo(() => (chat ? memoryTexts(chat) : []), [chat]);
  const notedSet = useMemo(() => new Set((chat?.noted ?? []).map((t) => t.trim())), [chat]);
  const freshCount = memories.filter((p) => !notedSet.has(p.trim())).length;

  // THE TREE OF NOTES (utils/assistantTree): the main topic's note, a nested note for every branch that holds a memory, a
  // board that shows them. Only what is new is written. A conversation from before notes were bound finds its note by title.
  async function toNote() {
    const base = chatRef.current;
    if (!base || memories.length === 0) return;
    try {
      let current = base;
      if (!current.noteId) {
        const title = titleOf(current);
        const firstAsk = current.messages.find((m) => m.role === 'user')?.text ?? 'Розмова';
        const oldTitle = firstAsk.length > 60 ? `${firstAsk.slice(0, 57).trim()}…` : firstAsk;
        const same = await getDocs(ownedQuery('documents', where('title', 'in', Array.from(new Set([title, oldTitle])))));
        const newest = same.docs
          .map((d) => ({ id: d.id, data: d.data() as { deletedAt?: number; updatedAt?: number } }))
          .filter((d) => !d.data.deletedAt)
          .sort((x, y) => (y.data.updatedAt ?? 0) - (x.data.updatedAt ?? 0))[0];
        if (newest) current = { ...current, noteId: newest.id };
      }
      // One ordinary note with a heading per branch, or (FEATURES.assistantTree) the tree of nested notes and its board.
      const result = FEATURES.assistantTree ? await writeMemoryTree(current) : await writeMemoryNote(current);
      const { rootNoteId, ...kept } = result as { rootNoteId: string; created?: number } & Partial<typeof current>;
      delete (kept as { created?: number }).created;
      update({ ...(chatRef.current ?? current), ...kept });
      navigation.navigate('Editor', { documentId: rootNoteId });
    } catch (e) {
      notify('Не вдалося записати в нотатку', (e as Error).message);
    }
  }

  // «Поглибити» / «Розгалузити» on the picked cards of the open board: one request each, the result written into the board,
  // the exchange kept in the conversation (so it counts in the cost and the AI remembers it), the change undoable.
  async function runBoardOp(kind: 'deepen' | 'branch', ids: string[], clear: () => void) {
    const base = chatRef.current;
    if (!base || !boardOpen || opBusy || ids.length === 0) return;
    setOpBusy(true);
    clear();
    const label = kind === 'deepen' ? 'Поглибити' : 'Розгалузити';
    const asked: AssistantMessage = { id: `m${Date.now()}`, role: 'user', text: ids.length > 1 ? `${label} (${ids.length} картки)` : label, at: Date.now() };
    const undos: (() => Promise<void>)[] = [];
    const lines: string[] = [];
    let cost = 0;
    try {
      for (const id of ids) {
        const r = kind === 'deepen' ? await deepenCard(boardOpen.boardId, id) : await branchCard(base.id, boardOpen.boardId, id);
        undos.push(r.undo);
        lines.push(r.summary);
        cost += r.costUsd;
      }
    } catch (e) {
      lines.push((e as Error).message);
      if (undos.length === 0) {
        const current = chatRef.current ?? base;
        update({ ...current, messages: [...current.messages, asked, { id: `e${Date.now()}`, role: 'model', text: lines.join(' '), at: Date.now(), error: true }] });
        setOpBusy(false);
        return;
      }
    }
    const current = chatRef.current ?? base;
    update({ ...current, messages: [...current.messages, asked, { id: `a${Date.now()}`, role: 'model', text: lines.join('\n\n'), at: Date.now(), costUsd: cost }] });
    setBoardTick((n) => n + 1);
    if (kind === 'branch') setTimeout(() => setFitTick((n) => n + 1), 500);
    setLastOp({
      summary: lines[0] ?? '',
      undo: async () => {
        for (const u of [...undos].reverse()) await u();
      },
    });
    setOpBusy(false);
  }
  async function undoLastOp() {
    const op = lastOp;
    if (!op) return;
    setLastOp(null);
    try {
      await op.undo();
      setBoardTick((n) => n + 1);
      setTimeout(() => setFitTick((n) => n + 1), 500);
    } catch (e) {
      notify('Не вдалося скасувати', (e as Error).message);
    }
  }

  // THE LIST OF CONVERSATIONS and what is done to its rows (sketches 8-12).
  async function refreshChats() {
    try {
      const list = await listChats();
      lastChats = list;
      setChatList(list);
    } catch {
      // The list stays as it was.
    }
  }
  function openChatsSheet() {
    refreshChats();
    setChatsOpen(true);
  }
  function newConversation(keepOld = true) {
    const old = chatRef.current;
    if (old && keepOld) saveChat(old);
    const fresh = newChat();
    chatRef.current = fresh;
    setChat(fresh);
    saveChat(fresh);
    setTopic(ROOT_TOPIC);
    setPicked([]);
    setBoardOpen(null);
    setRouteOffer(null);
    setLastOp(null);
  }
  async function openChat(id: string) {
    const loaded = await loadChatById(id);
    if (!loaded) return;
    if (chatRef.current) saveChat(chatRef.current);
    chatRef.current = loaded;
    setChat(loaded);
    saveChat(loaded);
    setTopic(ROOT_TOPIC);
    setPicked([]);
    setBoardOpen(null);
    setRouteOffer(null);
    setLastOp(null);
    setChatsOpen(false);
  }
  // A folder, an instruction or a new name for ANY conversation: the open one goes through update(), another only to the database.
  async function setChatFields(chatId: string, fields: { instruction?: string; folderId?: string; customTitle?: string; themeId?: string }) {
    const open = chatRef.current;
    if (open && open.id === chatId) {
      const merged: AssistantChat = { ...open };
      (Object.keys(fields) as (keyof typeof fields)[]).forEach((k) => {
        if (fields[k] === undefined || fields[k] === '') delete merged[k];
        else merged[k] = fields[k] as string;
      });
      update(merged);
    } else {
      try {
        await updateChatFields(chatId, fields);
      } catch (e) {
        notify('Не вдалося зберегти', (e as Error).message);
      }
    }
    refreshChats();
  }
  async function removeChat(chatId: string) {
    try {
      await deleteChat(chatId);
    } catch (e) {
      notify('Не вдалося видалити розмову', (e as Error).message);
      return;
    }
    if (chatRef.current?.id === chatId) newConversation(false);
    refreshChats();
  }
  const fieldOf = (chatId: string, key: 'instruction' | 'folderId') =>
    chatRef.current?.id === chatId ? chatRef.current?.[key] : chatList.find((c) => c.id === chatId)?.[key];

  // «Зберегти»: the draft board stops belonging to the conversation and is an ordinary board, in the conversation's folder if it
  // has one, else in the folder chosen now, else in «Без проєкту».
  async function saveStructureTo(folder: FolderOption | null) {
    const s = structure;
    if (!s) return;
    try {
      await promoteChatObject('board', s.boardId, {
        attachTo: folder
          ? async (id) => {
              const tag = tags.find((t) => t.id === folder.id);
              if (tag) await attachTag(tag, 'board', id, 'boards');
              else await createAndAttachTag(folder.path, 'folder-outline', S.accent, 'board', id, 'boards');
            }
          : undefined,
      });
      setBoardOpen(null);
      setMaterialsOpen(false);
      notify('Збережено', folder ? `Дошка «${s.title}» тепер у папці «${folder.name}».` : `Дошка «${s.title}» тепер у «Без проєкту».`);
    } catch (e) {
      notify('Не вдалося зберегти', (e as Error).message);
    }
  }
  function saveStructureFlow() {
    const c = chatRef.current;
    if (!structure || !c) return;
    const folder = folderOfPointer(folders, c.folderId);
    if (folder) saveStructureTo(folder);
    else setFolderFor({ chatId: c.id, purpose: 'save' });
  }

  async function showMemory() {
    const c = chatRef.current;
    if (!c) return;
    const parts = [
      c.summary ? `Стисло про попередню частину розмови:\n${c.summary}` : 'Розмова ще коротка: я бачу її всю, стисле зведення поки не потрібне.',
      memories.length ? `\nВи відібрали як важливе: ${memories.length}. Я тримаюсь цього.` : '',
    ];
    notify('Що я пам\'ятаю', parts.join('\n'));
  }

  // THE CONVERSATION'S «⋯»: the same drop-down the explorer and the start desk open under their «⋯» (sections, ticks, a red
  // delete), not a sheet in the middle of the screen (the user, 2026-10-24: «краще як в провіднику»).
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = () => setMenuOpen(true);
  // ATTACHMENTS: what each one weighs is asked of Gemini as soon as it is added (the count is free), so the dock shows the
  // price before anything is sent and the check at «надіслати» needs no second read.
  const kindForRow = (k: ChatAttachment['kind']): CostRow['kind'] => (k === 'photo' ? 'photo' : k === 'note' ? 'note' : k === 'folder' ? 'folder' : 'file');
  const weighed = useRef(new Map<string, { parts: GeminiPart[]; tokens: number; notes: string[] }>());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const a of attached) {
        if (weighed.current.has(a.id)) continue;
        try {
          const { parts, notes } = await attachmentParts([a]);
          const tokens = await countTokens(parts, '');
          weighed.current.set(a.id, { parts, tokens, notes });
        } catch (e) {
          weighed.current.set(a.id, { parts: [], tokens: 0, notes: [(e as Error).message] });
        }
        if (cancelled) return;
      }
      if (cancelled) return;
      if (attached.length === 0) {
        setEstimate(null);
        return;
      }
      const rows: CostRow[] = attached.map((a) => ({ kind: kindForRow(a.kind), label: `${a.name}${a.sub ? ` · ${a.sub}` : ''}`, tokens: weighed.current.get(a.id)?.tokens ?? 0 }));
      const tokens = rows.reduce((n, r) => n + r.tokens, 0);
      setEstimate({ tokens, usd: priceOfTokens(tokens), rows });
    })();
    return () => {
      cancelled = true;
    };
  }, [attached]);
  async function addAttachments(pick: () => Promise<ChatAttachment[]>) {
    setAttachOpen(false);
    try {
      const got = await pick();
      if (got.length) setAttached((list) => [...list, ...got]);
    } catch (e) {
      notify('Не вдалося додати', (e as Error).message);
    }
  }
  // The links base, read once when asked for (a listener kept open for a sheet opened now and then would be for nothing).
  async function openLinkChoices() {
    try {
      const snap = await getDocs(ownedQuery('links'));
      const rows = snap.docs
        .map((d: { id: string; data: () => Record<string, unknown> }) => ({ id: d.id, data: d.data() }))
        .filter((r: { data: Record<string, unknown> }) => !r.data.deletedAt && typeof r.data.url === 'string')
        .sort((x: { data: Record<string, unknown> }, y: { data: Record<string, unknown> }) => ((y.data.updatedAt as number) ?? 0) - ((x.data.updatedAt as number) ?? 0))
        .map((r: { id: string; data: Record<string, unknown> }) => ({
          id: r.id,
          url: r.data.url as string,
          title: ((r.data.title as string) || (r.data.siteName as string) || (r.data.url as string)).trim(),
          siteName: r.data.siteName as string | undefined,
        }));
      setLinkChoices(rows);
    } catch (e) {
      notify('Не вдалося відкрити посилання', (e as Error).message);
    }
  }
  function sendFromDock() {
    if (listening) stopListening();
    const text = draft;
    if (attached.length === 0) {
      send(text);
      return;
    }
    const list = attached;
    const ready = list.every((a) => weighed.current.has(a.id));
    if (!ready) {
      notify('Ще рахую', 'Вкладене ще читається - за мить можна надсилати.');
      return;
    }
    const parts = list.flatMap((a) => weighed.current.get(a.id)?.parts ?? []);
    const unread = list.flatMap((a) => weighed.current.get(a.id)?.notes ?? []);
    const meta = list.map((a) => ({ kind: a.kind, name: a.name, sub: a.sub, ...(a.uri && a.kind === 'photo' ? { uri: a.uri } : {}), ...(a.url ? { url: a.url } : {}) }));
    const go = () => {
      setWarning(null);
      setAttached([]);
      setEstimate(null);
      weighed.current.clear();
      if (unread.length) notify('Не все прочитано', unread.join('\n'));
      send(text, undefined, true, { parts, meta });
    };
    const cost = estimate?.usd ?? 0;
    if (threshold !== null && cost > threshold) {
      setWarning({ cost, rows: estimate?.rows ?? [], go });
      return;
    }
    go();
  }
  // The hints under «?»: each one a request about the last answer, sent at once.
  const HINT_ASK: Partial<Record<HintKind, string>> = {
    table: 'Покажи цю відповідь таблицею.',
    board: 'Розклади цю відповідь дошкою.',
    short: 'Скажи те саме коротше.',
    plan: 'Зроби з цього план дій.',
    more: 'Розкажи про це детальніше.',
    simple: 'Поясни це простіше.',
  };
  const STARTER_TEXT: Partial<Record<HintKind, string>> = {
    board: 'Розклади тему: ',
    research: 'Досліди тему: ',
    sum: 'Підсумуй: ',
    adapt: 'Адаптуй цю думку під читача: ',
  };
  useEffect(() => {
    const t = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [hintsOpen]);

  function menuEntries(): MenuEntry[] {
    const c = chatRef.current;
    const folder = folderOfPointer(folders, c?.folderId);
    const run = (f: () => void) => () => {
      setMenuOpen(false);
      f();
    };
    return [
      { label: 'Нова розмова', icon: 'add', onPress: run(() => newConversation()) },
      { label: 'Розмови', icon: 'chatbubble-outline', onPress: run(openChatsSheet) },
      { kind: 'section', label: 'Ця розмова' },
      { label: 'Інструкція', icon: 'book-outline', checked: !!c?.instruction, onPress: run(() => c && setInstructionFor(c.id)) },
      ...(FEATURES.aiHome && c && c.messages.length > 0
        ? [{ label: c.themeId ? `Тема: ${themes.find((t) => t.id === c.themeId)?.name ?? '—'}` : 'Тема…', icon: 'pricetag-outline', onPress: run(() => setThemeAsk(true)) } as MenuEntry]
        : []),
      { label: folder ? `Папка: ${folder.name}` : 'Папка', icon: 'folder-outline', checked: !!folder, onPress: run(() => c && setFolderFor({ chatId: c.id, purpose: 'chat' })) },
      { label: "Що ти пам'ятаєш?", icon: 'bulb-outline', onPress: run(showMemory) },
      ...(count > 0 ? [{ label: freshCount > 0 ? `Відібране в нотатку (${freshCount})` : 'Відкрити нотатку', icon: 'document-text-outline' as const, onPress: run(toNote) }] : []),
      { label: threshold === null ? 'Поріг ціни: не питати' : `Поріг ціни: $${money(threshold, 2)}`, icon: 'pricetag-outline', onPress: run(() => setThresholdOpen(true)) },
      ...(FEATURES.assistantTree && c?.boardId ? [{ label: 'Дерево на дошці', icon: 'git-network-outline' as const, onPress: run(() => navigation.navigate('BoardCopy', { boardId: c.boardId })) }] : []),
      { kind: 'section', label: 'Поки ШІ думає' },
      { label: 'Кульки', icon: 'ellipse-outline', checked: thinkingVariant === 'balloons', onPress: run(() => setThinkingVariant('balloons')) },
      { label: 'Нічого', icon: 'remove-outline', checked: thinkingVariant === 'off', onPress: run(() => setThinkingVariant('off')) },
      ...(c && c.messages.length > 0
        ? [
            { kind: 'rule' as const },
            {
              label: 'Видалити розмову',
              icon: 'trash-outline' as const,
              tone: 'danger' as const,
              onPress: run(async () => {
                const sure = await ask({ title: 'Видалити розмову?', actions: [{ id: 'yes', label: 'Видалити разом з її дошкою й нотатками', icon: 'trash-outline' as const }] });
                if (sure === 'yes') removeChat(c.id);
              }),
            },
          ]
        : []),
    ];
  }

  async function openHistory() {
    try {
      const list = (await listChats()).filter((c) => c.id !== chatRef.current?.id).slice(0, 30);
      if (list.length === 0) {
        notify('Попередніх розмов ще немає', "Нова розмова не стирає стару: вона з'явиться тут.");
        return;
      }
      const id = await ask({
        title: 'Попередні розмови',
        actions: list.map((c) => ({
          id: c.id,
          label: `${c.title} · ${new Date(c.updatedAt).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })}`,
          icon: 'chatbubble-outline' as const,
        })),
      });
      if (!id || id === 'cancel') return;
      const loaded = await loadChatById(id);
      if (!loaded) return;
      if (chatRef.current) saveChat(chatRef.current);
      chatRef.current = loaded;
      setChat(loaded);
      saveChat(loaded);
      setTopic(ROOT_TOPIC);
      setPicked([]);
    } catch (e) {
      notify('Не вдалося відкрити історію', (e as Error).message);
    }
  }

  // DICTATION - the same way as «Думки» (ThoughtCapture): Ukrainian, continuous, the words appearing as they are said.
  const stopListening = useCallback(() => {
    ExpoSpeechRecognitionModule.stop();
    setListening(false);
  }, []);
  const startListening = useCallback(async () => {
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      notify('Голосове введення недоступне', 'На цьому пристрої немає розпізнавання мови.');
      return;
    }
    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) return;
    committed.current = draft;
    ExpoSpeechRecognitionModule.start({ lang: 'uk-UA', interimResults: true, continuous: true, addsPunctuation: true });
    setListening(true);
  }, [draft]);
  useSpeechRecognitionEvent('result', (event) => {
    const heard = event.results?.[0]?.transcript ?? '';
    const before = committed.current;
    setDraft(before ? `${before} ${heard}`.replace(/\s+/g, ' ') : heard);
    if (event.isFinal) committed.current = before ? `${before} ${heard}`.replace(/\s+/g, ' ') : heard;
  });
  useSpeechRecognitionEvent('end', () => setListening(false));

  // «Послухати»: the same voicing as «Думки» (model, voice, kept file) - made only when asked.
  function listen(message: AssistantMessage) {
    if (speaking === message.id) {
      stopVoice().catch(() => {});
      setSpeaking(null);
      return;
    }
    setSpeaking(message.id);
    speakThoughts([{ title: '', text: plainOf(message.text), thoughtId: message.id }])
      .catch(() => {})
      .finally(() => setSpeaking((s) => (s === message.id ? null : s)));
  }

  const messages = chat?.messages ?? [];
  const count = memories.length;
  const styles = useMemo(() => makeStyles(S), [S]);
  const picking = picked.length > 0;
  const path = chat ? topicPath(chat, topic) : [];
  const parentTopic = path.length > 1 ? path[path.length - 2].id : path.length === 1 ? ROOT_TOPIC : null;

  function renderBlock(b: string) {
    const lines = b.split('\n');
    return (
      <View style={{ gap: 3 }}>
        {lines.map((line, i) => {
          const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
          const number = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
          const body = bullet ? bullet[1] : number ? number[2] : line;
          return (
            <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
              {bullet ? <Text style={styles.blockText}>•</Text> : number ? <Text style={styles.blockText}>{`${number[1]}.`}</Text> : null}
              <Text style={[styles.blockText, { flex: 1 }]}>
                <FormattedText segments={parseFormattedText(body)} defaultColor={S.ink} />
              </Text>
            </View>
          );
        })}
      </View>
    );
  }

  let shownTopic: string | undefined;
  const firstMineId = messages.find((m) => m.role === 'user')?.id;
  // By topic: each topic's messages in the order «Впорядкувати» laid them out, then «Нове» - what came after it, by time.
  const sortedSet = new Set(chat?.sortedIds ?? []);
  const sortedOn = FEATURES.aiChatOutline && byTopic && !!chat?.sections?.length;
  const byIdMsg = new Map(messages.map((m) => [m.id, m]));
  const topicGroups = chat?.sections?.length
    ? [
        ...chat.sections.map((sec) => ({
          key: sec.id,
          title: sec.title,
          section: sec as ChatSection | null,
          items: (chat.sortedIds ?? []).map((id) => byIdMsg.get(id)).filter((m): m is AssistantMessage => !!m && m.sectionId === sec.id),
        })),
        { key: 'new', title: 'Нове', section: null, items: messages.filter((m) => !sortedSet.has(m.id)) },
      ].filter((g) => g.items.length > 0)
    : [];
  const pairCount = (items: AssistantMessage[]) => items.filter((m) => m.role === 'user').length || 1;
  const showByTopic = (on: boolean) => {
    if (!chat) return;
    if (on) byTopicChats.add(chat.id);
    else byTopicChats.delete(chat.id);
    setByTopic(on);
  };
  const goToSection = (key: string) => {
    setOutlineOpen(false);
    if (!sortedOn) {
      jumpTo.current = key;
      showByTopic(true);
      return;
    }
    const y = sectionY.current[key];
    if (y !== undefined) scroll.current?.scrollTo({ y: Math.max(0, y - topH - 8), animated: true });
  };
  async function sortNow() {
    const before = chatRef.current;
    if (!before || sortBusy) return;
    setSortBusy(true);
    try {
      const plan = await sortPlan(before);
      const pairs = pairsOf(before);
      const lines = plan.sections
        .map((sec, i) => ({ title: sec.title, n: plan.pairSection.filter((x) => x === i).length }))
        .filter((x) => x.n > 0)
        .map((x) => `${x.title} · ${x.n}`);
      setOutlineOpen(false);
      const go = await ask({
        title: 'Впорядкувати розмову?',
        message: `${pairsWord(pairs.length)} питання-відповідь:\n${lines.join('\n')}\n\nСправжній порядок збережеться - «За часом» поверне його.`,
        actions: [{ id: 'yes', label: 'Впорядкувати', icon: 'list-outline' as const }],
      });
      if (go !== 'yes' || !chatRef.current || chatRef.current.id !== before.id) return;
      update(applySort(chatRef.current, before, plan));
      showByTopic(true);
    } catch (e) {
      notify('Не вдалося впорядкувати', (e as Error).message);
    } finally {
      setSortBusy(false);
    }
  }
  const renderMessage = (m: AssistantMessage, sorted: boolean) => {
          const t = m.topicId ?? ROOT_TOPIC;
          const marker =
            !sorted && t !== (shownTopic ?? ROOT_TOPIC) && chat ? (
              <Pressable key={`${m.id}-branch`} onPress={() => setTopic(t)} style={styles.branchMark}>
                <Text style={styles.branchMarkText} numberOfLines={1}>
                  {t === ROOT_TOPIC ? 'Головна тема' : topicPath(chat, t).map((x) => x.title).join(' › ')}
                </Text>
              </Pressable>
            ) : null;
          shownTopic = t;
          return (
            <View key={m.id} style={{ gap: 14 }}>
              {marker}
              {sorted && m.role === 'user' ? <Text style={styles.pairDate}>{new Date(m.at).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text> : null}
              {m.role === 'user' ? (
                <View style={{ gap: 6 }}>
                  {m.attachments?.length ? (
                    <MessageAttachments items={m.attachments.map((a) => ({ kind: a.kind === 'photo' ? 'photo' : a.kind === 'note' ? 'note' : a.kind === 'folder' ? 'folder' : a.kind === 'link' ? 'link' : 'file', name: a.name, sub: a.sub, uri: a.uri }))} />
                  ) : null}
                  <View style={styles.mine}>
                    <Text style={styles.mineText}>{m.text}</Text>
                  </View>
                  {FEATURES.aiHome && chat && m.id === firstMineId && ((!chat.themeId && themeSkip !== chat.id && messages.filter((x) => x.role === 'user').length <= 1) || themeAsk) ? (
                    <ThemeChips
                      likely={likelyThemes(m.text, chatList.filter((c) => c.id !== chat.id), themes)}
                      themes={themes}
                      onPick={(id) => {
                        setThemeAsk(false);
                        setChatFields(chat.id, { themeId: id });
                      }}
                      onNew={() => {
                        setThemeAsk(false);
                        setNewThemeFor('chat');
                      }}
                      onSkip={() => {
                        setThemeAsk(false);
                        setThemeSkip(chat.id);
                        if (chat.themeId) setChatFields(chat.id, { themeId: undefined });
                      }}
                    />
                  ) : null}
                </View>
              ) : m.error ? (
                <Text style={styles.error}>{m.text}</Text>
              ) : (
                <View style={styles.answer}>
                  {blocksOf(m.text).map((b, i) => {
                    const key = blockKey(m.id, i);
                    const mem = memo.get(key);
                    const on = picked.includes(key);
                    return (
                      <Pressable
                        key={key}
                        onLongPress={() => hold(key)}
                        onPress={() => tap(key)}
                        delayLongPress={350}
                        style={[styles.block, mem && styles.blockMem, on && styles.blockPicked]}
                      >
                        {renderBlock(b)}
                        {mem?.last ? <Text style={styles.memo}>у пам'яті</Text> : null}
                        {on ? (
                          <View style={styles.tick}>
                            <Ionicons name="checkmark" size={12} color={S.card} />
                          </View>
                        ) : null}
                      </Pressable>
                    );
                  })}
                  {m.structure ? (
                    <Pressable onPress={() => setBoardOpen(m.structure!)} style={styles.structCard} accessibilityLabel="Відкрити дошку">
                      <View style={styles.structIcon}>
                        <Ionicons name="grid-outline" size={26} color={S.accent} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                        <Text style={styles.structTitle} numberOfLines={1}>
                          {m.structure.title}
                        </Text>
                        <StructCount boardId={m.structure.boardId} fallback={m.structure.cards} style={styles.structSub} />
                      </View>
                      <View style={styles.structOpen}>
                        <Text style={styles.structOpenText}>Відкрити</Text>
                      </View>
                    </Pressable>
                  ) : null}
                  <Pressable onPress={() => listen(m)} style={styles.listen} hitSlop={8} accessibilityLabel="Послухати відповідь">
                    <Ionicons name={speaking === m.id ? 'stop-circle-outline' : 'volume-high-outline'} size={16} color={S.ink3} />
                    <Text style={styles.listenText}>{speaking === m.id ? 'Зупинити' : 'Послухати'}</Text>
                  </Pressable>
                </View>
              )}
            </View>
          );
  };
  // A topic of the conversation renamed by holding it (features.aiChatOutline) - shown in the conversation, not the list.
  const sectionPrompt = (
    <RenamePrompt
      visible={renameSection !== null}
      title="Назва теми розмови"
      initialValue={renameSection?.title ?? ''}
      onCancel={() => setRenameSection(null)}
      onSave={(name) => {
        const sec = renameSection;
        setRenameSection(null);
        const c = chatRef.current;
        if (!sec || !c || !name.trim()) return;
        update({ ...c, sections: (c.sections ?? []).map((x) => (x.id === sec.id ? { ...x, title: name.trim() } : x)) });
      }}
    />
  );
  const themePrompt = (
    <RenamePrompt
      visible={newThemeFor !== null}
      title="Нова тема"
      initialValue=""
      placeholder="Назва теми"
      onCancel={() => setNewThemeFor(null)}
      onSave={async (name) => {
        const forChat = newThemeFor === 'chat';
        setNewThemeFor(null);
        if (!name.trim()) return;
        try {
          const t = await createTheme(name, themes);
          if (forChat && chatRef.current) setChatFields(chatRef.current.id, { themeId: t.id });
        } catch (e) {
          notify('Не вдалося створити тему', (e as Error).message);
        }
      }}
    />
  );
  const renamePrompt = (
    <RenamePrompt
      visible={renameTheme !== null}
      title="Назва теми"
      initialValue={renameTheme?.name ?? ''}
      onCancel={() => setRenameTheme(null)}
      onSave={async (name) => {
        const t = renameTheme;
        setRenameTheme(null);
        if (!t || !name.trim()) return;
        try {
          await renameThemeTo(t.id, name);
        } catch (e) {
          notify('Не вдалося перейменувати', (e as Error).message);
        }
      }}
    />
  );
  if (FEATURES.aiHome && home) {
    return (
      <View style={styles.screen}>
        <AssistantHome
          chats={chatList}
          themes={themes}
          level={level}
          onLevel={setLevel}
          onOpenChat={async (id) => {
            await openChat(id);
            setHome(false);
          }}
          composing={composing}
          similar={similar}
          onContinue={continueThere}
          focused={chatFocused}
          onHoldChat={async (c) => {
            const choice = await holdAsk({
              title: c.title,
              actions: [
                { id: 'theme', label: 'Тема…', icon: 'pricetag-outline' },
                { id: 'rename', label: 'Перейменувати', icon: 'pencil-outline' },
                { id: 'delete', label: 'Видалити розмову', icon: 'trash-outline', tone: 'danger' },
              ],
            });
            if (choice === 'theme') {
              const pick = await ask({
                title: 'Тема розмови',
                actions: [
                  ...themes.map((t) => ({ id: t.id, label: t.name, icon: 'pricetag-outline' as const })),
                  { id: NO_THEME, label: 'Без теми', icon: 'remove-circle-outline' as const },
                ],
              });
              if (pick === NO_THEME) setChatFields(c.id, { themeId: undefined });
              else if (themes.some((t) => t.id === pick)) setChatFields(c.id, { themeId: pick });
            } else if (choice === 'rename') setRenameChat(c);
            else if (choice === 'delete') {
              const sure = await ask({
                title: 'Видалити розмову?',
                message: c.title,
                actions: [{ id: 'yes', label: 'Видалити', icon: 'trash-outline', tone: 'danger' }],
              });
              if (sure === 'yes') removeChat(c.id);
            }
          }}
          onHoldTheme={async (t) => {
            const choice = await holdAsk({
              title: t.name,
              actions: [
                { id: 'rename', label: 'Перейменувати', icon: 'pencil-outline' },
                { id: 'delete', label: 'Видалити тему', icon: 'trash-outline', tone: 'danger' },
              ],
            });
            if (choice === 'rename') setRenameTheme(t);
            else if (choice === 'delete') {
              try {
                await deleteTheme(t.id, chatList);
                refreshChats();
              } catch (e) {
                notify('Не вдалося видалити тему', (e as Error).message);
              }
            }
          }}
        />
        {composing && chatFocused ? (
          <GlassPortal name="chatComposer">
            <ChatComposer
              value={draft}
              onChangeText={setDraft}
              onSend={sendFromHome}
              sending={busy}
              listening={listening}
              onMic={listening ? stopListening : startListening}
              onPlus={() => setAttachOpen(true)}
              hintsOpen={false}
              onHints={() => {}}
              attachments={attached.map((a) => ({ id: a.id, kind: a.kind === 'photo' ? 'photo' : a.kind === 'note' ? 'note' : a.kind === 'folder' ? 'folder' : a.kind === 'link' ? 'link' : 'file', name: a.name, sub: a.sub, uri: a.uri }))}
              onRemoveAttachment={(id) => {
                weighed.current.delete(id);
                setAttached((list) => list.filter((a) => a.id !== id));
              }}
              estimate={null}
              placeholder="Запитай або скажи…"
              keyboardHeight={keyboard}
              bottomInset={insets.bottom}
              inputRef={inputRef}
              onHeight={setDockH}
            />
          </GlassPortal>
        ) : null}
        {themePrompt}
        {renamePrompt}
        <RenamePrompt
          visible={renameChat !== null}
          title="Назва розмови"
          initialValue={renameChat?.title ?? ''}
          onCancel={() => setRenameChat(null)}
          onSave={(name) => {
            const c = renameChat;
            setRenameChat(null);
            if (c && name.trim()) setChatFields(c.id, { customTitle: name.trim() });
          }}
        />
      </View>
    );
  }
  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* THE CONVERSATION RUNS UNDER GLASS (2026-10-25, the user's «робимо»): the list is the blur's own target, under the
          status bar no more; the top capsule (⋯, the name, ×) and the composer float over it (see after the list). */}
      <View style={[StyleSheet.absoluteFill, { top: insets.top }]}>
      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={[styles.list, { paddingTop: topH + 8, paddingBottom: (picking ? 24 : (keyboard > 0 ? keyboard + 8 : insets.bottom + 14) + dockH + 18 + (hintsOpen ? HINTS_STRIP_H : 0)) }]}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => {
          if (!picking) scroll.current?.scrollToEnd({ animated: true });
        }}
      >
        {messages.length === 0 && !busy && !routeOffer ? (
          <View style={styles.emptyBox}>
            <View style={styles.emptyBall}>
              <BalloonMark size={38} color={S.accent} />
            </View>
            <Text style={styles.emptyTitle}>Про що поговоримо?</Text>
            <View style={{ alignSelf: 'stretch', marginTop: 12 }}>
              <ChatStarterTiles
                onPick={(k) => {
                  setDraft(STARTER_TEXT[k] ?? '');
                  inputRef.current?.focus();
                }}
              />
            </View>
          </View>
        ) : null}
        {sortedOn
          ? topicGroups.map((g) => (
              <View
                key={`sec-${g.key}`}
                style={{ gap: 14 }}
                onLayout={(e) => {
                  sectionY.current[g.key] = e.nativeEvent.layout.y;
                  if (jumpTo.current === g.key) {
                    jumpTo.current = null;
                    const y = e.nativeEvent.layout.y;
                    setTimeout(() => scroll.current?.scrollTo({ y: Math.max(0, y - topH - 8), animated: false }), 60);
                  }
                }}
              >
                <Pressable onLongPress={g.section ? () => setRenameSection(g.section) : undefined} delayLongPress={350} style={styles.sectionHead} accessibilityLabel={`Тема: ${g.title}`}>
                  <Text style={[styles.sectionTitle, !g.section && { color: S.ink2 }]} numberOfLines={2}>
                    {g.title}
                  </Text>
                  <Text style={styles.sectionCount}>{pairCount(g.items)}</Text>
                </Pressable>
                {g.items.map((m) => renderMessage(m, true))}
              </View>
            ))
          : messages.map((m) => renderMessage(m, false))}
        {routeOffer ? (
          <View style={{ gap: 14 }}>
            <View style={styles.mine}>
              <Text style={styles.mineText}>{routeOffer.text}</Text>
            </View>
            <ChatRouteCard
              title={routeOffer.title}
              onContinue={async () => {
                const offer = routeOffer;
                setRouteOffer(null);
                await openChat(offer.chatId);
                send(offer.text, undefined, true);
              }}
              onStay={() => {
                const offer = routeOffer;
                setRouteOffer(null);
                send(offer.text, undefined, true);
              }}
            />
            <Text style={styles.thinkingText}>Відповідь прийде після вибору</Text>
          </View>
        ) : null}
        {busy ? (
          <View style={styles.thinking}>
            <ActivityIndicator size="small" color={S.ink3} />
            <Text style={styles.thinkingText}>Думаю…</Text>
          </View>
        ) : null}
      </ScrollView>
      </View>
      {/* Through the glass portal (above the app's blur target, as the dock and the bar): only there does a blur see what
          is under it - a nested target did not blur at all. Only while this screen is in front. */}
      {chatFocused && (
      <GlassPortal name="chatTop">
        <View style={[styles.topBlock, { top: insets.top }]} onLayout={(e) => setTopH(Math.round(e.nativeEvent.layout.height))} pointerEvents="box-none">
          <View style={[styles.header, styles.topCapsule, topGlass]}>
            {glassOn && <DockGlassFill soft={S} dense radius={28} />}
          <Pressable onPress={menu} style={styles.roundBare} accessibilityLabel="Меню розмови" hitSlop={6}>
            <Ionicons name="ellipsis-horizontal" size={20} color={S.ink} />
          </Pressable>
          <View style={styles.titleBox}>
            <Text style={styles.title} numberOfLines={1}>
              {chat && messages.length > 0 ? titleOf(chat) : 'Нова розмова'}
            </Text>
            {/* The conversation's price lives here, under its name (2026-10-24: the header had no room for a ring of its own). */}
            <Pressable onPress={() => setCostOpen((v) => !v)} hitSlop={8} accessibilityLabel="Вартість розмови" style={styles.subRow}>
              <Text style={styles.sub}>{messages.length > 0 ? `розмова · ${thoughtsWord(messages.filter((m) => m.role === 'user').length)} · ` : 'нова · '}</Text>
              <MiniRing usd={chatCost} color={S.accent} track={S.line} />
              <Text style={styles.subCost}>{`$${money(tenthsOf(chatCost), 1)}`}</Text>
            </Pressable>
          </View>
          {FEATURES.aiChatOutline && messages.some((m) => m.role === 'user') ? (
            <Pressable onPress={() => setOutlineOpen((v) => !v)} style={styles.roundBare} accessibilityLabel="Зміст розмови" hitSlop={6}>
              <Ionicons name="list-outline" size={22} color={sortedOn ? S.accent : S.ink} />
            </Pressable>
          ) : null}
          {structure ? (
            <Pressable onPress={() => setMaterialsOpen(true)} style={styles.roundBare} accessibilityLabel="Матеріали розмови" hitSlop={6}>
              <Ionicons name="layers-outline" size={21} color={S.ink} />
              {materialsCount > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{materialsCount}</Text>
                </View>
              ) : null}
            </Pressable>
          ) : null}
          <Pressable onPress={FEATURES.aiHome ? goHome : closeAll} style={styles.roundBare} accessibilityLabel={FEATURES.aiHome ? 'До списку розмов' : 'Закрити'} hitSlop={6}>
            <Ionicons name={FEATURES.aiHome ? 'chevron-back' : 'close'} size={18} color={S.ink} />
          </Pressable>
        </View>
        {chat?.instruction ? <ChatInstructionChip instruction={chat.instruction} onPress={() => setInstructionFor(chat.id)} /> : null}
        {path.length > 0 ? (
          <Pressable onPress={() => parentTopic !== null && setTopic(parentTopic)} style={styles.crumbs} accessibilityLabel="Вийти з гілки">
            <Ionicons name="chevron-back" size={14} color={S.ink2} />
            <Text style={styles.crumbsText} numberOfLines={1}>
              {`${path.map((t) => t.title).join(' › ')}`}
            </Text>
          </Pressable>
        ) : null}
        </View>
      </GlassPortal>
      )}
      {/* What follows the list in the flow (the picking bar) keeps the screen's foot. */}
      <View style={{ flex: 1 }} pointerEvents="none" />
      {costOpen ? (
        <>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setCostOpen(false)} accessibilityLabel="Закрити вартість" />
          <View style={[styles.costCard, { top: insets.top + 66, left: 60 }]}>
            <Text style={styles.costHead}>ВАРТІСТЬ</Text>
            <View style={styles.costRow}>
              <Text style={styles.costText}>Остання відповідь</Text>
              <Text style={styles.costText}>{lastCost !== undefined ? `$${money(lastCost, 4)}` : '—'}</Text>
            </View>
            <View style={styles.costRow}>
              <Text style={styles.costText}>Ця розмова</Text>
              <Text style={styles.costText}>{`$${money(chatCost, 3)}`}</Text>
            </View>
            <View style={styles.costRow}>
              <Text style={[styles.costText, { fontFamily: SOFT_SEMIBOLD }]}>Усього досі</Text>
              <Text style={[styles.costText, { fontFamily: SOFT_SEMIBOLD }]}>{usage ? `$${money(usage.costUsd, 2)}` : '—'}</Text>
            </View>
            <Text style={styles.costNote}>Під назвою — сума розмови, завжди вгору до наступної десятої долара; кільце заповнюється, поки ця десята використовується.</Text>
          </View>
        </>
      ) : null}
      {/* «Нова тема…» under the first message and a topic renamed by hold open here: the list's own copies are not drawn
          while a conversation is open (the chip did nothing in a conversation until 2026-10-29). */}
      {themePrompt}
      {sectionPrompt}
      {outlineOpen && chat ? (
        <>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOutlineOpen(false)} accessibilityLabel="Закрити зміст" />
          {/* «Зміст розмови» (features.aiChatOutline): the two views, the topics to jump to, and «Впорядкувати». */}
          <View style={[styles.costCard, styles.outlineCard, { top: insets.top + 66 }]}>
            <View style={styles.outlineSwitch}>
              {[
                { on: false, label: 'За часом' },
                { on: true, label: 'По темах' },
              ].map((o) => {
                const active = sortedOn === o.on;
                const can = !o.on || !!chat.sections?.length;
                return (
                  <Pressable
                    key={o.label}
                    disabled={!can}
                    onPress={() => {
                      showByTopic(o.on);
                      setOutlineOpen(false);
                    }}
                    style={[styles.outlineSeg, active && { backgroundColor: S.card, boxShadow: S.shadow } as never, !can && { opacity: 0.4 }]}
                  >
                    <Text style={[styles.outlineSegText, active && { color: S.ink, fontFamily: SOFT_SEMIBOLD }]}>{o.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            {topicGroups.length ? (
              <ScrollView style={{ maxHeight: 300 }} contentContainerStyle={{ paddingVertical: 4 }}>
                {topicGroups.map((g) => (
                  <Pressable key={g.key} onPress={() => goToSection(g.key)} onLongPress={g.section ? () => { setOutlineOpen(false); setRenameSection(g.section); } : undefined} delayLongPress={350} style={styles.outlineRow}>
                    <Text style={[styles.outlineRowText, !g.section && { color: S.ink2 }]} numberOfLines={1}>
                      {g.title}
                    </Text>
                    <Text style={styles.sectionCount}>{pairCount(g.items)}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : (
              <Text style={styles.costNote}>Розмова ще не впорядкована. ШІ розкладе пари питання-відповідь за темами; справжній порядок збережеться.</Text>
            )}
            <Pressable onPress={sortNow} disabled={sortBusy} style={styles.outlineAction} accessibilityLabel="Впорядкувати розмову">
              {sortBusy ? <ActivityIndicator size="small" color={S.ink2} /> : <Ionicons name="sparkles-outline" size={17} color={S.ink} />}
              <Text style={styles.outlineActionText}>{sortBusy ? 'Групую…' : chat.sections?.length ? 'Впорядкувати знову' : 'Впорядкувати'}</Text>
            </Pressable>
          </View>
        </>
      ) : null}
      {!picking && (
        <ChatHintsStrip
          visible={hintsOpen && !busy}
          bottom={(keyboard > 0 ? keyboard + 8 : insets.bottom + 14) + dockH + 8}
          onPick={(k) => {
            setHintsOpen(false);
            const q = HINT_ASK[k];
            if (q) send(q);
          }}
        />
      )}
      <ThinkingEffect active={busy || opBusy} variant={thinkingVariant} bottom={keyboard > 0 ? keyboard + 8 : insets.bottom + 14} height={dockH} />
      {picking ? (
        <View style={[styles.foot, { paddingBottom: insets.bottom + 14 }]}>
          <View style={styles.pickBar}>
            <Pressable onPress={() => setPicked([])} style={styles.pickClose} accessibilityLabel="Скасувати вибір" hitSlop={6}>
              <Ionicons name="close" size={16} color={S.card} />
            </Pressable>
            <Text style={styles.pickCount}>{`Вибрано ${picked.length}`}</Text>
            <Pressable onPress={rememberPicked} style={styles.pickMain}>
              <Text style={styles.pickMainText}>{allRemembered ? 'Забути' : "Запам'ятати"}</Text>
            </Pressable>
            <Pressable onPress={moreAboutPicked} style={styles.pickAction}>
              <Text style={styles.pickActionText}>Детальніше</Text>
            </Pressable>
            <Pressable onPress={copyPicked} style={styles.pickAction} accessibilityLabel="Копіювати">
              <Ionicons name="copy-outline" size={16} color={S.card} />
            </Pressable>
          </View>
        </View>
      ) : (
        chatFocused ? (
        <GlassPortal name="chatComposer">
          <ChatComposer
          value={draft}
          onChangeText={setDraft}
          onSend={sendFromDock}
          sending={busy}
          listening={listening}
          onMic={listening ? stopListening : startListening}
          onPlus={() => setAttachOpen(true)}
          hintsOpen={hintsOpen}
          onHints={() => setHintsOpen((v) => !v)}
          attachments={attached.map((a) => ({ id: a.id, kind: a.kind === 'photo' ? 'photo' : a.kind === 'note' ? 'note' : a.kind === 'folder' ? 'folder' : a.kind === 'link' ? 'link' : 'file', name: a.name, sub: a.sub, uri: a.uri }))}
          onRemoveAttachment={(id) => {
            weighed.current.delete(id);
            setAttached((list) => list.filter((a) => a.id !== id));
          }}
          estimate={estimate ? { text: `≈ ${estimate.tokens.toLocaleString('uk-UA')} ток. · ${estimate.usd < 0.01 ? '<$0,01' : `$${money(estimate.usd, 2)}`}`, warn: threshold !== null && estimate.usd > threshold } : null}
          placeholder={attached.length ? 'Спитай про вкладене…' : messages.length === 0 ? 'Запитай або скажи…' : 'Продовжуй…'}
          keyboardHeight={keyboard}
          bottomInset={insets.bottom}
          inputRef={inputRef}
          onHeight={setDockH}
        />
        </GlassPortal>
        ) : null
      )}
      <ChatAttachSheet
        visible={attachOpen}
        onClose={() => setAttachOpen(false)}
        onCamera={() => addAttachments(pickCamera)}
        onGallery={() => addAttachments(pickGallery)}
        onFile={() => addAttachments(pickFile)}
        onNote={() => {
          setAttachOpen(false);
          setNotePickerOpen(true);
        }}
        onFolder={() => {
          setAttachOpen(false);
          setFolderPickOpen(true);
        }}
        onLink={() => {
          setAttachOpen(false);
          openLinkChoices();
        }}
      />
      <DocumentPickerModal
        visible={linkChoices !== null}
        title="Посилання до розмови"
        icon="link-outline"
        documents={(linkChoices ?? []).map((l) => ({ id: l.id, title: l.title }))}
        onPick={(id) => {
          const l = linkChoices?.find((x) => x.id === id);
          setLinkChoices(null);
          if (l) setAttached((list) => [...list, linkAttachment(l)]);
        }}
        onClose={() => setLinkChoices(null)}
      />
      <DocumentPickerModal
        visible={notePickerOpen}
        title="Нотатка до розмови"
        // Only the user's own notes: not ones that belong to something (a board's cards, a nested note, a conversation).
        documents={[...docIndex.values()].filter((d) => !d.deletedAt && !(peekDocument(d.id) as { owner?: unknown } | undefined)?.owner).sort((x, y) => (y.updatedAt ?? 0) - (x.updatedAt ?? 0)).map((d) => ({ id: d.id, title: d.title || 'Без назви' }))}
        onPick={(id) => {
          setNotePickerOpen(false);
          const d = docIndex.get(id);
          setAttached((list) => [...list, noteAttachment({ id, title: d?.title || 'Без назви' })]);
        }}
        onClose={() => setNotePickerOpen(false)}
      />
      <ChatFolderSheet
        visible={folderPickOpen}
        attach
        chatTitle=""
        folders={folders}
        onClose={() => setFolderPickOpen(false)}
        onPick={(id) => {
          setFolderPickOpen(false);
          const f = id ? folders.find((x) => x.id === id) : null;
          if (!f) return;
          const tag = tags.find((t) => t.id === f.id);
          setAttached((list) => [...list, folderAttachment({ path: f.path, name: f.name, count: tag ? Object.keys(tag.usedIn ?? {}).length : 0 })]);
        }}
      />
      <ChatCostWarning
        visible={warning !== null}
        cost={warning?.cost ?? 0}
        threshold={threshold ?? 0}
        rows={warning?.rows ?? []}
        onCancel={() => setWarning(null)}
        onSend={() => warning?.go()}
      />
      <ChatThresholdSheet
        visible={thresholdOpen}
        value={threshold}
        onPick={(v) => {
          setThreshold(v);
          setThresholdOpen(false);
        }}
        onClose={() => setThresholdOpen(false)}
      />
      {boardOpen ? (
        <ChatBoardWindow
          boardId={boardOpen.boardId}
          title="Дошка"
          subtitle={opBusy ? 'ШІ працює…' : lastOp ? 'змінено' : 'чернетка'}
          subtitleAction={!opBusy && lastOp ? { label: 'Скасувати', onPress: undoLastOp } : undefined}
          refreshTick={boardTick}
          fitTick={fitTick}
          onClose={() => {
            setBoardOpen(null);
            setLastOp(null);
          }}
          onSave={saveStructureFlow}
          renderSelectionBar={(ids, clear) => (
            <View style={styles.selBar}>
              {opBusy ? (
                <View style={styles.selBusy}>
                  <ActivityIndicator size="small" color={S.card} />
                  <Text style={styles.selActionText}>ШІ працює…</Text>
                </View>
              ) : (
                <>
                  <Pressable onPress={() => runBoardOp('deepen', ids, clear)} style={styles.selMain} accessibilityLabel="Поглибити вибрані картки">
                    <Text style={styles.selMainText}>Поглибити</Text>
                  </Pressable>
                  <Pressable onPress={() => runBoardOp('branch', ids, clear)} style={styles.selAction} accessibilityLabel="Розгалузити вибрані картки">
                    <Text style={styles.selActionText}>Розгалузити</Text>
                  </Pressable>
                </>
              )}
            </View>
          )}
        />
      ) : null}
      {FEATURES.aiHome ? themePrompt : null}
      <Menu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        entries={menuOpen ? menuEntries() : []}
        style={{ position: 'absolute', left: 10, top: insets.top + 12 + 48 + 8 }}
        accent={S.accent}
        soft={S}
      />
      {materialsOpen && chat ? (
        <ChatMaterialsSheet
          chatId={chat.id}
          board={structure ? { boardId: structure.boardId, title: structure.title } : null}
          onClose={() => setMaterialsOpen(false)}
          onOpenBoard={() => {
            setMaterialsOpen(false);
            if (structure) setBoardOpen(structure);
          }}
          onOpenOutline={(id) => {
            setMaterialsOpen(false);
            setOutlineBoard(id);
          }}
          onOpenNote={(id) => navigation.navigate('Editor', { documentId: id })}
          onSave={saveStructureFlow}
        />
      ) : null}
      {outlineBoard ? <ChatOutlineSheet boardId={outlineBoard} refreshTick={boardTick} onClose={() => setOutlineBoard(null)} /> : null}
      <ChatsSheet
        visible={chatsOpen}
        chats={chatList}
        currentId={chat?.id}
        folders={folders}
        onClose={() => setChatsOpen(false)}
        onOpen={openChat}
        onNew={() => {
          setChatsOpen(false);
          newConversation();
        }}
        onFolder={(id) => {
          setChatsOpen(false);
          setFolderFor({ chatId: id, purpose: 'chat' });
        }}
        onInstruction={(id) => {
          setChatsOpen(false);
          setInstructionFor(id);
        }}
        onRename={(id, title) => setChatFields(id, { customTitle: title.trim() })}
        onDelete={removeChat}
      />
      <ChatFolderSheet
        visible={folderFor !== null}
        chatTitle={folderFor?.purpose === 'save' ? `Куди зберегти «${structure?.title ?? 'дошку'}»` : chatList.find((c) => c.id === folderFor?.chatId)?.title ?? (chat ? titleOf(chat) : 'Розмова')}
        folders={folders}
        currentId={folderFor ? (fieldOf(folderFor.chatId, 'folderId') as string | undefined) : undefined}
        onClose={() => setFolderFor(null)}
        onPick={(id) => {
          const target = folderFor;
          setFolderFor(null);
          if (!target) return;
          if (target.purpose === 'save') saveStructureTo(id ? folders.find((f) => f.id === id) ?? null : null);
          else setChatFields(target.chatId, { folderId: id ?? '' });
        }}
      />
      <ChatInstructionSheet
        visible={instructionFor !== null}
        value={instructionFor ? (fieldOf(instructionFor, 'instruction') as string | undefined) : undefined}
        onClose={() => setInstructionFor(null)}
        onSave={(text) => {
          const id = instructionFor;
          setInstructionFor(null);
          if (id) setChatFields(id, { instruction: text.trim() });
        }}
        onClear={() => {
          const id = instructionFor;
          setInstructionFor(null);
          if (id) setChatFields(id, { instruction: '' });
        }}
      />
    </View>
  );
}

// «6 думок»: the number of the user's own turns, with the Ukrainian plural.
function thoughtsWord(n: number): string {
  const last = n % 10;
  const tens = n % 100;
  const word = tens >= 11 && tens <= 14 ? 'думок' : last === 1 ? 'думка' : last >= 2 && last <= 4 ? 'думки' : 'думок';
  return `${n} ${word}`;
}

function makeStyles(S: ReturnType<typeof useSoft>) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: S.bg },
    topBlock: { position: 'absolute', left: 0, right: 0, gap: 6 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 12 },
    // One capsule across the top, as the bar on every other screen: ⋯, the name, × on it.
    topCapsule: { marginHorizontal: 10, marginTop: 6, height: 60, borderRadius: 30, paddingVertical: 0, paddingHorizontal: 6, backgroundColor: S.card, boxShadow: S.shadow } as never,
    roundBare: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
    round: { width: 48, height: 48, borderRadius: 24, backgroundColor: S.card, alignItems: 'center', justifyContent: 'center', boxShadow: S.shadow } as never,
    titleBox: { flex: 1, minWidth: 0, alignItems: 'center' },
    title: { textAlign: 'center', fontSize: 16, fontFamily: SOFT_SEMIBOLD, color: S.ink },
    sub: { fontSize: 12, color: S.ink2, fontFamily: SOFT_REGULAR },
    subRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    subCost: { fontSize: 12, color: S.ink, fontFamily: SOFT_SEMIBOLD },
    toNote: { height: 40, borderRadius: 20, paddingHorizontal: 16, backgroundColor: S.ink, alignItems: 'center', justifyContent: 'center' },
    toNoteText: { color: S.card, fontSize: 15, fontFamily: SOFT_MEDIUM },
    toNoteDone: { backgroundColor: S.card, boxShadow: S.shadow } as never,
    toNoteDoneText: { color: S.ink },
    crumbs: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, height: 30, marginHorizontal: 14, borderRadius: 15, backgroundColor: S.card },
    crumbsText: { flex: 1, fontSize: 12.5, color: S.ink2, fontFamily: SOFT_MEDIUM },
    list: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 24, gap: 14 },
    emptyBox: { alignItems: 'center', gap: 12, marginTop: 90, paddingHorizontal: 6 },
    emptyBall: { width: 64, height: 64, borderRadius: 32, backgroundColor: S.dark ? '#534034' : '#F9EAE0', alignItems: 'center', justifyContent: 'center' },
    emptyTitle: { fontSize: 22, fontFamily: SOFT_SEMIBOLD, color: S.ink },
    empty: { fontSize: 14, lineHeight: 21, color: S.ink2, fontFamily: SOFT_REGULAR, textAlign: 'center' },
    starters: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, paddingHorizontal: 14, paddingBottom: 6 },
    starter: { height: 40, borderRadius: 20, paddingHorizontal: 16, backgroundColor: S.card, alignItems: 'center', justifyContent: 'center', boxShadow: S.shadow } as never,
    starterText: { fontSize: 15, color: S.ink, fontFamily: SOFT_MEDIUM },
    selBar: { flexDirection: 'row', alignItems: 'center', gap: 2, padding: 4, borderRadius: 28, backgroundColor: S.ink, boxShadow: S.shadow } as never,
    selMain: { height: 40, borderRadius: 20, paddingHorizontal: 16, backgroundColor: S.card, alignItems: 'center', justifyContent: 'center' },
    selMainText: { fontSize: 15, color: S.ink, fontFamily: SOFT_MEDIUM },
    selAction: { height: 40, borderRadius: 20, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
    selActionText: { fontSize: 15, color: S.card, fontFamily: SOFT_MEDIUM },
    selBusy: { height: 40, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
    badge: { position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: S.accent, alignItems: 'center', justifyContent: 'center' },
    badgeText: { fontSize: 11, color: '#FFFFFF', fontFamily: SOFT_SEMIBOLD },
    structCard: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 76, borderRadius: 22, backgroundColor: S.card, paddingLeft: 12, paddingRight: 14, marginTop: 4, boxShadow: S.shadow } as never,
    structIcon: { width: 52, height: 52, borderRadius: 16, backgroundColor: S.dark ? '#534034' : '#F9EAE0', alignItems: 'center', justifyContent: 'center' },
    structTitle: { fontSize: 16, color: S.ink, fontFamily: SOFT_SEMIBOLD },
    structSub: { fontSize: 12.5, color: S.ink2, fontFamily: SOFT_REGULAR },
    structOpen: { height: 40, borderRadius: 20, paddingHorizontal: 16, backgroundColor: S.ink, alignItems: 'center', justifyContent: 'center' },
    structOpenText: { fontSize: 15, color: S.card, fontFamily: SOFT_MEDIUM },
    costCard: { position: 'absolute', width: 270, borderRadius: 22, backgroundColor: S.card, padding: 16, gap: 2, boxShadow: S.shadow } as never,
    costHead: { fontSize: 11.5, letterSpacing: 0.4, color: S.ink2, fontFamily: SOFT_SEMIBOLD, paddingBottom: 4 },
    costRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
    costText: { fontSize: 14, color: S.ink, fontFamily: SOFT_REGULAR },
    costNote: { marginTop: 6, fontSize: 12, lineHeight: 17, color: S.ink2, fontFamily: SOFT_REGULAR },
    outlineCard: { right: 12, width: 300, gap: 6 },
    outlineSwitch: { flexDirection: 'row', backgroundColor: S.fillSolid, borderRadius: 14, padding: 3, gap: 3 },
    outlineSeg: { flex: 1, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
    outlineSegText: { fontSize: 14, color: S.ink2, fontFamily: SOFT_MEDIUM },
    outlineRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
    outlineRowText: { flex: 1, fontSize: 15.5, color: S.ink, fontFamily: SOFT_MEDIUM },
    outlineAction: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 44, borderRadius: 14, backgroundColor: S.fillSolid, marginTop: 4 },
    outlineActionText: { fontSize: 14.5, color: S.ink, fontFamily: SOFT_SEMIBOLD },
    sectionHead: { flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingTop: 10 },
    sectionTitle: { flex: 1, fontSize: 21, color: S.ink, fontFamily: SOFT_BOLD },
    sectionCount: { fontSize: 14, color: S.ink3, fontFamily: SOFT_MEDIUM, fontVariant: ['tabular-nums'] },
    pairDate: { alignSelf: 'flex-end', fontSize: 11.5, color: S.ink3, fontFamily: SOFT_MEDIUM, marginBottom: -8 },
    branchMark: { alignSelf: 'flex-start', backgroundColor: S.fillSolid, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, maxWidth: '100%' },
    branchMarkText: { fontSize: 11.5, color: S.ink2, fontFamily: SOFT_MEDIUM },
    mine: { alignSelf: 'flex-end', maxWidth: '82%', backgroundColor: S.card, borderRadius: 22, borderBottomRightRadius: 6, paddingHorizontal: 16, paddingVertical: 11, boxShadow: S.shadow } as never,
    mineText: { fontSize: 15, lineHeight: 21, color: S.ink, fontFamily: SOFT_REGULAR },
    answer: { gap: 6 },
    block: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6, marginHorizontal: -8, borderWidth: 1.5, borderColor: 'transparent' },
    blockMem: { backgroundColor: S.dark ? 'rgba(217,121,63,0.18)' : '#FBEBD9' },
    blockPicked: { borderColor: S.accent },
    blockText: { fontSize: 15, lineHeight: 22, color: S.ink, fontFamily: SOFT_REGULAR },
    memo: { marginTop: 4, fontSize: 11, color: S.accent, fontFamily: SOFT_SEMIBOLD },
    tick: { position: 'absolute', right: -6, top: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: S.accent, alignItems: 'center', justifyContent: 'center' },
    listen: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingVertical: 2 },
    listenText: { fontSize: 12, color: S.ink3, fontFamily: SOFT_MEDIUM },
    error: { fontSize: 14, lineHeight: 20, color: '#B3402F', fontFamily: SOFT_REGULAR },
    thinking: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    thinkingText: { fontSize: 14, color: S.ink3, fontFamily: SOFT_REGULAR },
    foot: { paddingHorizontal: 10, paddingTop: 6, gap: 6, backgroundColor: S.bg },
    field: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, backgroundColor: S.card, borderRadius: 28, minHeight: 56, paddingLeft: 18, paddingRight: 8, paddingVertical: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: S.line, boxShadow: S.shadow } as never,
    input: { flex: 1, maxHeight: 140, fontSize: 16.5, lineHeight: 22, color: S.ink, fontFamily: SOFT_REGULAR, paddingVertical: 5 },
    mic: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    micOn: { backgroundColor: S.accent },
    send: { width: 40, height: 40, borderRadius: 20, backgroundColor: S.ink, alignItems: 'center', justifyContent: 'center' },
    pickBar: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: S.ink, borderRadius: 24, padding: 6, minHeight: 48 },
    pickClose: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
    pickCount: { flex: 1, color: S.card, fontSize: 13, fontFamily: SOFT_MEDIUM },
    pickMain: { backgroundColor: S.card, borderRadius: 17, paddingHorizontal: 13, paddingVertical: 9 },
    pickMainText: { color: S.ink, fontSize: 13, fontFamily: SOFT_SEMIBOLD },
    pickAction: { borderRadius: 17, paddingHorizontal: 11, paddingVertical: 9, alignItems: 'center', justifyContent: 'center' },
    pickActionText: { color: S.card, fontSize: 13, fontFamily: SOFT_MEDIUM },
  });
}
