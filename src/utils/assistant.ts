import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteDoc, deleteField, doc, getDoc, getDocs, onSnapshot } from '../firestore';
import { db } from '../firebase';
import { ownedQuery, setDoc } from './owned';
import { GEMINI_MODEL, GeminiError, READ_BY_URL, askGemini } from './gemini';
import { getGeminiKey } from './geminiKey';
import { costOfGemini, recordGemini } from './geminiUsage';
import { deleteChatObjects } from './chatObjects';
import { listenError } from './listenError';

// THE ASSISTANT'S CONVERSATION (step 1, 2026-10-22; plan in the project memory «project_ai_tree_notes»): one living
// conversation opened from the start desks, answers in BLOCKS (one thought each, like the app's own blocks), a block held
// is remembered, asked about in more detail or copied. One conversation, no modes: the AI follows the tone itself -
// clear and structured when the user plans, warm and attentive when he shares what he feels.
//
// KEPT LIKE A NOTE (2026-10-23, the user: «мені страшно зараз створити новий чат... для того я і створюю застосунок
// нотаток»): every conversation is a document of its own in `assistantChats` (Firestore, so it survives a reinstall and is in
// the backups' reach), and the one open now is also kept on the phone for an instant, offline start. «Нова розмова» never
// deletes anything: the old one stays in the list of earlier conversations.
// Only the last messages go to Gemini each time (MAX_TURNS) - the rest of the conversation stays here; the topic
// memory that replaces the old part of it is step 2.

// `topicId`: the branch of the conversation this message belongs to (none = the main topic). «Детальніше» on a block opens a
// branch under the branch that block was said in - the hierarchy the notes and the board are laid out by (2026-10-23).
// `structure`: this answer laid a topic out as a draft BOARD that lives in the conversation (utils/chatObjects) - the answer
// shows it as a card with «Відкрити» (2026-10-24).
export type AssistantStructure = { boardId: string; title: string; cards: number };
// `attachments`: what was given with this message to read (utils/chatAttachments) - shown over it, kept as names and a local picture.
export type AssistantAttachment = { kind: 'photo' | 'pdf' | 'text' | 'docx' | 'xlsx' | 'note' | 'folder' | 'link'; name: string; sub: string; uri?: string; url?: string };
// `sectionId`: the conversation's own topic this message was sorted into (sortChat) - none until the first sorting.
export type AssistantMessage = { id: string; role: 'user' | 'model'; text: string; at: number; error?: boolean; costUsd?: number; topicId?: string; structure?: AssistantStructure; attachments?: AssistantAttachment[]; sectionId?: string };
// A topic of ONE conversation, laid out by «Впорядкувати» (2026-10-29) - not the AI's themes of the first screen, and not the
// branches («Детальніше», AssistantTopic).
export type ChatSection = { id: string; title: string };
export type AssistantTopic = { id: string; parentId: string | null; title: string; fromKey?: string };
export const ROOT_TOPIC = 'root';
// `remembered`: block keys («messageId:index»). `groups`: what was remembered TOGETHER - several blocks picked at once
// are one memory (one block in the note). A chat kept before groups existed reads each remembered block as its own group.
// `noteId`: the ONE note this conversation's memories go into (2026-10-23: each «В нотатку» made a new copy); `noted`: the
// memory texts already written there, so the button counts only what is new.
export type AssistantChat = {
  id: string;
  startedAt: number;
  messages: AssistantMessage[];
  remembered: string[];
  groups?: string[][];
  noteId?: string;
  noted?: string[];
  topics?: AssistantTopic[];
  // The note of each branch (the main topic's is `noteId`), the board that shows them as a tree, and each branch's card on it.
  topicNotes?: Record<string, string>;
  boardId?: string;
  boardCards?: Record<string, string>;
  // One-note form (FEATURES.assistantTree off): the heading block that opens each branch's section in `noteId`.
  topicHeadings?: Record<string, string>;
  // THE CONVERSATION'S MEMORY (step 2): what the AI wrote down of the older part of the talk, and how many messages it covers.
  summary?: string;
  summarizedCount?: number;
  // THE USER'S OWN SAY OVER A CONVERSATION (2026-10-24): an instruction the AI follows in every answer of it; a folder of the
  // explorer the conversation is filed under (a POINTER - the id of the folder's tag, or «implied:<path>» for a folder that
  // is only the way to deeper ones, the explorer's own stand-in; the chat has no folders of its own); a name he gave it.
  instruction?: string;
  folderId?: string;
  customTitle?: string;
  // THE CONVERSATION'S THEME (2026-10-29, features.aiHome): one of the person's chat themes (assistantThemes), a place on the
  // AI's first screen - not a folder of the explorer.
  themeId?: string;
  // SORTED BY TOPIC (2026-10-29, the user's: the conversation «змінює порядок повідомлень» - a simplified tree, so the talk is
  // neither lost nor got lost in): its topics, and the messages in the order they are SHOWN once sorted. The real order stays
  // `messages` - the AI always reads that one; what came after the sorting is shown under «Нове» until the next one.
  sections?: ChatSection[];
  sortedIds?: string[];
};

