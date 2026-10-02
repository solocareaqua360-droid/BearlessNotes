import { Platform, type GestureResponderEvent } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import type { Rect } from './morph';

// A CARD OPENS BY TURNING OVER (the user's, 2026-10-02 - "натиск
// перегортає картку і там зміст картки", no new gestures). Cards are
// everything laid on the paper - records, links, photos, files - never a
// note or a board, which are the paper itself (see the paper-and-cards
// memory). The card that was pressed is photographed where it stands;
// the window that opens (GlassLayer's `flipFrom`) turns that photograph
// over and grows out of its back.
export type FlipFrom = { rect: Rect; uri: string };

type Measurable = {
  measureInWindow: (cb: (x: number, y: number, width: number, height: number) => void) => void;
};

// From the press itself: the pressed card is the event's currentTarget, so
// no screen has to keep a ref to every card it draws. Null - and the
// window simply grows in as before - in the browser, or when the card
// cannot be measured or photographed.
export async function captureCard(event: GestureResponderEvent | undefined): Promise<FlipFrom | null> {
  if (Platform.OS === 'web' || !event) return null;
  // A card may name the view to photograph (the whole card, frame and
  // all) - else the pressed view itself.
  const target = ((event as unknown as { flipTarget?: Measurable }).flipTarget ??
    event.currentTarget) as unknown as Measurable | null;
  if (!target || typeof target.measureInWindow !== 'function') return null;
  try {
    const rect = await new Promise<Rect | null>((resolve) =>
      target.measureInWindow((x, y, width, height) => resolve(width > 0 && height > 0 ? { x, y, width, height } : null))
    );
    if (!rect) return null;
    const uri = await captureRef(target as never, { format: 'png', result: 'tmpfile' });
    return { rect, uri };
  } catch {
    return null;
  }
}

// A card's press, told which view is the whole card (see captureCard).
export function withFlipTarget(event: GestureResponderEvent, target: unknown): GestureResponderEvent {
  if (target) (event as unknown as { flipTarget?: unknown }).flipTarget = target;
  return event;
}
