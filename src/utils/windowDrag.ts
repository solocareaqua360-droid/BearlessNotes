import { Platform } from 'react-native';

// THE MAC WINDOW'S TITLE BAND. The desktop shell marks its top bars as the
// place the window is dragged by (-webkit-app-region: drag - DesktopTabs,
// DesktopToolbar, DesktopRail, RightColumn). macOS takes clicks on such a
// region BEFORE the page sees them, whatever lies on top - so a window
// opened over the app (a date picker, a question, a menu) had its top
// controls dead wherever they crossed a bar: the month arrows and the
// «Кінцева дата» / «Час» boxes did nothing (2026-10-03). Every overlay
// says no-drag over its whole layer; a later no-drag cuts the drag region
// out. Nothing on a phone.
export const NO_WINDOW_DRAG = (Platform.OS === 'web' ? { WebkitAppRegion: 'no-drag' } : null) as never;
