import { collection } from '../firestore';
import { db } from '../firebase';
import { addDoc } from './owned';
import { blocksFromText } from './quickCreate';
import type { Block } from '../types';

// A .md FILE READ AS A NOTE (2026-10-31, «перегляд та імпорт md»): its first «# heading», when it opens the file, is the note's
// title; the rest is read as a paste is (headings, lists, checkboxes, code, tables - utils/pasteBlocks). Links to pictures and files
// inside the file stay as text: a .md carries no pictures of its own.
export function markdownToDocument(text: string, fileName?: string): { title: string; blocks: Block[] } {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const first = lines.findIndex((l) => l.trim() !== '');
  const heading = first >= 0 ? lines[first].match(/^#\s+(.+?)\s*#*\s*$/) : null;
  const title = heading ? heading[1] : (fileName ?? '').replace(/\.(md|markdown|txt)$/i, '') || 'Без назви';
  const rest = heading ? lines.slice(first + 1).join('\n') : lines.join('\n');
  return { title, blocks: blocksFromText(rest) };
}

// The note made from it, filed nowhere (it lands in «Нерозкладене»). Returns its id.
export async function importMarkdown(text: string, fileName?: string): Promise<string> {
  const { title, blocks } = markdownToDocument(text, fileName);
  const now = Date.now();
  const ref = await addDoc(collection(db, 'documents'), { title, blocks, createdAt: now, updatedAt: now });
  return ref.id;
}
