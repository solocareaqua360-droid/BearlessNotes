import { collection, doc, getDocs, writeBatch } from '../firestore';
import { auth, db } from '../firebase';
import { ownedQuery } from './owned';
import { generateId } from './documentBlocks';
import { documentLinksIn } from './documentLinks';
import type { Block } from '../types';

// «СТВОРИТИ КОПІЮ» (2026-10-23, the user: «дай можливість копіювати нотатку щоб я зміг її змінити і показати тобі як би я її
// структурував»): the note with EVERYTHING nested in it, as new notes - every nested note a copy nested in its copy, every word
// that linked to a nested note now linking to ITS copy (a link out of the tree stays as it was). New block ids, no folders and no
// board (the copy is a note of its own, in «Нерозкладене»), the copy's title gets « (копія)». One batch: all of it or none.
// Returns the copy of the note asked for.

type Raw = { title?: string; blocks?: Block[]; owner?: { kind?: string; id?: string }; deletedAt?: number; groupId?: string };

export async function copyNoteWithNested(rootId: string): Promise<{ id: string; count: number }> {
  const snap = await getDocs(ownedQuery('documents'));
  const all = new Map<string, Raw>();
  snap.docs.forEach((d) => all.set(d.id, d.data() as Raw));
  if (!all.has(rootId)) throw new Error('Нотатку не знайдено');
  // The note and everything nested under it, parents first.
  const children = new Map<string, string[]>();
  all.forEach((data, id) => {
    if (data.owner?.kind === 'note' && data.owner.id && !data.deletedAt) children.set(data.owner.id, [...(children.get(data.owner.id) ?? []), id]);
  });
  const order: string[] = [];
  const seen = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const at = queue.shift()!;
    order.push(at);
    (children.get(at) ?? []).forEach((c) => {
      if (!seen.has(c)) {
        seen.add(c);
        queue.push(c);
      }
    });
  }
  const copyOf = new Map<string, string>(order.map((id) => [id, doc(collection(db, 'documents')).id]));
  const uid = auth.currentUser?.uid;
  const now = Date.now();
  const batch = writeBatch(db);
  const relink = (text: string) => text.replace(/\{n:([A-Za-z0-9_-]+)((?:#[A-Za-z0-9_-]+)?)\}/g, (whole, id: string, rest: string) => (copyOf.has(id) ? `{n:${copyOf.get(id)}${rest}}` : whole));
  order.forEach((id) => {
    const data = all.get(id)!;
    const blocks = (data.blocks ?? []).map((b) => {
      const next: Block = { ...b, id: generateId(), text: relink(b.text ?? '') };
      if (next.docRefId && copyOf.has(next.docRefId)) next.docRefId = copyOf.get(next.docRefId);
      return next;
    });
    const parent = data.owner?.kind === 'note' && data.owner.id ? copyOf.get(data.owner.id) : undefined;
    batch.set(doc(db, 'documents', copyOf.get(id)!), {
      title: id === rootId ? `${data.title || 'Без назви'} (копія)` : data.title || 'Без назви',
      createdAt: now,
      updatedAt: now,
      blocks,
      linksTo: documentLinksIn(blocks),
      ...(parent ? { owner: { kind: 'note', id: parent } } : {}),
      ...(data.groupId && id === rootId ? { groupId: data.groupId } : {}),
      ...(uid ? { ownerId: uid } : {}),
    });
  });
  await batch.commit();
  return { id: copyOf.get(rootId)!, count: order.length };
}
