import { useEffect } from 'react';
import { arrayUnion, collection, doc, getDocs, writeBatch } from '../firestore';
import { auth, db } from '../firebase';
import { addDoc, ownedQuery } from './owned';
import { importMarkdown } from './markdownFile';

// THE DOCUMENT INTAKE (2026-11-20, the user's: valuable documents from the other apps' chats - research, decisions - must not be
// lost in those chats; «для кожного застосунку окрема папка»). Claude sessions hand a .md file to the main session, which runs
// scripts/inbox-doc.py; that writes ~/Library/Application Support/mindEva/state/inbox-docs.json (the file the shell serves, as for the
// dev board). The signed-in app reads it every few seconds and makes each document a note, filed in the explorer folder named after the
// app - as the user, with no key of Claude's own. A document is made ONCE (by its `key`): a note the user edits afterwards is never
// overwritten by a second delivery.
const STATE_URL = '/__desktop/state/inbox-docs';
const APPLIED_KEY = 'inboxDocsApplied';
const POLL_MS = 5000;
const FOLDER_COLOR = '#DAA587';

type InboxDoc = { key: string; app: string; title?: string; text: string; at?: number };

function readApplied(): Record<string, string> {
  try {
    return JSON.parse(window.localStorage.getItem(APPLIED_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

let running = false;

// The folder (a tag with that path) for an app: an existing one of any case, else a new one that lists documents.
async function folderTagFor(app: string): Promise<string> {
  const snapshot = await getDocs(ownedQuery('tags'));
  const same = snapshot.docs
    .map((d) => ({ id: d.id, ...(d.data() as { path?: string; types?: string[] }) }))
    .filter((t) => (t.path ?? '').trim().toLowerCase() === app.trim().toLowerCase())
    .sort((a, b) => (b.types?.length ?? 0) - (a.types?.length ?? 0));
  if (same.length) return same[0].id;
  const made = await addDoc(collection(db, 'tags'), {
    path: app.trim(),
    icon: 'folder-outline',
    color: FOLDER_COLOR,
    types: ['document'],
    usedIn: {},
    keep: true,
  });
  return made.id;
}

async function applyOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const response = await fetch(STATE_URL, { cache: 'no-store' });
    if (!response.ok) return;
    const docs = ((await response.json()) as { docs?: InboxDoc[] }).docs ?? [];
    const applied = readApplied();
    const fresh = docs.filter((d) => d.key && d.app?.trim() && d.text?.trim() && !applied[d.key]);
    if (fresh.length === 0) return;
    for (const item of fresh) {
      const noteId = await importMarkdown(item.text, item.title ? `${item.title}.md` : undefined);
      const tagId = await folderTagFor(item.app);
      const batch = writeBatch(db);
      batch.update(doc(db, 'tags', tagId), { [`usedIn.document:${noteId}`]: true, types: arrayUnion('document') });
      batch.update(doc(db, 'documents', noteId), { tagIds: arrayUnion(tagId) });
      await batch.commit();
      applied[item.key] = noteId;
      window.localStorage.setItem(APPLIED_KEY, JSON.stringify(applied));
    }
  } catch (e) {
    console.warn('[inboxDocsBridge]', e, auth.currentUser?.uid ? '' : '(not signed in)');
  } finally {
    running = false;
  }
}

export function useInboxDocsBridge(signedIn: boolean): void {
  useEffect(() => {
    if (!signedIn) return;
    const first = setTimeout(applyOnce, 3000);
    const timer = setInterval(applyOnce, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [signedIn]);
}
