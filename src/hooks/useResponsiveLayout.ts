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

export function useResponsiveLayout() {
  const { width, height } = useWindowDimensions();
  const bigEnough = Math.min(width, height) >= MIN_SMALLEST_WIDTH;
  return {
    width,
    height,
    isTwoPane: bigEnough && width >= TWO_PANE_MIN_WIDTH,
    isThreePane: bigEnough && width >= THREE_PANE_MIN_WIDTH,
  };
}
