import { escapeHtml } from './documentBlocks';
import { imageBase64 } from './imageBase64';

type PdfTask = {
  text: string;
  checked: boolean;
  comment?: string;
  subtasks?: { text: string; checked: boolean }[];
  attachments?: { imageUri?: string; fileName?: string; imageTitle?: string; driveFileId?: string }[];
  where?: string;
};

// SELECTED TASKS AS ONE DOCUMENT, each with its pictures UNDER IT (the user,
// 2026-10-09: not every task is for Claude - some are other spheres of life,
// and any list should be able to leave as a PDF with the screenshots in the
// right place). A picture that cannot be read is named instead.
export async function tasksToHtml(title: string, tasks: PdfTask[]): Promise<string> {
  const parts: string[] = [`<h1 style="margin:0 0 14px;">${escapeHtml(title)}</h1>`];
  let n = 0;
  for (const t of tasks) {
    n += 1;
    const style = t.checked ? 'text-decoration:line-through;opacity:0.6;' : '';
    parts.push(`<h3 style="margin:18px 0 4px;${style}">${n}. ${escapeHtml(t.text)}</h3>`);
    if (t.where) parts.push(`<div style="color:#6B7280;font-size:12px;">${escapeHtml(t.where)}</div>`);
    if (t.comment?.trim()) parts.push(`<p style="margin:6px 0;white-space:pre-wrap;">${escapeHtml(t.comment.trim())}</p>`);
    (t.subtasks ?? []).forEach((s) =>
      parts.push(`<p style="margin:2px 0 2px 14px;">${s.checked ? '☑' : '☐'} ${escapeHtml(s.text)}</p>`)
    );
    for (const a of t.attachments ?? []) {
      if (a.imageUri) {
        try {
          const base64 = await imageBase64(a.imageUri, a.driveFileId);
          parts.push(`<img src="data:image/png;base64,${base64}" style="max-width:100%;display:block;margin:8px 0;" />`);
          continue;
        } catch {
          // Named below.
        }
      }
      parts.push(`<p style="margin:2px 0;color:#6B7280;">[${escapeHtml(a.fileName || a.imageTitle || 'вкладення')}]</p>`);
    }
  }
  return `<html><head><meta charset="utf-8"/></head><body style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.45;padding:12px;">${parts.join('')}</body></html>`;
}
