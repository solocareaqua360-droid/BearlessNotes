import { doc, getDoc } from '../firestore';
import { db } from '../firebase';

// What a document can say about a photo or file it mentions, without
// showing anything on the page.
//
// The name a user gives an attachment is real and editable, and until now
// it was visible in exactly one place: the Photos/Files database itself.
// A caption under the image was the obvious answer and the wrong one -
// the user asked for this behind the "..." instead, so a note stays a
// note and the details are there when they are wanted.
//
// Read fresh rather than from the block, deliberately: the block carries
// a copy from when it was inserted, and the whole point of asking is to
// see what is true now.
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes / 1024 < 10 ? 1 : 0)} КБ`;
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} МБ`;
  return `${(mb / 1024).toFixed(2)} ГБ`;
}

function formatDate(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

export async function attachmentInfoText(
  collectionName: 'photos' | 'files',
  id: string,
  fallbackName?: string
): Promise<string> {
  const snapshot = await getDoc(doc(db, collectionName, id)).catch(() => null);
  const data = snapshot?.data();
  if (!data) {
    // The record is gone, and the block is all that is left of it. Worth
    // saying so plainly rather than showing an empty panel: it is the
    // difference between "deleted" and "did not load".
    return `${fallbackName ?? 'Без назви'}\n\nЗапису в базі більше немає - у документі лишився тільки цей блок.`;
  }

  const lines: string[] = [];
  lines.push((data.title as string) || fallbackName || 'Без назви');
  if (collectionName === 'files' && data.fileName) lines.push(`Файл: ${data.fileName}`);
  if (typeof data.createdAt === 'number') lines.push(`Додано: ${formatDate(data.createdAt)}`);
  if (typeof data.updatedAt === 'number') lines.push(`Змінено: ${formatDate(data.updatedAt)}`);
  lines.push(
    data.driveFileId
      ? `На Google Диску: так${typeof data.driveBytes === 'number' ? ` (${formatBytes(data.driveBytes)})` : ''}`
      : 'На Google Диску: копії немає'
  );
  const usedIn = Object.keys((data.usedInDocuments as Record<string, boolean>) ?? {}).length;
  if (usedIn > 0) {
    lines.push(`У нотатках: ${usedIn}`);
  }
  return lines.join('\n');
}
