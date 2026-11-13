import { collection, doc, getDoc, getDocs, writeBatch } from '../firestore';
import { auth, db } from '../firebase';
import { addDoc, ownedQuery } from './owned';
import { Block, FlashcardImage, Group } from '../types';
import { groupAppliesTo, groupKindFields } from './groups';
import { plainTextOf } from './documentBlocks';
import { ask, notify } from '../components/surfaces/Ask';

const GROUP_COLORS = ['#3B82F6', '#16A34A', '#8B5CF6', '#F97316', '#EC4899', '#14B8A6', '#EAB308'];
// How many existing decks the question offers by name before it would
// stop being a question and start being a list.
const OFFERED_DECKS = 4;

type Draft = { term: string; explanation: string; images: { blockId: string; uri: string; driveFileId?: string }[] };

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// A block's words as they read, without the formatting markers - a list
// item keeps its bullet, so an explanation made of one still reads as a
// list.
function lineOf(block: Block): string | null {
  const type = block.type ?? 'paragraph';
  const text = plainTextOf(block.text ?? '');
  if (type === 'paragraph' || type === 'heading' || type === 'code' || type === 'toggle') return text;
  if (type === 'bulleted') return `• ${text}`;
  if (type === 'numbered') return text;
  if (type === 'checkbox') return `${block.checked ? '☑' : '☐'} ${text}`;
  return null;
}

// THE USER'S RULE, word for word: a BOLD line parts one card from the
// next; a THIN line parts a card's term from its explanation. Every
// picture between two bold lines belongs to that card, wherever it
// stands - above the term, in the middle of the explanation or at the
// end - in the order the note has them.
//
// Only the first thin line in a card splits it; any after that are part
// of the explanation (kept as an empty line). A card with no thin line
// is all term.
export function draftCardsFrom(blocks: Block[]): Draft[] {
  const drafts: Draft[] = [];
  let term: string[] = [];
  let explanation: string[] = [];
  let images: Draft['images'] = [];
  let pastThin = false;
  const flush = () => {
    const t = term.join('\n').trim();
    const e = explanation.join('\n').trim();
    if (t || e || images.length > 0) drafts.push({ term: t, explanation: e, images });
    term = [];
    explanation = [];
    images = [];
    pastThin = false;
  };
  for (const block of blocks) {
    const type = block.type ?? 'paragraph';
    if (type === 'divider') {
      if (block.dividerStyle === 'bold') flush();
      else if (!pastThin) pastThin = true;
      else explanation.push('');
      continue;
    }
    if (type === 'image') {
      if (block.imageUri) images.push({ blockId: block.id, uri: block.imageUri, driveFileId: block.driveFileId });
      continue;
    }
    const line = lineOf(block);
    if (line === null) continue;
    (pastThin ? explanation : term).push(line);
  }
  flush();
  return drafts;
}

// "Створити 14 карток?" - and into which deck. The note's own name is
// offered as a new deck, since a note turned into cards usually IS one.
// Resolves to whether any were made and whether to go and look at them.
export async function createFlashcardsFromNote(blocks: Block[], noteTitle: string): Promise<'open' | 'done' | 'none'> {
  const drafts = draftCardsFrom(blocks);
  if (drafts.length === 0) {
    await notify(
      'Немає з чого зробити картки',
      'Жирна лінія відділяє одну картку від іншої, тонка - термін від пояснення.'
    );
    return 'none';
  }

  const groupsSnapshot = await getDocs(ownedQuery('groups'));
  const decks = groupsSnapshot.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<Group, 'id'>) }))
    .filter((g) => groupAppliesTo(g, 'flashcard'));
  const title = noteTitle.trim();
  const sameName = title ? decks.find((g) => g.name.trim().toLowerCase() === title.toLowerCase()) : undefined;
  const offered = [...(sameName ? [sameName] : []), ...decks.filter((g) => g !== sameName)].slice(0, OFFERED_DECKS);
  const count = drafts.length;
  const noun = count % 10 === 1 && count % 100 !== 11 ? 'картку' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? 'картки' : 'карток';
  const choice = await ask({
    title: `Створити ${count} ${noun}?`,
    message: 'У який проект їх покласти',
    actions: [
      ...(title && !sameName ? [{ id: 'new', label: `Новий проект «${title}»` }] : []),
      ...offered.map((g) => ({ id: `group:${g.id}`, label: `«${g.name}»` })),
      { id: 'none', label: 'Без проекту' },
    ],
    cancelLabel: 'Скасувати',
  });
  if (choice !== 'new' && choice !== 'none' && !choice.startsWith('group:')) return 'none';

  let groupId: string | null = null;
  if (choice === 'new') {
    const created = await addDoc(collection(db, 'groups'), {
      name: title,
      color: GROUP_COLORS[decks.length % GROUP_COLORS.length],
      ...groupKindFields(['flashcard']),
    });
    groupId = created.id;
  } else if (choice.startsWith('group:')) {
    groupId = choice.slice('group:'.length);
  }

  // A picture's Drive copy lives on its photo record (keyed by the block's
  // id), not on the block - read it so the card can be shown on another
  // device too.
  const images = drafts.flatMap((d) => d.images).filter((i) => !i.driveFileId);
  const driveIds = new Map<string, { driveFileId?: string; driveBytes?: number }>();
  await Promise.all(
    images.map(async (image) => {
      try {
        const snapshot = await getDoc(doc(db, 'photos', image.blockId));
        const data = snapshot.data();
        if (data?.driveFileId) driveIds.set(image.blockId, { driveFileId: data.driveFileId, driveBytes: data.driveBytes });
      } catch {
        // No record, or not readable: the card keeps the local picture.
      }
    })
  );

  const now = Date.now();
  const batch = writeBatch(db);
  drafts.forEach((draft, i) => {
    const cardImages: FlashcardImage[] = draft.images.map((image) => {
      const drive = image.driveFileId ? { driveFileId: image.driveFileId } : driveIds.get(image.blockId);
      return { uri: image.uri, ...(drive?.driveFileId ? drive : {}) };
    });
    batch.set(doc(db, 'flashcards', generateId()), {
      term: draft.term,
      explanation: draft.explanation,
      images: cardImages,
      tagIds: [],
      ...(groupId ? { groupId } : {}),
      // One apart, so "by date" keeps the note's own order.
      createdAt: now + i,
      updatedAt: now + i,
      // By hand: a batched write does not go through utils/owned.
      ownerId: auth.currentUser?.uid ?? null,
    });
  });
  await batch.commit();

  const opened = await ask({
    title: `Готово: ${count} ${noun}`,
    actions: [{ id: 'open', label: 'Відкрити картки' }],
    cancelLabel: 'Залишитись у нотатці',
  });
  return opened === 'open' ? 'open' : 'done';
}