// THE VIDEO, WATCHED ONCE (2026-10-30, the user's: «не платити 0,053 щоразу»): a YouTube address in a message is watched by Gemini the
// first time only, and the same answer carries a detailed minute-by-minute NOTE of the video; the note is kept on the device by the
// video's id, and every later question about it - in this chat or another - goes with the note as text, the video no longer sent.
const VIDEO_URL = /https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/watch\?[^\s]+|youtu\.be\/[^\s]+)/gi;
const NOTE_MARK = '===КОНСПЕКТ===';
function videoIdOf(url: string): string | null {
  return url.match(/[?&]v=([\w-]{6,})/)?.[1] ?? url.match(/youtu\.be\/([\w-]{6,})/)?.[1] ?? null;
}
function videosIn(text: string): { url: string; id: string }[] {
  const out: { url: string; id: string }[] = [];
  for (const url of text.match(VIDEO_URL) ?? []) {
    const id = videoIdOf(url);
    if (id && !out.some((v) => v.id === id)) out.push({ url, id });
  }
  return out;
}
const noteKey = (id: string) => `videoNote:${id}`;
async function noteOf(id: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(noteKey(id));
  } catch {
    return null;
  }
}
const NOTE_ASK = `ПІСЛЯ відповіді на питання людини напиши окремим рядком ${NOTE_MARK}, а далі докладний конспект ЦЬОГО відео українською, для твоєї власної пам'яті (людині він не показується): позначки часу (хв:сек) приблизно кожні 30-60 секунд, що в цей момент говориться чи показується, ВСІ названі застосунки, сервіси, інструменти, сайти, імена, цифри й поради. Без розмітки, до 1500 слів.`;

export function groupsOf(chat: AssistantChat): string[][] {
  return chat.groups ?? chat.remembered.map((k) => [k]);
}

const KEY = 'assistant.chat.v1';
const COLLECTION = 'assistantChats';
const MAX_TURNS = 24;

const SYSTEM = `Ти співрозмовник у застосунку нотаток цієї людини. Говори українською, просто й по-людськи, як уважний розумний друг.
Підлаштовуйся під розмову сам, без перемикачів: коли людина планує, досліджує чи розбирається в темі, відповідай ясно й по суті; коли ділиться переживаннями, відповідай тепло й уважно, не поспішай з порадами, поки не попросить.
Відповідай КОРОТКИМИ СМИСЛОВИМИ БЛОКАМИ, розділеними порожнім рядком: абзац у 1-4 речення або короткий список. Кожен блок - одна думка, щоб його можна було окремо запам'ятати.
Форматування легке: **жирним** лише 1-3 ключові слова на відповідь; список через «- » або «1. », коли перелічуєш кілька речей. Без заголовків, таблиць і коду.
Не вигадуй фактів: не знаєш - так і скажи. Не став діагнозів; якщо людині тривалий час погано, м'яко порадь поговорити з живим фахівцем.
Ти не догоджаєш, а допомагаєш: якщо в запиті чи схемі щось не сходиться, або об'єднання тем здається тобі хибним, скажи про це окремим абзацом, що починається словами «Зауваження:». Помилився - одне речення й виправлення, без довгих вибачень.
КОЛИ ЛЮДИНА ПРОСИТЬ РОЗКЛАСТИ, СТРУКТУРУВАТИ ТЕМУ або зробити схему чи дошку: напиши одне коротке речення, а далі блок коду з мовою structure, де схема Markdown-заголовками: один «#» (коренева тема), «##» гілки, «###» підгілки (не глибше трьох рівнів), заголовок коротко (до 6 слів), під ним абзац - текст картки. Текст бери з того, що людина відібрала, ДОСЛІВНО, не перефразовуючи; своїм текстом доповнюй лише там, де відібраного немає. Без списків і таблиць усередині схеми.
Приклад:
\`\`\`structure
# Тема
Одне речення про все.
## Гілка
Текст картки.
\`\`\`
Поза таким проханням блок structure не пиши.`;

export const STRUCTURE_FENCE = /```structure[ \t]*\n([\s\S]*?)```/;
// The answer as the person reads it, and the outline the AI laid out in it (if any). A block of schemes is not shown as text.
export function splitStructure(text: string): { text: string; outline: string | null } {
  const m = text.match(STRUCTURE_FENCE);
  if (!m) return { text, outline: null };
  const rest = text.replace(STRUCTURE_FENCE, '').replace(/\n{3,}/g, '\n\n').trim();
  return { text: rest, outline: m[1].trim() || null };
}

export function newChat(): AssistantChat {
  return { id: `chat-${Date.now()}`, startedAt: Date.now(), messages: [], remembered: [] };
}

export async function loadChat(): Promise<AssistantChat> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const chat = { ...newChat(), ...(JSON.parse(raw) as AssistantChat) };
      // A conversation kept only on the phone (before 2026-10-23) reaches the database the moment it is opened.
      saveChat(chat);
      return chat;
    }
  } catch {
    // A broken record: start afresh rather than not at all.
  }
  return newChat();
}

