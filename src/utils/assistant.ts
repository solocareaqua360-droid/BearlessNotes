import AsyncStorage from '@react-native-async-storage/async-storage';
import { GEMINI_MODEL, GeminiError } from './gemini';
import { getGeminiKey } from './geminiKey';
import { costOfGemini, recordGemini } from './geminiUsage';

// THE ASSISTANT'S CONVERSATION (step 1, 2026-10-22; plan in the project memory «project_ai_tree_notes»): one living
// conversation opened from the start desks, answers in BLOCKS (one thought each, like the app's own blocks), a block held
// is remembered, asked about in more detail or copied. One conversation, no modes: the AI follows the tone itself -
// clear and structured when the user plans, warm and attentive when he shares what he feels.
//
// Kept on THIS phone for now (AsyncStorage): the trial is the phone's, where the Gemini key is.
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
    if (raw) return { ...newChat(), ...(JSON.parse(raw) as AssistantChat) };
  } catch {
    // A broken record: start afresh rather than not at all.
  }
  return newChat();
}

export function saveChat(chat: AssistantChat): void {
  AsyncStorage.setItem(KEY, JSON.stringify(chat)).catch(() => {});
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
