import { useImperativeHandle, useMemo, useRef, type Ref } from 'react';
import { StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

export type ArticleBodyHandle = { clearSelection: () => void };

// A saved article's reading page (see readerHtml), in a WebView because
// that is where real text selection lives on the phone - handles, drag,
// across paragraphs - and the page reports what is selected back here.
// The browser build draws the same page in an iframe (ArticleBody.web).
export default function ArticleBody({
  html,
  onSelectionChange,
  ref,
}: {
  html: string;
  onSelectionChange: (text: string) => void;
  ref?: Ref<ArticleBodyHandle>;
}) {
  const webRef = useRef<WebView>(null);
  useImperativeHandle(
    ref,
    () => ({
      clearSelection: () => webRef.current?.injectJavaScript('window.__clearSelection && window.__clearSelection(); true;'),
    }),
    []
  );
  const source = useMemo(() => ({ html }), [html]);
  return (
    <WebView
      ref={webRef}
      source={source}
      originWhitelist={['*']}
      style={styles.fill}
      setSupportMultipleWindows={false}
      onMessage={(event) => {
        try {
          const message = JSON.parse(event.nativeEvent.data);
          if (message?.type === 'selection') onSelectionChange(String(message.text ?? ''));
        } catch {
          // Only this page's own script posts here.
        }
      }}
    />
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
