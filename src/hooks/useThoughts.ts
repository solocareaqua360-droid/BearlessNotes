import { useEffect, useMemo, useState } from 'react';
import { arrayRemove, arrayUnion, collection, deleteDoc, deleteField, doc, onSnapshot, updateDoc, writeBatch } from '../firestore';
import { db } from '../firebase';
import { FEATURES } from '../features';
import { addDoc, ownedQuery } from '../utils/owned';
import { listenError } from '../utils/listenError';

// THE THOUGHT FLOW'S DATA (2026-10-15, the user's «хід думок»: something that caught you - a video, a text, a thought
// in the shower - is kept WITH what it made you feel, and lands in a THEME that grows and that you want to come back
// to). Two collections of their own, owner-only like everything else:
//   thoughts      - one caught thing: what it was (source), what it stirred (felt), which theme (null = not laid out yet)
//   thoughtThemes - a theme: its name, its colour, when it was last touched (the cloud's warmth)
// Saved the moment it is caught, with no network or AI in the way; summaries and voice come later, onto what is kept.

export type ThoughtSource =
  | { kind: 'link'; url: string; title?: string; imageUrl?: string; siteName?: string }
  | { kind: 'text'; text: string };

// A picture of a thought: kept in the app's own folder, and - once backed up - known to Drive by its id.
export type ThoughtImage = { uri: string; driveFileId?: string };

export type Thought = {
  id: string;
  themeId: string | null;
  felt: string;
  source?: ThoughtSource;
  // Pictures that came with it (or ARE it - a thought can arrive as a photo alone).
  images?: ThoughtImage[];
  state: 'raw' | 'ripening' | 'settled';
  createdAt: number;
  // On its theme's canvas: where it lies (fractions of the canvas, so the same layout fits the cover and the inner
  // screen; unset = not placed yet, laid out in a row) and which thoughts it is joined to by a line.
  x?: number;
  y?: number;
  links: string[];
  // Written by the assistant (thoughtAI): a summary of picked thoughts, or an answer to a question about them. While
  // it is being written the card stands as 'pending'; a failed call leaves 'error' with the reason, and a retry.
  ai?: 'summary' | 'answer';
  question?: string;
  from?: string[];
  aiState?: 'pending' | 'error';
  aiError?: string;
  // What a YouTube video is about, once Gemini has watched it (kept so it is watched once).
  videoGist?: string;
};

export type ThoughtTheme = {
  id: string;
  name: string;
  hue: number;
  createdAt: number;
  touchedAt: number;
  // «Що з цього ти вже точно знаєш?» - the theme's own conclusion, written on its canvas.
  conclusion: string;
};

// The clouds' colours: soft, of one lightness, told apart by hue (the user's «бюджет кольору»).
const SOFT_HUES: { from: string; to: string; ink: string; sub: string }[] = [
  { from: '#FDF0E0', to: '#F7DCC0', ink: '#7E4716', sub: '#9A5A1E' },
  { from: '#EEF3FA', to: '#DCE7F4', ink: '#2F5F96', sub: '#4B74A6' },
  { from: '#F4EEF9', to: '#E6DBF1', ink: '#6A4A93', sub: '#7D5EA6' },
  { from: '#EEF6F0', to: '#DCEDE2', ink: '#2E7A50', sub: '#3C8A5F' },
  { from: '#FBEEF1', to: '#F4D9E0', ink: '#8E3B54', sub: '#A04F67' },
  { from: '#ECF6F6', to: '#D5ECEC', ink: '#2A6B6B', sub: '#3B7D7D' },
  { from: '#F6F3E8', to: '#EAE3CB', ink: '#6B5A25', sub: '#7D6B36' },
];
// OUR TONES (FEATURES.ourTones): the balloons in the app's own colours - black, beige, orange, grey, white, graphite, sand.
const OUR_HUES: { from: string; to: string; ink: string; sub: string }[] = [
  { from: '#E38A52', to: '#D9793F', ink: '#FFFFFF', sub: '#FBE3D2' },
  { from: '#2E2E2B', to: '#1E1E1C', ink: '#FFFFFF', sub: '#CFCDC7' },
  { from: '#EFE7D9', to: '#E3D9C6', ink: '#3D3528', sub: '#6B5E48' },
  { from: '#E8E6E1', to: '#D9D6CF', ink: '#2E2D2A', sub: '#5C5B56' },
  { from: '#FFFFFF', to: '#F1EFEA', ink: '#1E1E1C', sub: '#6E6D68' },
  { from: '#5A5955', to: '#4A4946', ink: '#FFFFFF', sub: '#DDDBD5' },
  { from: '#E6DCC8', to: '#D8CBB1', ink: '#3D3528', sub: '#6B5E48' },
];
export const THEME_HUES = FEATURES.ourTones ? OUR_HUES : SOFT_HUES;
// On the black theme a black balloon (and the graphite one) would sink into the dark card: they turn light there.
const OUR_HUES_ON_DARK: Record<number, { from: string; to: string; ink: string; sub: string }> = {
  1: { from: '#F4F2EE', to: '#E4E1DA', ink: '#1E1E1C', sub: '#5C5B56' },
  5: { from: '#A3A19B', to: '#8E8C86', ink: '#FFFFFF', sub: '#F1F0EC' },
};
export const hueOf = (theme: { hue: number }, dark?: boolean) => {
  const i = ((theme.hue % THEME_HUES.length) + THEME_HUES.length) % THEME_HUES.length;
  return (dark && FEATURES.ourTones && OUR_HUES_ON_DARK[i]) || THEME_HUES[i];
};

