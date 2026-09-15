import { registerWidgetTaskHandler } from 'react-native-android-widget';
import { stickerWidgetTaskHandler } from './stickerWidget';

// The home-screen sticker widget is drawn by this handler, which the
// launcher calls in a headless task - so it is registered at the entry,
// beside the app, not inside it. Android only: the browser gets the
// empty .web sibling, the same pattern every native-only piece follows.
export function registerWidgets() {
  registerWidgetTaskHandler(stickerWidgetTaskHandler);
}
