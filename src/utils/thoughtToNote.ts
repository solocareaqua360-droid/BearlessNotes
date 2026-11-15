import { collection } from '../firestore';
import { db } from '../firebase';
import type { Block } from '../types';
import { addDoc } from './owned';
import { generateId } from './documentBlocks';
import { blockFromLink } from './copyToNote';
import { deleteThought, type Thought } from '../hooks/useThoughts';
import { readable } from '../components/thoughts/ThoughtCapture';
import { cardTitle } from '../components/thoughts/thoughtText';

// «ЗРОБИТИ ДОКУМЕНТОМ» (2026-11-16, the inbox): a thought whose words outgrew a caption becomes a real note - its title
// the first line, then what came in (the pictures, the video, the link), then the words. The note is written first and
// the thought taken out of the inbox only after it is, so nothing can be lost in between. Returns the new note's id.
export async function thoughtToNote(t: Thought): Promise<string> {
  const now = Date.now();
  const paragraphs = (text: string) =>
    text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p): Block => ({ id: generateId(), type: 'paragraph', text: p, createdAt: now }));
  const blocks: Block[] = [];
  const src = t.source;
  if (src?.kind === 'text') blocks.push(...paragraphs(readable(src.text)));
  for (const image of t.images ?? []) {
    const b: Block = { id: generateId(), type: 'image', text: '', imageUri: image.uri, imageFit: 'contain', createdAt: now };
    if (image.driveFileId) b.driveFileId = image.driveFileId;
    blocks.push(b);
  }
  if (t.video) {
    const name = t.video.name || t.video.uri.split('/').pop() || 'video.mp4';
    const b: Block = { id: generateId(), type: 'file', text: '', fileUri: t.video.uri, fileName: name, mimeType: 'video/mp4', createdAt: now };
    if (t.video.driveFileId) b.driveFileId = t.video.driveFileId;
    blocks.push(b);
  }
  if (src?.kind === 'link') blocks.push(blockFromLink(src));
  if (t.felt.trim()) blocks.push(...paragraphs(src ? t.felt : readable(t.felt)));
  if (!blocks.length) blocks.push({ id: generateId(), type: 'paragraph', text: '', createdAt: now });

  const firstLine = (cardTitle(t) || readable(t.felt)).split('\n').find((l) => l.trim()) ?? '';
  const title = firstLine.trim().slice(0, 80);
  const ref = await addDoc(collection(db, 'documents'), { title, blocks, createdAt: now, updatedAt: now });
  await deleteThought(t.id).catch(() => {});
  return ref.id;
}