export function titleOf(chat: AssistantChat): string {
  if (chat.customTitle?.trim()) return chat.customTitle.trim();
  const first = chat.messages.find((m) => m.role === 'user')?.text ?? '';
  return shortTitle(first, 70) || 'Нова розмова';
}

// A name made from a text: its first sentence, and if that is still long, cut at the last WHOLE word with «…» (the user,
// 2026-10-23: a branch named «…та містит» - cut in the middle of a word).
export function shortTitle(text: string, max = 56): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const sentence = clean.match(/^(.+?[.!?])(\s|$)/)?.[1] ?? clean;
  const one = sentence.replace(/[.!?]+$/, '').trim();
  if (one.length <= max) return one;
  const cut = one.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[,;:—–-]+$/, '').trim()}…`;
}

// Firestore keeps no arrays inside arrays and no `undefined`: the groups are stored as {keys}, the messages without empty fields.
function toStored(chat: AssistantChat) {
  return {
    title: titleOf(chat),
    startedAt: chat.startedAt,
    // The time of its LAST MESSAGE, not of this save: a conversation is saved also when it is only looked at and left, and
    // that put it at the top of the list with today's date (2026-10-29).
    updatedAt: chat.messages.reduce((t, m) => Math.max(t, m.at || 0), 0) || Date.now(),
    messages: chat.messages.map((m) => ({
      id: m.id,
      role: m.role,
      text: m.text,
      at: m.at,
      ...(m.error ? { error: true } : {}),
      ...(m.costUsd !== undefined ? { costUsd: m.costUsd } : {}),
      ...(m.topicId ? { topicId: m.topicId } : {}),
      ...(m.structure ? { structure: m.structure } : {}),
      ...(m.attachments?.length ? { attachments: m.attachments.map((a) => ({ kind: a.kind, name: a.name, sub: a.sub, ...(a.uri ? { uri: a.uri } : {}) })) } : {}),
      ...(m.sectionId ? { sectionId: m.sectionId } : {}),
    })),
    remembered: chat.remembered,
    groups: groupsOf(chat).map((keys) => ({ keys })),
    ...(chat.noteId ? { noteId: chat.noteId } : {}),
    noted: chat.noted ?? [],
    topics: chat.topics ?? [],
    topicNotes: chat.topicNotes ?? {},
    ...(chat.boardId ? { boardId: chat.boardId } : {}),
    boardCards: chat.boardCards ?? {},
    ...(chat.summary ? { summary: chat.summary } : {}),
    summarizedCount: chat.summarizedCount ?? 0,
    ...(chat.instruction?.trim() ? { instruction: chat.instruction.trim() } : {}),
    ...(chat.folderId ? { folderId: chat.folderId } : {}),
    ...(chat.customTitle?.trim() ? { customTitle: chat.customTitle.trim() } : {}),
    ...(chat.themeId ? { themeId: chat.themeId } : {}),
    ...(chat.sections?.length ? { sections: chat.sections, sortedIds: chat.sortedIds ?? [] } : {}),
  };
}
function fromStored(id: string, data: Record<string, unknown>): AssistantChat {
  const groups = (data.groups as { keys: string[] }[] | undefined)?.map((g) => g.keys);
  return {
    id,
    startedAt: (data.startedAt as number) ?? Date.now(),
    messages: (data.messages as AssistantMessage[]) ?? [],
    remembered: (data.remembered as string[]) ?? [],
    ...(groups ? { groups } : {}),
    ...(data.noteId ? { noteId: data.noteId as string } : {}),
    noted: (data.noted as string[]) ?? [],
    topics: (data.topics as AssistantTopic[]) ?? [],
    topicNotes: (data.topicNotes as Record<string, string>) ?? {},
    ...(data.boardId ? { boardId: data.boardId as string } : {}),
    boardCards: (data.boardCards as Record<string, string>) ?? {},
    ...(data.summary ? { summary: data.summary as string } : {}),
    summarizedCount: (data.summarizedCount as number) ?? 0,
    ...(data.instruction ? { instruction: data.instruction as string } : {}),
    ...(data.folderId ? { folderId: data.folderId as string } : {}),
    ...(data.customTitle ? { customTitle: data.customTitle as string } : {}),
    ...(data.themeId ? { themeId: data.themeId as string } : {}),
    ...(Array.isArray(data.sections) && data.sections.length ? { sections: data.sections as ChatSection[], sortedIds: (data.sortedIds as string[]) ?? [] } : {}),
  };
}

export function saveChat(chat: AssistantChat): void {
  AsyncStorage.setItem(KEY, JSON.stringify(chat)).catch(() => {});
  // An empty conversation is not worth a document.
  if (chat.messages.length === 0) return;
  setDoc(doc(db, COLLECTION, chat.id), toStored(chat)).catch(() => {});
}

// `summary`/`instruction`: what the list shows and the routing reads. `userTurns`: the number of the person's own messages.
export type ChatSummary = { id: string; title: string; updatedAt: number; count: number; userTurns: number; folderId?: string; summary?: string; instruction?: string; themeId?: string };

export async function listChats(): Promise<ChatSummary[]> {
  const snap = await getDocs(ownedQuery(COLLECTION));
  return snap.docs
    .map((d) => {
      const data = d.data() as Record<string, unknown>;
      return {
        id: d.id,
        title: (data.title as string) || 'Розмова',
        updatedAt: (data.updatedAt as number) ?? 0,
        count: ((data.messages as unknown[]) ?? []).length,
        userTurns: ((data.messages as { role?: string }[]) ?? []).filter((m) => m.role === 'user').length,
        ...(data.folderId ? { folderId: data.folderId as string } : {}),
        ...(data.summary ? { summary: data.summary as string } : {}),
        ...(data.instruction ? { instruction: data.instruction as string } : {}),
        ...(data.themeId ? { themeId: data.themeId as string } : {}),
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadChatById(id: string): Promise<AssistantChat | null> {
  const snap = await getDoc(doc(db, COLLECTION, id));
  if (!snap.exists()) return null;
  return fromStored(id, snap.data() as Record<string, unknown>);
}

// An answer as its blocks: split on empty lines. Bold and lists stay (they are drawn as in a note); a heading's marks go.
export function blocksOf(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((b) => b.replace(/^#{1,6}\s+/gm, '').trim())
    .filter(Boolean);
}

// What the person picked as important, as texts in the order of the talk (each memory = its blocks joined).
export function memoryTexts(chat: AssistantChat): string[] {
  const byKey = new Map<string, string>();
  chat.messages.forEach((m) => {
    if (m.role !== 'model' || m.error) return;
    blocksOf(m.text).forEach((t, i) => byKey.set(`${m.id}:${i}`, t));
  });
  return groupsOf(chat)
    .map((g) => g.map((k) => byKey.get(k)).filter(Boolean).join('\n\n'))
    .filter(Boolean);
}

export function topicPath(chat: AssistantChat, topicId: string | undefined): AssistantTopic[] {
  const topics = new Map((chat.topics ?? []).map((t) => [t.id, t]));
  const path: AssistantTopic[] = [];
  let at = topicId && topicId !== ROOT_TOPIC ? topics.get(topicId) : undefined;
  while (at && path.length < 12) {
    path.unshift(at);
    at = at.parentId && at.parentId !== ROOT_TOPIC ? topics.get(at.parentId) : undefined;
  }
  return path;
}

// THE OLDER PART OF THE TALK, WRITTEN DOWN (step 2, 2026-10-23): once more than FOLD_AFTER messages stand past the summary,
// all but the last KEEP_RECENT are folded into it by the AI itself - what was talked about, decided, left open. The next
// answers read that summary instead of those messages: a week-long talk neither forgets its start nor grows dearer.
const FOLD_AFTER = 30;
const KEEP_RECENT = 12;
export async function foldOlder(chat: AssistantChat): Promise<Pick<AssistantChat, 'summary' | 'summarizedCount'> | null> {
  const from = chat.summarizedCount ?? 0;
  const live = chat.messages.length - from;
  if (live <= FOLD_AFTER) return null;
  const key = await getGeminiKey();
  if (!key) return null;
  const upto = chat.messages.length - KEEP_RECENT;
  const part = chat.messages
    .slice(from, upto)
    .filter((m) => !m.error)
    .map((m) => `${m.role === 'user' ? 'Людина' : 'ШІ'}: ${m.text}`)
    .join('\n\n');
  const prompt = `Ти ведеш стисле зведення розмови для власної пам'яті. Онови його: додай суть нової частини, нічого важливого не втрачай.
