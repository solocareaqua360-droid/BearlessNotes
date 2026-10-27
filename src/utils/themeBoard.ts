import { doc, getDoc, setDoc } from '../firestore';
import { auth, db } from '../firebase';
import { keyedAll } from './boardStorage';
import { generateId } from './documentBlocks';
import { WORLD_CENTER } from './boardLayout';
import type { BoardCard, BoardConnection } from '../types';
import type { Thought, ThoughtTheme } from '../hooks/useThoughts';

// A THOUGHT THEME'S BOARD (2026-10-27, the user: «в ідеалі зробити дошку погоджуюсь, але і досвід ai забувати не треба»;
// sketch https://claude.ai/artifact/1XYk7HtpYRD3STnKsxeGG8). The theme's canvas is a real board now - zoom, arrows, frames,
// selection, everything the board can - built on the same ground as the AI chat's boards: the board BELONGS to the theme
// (owner {kind:'theme'}), so it is left out of the lists and the search (chatOwned.isTucked), and it reads as a note
// through the same tree (structureTree). Its id is made from the theme's, so it is found without a query and never made
// twice. Thoughts stay THOUGHTS: a card points at one (`type: 'thought'`), live; the arrows between them are the thoughts'
// links (BoardScreen mirrors them), which is what the network of neurons draws.

export const themeBoardId = (themeId: string) => `theme_${themeId}`;
export const themeIdOfBoard = (boardId: string | undefined) => (boardId?.startsWith('theme_') ? boardId.slice(6) : null);
export const thoughtCardId = (thoughtId: string) => `th_${thoughtId}`;
export const THOUGHT_CARD_W = 220;

export function thoughtCard(t: Thought, x: number, y: number): BoardCard {
  return { id: thoughtCardId(t.id), type: 'thought', thoughtId: t.id, text: '', createdAt: Date.now(), x, y, width: THOUGHT_CARD_W };
}

// The old canvas kept a place as fractions of a screen-sized surface; spread over a board that is a little wider and
// taller, so the bigger cards do not land on each other. Not placed there yet: two columns, in the order they came.
function layoutFromCanvas(mine: Thought[]): Map<string, { x: number; y: number }> {
  const AW = 600;
  const AH = 680;
  const left = WORLD_CENTER - AW / 2;
  const top = WORLD_CENTER - AH / 2;
  const out = new Map<string, { x: number; y: number }>();
  let k = 0;
  [...mine]
    .sort((a, b) => a.createdAt - b.createdAt)
    .forEach((t) => {
      if (t.x != null && t.y != null) out.set(t.id, { x: Math.round(left + t.x * AW), y: Math.round(top + t.y * AH) });
      else {
        out.set(t.id, { x: left + (k % 2) * (THOUGHT_CARD_W + 30), y: top + AH + 60 + Math.floor(k / 2) * 200 });
        k++;
      }
    });
  return out;
}

// The board for a theme, made the first time it is opened, with the theme's thoughts laid out the way its canvas had
// them and their links as lines (what an AI card was made from: an arrow into it). Returns its id. Without a network
// the board is still opened: what is missing, the board itself adds (BoardScreen's sync) and the owner is written here,
// so it never shows up in the lists.
export async function ensureThemeBoard(theme: ThoughtTheme, thoughts: Thought[]): Promise<string> {
  const id = themeBoardId(theme.id);
  const ref = doc(db, 'boards', id);
  const uid = auth.currentUser?.uid;
  const owner = { kind: 'theme', id: theme.id };
  let exists: boolean | null = null;
  try {
    const snap = await getDoc(ref);
    exists = (snap as unknown as { exists: () => boolean }).exists();
  } catch {
    exists = null;
  }
  if (exists) return id;
  const now = Date.now();
  if (exists === null) {
    await setDoc(ref, { title: theme.name, owner, updatedAt: now, ...(uid ? { ownerId: uid } : {}) }, { merge: true }).catch(() => {});
    return id;
  }
  const mine = thoughts.filter((t) => t.themeId === theme.id);
  const places = layoutFromCanvas(mine);
  const cards = mine.map((t) => thoughtCard(t, places.get(t.id)!.x, places.get(t.id)!.y));
  const ids = new Set(mine.map((t) => t.id));
  const seen = new Set<string>();
  const connections: BoardConnection[] = [];
  mine.forEach((t) => {
    (t.from ?? []).forEach((f) => {
      if (!ids.has(f) || seen.has(`${f}|${t.id}`)) return;
      seen.add(`${f}|${t.id}`).add(`${t.id}|${f}`);
      connections.push({ id: generateId(), fromCardId: thoughtCardId(f), toCardId: thoughtCardId(t.id), kind: 'arrow' });
    });
  });
  mine.forEach((t) => {
    t.links.forEach((l) => {
      if (!ids.has(l) || seen.has(`${t.id}|${l}`)) return;
      seen.add(`${t.id}|${l}`).add(`${l}|${t.id}`);
      connections.push({ id: generateId(), fromCardId: thoughtCardId(t.id), toCardId: thoughtCardId(l) });
    });
  });
  await setDoc(ref, {
    title: theme.name,
    cards: keyedAll(cards),
    shapes: {},
    connections: keyedAll(connections),
    owner,
    createdAt: now,
    updatedAt: now,
    ...(uid ? { ownerId: uid } : {}),
  }).catch(() => {});
  return id;
}
