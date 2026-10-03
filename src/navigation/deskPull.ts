import { makeMutable } from 'react-native-reanimated';

// THE PULL THAT TURNS THE BAR INTO THE PANEL OF OPEN DESKS (2026-10-03):
// the list's pull-down (usePullToSearch) writes how far the bar has become
// the panel here, 0 to 1, on the UI thread, and DeskSwitcher draws it - so
// the bar changes shape under the finger, in step with it, rather than
// jumping when the pull is over. At the line where the search arms the
// panel is whole.
export const deskPull = makeMutable(0);
// Whether there are desks to turn into: set by the bar while the desks are
// what is in front. Without them a pull is just the search's.
export const deskPullEnabled = makeMutable(false);
// How far the list has been pulled (its rubber-banded travel) when the
// panel is whole - about where the search's line is.
export const PULL_MORPH_AT = 150;
