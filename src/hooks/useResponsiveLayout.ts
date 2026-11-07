import { createContext, useContext } from 'react';
import { useWindowDimensions } from 'react-native';

// These numbers come from the device, not from a spec sheet. A Fold's inner
// screen reports 704 x 933 dp at density 2.625 - not the 984 x 1092 its
// 1968px width suggests, because Android's own "screen zoom" setting is
// what decides the density those pixels divide by. So a breakpoint written
// against a published resolution is a guess; this one was read off the
// phone (Settings shows it, which is why that line is there).
//
// Portrait on that screen is 704 wide - two columns of 352, a phone's width
// each. Landscape is 933 - three columns still leave ~280 apiece.
export const TWO_PANE_MIN_WIDTH = 680;
export const THREE_PANE_MIN_WIDTH = 900;
// A phone turned sideways is wide too (~800dp) but only ~360 tall, and
// splitting THAT into columns gives two letterboxes. The shorter side is
// what separates a big device from a phone in landscape - the same test
// Android's own sw600dp resource qualifier makes.
const MIN_SMALLEST_WIDTH = 600;

// A screen drawn inside something narrower than the window - the
// calendar in its drawer - is told the frame it really has. Everything
// below reads the frame instead of the window, and a frame is always a
// single column: splitting a drawer into panes gives two slivers.
export const LayoutFrameContext = createContext<{ width: number; height: number } | null>(null);

// useWindowDimensions, but the frame's size inside one.
export function useFrameDimensions() {
  const window = useWindowDimensions();
  const frame = useContext(LayoutFrameContext);
  return frame ? { ...window, width: frame.width, height: frame.height } : window;
}

export function useResponsiveLayout() {
  const { width, height } = useWindowDimensions();
  const frame = useContext(LayoutFrameContext);
  if (frame) return { width: frame.width, height: frame.height, isTwoPane: false, isThreePane: false };
  const bigEnough = Math.min(width, height) >= MIN_SMALLEST_WIDTH;
  return {
    width,
    height,
    isTwoPane: bigEnough && width >= TWO_PANE_MIN_WIDTH,
    isThreePane: bigEnough && width >= THREE_PANE_MIN_WIDTH,
  };
}
