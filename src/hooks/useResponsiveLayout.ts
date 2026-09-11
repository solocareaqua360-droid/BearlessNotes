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

export function useResponsiveLayout() {
  const { width, height } = useWindowDimensions();
  // The two panes split the window evenly. A narrower list pane leaves the
  // editor more room, but at 984dp half is still ~490dp - wider than any
  // phone this app runs on - and the list is the half that suffers first
  // when it's squeezed: its cards are two columns of thumbnails, not text.
  return { width, height, isTwoPane: width >= TWO_PANE_MIN_WIDTH };
}
