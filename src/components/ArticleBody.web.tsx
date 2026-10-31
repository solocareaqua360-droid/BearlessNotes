import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';

export type ArticleBodyHandle = { clearSelection: () => void };

// The browser's side of ArticleBody: the same reading page, in an iframe
// (react-native-webview has no browser build). srcDoc with no sandbox
// keeps the frame on this page's own origin, which is what lets
// clearSelection reach into it.
export default function ArticleBody({
  html,
  onSelectionChange,
  ref,
}: {
  html: string;
  onSelectionChange: (text: string) => void;
  ref?: Ref<ArticleBodyHandle>;
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  useImperativeHandle(
    ref,
    () => ({
      clearSelection: () => {
        const frameWindow = frameRef.current?.contentWindow as (Window & { __clearSelection?: () => void }) | null;
        frameWindow?.__clearSelection?.();
      },
    }),
    []
  );
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      try {
        const message = JSON.parse(String(event.data));
        if (message?.type === 'selection') onSelectionChange(String(message.text ?? ''));
      } catch {
        // Only this page's own script posts here.
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onSelectionChange]);
  return (
    <iframe
      ref={frameRef}
      srcDoc={html}
      title="Стаття"
      style={{ border: 0, width: '100%', height: '100%', flex: 1, background: 'transparent' }}
    />
  );
}
