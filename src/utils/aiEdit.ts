import { askCosted } from './assistant';

// THE AI ON CHOSEN BLOCKS (2026-10-24, sketch V4 «Що зробити з виділеним…»): the blocks go as Markdown (utils/blocksText), the
// answer comes back as Markdown and becomes blocks again through the paste reader (utils/pasteBlocks) - so a table asked for
// arrives as a REAL table block. Nothing in the note changes until «Залишити».
//
// Each round sends only the original, the last version the person saw and what they ask now - never the rounds before: the
// fifth costs like the first.

export type AiEditRound = { ask: string; text: string; costUsd: number };

export async function askEdit(original: string, ask: string, last?: string): Promise<{ text: string; costUsd: number }> {
  const prompt = [
    'Ти редагуєш фрагмент нотатки людини. Поверни ЛИШЕ новий текст фрагмента в Markdown: без пояснень, без вступу, без ``` навколо.',
    'Пиши мовою оригіналу. Нічого не вигадуй понад те, що є в тексті, якщо людина не просить додати.',
    'Можна: заголовки (#, ##, ###), списки (- , 1. ), чекбокси (- [ ] ), **жирний**, *курсив*.',
    'Якщо людина просить таблицю - поверни Markdown-таблицю (| A | B | і рядок |---|---| під шапкою), за потреби з коротким рядком до чи після неї.',
    '',
    'ОРИГІНАЛ:',
    original,
    ...(last && last !== original ? ['', 'ОСТАННЯ ВЕРСІЯ, ЯКУ ЛЮДИНА БАЧИЛА (зміни роби від неї, якщо прохання не каже почати з оригіналу):', last] : []),
    '',
    `ПРОХАННЯ: ${ask}`,
  ].join('\n');
  const { text, costUsd } = await askCosted(prompt);
  return { text: unfence(text), costUsd };
}

// A model that wraps its whole answer in a ``` fence anyway: the fence goes, the text stays.
function unfence(text: string): string {
  const m = text.trim().match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
  return (m ? m[1] : text).trim();
}
