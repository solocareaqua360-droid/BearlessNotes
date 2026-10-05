import { deleteField, doc, getDocs, updateDoc } from '../firestore';
import { db } from '../firebase';
import { ownedQuery, setDoc } from './owned';

// NESTED NOTES AND THE BIN (the user's rule, 2026-10-05: "видалення кореня
// видаляє вкладену нотатку"). A note goes to the bin with everything
// nested in it, all under ONE stamp - the root's deletedAt - and comes
// back the same way: restoring the root brings back exactly what went
// with it, not a child that had been binned on its own before. A word
// linking to a note never takes part in any of this (see DocOwner).

type Node = { id: string; parentId?: string; deletedAt?: number };

async function loadNodes(): Promise<Map<string, Node>> {
  const snapshot = await getDocs(ownedQuery('documents'));
  const nodes = new Map<string, Node>();
  snapshot.docs.forEach((d) => {
    const data = d.data();
    nodes.set(d.id, {
      id: d.id,
      parentId: data.owner?.kind === 'note' ? (data.owner.id as string) : undefined,
      deletedAt: data.deletedAt as number | undefined,
    });
  });
  return nodes;
}

// Everything nested under a note, at any depth.
function nestedUnder(rootId: string, nodes: Map<string, Node>): Node[] {
  const children = new Map<string, Node[]>();
  nodes.forEach((n) => {
    if (!n.parentId) return;
    const list = children.get(n.parentId) ?? [];
    list.push(n);
    children.set(n.parentId, list);
  });
  const found: Node[] = [];
  const seen = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length) {
    for (const child of children.get(queue.shift()!) ?? []) {
      // A cycle would be a bug elsewhere; it must not hang this.
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      found.push(child);
      queue.push(child.id);
    }
  }
  return found;
}

export async function binNote(id: string): Promise<void> {
  const stamp = Date.now();
  // Merged rather than updated: a note just made may not be written yet.
  await setDoc(doc(db, 'documents', id), { deletedAt: stamp }, { merge: true });
  const nodes = await loadNodes().catch(() => null);
  if (!nodes) return;
  await Promise.all(
    nestedUnder(id, nodes)
      .filter((n) => !n.deletedAt)
      .map((n) => updateDoc(doc(db, 'documents', n.id), { deletedAt: stamp }).catch(() => {}))
  );
}

export async function restoreNote(id: string): Promise<void> {
  const nodes = await loadNodes().catch(() => null);
  const self = nodes?.get(id);
  const stamp = self?.deletedAt;
  // Its home still in the bin: back as a note of its own, or it would
  // come back to a place nobody can see.
  const parent = self?.parentId ? nodes?.get(self.parentId) : undefined;
  const homeless = !!self?.parentId && (!parent || !!parent.deletedAt);
  await updateDoc(
    doc(db, 'documents', id),
    homeless ? { deletedAt: deleteField(), owner: deleteField() } : { deletedAt: deleteField() }
  );
  if (!nodes || !stamp) return;
  await Promise.all(
    nestedUnder(id, nodes)
      .filter((n) => n.deletedAt === stamp)
      .map((n) => updateDoc(doc(db, 'documents', n.id), { deletedAt: deleteField() }).catch(() => {}))
  );
}

// Gone for good, with what is nested in it - each through the caller's
// own purge (tags to detach). A nested note somehow still alive under it
// is let out into the list rather than left under a note that is gone.
export async function purgeNote(id: string, purgeOne: (id: string) => Promise<void>): Promise<void> {
  const nodes = await loadNodes().catch(() => null);
  const nested = nodes ? nestedUnder(id, nodes) : [];
  await purgeOne(id);
  await Promise.all(
    nested.map((n) =>
      n.deletedAt
        ? purgeOne(n.id).catch(() => {})
        : updateDoc(doc(db, 'documents', n.id), { owner: deleteField() }).catch(() => {})
    )
  );
}
