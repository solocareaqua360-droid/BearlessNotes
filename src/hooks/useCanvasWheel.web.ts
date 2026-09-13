import { RefObject, useEffect } from 'react';
import { View } from 'react-native';
import type { CanvasWheelHandles } from './useCanvasWheel';

export type { CanvasWheelHandles } from './useCanvasWheel';

// What two fingers do on the phone, a trackpad and a mouse have to do
// here - and until this existed, a pinch on the trackpad zoomed the WHOLE
// PAGE instead of the board, which is why the board felt boxed in.
//
// A pinch on a trackpad does not arrive as a pinch. Browsers report it as
// a wheel event with ctrlKey set, which is the one piece of knowledge
// this file is built on. So:
//
//   pinch (or ctrl/cmd + wheel) -> zoom, around the pointer
//   two-finger scroll           -> move the board
//   shift + scroll              -> move it sideways
//
// The same arrangement Figma and Miro use, so a hand that knows either
// already knows this.
export function useCanvasWheel(ref: RefObject<View | null>, handles: CanvasWheelHandles): void {
  const {
    scale,
    savedScale,
    translateX,
    translateY,
    savedTranslateX,
    savedTranslateY,
    viewport,
    minScale,
    maxScale,
  } = handles;

  useEffect(() => {
    // On React Native Web a View's ref IS the DOM node.
    const node = ref.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== 'function') return;

    function onWheel(event: WheelEvent) {
      // Without this the browser zooms the page or scrolls it, and the
      // board sits there unchanged underneath.
      event.preventDefault();

      if (!event.ctrlKey && !event.metaKey) {
        const dx = event.shiftKey ? -event.deltaY : -event.deltaX;
        const dy = event.shiftKey ? 0 : -event.deltaY;
        translateX.value += dx;
        translateY.value += dy;
        savedTranslateX.value = translateX.value;
        savedTranslateY.value = translateY.value;
        return;
      }

      const from = scale.value;
      // Exponential, so every notch changes the view by the same
      // PROPORTION - a linear step crawls when zoomed out and lurches
      // when zoomed in.
      //
      // The constant is the whole feel of it, and it has to serve two
      // very different senders. A mouse wheel arrives in notches of
      // about 120, a trackpad pinch in ones and twos, sixty times a
      // second. At 0.0015 a notch is a fifth bigger and a pinch is
      // smooth; at 0.01, where this started, a single notch tripled the
      // board and slammed into the far end of the range.
      const next = Math.min(maxScale, Math.max(minScale, from * Math.exp(-event.deltaY * 0.0015)));
      if (next === from) return;

      // The world is a square centred in the viewport and scaled about
      // its own middle, so a point's place on screen is
      //   centre + (point - worldCentre) * scale + translate.
      // Holding the point under the pointer still gives this, with
      // d being how far the pointer is from where the translation has
      // put the world's centre.
      const rect = node!.getBoundingClientRect();
      const dxFromCentre = event.clientX - rect.left - viewport.width / 2 - translateX.value;
      const dyFromCentre = event.clientY - rect.top - viewport.height / 2 - translateY.value;
      const shrink = 1 - next / from;
      translateX.value += dxFromCentre * shrink;
      translateY.value += dyFromCentre * shrink;
      scale.value = next;
      savedScale.value = next;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    }

    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [ref, scale, savedScale, translateX, translateY, savedTranslateX, savedTranslateY, viewport.width, viewport.height, minScale, maxScale]);
}
