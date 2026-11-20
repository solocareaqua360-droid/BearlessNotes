import { useRef, useState } from 'react';

const AUTO_DISMISS_MS = 5000;

export type DownloadToastState = { fileName: string; uri: string; mimeType: string };

// A transient banner after a file lands on-device via the Storage Access
// Framework (see downloadToDevice/downloadPhoto) - "Показати в папці" opens
// the OS app chooser on that exact file (Android has no cross-app "reveal
// highlighted in Files" intent, so this is the closest a normal app can get)
// and "Ігнорувати" or a 5s timeout dismiss it, same shape as UndoToast's
// pending-delete banner.
export function useDownloadToast() {
  const [toast, setToast] = useState<DownloadToastState | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showDownloadToast(fileName: string, uri: string, mimeType: string) {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setToast({ fileName, uri, mimeType });
    timeoutRef.current = setTimeout(() => setToast(null), AUTO_DISMISS_MS);
  }

  function dismissDownloadToast() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    setToast(null);
  }

  return { downloadToast: toast, showDownloadToast, dismissDownloadToast };
}
