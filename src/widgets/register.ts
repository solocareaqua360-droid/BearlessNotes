import { registerWidgetTaskHandler, registerWidgetConfigurationScreen } from 'react-native-android-widget';
import { stickerWidgetTaskHandler } from './stickerWidget';
import StickerWidgetConfigScreen from './StickerWidgetConfigScreen';

// The home-screen sticker widget: the task handler is what the launcher
// calls in a headless task to (re)draw it, and the configuration screen
// is what Android opens when the widget is placed or reconfigured (see
// widgetFeatures in app.json) - registered at the entry, beside the app,
// not inside it, since neither is reached through the app's own
// navigator. See stickerWidget.tsx and StickerWidgetConfigScreen.tsx.
// Android only: the browser gets the empty .web sibling, the pattern
// every native-only piece follows.
export function registerWidgets() {
  registerWidgetTaskHandler(stickerWidgetTaskHandler);
  registerWidgetConfigurationScreen(StickerWidgetConfigScreen);
}