const num = (v: unknown, fallback = 0) => (typeof v === 'number' ? v : fallback);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

function imagesOf(raw: unknown): ThoughtImage[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const list = raw
    .map((i) => (i && typeof i === 'object' && typeof (i as Record<string, unknown>).uri === 'string' ? ({ uri: (i as Record<string, string>).uri, driveFileId: str((i as Record<string, unknown>).driveFileId) || undefined } as ThoughtImage) : null))
    .filter((i): i is ThoughtImage => !!i);
  return list.length ? list : undefined;
}

function sourceOf(raw: unknown): ThoughtSource | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (r.kind === 'link' && typeof r.url === 'string') {
    return { kind: 'link', url: r.url, title: str(r.title) || undefined, imageUrl: str(r.imageUrl) || undefined, siteName: str(r.siteName) || undefined };
  }
  if (r.kind === 'text' && typeof r.text === 'string') return { kind: 'text', text: r.text };
  return undefined;
}

// Both lists, live. Read only where they are shown (the living folder, the space, the capture window).
export function useThoughts(enabled = true) {
  const [themes, setThemes] = useState<ThoughtTheme[]>([]);
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  // The first answer of the themes has come: before it, «no themes» only means «not heard yet» (the folder showed its empty line for a blink).
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const offThemes = onSnapshot(
      ownedQuery('thoughtThemes'),
      (snap) => {
        setLoaded(true);
        setThemes(
          snap.docs.map((d) => {
            const x = d.data();
            const createdAt = num(x.createdAt);
            return { id: d.id, name: str(x.name) || 'Без назви', hue: num(x.hue), createdAt, touchedAt: num(x.touchedAt, createdAt), conclusion: str(x.conclusion) };
          })
        );
      },
      listenError('thoughtThemes')
    );
    const offThoughts = onSnapshot(
      ownedQuery('thoughts'),
      (snap) =>
        setThoughts(
          snap.docs
            .map((d) => {
              const x = d.data();
              return {
                id: d.id,
                themeId: typeof x.themeId === 'string' ? x.themeId : null,
                felt: str(x.felt),
                source: sourceOf(x.source),
                images: imagesOf(x.images),
                state: x.state === 'ripening' || x.state === 'settled' ? x.state : 'raw',
                createdAt: num(x.createdAt),
                x: typeof x.x === 'number' ? x.x : undefined,
                y: typeof x.y === 'number' ? x.y : undefined,
                links: Array.isArray(x.links) ? (x.links as unknown[]).filter((l): l is string => typeof l === 'string') : [],
                ai: x.ai === 'summary' || x.ai === 'answer' ? x.ai : undefined,
                question: str(x.question) || undefined,
                from: Array.isArray(x.from) ? (x.from as unknown[]).filter((l): l is string => typeof l === 'string') : undefined,
                aiState: x.aiState === 'pending' || x.aiState === 'error' ? x.aiState : undefined,
                aiError: str(x.aiError) || undefined,
                videoGist: str(x.videoGist) || undefined,
              } as Thought;
            })
            .sort((a, b) => b.createdAt - a.createdAt)
        ),
      listenError('thoughts')
    );
    return () => {
      offThemes();
      offThoughts();
    };
  }, [enabled]);
  const countOf = useMemo(() => {
    const m = new Map<string | null, number>();
    thoughts.forEach((t) => m.set(t.themeId, (m.get(t.themeId) ?? 0) + 1));
    return (id: string | null) => m.get(id) ?? 0;
  }, [thoughts]);
  return { themes, thoughts, countOf, loaded };
}

export async function createTheme(name: string, hue: number): Promise<string> {
  const now = Date.now();
  const ref = await addDoc(collection(db, 'thoughtThemes'), { name: name.trim(), hue, createdAt: now, touchedAt: now });
  return ref.id;
}

// Firestore refuses `undefined` anywhere in a value: the source is written with only the fields it has.
function cleanSource(source: ThoughtSource | undefined) {
  if (!source) return null;
  return Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ''));
}

export async function saveThought(input: { felt: string; source?: ThoughtSource; images?: ThoughtImage[]; themeId: string | null }): Promise<string> {
  const now = Date.now();
  const ref = await addDoc(collection(db, 'thoughts'), {
    themeId: input.themeId,
    felt: input.felt.trim(),
    source: cleanSource(input.source),
    ...(input.images?.length ? { images: input.images.map((i) => (i.driveFileId ? { uri: i.uri, driveFileId: i.driveFileId } : { uri: i.uri })) } : {}),
    state: 'raw',
    createdAt: now,
    updatedAt: now,
  });
  if (input.themeId) await updateDoc(doc(db, 'thoughtThemes', input.themeId), { touchedAt: now }).catch(() => {});
  return ref.id;
}

