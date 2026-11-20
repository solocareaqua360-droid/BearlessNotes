import { PixelRatio, type View } from 'react-native';
import { doc, getDoc, updateDoc } from '../firestore';
import { db } from '../firebase';
import type { Block } from '../types';
import { buildBlock, generateId } from './documentBlocks';
import { blockFromPhoto } from './copyToNote';
import { compressPickedImage, writePhotoRecord } from './photoLibrary';
import { grabScreenFrame, startScreenCapture } from './mindevaNative';
import { ensureMainNote } from './recordNotes';

// A MOMENT OF A VIDEO, INTO A NOTE (the user's, 2026-10-04): the time the
// video is at, typed as «04:32» - which a tap then seeks to (see
// FormattedText's timecodes) - and a frame of it, a picture with that same
// time under it. Used by the note's own player, by a lesson on an app's
// page, and (for the frame alone) by the board.

export type VideoShot = { uri: string; width: number; height: number };

// 272 -> «4:32»; an hour or more -> «1:04:32». What the timecode pattern
// (utils/videoEmbed) reads back.
export function formatStamp(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// A frame off the screen, cut to a player whose two corners are given as
// views. Asks the phone's consent the first time; a fresh capture has no
// image until the screen changes, so it asks a few times. Null when
// declined, unavailable, or nothing came.
export async function captureVideoFrame(topLeft: View | null, bottomRight: View | null): Promise<VideoShot | null> {
  if (!(await startScreenCapture())) return null;
  // A moment for the system's dialog to be gone and the screen to show the
  // player as it is.
  await new Promise((r) => setTimeout(r, 450));
  const corner = (node: View | null) =>
    new Promise<{ x: number; y: number } | null>((resolve) => {
      if (!node) return resolve(null);
      node.measureInWindow((x, y) => resolve({ x, y }));
    });
  const [tl, br] = await Promise.all([corner(topLeft), corner(bottomRight)]);
  if (!tl || !br) return null;
  const scale = PixelRatio.get();
  for (let attempt = 0; attempt < 8; attempt++) {
    const shot = await grabScreenFrame({
      x: tl.x * scale,
      y: tl.y * scale,
      w: (br.x - tl.x) * scale,
      h: (br.y - tl.y) * scale,
    });
    if (shot) return shot;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

// The blocks a moment becomes: the time alone, as a paragraph left open
// for the words that go after it - or a frame (a photo of its own, in
// «Зображення», backed up like any) with its time under it.
export function timecodeBlocks(seconds: number): Block[] {
  return [buildBlock(generateId(), 'paragraph', `${formatStamp(seconds)} `)];
}

export async function frameBlocks(shot: VideoShot, seconds: number | null): Promise<Block[]> {
  const uri = await compressPickedImage(shot.uri, shot.width, shot.height);
  const photo = await writePhotoRecord(uri);
  const title = seconds === null ? 'Кадр з відео' : `Кадр ${formatStamp(seconds)}`;
  updateDoc(doc(db, 'photos', photo.id), { title }).catch(() => {});
  const image = blockFromPhoto({ id: photo.id, imageUri: uri, createdAt: photo.createdAt, title });
  return seconds === null ? [image] : [image, buildBlock(generateId(), 'paragraph', `${formatStamp(seconds)} `)];
}

// Into a lesson's own note (the one owned by the video - see
// utils/recordNotes), made if it is not there yet: after what it already
// holds.
export async function appendToLessonNote(
  link: { id: string; title: string },
  blocks: Block[]
): Promise<void> {
  const id = await ensureMainNote({ kind: 'link', id: link.id }, `${link.title} - нотатка`);
  const ref = doc(db, 'documents', id);
  const snap = await getDoc(ref);
  const existing = ((snap.data() as { blocks?: Block[] } | undefined)?.blocks ?? []) as Block[];
  await updateDoc(ref, { blocks: [...existing, ...blocks], updatedAt: Date.now() });
}