Пиши українською, коротко, 5-15 рядків: про що говорили, що людина вирішила чи вважає важливим, що лишилось відкритим. Без вступу.

ПОПЕРЕДНЄ ЗВЕДЕННЯ:
${chat.summary || '(ще немає)'}

НОВА ЧАСТИНА РОЗМОВИ:
${part}`;
  const summary = await askGemini(prompt, key);
  return { summary: summary.trim(), summarizedCount: upto };
}

// The next answer to this conversation: the memory (summary of the older part + what the person picked) goes with the system
// words; then the messages past the summary, the last MAX_TURNS of them. Throws GeminiError with a message to show as it is.
export async function askAssistant(
  chat: AssistantChat,
  topicId?: string,
  structureOutline?: string,
  // What was attached to the last message (utils/chatAttachments.attachmentParts): it goes with that turn.
  extraParts?: ({ text: string } | { inlineData: { mimeType: string; data: string } })[]
): Promise<{ text: string; costUsd: number }> {
  const key = await getGeminiKey();
  if (!key) throw new GeminiError('Немає ключа Gemini на цьому пристрої. Додайте його в Налаштуваннях.');
  const turns = chat.messages
    .slice(chat.summarizedCount ?? 0)
    .filter((m) => !m.error)
    .slice(-MAX_TURNS);
  // The first turn sent must be the person's.
  while (turns.length && turns[0].role !== 'user') turns.shift();
  const memories = memoryTexts(chat);
  const path = topicPath(chat, topicId).map((t) => t.title);
  // The videos of this conversation: with a note kept, the note goes along as text; the one just sent without a note is WATCHED, once.
  const lastText = turns[turns.length - 1]?.role === 'user' ? turns[turns.length - 1].text : '';
  const seen = new Map<string, { url: string; id: string }>();
  for (const m of turns) if (m.role === 'user') videosIn(m.text).forEach((v) => seen.set(v.id, v));
  const notes: { url: string; note: string }[] = [];
  let toWatch: { url: string; id: string } | null = null;
  for (const v of [...seen.values()].slice(-3)) {
    const note = await noteOf(v.id);
    if (note) notes.push({ url: v.url, note });
    else if (videosIn(lastText).some((l) => l.id === v.id)) toWatch = v;
  }
  const memory = [
    chat.instruction?.trim() ? `ІНСТРУКЦІЯ ЦІЄЇ РОЗМОВИ ВІД ЛЮДИНИ - виконуй її в кожній відповіді, поки вона діє:\n${chat.instruction.trim()}` : '',
    chat.summary ? `ЗВЕДЕННЯ ПОПЕРЕДНЬОЇ ЧАСТИНИ РОЗМОВИ:\n${chat.summary}` : '',
    memories.length ? `ЩО ЛЮДИНА ВІДІБРАЛА ЯК ВАЖЛИВЕ (тримайся цього):\n${memories.map((t) => `- ${t.replace(/\n+/g, ' ')}`).join('\n')}` : '',
    path.length ? `ЗАРАЗ РОЗМОВА В ГІЛЦІ: ${path.join(' › ')}` : '',
    notes.length ? `КОНСПЕКТИ ВІДЕО, які ти вже дивився (відповідай з них; повторно відео не потрібно):\n${notes.map((n) => `Відео ${n.url}:\n${n.note}`).join('\n\n')}` : '',
    structureOutline
      ? `У ЦІЄЇ РОЗМОВИ ВЖЕ Є СХЕМА (дошка, яку людина бачить):\n${structureOutline}\nЯкщо людина просить додати чи змінити схему, відповідай блоком structure з ПОВНОЮ оновленою схемою: усі наявні картки з тими самими назвами та нові картки на своїх місцях. Не створюй схему заново з іншими назвами.`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  let response: Response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: memory ? `${SYSTEM}\n\n${memory}` : SYSTEM }] },
        contents: turns.map((m, i) => ({
          role: m.role,
          parts: [
            ...(i === turns.length - 1 && m.role === 'user' && extraParts?.length
              ? [{ text: m.text }, ...extraParts]
              : // A page given earlier is only its address now: the talk about it goes on with Gemini opening it again.
                [{ text: m.text + pagesOf(m) }]),
            // A YouTube address in the user's own words is WATCHED (2026-10-30, the user: «він не може бачити відео»): the API takes the
            // address as a file, the way the thoughts' video summary does - the last video of the last message only.
            ...(i === turns.length - 1 && m.role === 'user' && toWatch ? [{ fileData: { fileUri: toWatch.url } }, { text: NOTE_ASK }] : []),
          ],
        })),
        // A page given as an address (now, or earlier in the talk): Gemini opens it itself.
        ...(() => {
          const tools: object[] = [];
          if (extraParts?.some((p) => 'text' in p && p.text.includes(READ_BY_URL)) || turns.some((m) => pagesOf(m))) tools.push({ url_context: {} });
          // A video in the last message: Gemini may also search the web, to find the app it names in a store (the first try, 2026-10-30).
          if (toWatch || notes.length > 0) tools.push({ google_search: {} });
          return tools.length ? { tools } : {};
        })(),
      }),
    });
  } catch {
    throw new GeminiError('Немає звʼязку з Gemini - перевір інтернет');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new GeminiError((data?.error?.message as string | undefined) ?? `Gemini відповів ${response.status}`, response.status);
  const usage = data?.usageMetadata;
  recordGemini('text', GEMINI_MODEL, usage);
  const parts = data?.candidates?.[0]?.content?.parts as { text?: string }[] | undefined;
  const text = parts?.map((p) => p.text ?? '').join('').trim();
  if (!text) throw new GeminiError('Gemini не дав відповіді - можливо, запит потрапив під фільтр безпеки');
  // The note rides at the end of the same answer: kept by the video's id, never shown.
  const at = text.indexOf(NOTE_MARK);
  if (at >= 0) {
    const note = text.slice(at + NOTE_MARK.length).trim();
    if (toWatch && note.length > 200) AsyncStorage.setItem(noteKey(toWatch.id), note).catch(() => {});
    return { text: text.slice(0, at).trim() || text, costUsd: costOfGemini(GEMINI_MODEL, usage) };
  }
  return { text, costUsd: costOfGemini(GEMINI_MODEL, usage) };
}

function pagesOf(m: AssistantMessage): string {
  const pages = (m.attachments ?? []).filter((a) => a.kind === 'link' && a.url);
  return pages.length ? `\n\n(Додані сторінки: ${pages.map((a) => `«${a.name}» ${a.url}`).join(', ')})` : '';
}

// «ВПОРЯДКУВАТИ» (2026-10-29): the conversation is laid out by topic. The unit is a PAIR - the person's message with the answers
// after it (an answer without its question means nothing) - and a follow-up («а дешевше?») stays with the pair before it.
// The AI gets only the first lines of each pair and the topics it already named (so a topic come back to keeps its name);
// it answers which pairs go under which topic. Nothing moves here - sortPlan only says, applySort lays it out.
export type ChatPair = { ids: string[]; question: string; answer: string; at: number };
export function pairsOf(chat: AssistantChat): ChatPair[] {
  const pairs: ChatPair[] = [];
  for (const m of chat.messages) {
    const line = m.text.replace(/\s+/g, ' ').trim();
    if (m.role === 'user' || pairs.length === 0) {
      pairs.push({ ids: [m.id], question: m.role === 'user' ? line : '', answer: m.role === 'user' ? '' : line, at: m.at });
    } else {
      const p = pairs[pairs.length - 1];
      p.ids.push(m.id);
      if (!p.answer && !m.error) p.answer = line;
    }
  }
  return pairs;
}
export type SortPlan = { sections: ChatSection[]; pairSection: number[]; costUsd: number };
export async function sortPlan(chat: AssistantChat): Promise<SortPlan> {
  const pairs = pairsOf(chat);
  const known = chat.sections ?? [];
  const list = pairs
    .map((p, i) => `${i + 1} | Л: ${p.question.slice(0, 140) || '-'} | ШІ: ${p.answer.slice(0, 90) || '-'}`)
    .join('\n');
  const prompt = `Ось розмова людини з ШІ, розбита на пари (повідомлення людини + відповідь), за часом. Згрупуй пари за темами, щоб розмову було зручно читати по темах.
