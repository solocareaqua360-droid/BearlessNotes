import * as ImagePicker from 'expo-image-picker';
import { doc, updateDoc } from '../firestore';
import { db } from '../firebase';
import { backupFileToDrive } from './googleDrive';
import type { ThoughtImage } from '../hooks/useThoughts';

// THE PICTURES OF A THOUGHT IN THE BROWSER / ON THE MAC (see thoughtImages.ts). No app folder to copy into: a picked
// picture stays the page's own (blob:) address for this session, and goes to Drive straight after the thought is
// saved - from then on the thought carries its Drive id, and every device (the phone too) shows it from there.

const mimeOf = (uri: string, fallback = 'image/jpeg') => {
  const m = /^data:([^;,]+)/.exec(uri);
  return m ? m[1] : fallback;
};

export async function pickThoughtImages(): Promise<string[]> {
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 0.9 });
  return picked.canceled ? [] : picked.assets.map((a) => a.uri);
}

// A picture on the clipboard, read through the browser's own clipboard (the page must have the focus).
async function clipboardImageBlob(): Promise<Blob | null> {
  try {
    const nav = navigator as Navigator & { clipboard?: { read?: () => Promise<{ types: string[]; getType: (t: string) => Promise<Blob> }[]> } };
    const items = (await nav.clipboard?.read?.()) ?? [];
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (type) return await item.getType(type);
    }
  } catch {
    // no permission, or nothing there
  }
  return null;
}

export async function clipboardHasImage(): Promise<boolean> {
  return !!(await clipboardImageBlob());
}

export async function pasteClipboardImage(): Promise<string | null> {
  const blob = await clipboardImageBlob();
  return blob ? URL.createObjectURL(blob) : null;
}

export async function keepThoughtImage(src: string): Promise<string> {
  return src;
}

export async function backupThoughtImages(thoughtId: string, images: ThoughtImage[]) {
  const done: ThoughtImage[] = [];
  let changed = false;
  for (const image of images) {
    if (image.driveFileId) {
      done.push(image);
      continue;
    }
    const name = `thought-${Date.now().toString(36)}.jpg`;
    const uploaded = await backupFileToDrive(image.uri, name, mimeOf(image.uri), 'Photos').catch(() => null);
    done.push(uploaded ? { uri: image.uri, driveFileId: uploaded.fileId } : image);
    if (uploaded) changed = true;
  }
  if (changed) await updateDoc(doc(db, 'thoughts', thoughtId), { images: done }).catch(() => {});
}

export async function imagePartOf(uri: string): Promise<{ inlineData: { mimeType: string; data: string } } | null> {
  try {
    const blob = await (await fetch(uri)).blob();
    if (blob.size > 4_500_000) return null;
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    return { inlineData: { mimeType: blob.type || 'image/jpeg', data } };
  } catch {
    return null;
  }
}
