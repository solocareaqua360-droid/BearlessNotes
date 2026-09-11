import { useWindowDimensions } from 'react-native';

// Where one column of content stops being enough. 840dp is Android's own
// "expanded" width class, and it lands where it should for the devices
// this app actually runs on: a Fold's inner screen reports ~984dp wide
// (1968px at density 2), its cover screen ~385dp, a plain phone 360-430dp.
// So the inner screen and a tablet get two panes, and folding the phone
// shut drops straight back to one - the window is simply resized, which
// useWindowDimensions reports live (never Dimensions.get() at module
// scope - see the calendar's own scars).
export const TWO_PANE_MIN_WIDTH = 840;

// The list pane. Wide enough for a document card to read as a card rather
// than a strip, narrow enough that the editor beside it keeps a full
// text column.
function listPaneWidth(width: number): number {
  return Math.round(Math.min(420, Math.max(340, width * 0.36)));
}

export function useResponsiveLayout() {
  const { width, height } = useWindowDimensions();
  const isTwoPane = width >= TWO_PANE_MIN_WIDTH;
  return { width, height, isTwoPane, listPaneWidth: listPaneWidth(width) };
}