Правила:
- від 1 до 8 тем; назва теми 1-4 слова, мовою розмови, без лапок і крапки;
- уточнення до попередньої пари («а дешевше?», «а детальніше?», «а якщо…») - у ту саму тему, що й пара перед ним;
- якщо тема вже є серед наявних - назви її ТОЧНО так само;
- кожна пара - рівно в одній темі; теми впорядкуй за першою своєю парою.
Наявні теми: ${known.length ? known.map((t) => t.title).join('; ') : '(немає)'}
Пари:
${list}
Відповідь - лише JSON: {"themes":[{"title":"...","pairs":[1,2,5]}]}`;
  const { text, costUsd } = await askCosted(prompt, { json: true });
  let themes: { title?: unknown; pairs?: unknown }[] = [];
  try {
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    themes = Array.isArray(parsed?.themes) ? parsed.themes : [];
  } catch {
    throw new GeminiError('ШІ відповів не так, як треба. Спробуй ще раз.');
  }
  const sections: ChatSection[] = [];
  const pairSection = pairs.map(() => -1);
  for (const t of themes) {
    const title = typeof t.title === 'string' ? t.title.trim().slice(0, 60) : '';
    if (!title || !Array.isArray(t.pairs)) continue;
    // A topic it named before keeps its id (and so the name the person may have given it).
    const same = known.find((k) => k.title.toLowerCase() === title.toLowerCase());
    let at = sections.findIndex((x) => x.title.toLowerCase() === title.toLowerCase());
    if (at < 0) {
      sections.push(same ?? { id: `sec-${Date.now().toString(36)}-${sections.length}`, title });
      at = sections.length - 1;
    }
    for (const n of t.pairs) if (typeof n === 'number' && n >= 1 && n <= pairs.length && pairSection[n - 1] < 0) pairSection[n - 1] = at;
  }
  // A pair it left out goes with the pair before it - a follow-up, most likely.
  if (sections.length === 0) sections.push({ id: `sec-${Date.now().toString(36)}-0`, title: 'Розмова' });
  for (let i = 0; i < pairSection.length; i++) if (pairSection[i] < 0) pairSection[i] = i > 0 ? pairSection[i - 1] : 0;
  return { sections, pairSection, costUsd };
}
// The plan laid out on the conversation as it is NOW: messages that came while the AI was thinking stay under «Нове».
export function applySort(chat: AssistantChat, planFor: AssistantChat, plan: SortPlan): AssistantChat {
  const pairs = pairsOf(planFor);
  const sectionOf = new Map<string, string>();
  pairs.forEach((p, i) => p.ids.forEach((id) => sectionOf.set(id, plan.sections[plan.pairSection[i]].id)));
  const used = plan.sections.filter((sec) => [...sectionOf.values()].includes(sec.id));
  const sortedIds = used.flatMap((sec) => planFor.messages.filter((m) => sectionOf.get(m.id) === sec.id).map((m) => m.id));
  return {
    ...chat,
    sections: used,
    sortedIds,
    messages: chat.messages.map((m) => (sectionOf.has(m.id) ? { ...m, sectionId: sectionOf.get(m.id) } : m)),
  };
}

// A one-shot request (no conversation) with its price, for what the board window asks of the AI: deepen a card, branch it.
// `json`: the answer is JSON only. Throws GeminiError with a message to show as it is.
export async function askCosted(prompt: string, options: { json?: boolean } = {}): Promise<{ text: string; costUsd: number }> {
  const key = await getGeminiKey();
  if (!key) throw new GeminiError('Немає ключа Gemini на цьому пристрої. Додайте його в Налаштуваннях.');
  let response: Response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        ...(options.json ? { generationConfig: { responseMimeType: 'application/json' } } : {}),
      }),
    });
  } catch {
    throw new GeminiError('Немає звʼязку з Gemini - перевір інтернет');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new GeminiError((data?.error?.message as string | undefined) ?? `Gemini відповів ${response.status}`, response.status);
  const usage = data?.usageMetadata;
  recordGemini('text', GEMINI_MODEL, usage);
  const parts = data?.candidates?.[0]?.content?.parts as { text?: string }[] | undefined;
  const text = parts?.map((p) => p.text ?? '').join('').trim();
  if (!text) throw new GeminiError('Gemini не дав відповіді - можливо, запит потрапив під фільтр безпеки');
  return { text, costUsd: costOfGemini(GEMINI_MODEL, usage) };
}

// DELETING A CONVERSATION (2026-10-24): what it owns (its notes and boards) goes first, then its own document; a failure on the
// way leaves the conversation in place to try again. The copy kept on the phone goes only if it is this one.
// «ПЕРЕНЕСТИ ТУДИ» (2026-10-29): a conversation just begun turns out to belong to an older one - its messages are added at
// that one's end, in their order, and the new one is gone. Returns the older one as it is now, or null if it is not there.
export async function mergeInto(targetId: string, from: AssistantChat): Promise<AssistantChat | null> {
  const target = await loadChatById(targetId);
  if (!target) return null;
  const have = new Set(target.messages.map((m) => m.id));
  const merged: AssistantChat = { ...target, messages: [...target.messages, ...from.messages.filter((m) => !have.has(m.id)).map(({ sectionId: _s, ...m }) => m)] };
  saveChat(merged);
  await deleteChat(from.id);
  return merged;
}

export async function deleteChat(chatId: string): Promise<void> {
  await deleteChatObjects(chatId);
  await deleteDoc(doc(db, COLLECTION, chatId));
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw && (JSON.parse(raw) as { id?: string }).id === chatId) await AsyncStorage.removeItem(KEY);
  } catch {
    // The phone's copy is only a quick start; the next open makes a fresh conversation anyway.
  }
}

// FIRST MESSAGE -> A CONVERSATION IT CONTINUES (2026-10-24, sketch 13): one cheap request over the titles and summaries of the
// other conversations. The answer is a chat's id only when the model is sure; any doubt, no conversations, or no key is «none»
// and costs nothing.
export function parseRouteAnswer(text: string, ids: string[]): string | null {
  try {
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')) as { chatId?: unknown; confident?: unknown };
    const id = typeof parsed.chatId === 'string' ? parsed.chatId : null;
    return id && parsed.confident === true && ids.includes(id) ? id : null;
  } catch {
    return null;
  }
}
export function routePrompt(message: string, chats: ChatSummary[]): string {
  const list = chats.map((c) => `${c.id} | ${c.title}${c.summary ? ` | ${c.summary.replace(/\s+/g, ' ').slice(0, 160)}` : ''}`).join('\n');
  return `Людина починає нову розмову першим повідомленням. Визнач, чи воно ПРОДОВЖУЄ одну з її існуючих розмов (та сама тема), щоб не плодити схожі розмови.