export async function moveThought(id: string, themeId: string | null) {
  const now = Date.now();
  await updateDoc(doc(db, 'thoughts', id), { themeId, updatedAt: now });
  if (themeId) await updateDoc(doc(db, 'thoughtThemes', themeId), { touchedAt: now }).catch(() => {});
}

export async function deleteThought(id: string) {
  await deleteDoc(doc(db, 'thoughts', id));
}

export async function renameTheme(id: string, name: string) {
  await updateDoc(doc(db, 'thoughtThemes', id), { name: name.trim(), touchedAt: Date.now() });
}

// A theme deleted lets go of its thoughts: they stay, not laid out yet - nothing caught is lost with a theme.
export async function deleteTheme(id: string, thoughtIds: string[]) {
  const batch = writeBatch(db);
  const now = Date.now();
  thoughtIds.forEach((t) => batch.update(doc(db, 'thoughts', t), { themeId: null, updatedAt: now }));
  batch.delete(doc(db, 'thoughtThemes', id));
  await batch.commit();
}

export async function placeThought(id: string, x: number, y: number) {
  await updateDoc(doc(db, 'thoughts', id), { x, y, updatedAt: Date.now() });
}

// A line between two thoughts, kept on both (so either one knows its neighbours).
export async function linkThoughts(a: string, b: string) {
  if (a === b) return;
  const batch = writeBatch(db);
  batch.update(doc(db, 'thoughts', a), { links: arrayUnion(b) });
  batch.update(doc(db, 'thoughts', b), { links: arrayUnion(a) });
  await batch.commit();
}

export async function unlinkThought(id: string, others: string[]) {
  const batch = writeBatch(db);
  batch.update(doc(db, 'thoughts', id), { links: [] });
  others.forEach((o) => batch.update(doc(db, 'thoughts', o), { links: arrayRemove(id) }));
  await batch.commit();
}

export async function setConclusion(themeId: string, text: string) {
  await updateDoc(doc(db, 'thoughtThemes', themeId), { conclusion: text, touchedAt: Date.now() });
}

// A card the assistant will write, standing first (so nothing waits on the network to exist): placed near the picked
// cards and joined to them.
export async function startAiCard(input: {
  themeId: string | null;
  ai: 'summary' | 'answer';
  question?: string;
  from: string[];
  x?: number;
  y?: number;
}): Promise<string> {
  const now = Date.now();
  const ref = await addDoc(collection(db, 'thoughts'), {
    themeId: input.themeId,
    felt: '',
    source: null,
    state: 'raw',
    ai: input.ai,
    ...(input.question ? { question: input.question } : {}),
    from: input.from,
    aiState: 'pending',
    links: input.from,
    ...(input.x != null && input.y != null ? { x: input.x, y: input.y } : {}),
    createdAt: now,
    updatedAt: now,
  });
  const batch = writeBatch(db);
  input.from.forEach((f) => batch.update(doc(db, 'thoughts', f), { links: arrayUnion(ref.id) }));
  await batch.commit().catch(() => {});
  return ref.id;
}

export async function finishAiCard(id: string, result: { text: string } | { error: string }) {
  if ('text' in result) await updateDoc(doc(db, 'thoughts', id), { felt: result.text, aiState: deleteField(), aiError: deleteField(), updatedAt: Date.now() });
  else await updateDoc(doc(db, 'thoughts', id), { aiState: 'error', aiError: result.error, updatedAt: Date.now() });
}

export async function setVideoGist(id: string, gist: string) {
  await updateDoc(doc(db, 'thoughts', id), { videoGist: gist, updatedAt: Date.now() });
}

// A plain card written on the canvas (no source - the words are the thought).
export async function saveTextCard(input: { themeId: string | null; text: string; x?: number; y?: number }): Promise<string> {
  const now = Date.now();
  const ref = await addDoc(collection(db, 'thoughts'), {
    themeId: input.themeId,
    felt: input.text.trim(),
    source: null,
    state: 'raw',
    links: [],
    ...(input.x != null && input.y != null ? { x: input.x, y: input.y } : {}),
    createdAt: now,
    updatedAt: now,
  });
  if (input.themeId) await updateDoc(doc(db, 'thoughtThemes', input.themeId), { touchedAt: now }).catch(() => {});
  return ref.id;
}

export async function editThoughtText(id: string, text: string) {
  await updateDoc(doc(db, 'thoughts', id), { felt: text.trim(), updatedAt: Date.now() });
}

export async function markAiPending(id: string) {
  await updateDoc(doc(db, 'thoughts', id), { aiState: 'pending', aiError: deleteField(), updatedAt: Date.now() });
}
