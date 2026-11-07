import { useEffect, useRef } from 'react';
import type { BoardKeyHandlers } from './useBoardKeys';

export type { BoardKeyHandlers } from './useBoardKeys';

// What a hand on a keyboard expects of a canvas - the same few keys
// Figma and Miro answer to:
//
//   Delete / Backspace  -> remove what is selected (it still asks first)
//   Escape              -> let go of the selection
//   Ctrl/Cmd + C, V     -> copy and paste cards
//   Ctrl/Cmd + D        -> duplicate in place
//   Ctrl/Cmd + A        -> select everything
//
// The handlers live in a ref, read at the moment a key arrives, so the one
// listener never holds a stale copy of the board's state.
export function useBoardKeys(handlers: BoardKeyHandlers): void {
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    function typingInto(target: EventTarget | null): boolean {
      const el = target as HTMLElement | null;
      if (!el || !el.tagName) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    }

    function onKeyDown(event: KeyboardEvent) {
      const h = latest.current;
      if (!h.active || event.defaultPrevented || event.repeat) return;
      if (typingInto(event.target)) return;

      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (!mod && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        h.onDelete();
      } else if (!mod && event.key === 'Escape') {
        h.onEscape();
      } else if (mod && !event.shiftKey && !event.altKey && key === 'c') {
        event.preventDefault();
        h.onCopy();
      } else if (mod && !event.shiftKey && !event.altKey && key === 'v') {
        event.preventDefault();
        h.onPaste();
      } else if (mod && !event.shiftKey && !event.altKey && key === 'd') {
        // The browser's own "bookmark this page".
        event.preventDefault();
        h.onDuplicate();
      } else if (mod && !event.shiftKey && !event.altKey && key === 'a') {
        event.preventDefault();
        h.onSelectAll();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}
