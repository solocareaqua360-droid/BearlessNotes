import { useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import TextRecognizer, { type RecognizeProgress, type RecognizeRequest, type RecognizedPage } from './TextRecognizer';
import TextSelection from './TextSelection';
import { notify } from './surfaces/Ask';
import { tidyRecognized } from '../utils/recognizedText';
import { SOFT_MEDIUM } from '../utils/fonts';

// «ТЕКСТ» OF THE PHOTO VIEWER where there is no note to put it in (the Photos base, the explorer; 2026-10-24, the user: «а де
// ділась 4 кнопка текст»): the same reading as in a note (TextRecognizer, on the phone, Ukrainian), the same picking off the
// page (TextSelection) - and what is picked goes to the clipboard, to be pasted wherever it is wanted.
export default function PhotoTextReader({ request, onDone }: { request: RecognizeRequest | null; onDone: () => void }) {
  const [progress, setProgress] = useState<RecognizeProgress | null>(null);
  const [pages, setPages] = useState<RecognizedPage[] | null>(null);
  const reading = request !== null && pages === null;
  const finish = () => {
    setPages(null);
    setProgress(null);
    onDone();
  };
  return (
    <>
      <TextRecognizer
        request={pages === null ? request : null}
        onProgress={setProgress}
        onDone={(found) => {
          setProgress(null);
          if (!found.some((p) => p.words.length > 0)) {
            notify('Нічого не знайшлось', 'На цьому знімку не вдалося прочитати текст.');
            finish();
            return;
          }
          setPages(found);
        }}
        onError={(message) => {
          notify('Не вдалося розпізнати', message);
          finish();
        }}
      />
      <TextSelection
        pages={pages}
        onClose={finish}
        insertLabel="Копіювати"
        insertIcon="copy-outline"
        onInsert={(text) => {
          const tidied = tidyRecognized(text);
          finish();
          if (!tidied) return;
          Clipboard.setStringAsync(tidied).then(
            // The phone says «Скопійовано» itself; a browser says nothing, so it is told.
            () => {
              if (Platform.OS === 'web') notify('Скопійовано', 'Текст можна вставити в нотатку чи будь-куди.');
            },
            (e) => notify('Не вдалося скопіювати', (e as Error).message)
          );
        }}
      />
      {/* It takes seconds, not an instant - so it says so. */}
      {reading && (
        <View style={styles.toast} pointerEvents="none">
          <ActivityIndicator color="#fff" />
          <Text style={styles.toastLabel}>
            {progress?.stage ?? 'Читаю текст'}
            {progress && progress.progress > 0 ? ` · ${Math.round(progress.progress * 100)}%` : ''}
          </Text>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 110,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(30,30,32,0.94)',
  },
  toastLabel: { color: '#fff', fontSize: 14, fontFamily: SOFT_MEDIUM },
});
