import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteDoc, deleteField, doc, getDoc, getDocs } from '../firestore';
import { db } from '../firebase';
import { ownedQuery, setDoc } from './owned';
import { GEMINI_MODEL, GeminiError, READ_BY_URL, askGemini } from './gemini';
import { getGeminiKey } from './geminiKey';
import { costOfGemini, recordGemini } from './geminiUsage';
import { deleteChatObjects } from './chatObjects';

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
export type AssistantMessage = { id: string; role: 'user' | 'model'; text: string; at: number; error?: boolean; costUsd?: number; topicId?: string; structure?: AssistantStructure; attachments?: AssistantAttachment[] };
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
};

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
    updatedAt: Date.now(),
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
  };
}

export function saveChat(chat: AssistantChat): void {
  AsyncStorage.setItem(KEY, JSON.stringify(chat)).catch(() => {});
  // An empty conversation is not worth a document.
  if (chat.messages.length === 0) return;
  setDoc(doc(db, COLLECTION, chat.id), toStored(chat)).catch(() => {});
}

// `summary`/`instruction`: what the list shows and the routing reads. `userTurns`: the number of the person's own messages.
export type ChatSummary = { id: string; title: string; updatedAt: number; count: number; userTurns: number; folderId?: string; summary?: string; instruction?: string };

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
  const memory = [
    chat.instruction?.trim() ? `ІНСТРУКЦІЯ ЦІЄЇ РОЗМОВИ ВІД ЛЮДИНИ - виконуй її в кожній відповіді, поки вона діє:\n${chat.instruction.trim()}` : '',
    chat.summary ? `ЗВЕДЕННЯ ПОПЕРЕДНЬОЇ ЧАСТИНИ РОЗМОВИ:\n${chat.summary}` : '',
    memories.length ? `ЩО ЛЮДИНА ВІДІБРАЛА ЯК ВАЖЛИВЕ (тримайся цього):\n${memories.map((t) => `- ${t.replace(/\n+/g, ' ')}`).join('\n')}` : '',
    path.length ? `ЗАРАЗ РОЗМОВА В ГІЛЦІ: ${path.join(' › ')}` : '',
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
          parts:
            i === turns.length - 1 && m.role === 'user' && extraParts?.length
              ? [{ text: m.text }, ...extraParts]
              : // A page given earlier is only its address now: the talk about it goes on with Gemini opening it again.
                [{ text: m.text + pagesOf(m) }],
        })),
        // A page given as an address (now, or earlier in the talk): Gemini opens it itself.
        ...(extraParts?.some((p) => 'text' in p && p.text.includes(READ_BY_URL)) || turns.some((m) => pagesOf(m)) ? { tools: [{ url_context: {} }] } : {}),
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

function pagesOf(m: AssistantMessage): string {
  const pages = (m.attachments ?? []).filter((a) => a.kind === 'link' && a.url);
  return pages.length ? `\n\n(Додані сторінки: ${pages.map((a) => `«${a.name}» ${a.url}`).join(', ')})` : '';
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
export async function updateChatFields(chatId: string, fields: { instruction?: string; folderId?: string; customTitle?: string }): Promise<void> {
  const patch: Record<string, unknown> = { updatedAt: Date.now() };
  (Object.keys(fields) as (keyof typeof fields)[]).forEach((k) => {
    patch[k] = fields[k] === undefined || fields[k] === '' ? deleteField() : fields[k];
  });
  await setDoc(doc(db, COLLECTION, chatId), patch, { merge: true });
}
