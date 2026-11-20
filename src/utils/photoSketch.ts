import { doc, getDoc, updateDoc } from '../firestore';
import { db } from '../firebase';
import type { Block, SketchElement } from '../types';

// A DRAWING ON A PHOTO, saved (shared: the single explorer's viewer uses it, so it
// does not lean on the Photos screen). The same two writes the Photos base
// makes: the photo record, then every note that shows this photo, so one photo
// stays one record instead of copies that drift apart.
export async function savePhotoSketch(
  photoId: string,
  documentIds: string[],
  elements: SketchElement[],
  width: number,
  height: number
): Promise<void> {
  await updateDoc(doc(db, 'photos', photoId), {
    sketchElements: elements,
    sketchWidth: width,
    sketchHeight: height,
    updatedAt: Date.now(),
  });
  await Promise.all(
    documentIds.map(async (docId) => {
      const documentRef = doc(db, 'documents', docId);
      const snapshot = await getDoc(documentRef);
      const data = snapshot.data();
      if (!data) return;
      const blocks: Block[] = data.blocks ?? [];
      let changed = false;
      const updated = blocks.map((b) => {
        if (b.id === photoId && (b.type ?? 'paragraph') === 'image') {
          changed = true;
          return { ...b, sketchElements: elements, sketchWidth: width, sketchHeight: height };
        }
        return b;
      });
      if (changed) await updateDoc(documentRef, { blocks: updated });
    })
  );
}
