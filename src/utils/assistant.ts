import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, getDoc, getDocs } from '../firestore';
import { db } from '../firebase';
import { ownedQuery, setDoc } from './owned';
import { GEMINI_MODEL, GeminiError } from './gemini';
import { getGeminiKey } from './geminiKey';
import { costOfGemini, recordGemini } from './geminiUsage';

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

export type AssistantMessage = { id: string; role: 'user' | 'model'; text: string; at: number; error?: boolean; costUsd?: number };
// `remembered`: block keys («messageId:index»). `groups`: what was remembered TOGETHER - several blocks picked at once
// are one memory (one block in the note). A chat kept before groups existed reads each remembered block as its own group.
export type AssistantChat = { id: string; startedAt: number; messages: AssistantMessage[]; remembered: string[]; groups?: string[][] };

export function groupsOf(chat: AssistantChat): string[][] {
  return chat.groups ?? chat.remembered.map((k) => [k]);
}

const KEY = 'assistant.chat.v1';
const COLLECTION = 'assistantChats';
const MAX_TURNS = 24;

const SYSTEM = `Ти співрозмовник у застосунку нотаток цієї людини. Говори українською, просто й по-людськи, як уважний розумний друг.
Підлаштовуйся під розмову сам, без перемикачів: коли людина планує, досліджує чи розбирається в темі, відповідай ясно й по суті; коли ділиться переживаннями, відповідай тепло й уважно, не поспішай з порадами, поки не попросить.
Відповідай КОРОТКИМИ СМИСЛОВИМИ АБЗАЦАМИ по 1-4 речення, розділеними порожнім рядком. Кожен абзац - одна думка, щоб його можна було окремо запам'ятати.
Без Markdown: без зірочок, решіток, таблиць. Нумерований чи маркований список - лише коли людина прямо попросить.
Не вигадуй фактів: не знаєш - так і скажи. Не став діагнозів; якщо людині тривалий час погано, м'яко порадь поговорити з живим фахівцем.`;

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
  const first = chat.messages.find((m) => m.role === 'user')?.text ?? '';
  const clean = first.replace(/\s+/g, ' ').trim();
  return !clean ? 'Нова розмова' : clean.length > 70 ? `${clean.slice(0, 67).trim()}…` : clean;
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
    })),
    remembered: chat.remembered,
    groups: groupsOf(chat).map((keys) => ({ keys })),
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
  };
}

export function saveChat(chat: AssistantChat): void {
  AsyncStorage.setItem(KEY, JSON.stringify(chat)).catch(() => {});
  // An empty conversation is not worth a document.
  if (chat.messages.length === 0) return;
  setDoc(doc(db, COLLECTION, chat.id), toStored(chat)).catch(() => {});
}

export type ChatSummary = { id: string; title: string; updatedAt: number; count: number };

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
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadChatById(id: string): Promise<AssistantChat | null> {
  const snap = await getDoc(doc(db, COLLECTION, id));
  if (!snap.exists()) return null;
  return fromStored(id, snap.data() as Record<string, unknown>);
}

// An answer as its blocks: split on empty lines; what Markdown slips through is taken off, the words stay.
export function blocksOf(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((b) =>
      b
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        .trim()
    )
    .filter(Boolean);
}

// The next answer to this conversation. Throws GeminiError with a message the screen can show as it is.
export async function askAssistant(messages: AssistantMessage[]): Promise<{ text: string; costUsd: number }> {
  const key = await getGeminiKey();
  if (!key) throw new GeminiError('Немає ключа Gemini на цьому пристрої. Додайте його в Налаштуваннях.');
  const turns = messages.filter((m) => !m.error).slice(-MAX_TURNS);
  let response: Response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: turns.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
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
