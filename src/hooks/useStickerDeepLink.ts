import { useEffect, useRef } from 'react';
import { Linking } from 'react-native';
import { navigationRef } from '../navigationRef';

// Tapping the sticker widget on the home screen opens `mindeva://sticker/
// <id>` - see stickerWidgetElement's clickAction. Without this, "OPEN_APP"
// was all a tap could do: it brought the app to the front and left the
// user to go find the sticker themselves, in a database that carries no
// folders or search built for a single scrap of text.
//
// Two cases, because the app may not exist yet when the link arrives:
// already running (`addEventListener('url', ...)`), or launched BY this
// exact tap (`getInitialURL`) - and in the second case the navigator has
// not necessarily finished mounting the instant this effect runs, so a
// URL that arrives too early is held and replayed once it is.
const STICKER_URL = /^mindeva:\/\/sticker\/(.+)$/;

function openSticker(id: string) {
  if (navigationRef.isReady()) {
    navigationRef.navigate('Stickers', { openStickerId: id });
  }
}

export function useStickerDeepLink() {
  const pendingRef = useRef<string | null>(null);

  useEffect(() => {
    function handle(url: string) {
      const match = url.match(STICKER_URL);
      if (!match) return;
      if (navigationRef.isReady()) openSticker(match[1]);
      else pendingRef.current = match[1];
    }

    Linking.getInitialURL().then((url) => {
      if (url) handle(url);
    });
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));

    // The navigator's own "ready" event is the moment a held link can
    // finally be replayed - polling would work too, but this is the
    // signal React Navigation already provides for exactly this.
    const unsubscribeReady = navigationRef.addListener?.('state', () => {
      if (pendingRef.current && navigationRef.isReady()) {
        const id = pendingRef.current;
        pendingRef.current = null;
        openSticker(id);
      }
    });

    return () => {
      sub.remove();
      unsubscribeReady?.();
    };
  }, []);
}
