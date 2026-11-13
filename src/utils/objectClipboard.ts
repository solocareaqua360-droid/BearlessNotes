import { useEffect, useState } from 'react';
import { Block } from '../types';

// What "copy" means for an object that isn't text. The system clipboard
// can carry a picture's bytes, but pasting those would put a SECOND copy
// of the photo into the document - unrelated to the one in the Photos
// database, surviving its deletion and missing its edits. Everything else
// in this app references instead (see copyToNote's blockFromPhoto), so
// copying here stores the block that references it, and pasting drops that
// block in. The picture stays one picture.
//
// In memory only, and deliberately: it lives for as long as the app is
// open, which is as long as a copy-and-paste takes.
export type CopiedObject = {
  // What it is, for the paste row's label ("Вставити фото").
  label: string;
  block: Block;
};

let copied: CopiedObject | null = null;
const listeners = new Set<(value: CopiedObject | null) => void>();

export function copyObject(value: CopiedObject) {
  copied = value;
  listeners.forEach((listener) => listener(copied));
}

export function getCopiedObject(): CopiedObject | null {
  return copied;
}

export function clearCopiedObject() {
  copied = null;
  listeners.forEach((listener) => listener(null));
}

// What a screen uses to show or hide its paste action as the clipboard
// fills and empties.
export function useCopiedObject(): CopiedObject | null {
  const [value, setValue] = useState<CopiedObject | null>(copied);
  useEffect(() => {
    listeners.add(setValue);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}

// The label a kind of block reads as in "Вставити …".
export function labelForBlock(block: Block): string {
  switch (block.type) {
    case 'image':
      return 'фото';
    case 'file':
      return 'файл';
    case 'link':
      return 'посилання';
    case 'dbRow':
      return 'запис бази';
    case 'dbView':
      return 'вигляд бази';
    case 'sketch':
      return 'малюнок';
    default:
      return 'текст';
  }
}
