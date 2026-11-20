import { Pressable, StyleSheet, Text, View } from 'react-native';
import Sheet from './surfaces/Sheet';
import { useTheme } from '../theme/ThemeProvider';
import { CHAT_BIN_DAYS, type ChatMessage } from '../utils/chat';

// THE CHAT'S BIN (2026-10-07). A deleted message waits here for CHAT_BIN_DAYS
// and can be put back; from here it can also be removed for good. Buttons are
// full-size and named, never a corner icon.
export default function ChatBinSheet({
  visible,
  onClose,
  items,
  label,
  onRestore,
  onPurge,
}: {
  visible: boolean;
  onClose: () => void;
  items: ChatMessage[];
  // What a message with no text of its own is called (its first attachment).
  label: (message: ChatMessage) => string;
  onRestore: (id: string) => void;
  onPurge: (id: string) => void;
}) {
  const theme = useTheme();
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Кошик"
      subtitle={`Видалені повідомлення зберігаються ${CHAT_BIN_DAYS} днів`}
      scroll
      maxHeight="80%"
    >
      {items.length === 0 ? (
        <Text style={[styles.empty, { color: theme.ink.muted }]}>У кошику порожньо</Text>
      ) : (
        items.map((m) => {
          const daysLeft = Math.max(0, CHAT_BIN_DAYS - Math.floor((Date.now() - (m.deletedAt ?? 0)) / 86400000));
          return (
            <View key={m.id} style={[styles.row, { backgroundColor: theme.surface }]}>
              <Text numberOfLines={3} style={[styles.text, { color: theme.ink.primary }]}>
                {m.text.trim() || label(m)}
              </Text>
              <Text style={[styles.meta, { color: theme.ink.muted }]}>
                {new Date(m.createdAt).toLocaleDateString('uk-UA')} · зникне через {daysLeft} дн.
              </Text>
              <View style={styles.buttons}>
                <Pressable onPress={() => onRestore(m.id)} style={[styles.button, { backgroundColor: theme.accent }]}>
                  <Text style={[styles.buttonText, { color: '#fff' }]}>Відновити</Text>
                </Pressable>
                <Pressable onPress={() => onPurge(m.id)} style={[styles.button, { borderColor: theme.danger, borderWidth: 1.5 }]}>
                  <Text style={[styles.buttonText, { color: theme.danger }]}>Назавжди</Text>
                </Pressable>
              </View>
            </View>
          );
        })
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  empty: { fontSize: 15, textAlign: 'center', paddingVertical: 28 },
  row: { borderRadius: 16, padding: 14, marginBottom: 10, gap: 6 },
  text: { fontSize: 15, lineHeight: 20 },
  meta: { fontSize: 12 },
  buttons: { flexDirection: 'row', gap: 8, marginTop: 6 },
  button: { flex: 1, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 14, fontWeight: '600' },
});
