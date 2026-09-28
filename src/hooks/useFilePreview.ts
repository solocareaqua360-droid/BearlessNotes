import { useEffect, useState } from 'react';
import { previewFor, requestPreview, subscribeToPreviews } from '../utils/filePreviews';
import { quickLookKindFor } from '../components/DocumentQuickLook';

// A card's own preview: whatever is already known, and a request for it if
// it is not. Nothing is computed here - the one hidden worker does that
// (see FilePreviewWorker) - so a list of fifty files costs fifty lookups
// in a map.
export function useFilePreview(file: { id: string; fileName: string; fileUri?: string }) {
  const [, bump] = useState(0);
  useEffect(() => subscribeToPreviews(() => bump((n) => n + 1)), []);

  const kind = quickLookKindFor(file.fileName);
  useEffect(() => {
    if (!kind || !file.fileUri) return;
    requestPreview({ id: file.id, uri: file.fileUri, kind });
  }, [file.id, file.fileUri, kind]);

  const preview = previewFor(file.id);
  return preview?.failed ? undefined : preview;
}
