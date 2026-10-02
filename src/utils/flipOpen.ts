import { Platform, type GestureResponderEvent } from 'react-native';
import { makeMutable } from 'react-native-reanimated';
import type { Rect } from './morph';

// A CARD OPENS BY TURNING OVER (the user's, 2026-10-02 - "натиск
// перегортає картку і там зміст картки", no new gestures). Cards are
// everything laid on the paper - records, links, photos, files - never a
// note or a board, which are the paper itself (see the paper-and-cards
// memory).
//
// The REAL card turns: it reads `flipProgress` (usePressSettle, given its
// key) and turns edge-on over the first half; the window that opens
// (GlassLayer's `flipFrom`) comes round from edge-on on the second half,
// growing from the card's place. One clock, one card - a photograph of
// the card was tried first and showed as "another card" at the hand-over
// (no shadow, other corners, taken a beat late).
export type FlipFrom = { rect: Rect };

// The turn's length, both ways - the window's half and the card's.
export const FLIP_MS = 460;

// 0 in the card .. 1 open. Driven by GlassLayer; read by the card whose
// key is `flipKey`.
export const flipProgress = makeMutable(0);
export const flipKey = makeMutable('');

type Measurable = {
  measureInWindow: (cb: (x: number, y: number, width: number, height: number) => void) => void;
};

// From the press itself: the card names the view that is the whole card
// (withFlipTarget), else the pressed view is measured. Null - and the
// window simply grows in as before - in the browser, or when the card
// cannot be measured.
export async function prepareFlip(key: string, event: GestureResponderEvent | undefined): Promise<FlipFrom | null> {
  if (Platform.OS === 'web' || !event) return null;
  const target = ((event as unknown as { flipTarget?: Measurable }).flipTarget ??
    event.currentTarget) as unknown as Measurable | null;
  if (!target || typeof target.measureInWindow !== 'function') return null;
  try {
    const rect = await new Promise<Rect | null>((resolve) =>
      target.measureInWindow((x, y, width, height) => resolve(width > 0 && height > 0 ? { x, y, width, height } : null))
    );
    if (!rect) return null;
    flipProgress.value = 0;
    flipKey.value = key;
    return { rect };
  } catch {
    return null;
  }
}

// The card is back in its place: no card answers to the clock any more.
export function endFlip() {
  flipKey.value = '';
}

// A card's press, told which view is the whole card (see prepareFlip).
export function withFlipTarget(event: GestureResponderEvent, target: unknown): GestureResponderEvent {
  if (target) (event as unknown as { flipTarget?: unknown }).flipTarget = target;
  return event;
}
