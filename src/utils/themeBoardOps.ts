import { finishAiCard, startAiCard, type Thought } from '../hooks/useThoughts';
import { askAboutThoughts, branchThought, deepenThought, summarizeThoughts } from './thoughtAI';

// THE AI ON A THEME BOARD'S PICKED THOUGHTS (sketch artboard «Виділені думки», menu «ШІ»). Each answer is a thought of the
// theme, an AI card: it stands at once as «Пишу…» (so nothing hangs on the network) and the board puts it under the
// cards it came from, with an arrow from each (useThemeBoard); the call then fills it in, or marks it failed.
async function run(themeId: string, ai: 'summary' | 'answer' | 'deepen', from: Thought[], work: () => Promise<string>, question?: string) {
  const id = await startAiCard({ themeId, ai, question, from: from.map((t) => t.id) }).catch(() => undefined);
  if (!id) return;
  try {
    await finishAiCard(id, { text: await work() });
  } catch (e) {
    await finishAiCard(id, { error: (e as Error).message }).catch(() => {});
  }
}

const usable = (list: Thought[]) => list.filter((t) => !t.aiState);

export const summarizeOnBoard = (themeId: string, picked: Thought[]) => {
  const list = usable(picked);
  return list.length ? run(themeId, 'summary', list, () => summarizeThoughts(list)) : Promise.resolve();
};

export const askOnBoard = (themeId: string, picked: Thought[], question: string) => {
  const list = usable(picked);
  return list.length && question.trim() ? run(themeId, 'answer', list, () => askAboutThoughts(list, question.trim()), question.trim()) : Promise.resolve();
};

// One card per picked thought, each from its own.
export const deepenOnBoard = (themeId: string, picked: Thought[]) =>
  Promise.all(usable(picked).map((t) => run(themeId, 'deepen', [t], () => deepenThought(t))));

// A few directions out of each picked thought: the first card stands while the AI thinks, the rest come with the answer.
export async function branchOnBoard(themeId: string, picked: Thought[]) {
  await Promise.all(
    usable(picked).map(async (t) => {
      const first = await startAiCard({ themeId, ai: 'branch', from: [t.id] }).catch(() => undefined);
      if (!first) return;
      try {
        const lines = await branchThought(t);
        if (lines.length === 0) throw new Error('ШІ не запропонував напрямів');
        await finishAiCard(first, { text: lines[0] });
        for (const line of lines.slice(1)) {
          const id = await startAiCard({ themeId, ai: 'branch', from: [t.id] }).catch(() => undefined);
          if (id) await finishAiCard(id, { text: line }).catch(() => {});
        }
      } catch (e) {
        await finishAiCard(first, { error: (e as Error).message }).catch(() => {});
      }
    })
  );
}
