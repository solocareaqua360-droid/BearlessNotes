import { useEffect } from 'react';

// Reading text off a picture, in a browser: not here.
//
// The real recogniser is Tesseract running inside a WebView, fed by files
// the phone holds on disk (see TextRecognizer.tsx). Both halves of that
// are missing here - react-native-webview has no web build, and the pages
// it would read are local paths a browser may not open. This could
// genuinely be rebuilt for the page one day, since Tesseract is a browser
// library to begin with; it is the file handling around it that is the
// work, not the reading.
//
// Until then this answers rather than hangs. A caller that starts a
// recognition gets a plain error, once, and can put its UI away - a
// component that simply rendered nothing would leave a progress dialog up
// for ever.

export type RecognizeRequest = { uris: string[] };
export type { RecognizedWord, RecognizedPage } from '../utils/recognizedText';
export type RecognizeProgress = { page: number; of: number; progress: number; stage?: string };

export default function TextRecognizer({
  request,
  onError,
}: {
  request: RecognizeRequest | null;
  onProgress: (progress: RecognizeProgress) => void;
  onDone: (pages: import('../utils/recognizedText').RecognizedPage[]) => void;
  onError: (message: string) => void;
}) {
  useEffect(() => {
    if (!request) return;
    onError('Розпізнавання тексту працює лише в застосунку на телефоні.');
    // onError is a fresh closure every render; the request is the event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);
  return null;
}
