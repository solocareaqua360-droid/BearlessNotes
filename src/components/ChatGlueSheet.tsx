import { Pressable, StyleSheet, Text, View } from 'react-native';
import Sheet from './surfaces/Sheet';
import { useTheme } from '../theme/ThemeProvider';
import type { Block } from '../types';

// THE GLUE'S WINDOW (see utils/chatGlue): what has been stuck together, in
// order, with the ways on. «Редагувати» opens the draft in the note editor -
// that is where a word is mended or a piece moved.
export default function ChatGlueSheet({
  visible,
  onClose,
  blocks,
  onEdit,
  onToNote,
  onClear,
}: {
  visible: boolean;
  onClose: () => void;
  blocks: Block[];
  onEdit: () => void;
  onToNote: () => void;
  onClear: () => void;
}) {
  const theme = useTheme();
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Склейка"
      subtitle={blocks.length === 0 ? 'Поки порожньо' : `${blocks.length} шматків, у порядку склеювання`}
      scroll
      maxHeight="85%"
    >
      {blocks.map((b, i) => (
        <View key={b.id}>
          {i > 0 && <View style={[styles.seam, { borderColor: theme.ink.faint }]} />}
          <View style={[styles.piece, { backgroundColor: theme.surface }]}>
            <Text numberOfLines={4} style={[styles.text, { color: theme.ink.primary }]}>
              {b.text?.trim() || '…'}
            </Text>
          </View>
        </View>
      ))}
      <View style={styles.buttons}>
        <Pressable onPress={onEdit} style={[styles.button, { backgroundColor: theme.accent }]}>
          <Text style={[styles.buttonText, { color: '#fff' }]}>Редагувати</Text>
        </Pressable>
        <Pressable onPress={onToNote} style={[styles.button, { borderColor: theme.accent, borderWidth: 1.5 }]}>
          <Text style={[styles.buttonText, { color: theme.accent }]}>У нотатку</Text>
        </Pressable>
      </View>
      <Pressable onPress={onClear} style={[styles.button, styles.clear, { borderColor: theme.danger, borderWidth: 1.5 }]}>
        <Text style={[styles.buttonText, { color: theme.danger }]}>Розклеїти все</Text>
      </Pressable>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  piece: { borderRadius: 14, padding: 12 },
  // The line that says these two were stuck together.
  seam: { alignSelf: 'center', height: 10, borderLeftWidth: 1.5, borderStyle: 'dashed' },
  text: { fontSize: 15, lineHeight: 20 },
  buttons: { flexDirection: 'row', gap: 8, marginTop: 14 },
  button: { flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  clear: { marginTop: 8, flex: 0 },
  buttonText: { fontSize: 14, fontWeight: '600' },
});
