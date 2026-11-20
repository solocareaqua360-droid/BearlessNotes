import { useEffect } from 'react';

// Toning a picture for a tile's background, in a browser: not here.
//
// The real one does the work inside a WebView (a canvas, in a page of its
// own) and reads the result back off the phone's disk - neither of which
// exists in a browser, react-native-webview having no web build. It could
// be rebuilt on the page's own canvas one day, and cheaply; it is not what
// the browser build needed first.
//
// Answers rather than hangs, so a caller that starts a job gets an error
// once and can put its progress away.
export type StylistRequest = { uri: string; color: string };

export default function BackgroundStylist({
  request,
  onError,
}: {
  request: StylistRequest | null;
  onDone: (uri: string) => void;
  onError: (message: string) => void;
}) {
  useEffect(() => {
    if (!request) return;
    onError('Стилізація фону працює лише в застосунку на телефоні.');
    // onError is a fresh closure every render; the request is the event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);
  return null;
}