Розмови (id | назва | зведення):
${list}

Перше повідомлення: «${message.replace(/\s+/g, ' ').slice(0, 600)}»

Відповідай лише JSON: {"chatId": "id розмови або null", "confident": true або false}. confident = true лише коли тема справді та сама; при будь-якому сумніві null і false.`;
}
export async function routeFirstMessage(message: string, chats: ChatSummary[]): Promise<{ chatId: string | null; costUsd: number }> {
  const pool = chats.filter((c) => c.count > 0);
  if (!message.trim() || pool.length === 0) return { chatId: null, costUsd: 0 };
  if (!(await getGeminiKey())) return { chatId: null, costUsd: 0 };
  const { text, costUsd } = await askCosted(routePrompt(message, pool), { json: true });
  return { chatId: parseRouteAnswer(text, pool.map((c) => c.id)), costUsd };
}

// Fields of ANOTHER conversation than the open one (the list's rows: a folder, an instruction, a new name), written to the
// database only - saveChat would also make it «the last one» on this phone. `undefined` removes the field.
export async function updateChatFields(chatId: string, fields: { instruction?: string; folderId?: string; customTitle?: string; themeId?: string }): Promise<void> {
  // No new date: a name, a theme or a folder is not a new word in the talk (the list is ordered by the last message).
  const patch: Record<string, unknown> = {};
  (Object.keys(fields) as (keyof typeof fields)[]).forEach((k) => {
    patch[k] = fields[k] === undefined || fields[k] === '' ? deleteField() : fields[k];
  });
  // The list reads `title`: a new name is the title at once.
  if (fields.customTitle?.trim()) patch.title = fields.customTitle.trim();
  await setDoc(doc(db, COLLECTION, chatId), patch, { merge: true });
}

// ---- THE CHAT THEMES (features.aiHome, 2026-10-29) ----------------------------------------------------------------------------
// The places on the AI's first screen: a few broad themes the person keeps (the user: «простий список і теми для об'єднання
// чатів»). Kept in the account, like the conversations.
export type ChatTheme = { id: string; name: string; color: string; createdAt: number };
const THEMES = 'assistantThemes';
export const THEME_COLORS = ['#E89A62', '#55B5A6', '#E1B53E', '#8FA6F0', '#D98BB5', '#9BBE6A', '#B99BF2', '#7FB8D9'];

export function listenThemes(on: (themes: ChatTheme[]) => void): () => void {
  return onSnapshot(
    ownedQuery(THEMES),
    (snap) =>
      on(
        snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<ChatTheme, 'id'>) }))
          .filter((t) => typeof t.name === 'string' && t.name.trim())
          .sort((a, b) => a.name.localeCompare(b.name))
      ),
    listenError('assistantThemes')
  );
}
export async function createTheme(name: string, taken: ChatTheme[]): Promise<ChatTheme> {
  const theme: ChatTheme = { id: `theme-${Date.now()}`, name: name.trim(), color: THEME_COLORS[taken.length % THEME_COLORS.length], createdAt: Date.now() };
  await setDoc(doc(db, THEMES, theme.id), { name: theme.name, color: theme.color, createdAt: theme.createdAt });
  return theme;
}

// WHICH CONVERSATION THIS LOOKS LIKE, on the phone (no AI, no cost): the words of the draft against each conversation's title
// and summary. A match needs two shared words, or one long one in a short draft; null otherwise.
const STOP = new Set(['який', 'яка', 'яке', 'які', 'щоб', 'чому', 'коли', 'тому', 'якщо', 'мені', 'тобі', 'тебе', 'мене', 'його', 'вона', 'вони', 'буде', 'було', 'треба', 'можна', 'about', 'what', 'with', 'this', 'that', 'from', 'have', 'then']);
export function wordsOf(text: string): string[] {
  // Short words are noise - except an abbreviation in capitals (RAG, API, CRM), often the very thing a talk is about
  // (2026-10-29: «Test RAG vector database cost» found no «Test RAG: what is RAG…»).
  return (text.match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((w) => (w.length >= 4 || (w.length >= 2 && /\p{L}/u.test(w) && w === w.toUpperCase())) && !STOP.has(w.toLowerCase()))
    .map((w) => w.toLowerCase().slice(0, 6));
}
export function similarChat(draft: string, chats: ChatSummary[]): ChatSummary | null {
  const mine = new Set(wordsOf(draft));
  if (mine.size === 0) return null;
  let best: { chat: ChatSummary; score: number } | null = null;
  chats.forEach((c) => {
    if (c.count === 0) return;
    const theirs = new Set(wordsOf(`${c.title} ${c.summary ?? ''}`));
    let score = 0;
    mine.forEach((w) => theirs.has(w) && (score += 1));
    if (score > 0 && (!best || score > best.score || (score === best.score && c.updatedAt > best.chat.updatedAt))) best = { chat: c, score };
  });
  if (!best) return null;
  const b = best as { chat: ChatSummary; score: number };
  return b.score >= 2 || (b.score === 1 && mine.size <= 2) ? b.chat : null;
}
// The themes a message most looks like, by the conversations already in them (best first).
export function likelyThemes(text: string, chats: ChatSummary[], themes: ChatTheme[]): ChatTheme[] {
  const mine = new Set(wordsOf(text));
  const scored = themes.map((t) => {
    const words = new Set(wordsOf(`${t.name} ${chats.filter((c) => c.themeId === t.id).map((c) => c.title).join(' ')}`));
    let score = 0;
    mine.forEach((w) => words.has(w) && (score += 1));
    return { t, score };
  });
  return scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score).map((x) => x.t);
}
export async function renameThemeTo(id: string, name: string): Promise<void> {
  await setDoc(doc(db, THEMES, id), { name: name.trim() }, { merge: true });
}
// The theme goes; its conversations stay, without a theme.
export async function deleteTheme(id: string, chats: ChatSummary[]): Promise<void> {
  await Promise.all(chats.filter((c) => c.themeId === id).map((c) => updateChatFields(c.id, { themeId: undefined })));
  await deleteDoc(doc(db, THEMES, id));
}
