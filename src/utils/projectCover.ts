import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

// A project's cover picture (2026-10-22). Kept INSIDE the project's own document as a small JPEG data-URL, not as a file: a file would
// exist on one device only, and the user works on the phone and the Mac. ~700 px at quality 0.6 is some 60-120 KB, far under a document's
// 1 MB, and the band draws it at most a phone wide.
const MAX = 700;

export async function coverDataUrl(uri: string): Promise<string> {
  const ctx = ImageManipulator.manipulate(uri).resize({ width: MAX });
  const rendered = await ctx.renderAsync();
  const saved = await rendered.saveAsync({ compress: 0.6, format: SaveFormat.JPEG, base64: true });
  if (!saved.base64) throw new Error('Не вдалося стиснути зображення');
  return `data:image/jpeg;base64,${saved.base64}`;
}
