import { doc } from '../firestore';
import { db } from '../firebase';
import { setDoc } from './owned';
import { fetchLinkPreview } from './linkPreview';
import { linkDocId } from './linkId';

// A link record made from a pasted address: its preview fetched (title,
// picture, site), and its category - video, geo point or other - coming
// from the address itself, as for a link shared into the app. Its id is
// the address's own (linkDocId), so the same address twice is one link.
// Used by the chat and by a database's link field («Додати за адресою»).
export async function saveLinkFromUrl(
  rawUrl: string
): Promise<{ id: string; url: string; title?: string; imageUrl?: string; siteName?: string } | null> {
  const url = rawUrl.trim();
  if (!url) return null;
  const preview = await fetchLinkPreview(url).catch(() => ({}) as Awaited<ReturnType<typeof fetchLinkPreview>>);
  const id = linkDocId(url);
  const now = Date.now();
  const data: Record<string, unknown> = { url, createdAt: now, updatedAt: now, usedInDocuments: {} };
  if (preview.title) data.title = preview.title;
  if (preview.imageUrl) data.imageUrl = preview.imageUrl;
  if (preview.siteName) data.siteName = preview.siteName;
  await setDoc(doc(db, 'links', id), data, { merge: true });
  return { id, url, title: preview.title, imageUrl: preview.imageUrl, siteName: preview.siteName };
}
