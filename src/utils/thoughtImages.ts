import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { doc, updateDoc } from '../firestore';
import { db } from '../firebase';
import { backupFileToDrive } from './googleDrive';
import type { ThoughtImage } from '../hooks/useThoughts';

// THE PICTURES OF A THOUGHT (2026-10-15, the user's: «треба щоб думки навчились приймати одну або декілька картинок.
// Думка може прийти і через зображення»). A thought carries any number of pictures, with or without a source and words:
// the photo of a whiteboard, a screenshot, a page. They come from the share sheet, the gallery or the clipboard; each is
// COPIED into the app's own folder (a picker's or a share's address does not live long), and backed up to Drive in the
// background like every photo of the app (the thought keeps the file's id, so a reinstall brings it back).
const DIR = `${FileSystem.documentDirectory}thought-images/`;

const extOf = (uri: string) => (/\.(png|webp|gif|jpe?g)(\?|$)/i.exec(uri)?.[1] ?? 'jpg').toLowerCase().replace('jpeg', 'jpg');
const mimeOf = (uri: string) => {
  const e = extOf(uri);
  return e === 'png' ? 'image/png' : e === 'webp' ? 'image/webp' : e === 'gif' ? 'image/gif' : 'image/jpeg';
};
const freshName = (ext: string) => `${DIR}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}.${ext}`;

// Pictures chosen in the phone's gallery - several at once.
export async function pickThoughtImages(): Promise<string[]> {
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 0.9 });
  return picked.canceled ? [] : picked.assets.map((a) => a.uri);
}

// A picture the clipboard holds (a copied screenshot or photo).
export async function clipboardHasImage(): Promise<boolean> {
  try {
    return await Clipboard.hasImageAsync();
  } catch {
    return false;
  }
}
export async function pasteClipboardImage(): Promise<string | null> {
  try {
    const image = await Clipboard.getImageAsync({ format: 'jpeg' });
    if (!image?.data) return null;
    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
    const to = freshName('jpg');
    await FileSystem.writeAsStringAsync(to, image.data.replace(/^data:[^,]*,/, ''), { encoding: FileSystem.EncodingType.Base64 });
    return to;
  } catch {
    return null;
  }
}

// Takes a picture into the app's own folder (already there: left as it is).
export async function keepThoughtImage(src: string): Promise<string> {
  if (src.startsWith(DIR)) return src;
  await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
  const to = freshName(extOf(src));
  await FileSystem.copyAsync({ from: src, to });
  return to;
}

// After the thought is saved: the pictures go to Drive, one after another, and the thought learns their ids. Silent -
// the thought is kept already, and a missing sign-in only means the copy waits.
export async function backupThoughtImages(thoughtId: string, images: ThoughtImage[]) {
  const done: ThoughtImage[] = [];
  let changed = false;
  for (const image of images) {
    if (image.driveFileId) {
      done.push(image);
      continue;
    }
    const name = image.uri.split('/').pop() || 'thought.jpg';
    const uploaded = await backupFileToDrive(image.uri, name, mimeOf(image.uri), 'Photos').catch(() => null);
    done.push(uploaded ? { uri: image.uri, driveFileId: uploaded.fileId } : image);
    if (uploaded) changed = true;
  }
  if (changed) await updateDoc(doc(db, 'thoughts', thoughtId), { images: done }).catch(() => {});
}

// A picture as Gemini takes it, from the phone's own copy.
export async function imagePartOf(uri: string): Promise<{ inlineData: { mimeType: string; data: string } } | null> {
  try {
    const data = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    if (!data || data.length > 6_000_000) return null;
    return { inlineData: { mimeType: mimeOf(uri), data } };
  } catch {
    return null;
  }
}
