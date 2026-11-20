import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Sheet from './surfaces/Sheet';
import { useTheme } from '../theme/ThemeProvider';
import type { Block } from '../types';

// THE GLUE'S WINDOW (see utils/chatGlue): what has been stuck together, in
// order, with the ways on. «Редагувати» opens the draft in the note editor -
// that is where a word is mended or a piece moved. Every piece says where in
// the chat it came from, and takes you there.
function pieceLabel(b: Block): string {
  if (b.type === 'image') return b.imageTitle || 'Фото';
  if (b.type === 'file') return b.fileTitle || b.fileName || 'Файл';
  if (b.type === 'link') return b.linkTitle || b.linkUrl || b.text || 'Посилання';
  return b.text?.trim() || '…';
}

function kindMark(b: Block): string {
  if (b.type === 'file') return '📎 ';
  if (b.type === 'link') return b.linkSiteName === 'Геоточка' ? '📍 ' : '🔗 ';
  return '';
}

export default function ChatGlueSheet({
  visible,
  onClose,
  blocks,
  sources,
  onShow,
  onEdit,
  onToNote,
  onToProject,
  onClear,
}: {
  visible: boolean;
  onClose: () => void;
  blocks: Block[];
  sources: Record<string, string>;
  onShow: (chatId: string) => void;
  onEdit: () => void;
  onToNote: () => void;
  onToProject: () => void;
  onClear: () => void;
}) {
  const theme = useTheme();
  // Consecutive pieces of the same message are one group.
  const groups: { source?: string; blocks: Block[] }[] = [];
  blocks.forEach((b) => {
    const source = sources[b.id];
    const last = groups[groups.length - 1];
    if (last && source && last.source === source) last.blocks.push(b);
    else groups.push({ source, blocks: [b] });
  });
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Склейка"
      subtitle={blocks.length === 0 ? 'Поки порожньо' : `${blocks.length} шматків, у порядку склеювання`}
      scroll
      maxHeight="85%"
    >
      {groups.map((group, i) => (
        <View key={group.blocks[0].id}>
          {i > 0 && <View style={[styles.seam, { borderColor: theme.ink.faint }]} />}
          {/* One message is ONE frame, however many pieces it brought:
              the picture on top, the words, then a plain row for a file or
              a link - the seam is only between messages. */}
          <View style={[styles.piece, { backgroundColor: theme.surface }]}>
            {group.blocks.map((b, j) => (
              <View key={b.id} style={j > 0 ? [styles.row, { borderColor: theme.ink.faint }] : undefined}>
                {b.type === 'image' && !!b.imageUri && (
                  <Image source={{ uri: b.imageUri }} style={styles.picture} resizeMode="cover" />
                )}
                {(b.type !== 'image' || !b.imageUri) && (
                  <Text numberOfLines={4} style={[styles.text, { color: theme.ink.primary }]}>
                    {kindMark(b)}
                    {pieceLabel(b)}
                  </Text>
                )}
              </View>
            ))}
            {!!group.source && (
              <Pressable onPress={() => onShow(group.source!)} hitSlop={8}>
                <Text style={[styles.source, { color: theme.accent }]}>показати в чаті</Text>
              </Pressable>
            )}
          </View>
        </View>
      ))}
      <View style={styles.buttons}>
        <Pressable onPress={onEdit} style={[styles.button, { backgroundColor: theme.accent }]}>
          <Text style={[styles.buttonText, { color: '#fff' }]}>Редагувати</Text>
        </Pressable>
      </View>
      <View style={styles.buttons}>
        <Pressable onPress={onToNote} style={[styles.button, { borderColor: theme.accent, borderWidth: 1.5 }]}>
          <Text style={[styles.buttonText, { color: theme.accent }]}>У нотатку</Text>
        </Pressable>
        <Pressable onPress={onToProject} style={[styles.button, { borderColor: theme.accent, borderWidth: 1.5 }]}>
          <Text style={[styles.buttonText, { color: theme.accent }]}>У проект</Text>
        </Pressable>
      </View>
      <Pressable onPress={onClear} style={[styles.button, styles.clear, { borderColor: theme.danger, borderWidth: 1.5 }]}>
        <Text style={[styles.buttonText, { color: theme.danger }]}>Розклеїти все</Text>
      </Pressable>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  piece: { borderRadius: 14, padding: 12, gap: 6 },
  row: { borderTopWidth: 0.5, paddingTop: 6, marginTop: 2 },
  picture: { width: '100%', height: 120, borderRadius: 10 },
  // The line that says these two were stuck together.
  seam: { alignSelf: 'center', height: 10, borderLeftWidth: 1.5, borderStyle: 'dashed' },
  text: { fontSize: 15, lineHeight: 20 },
  source: { fontSize: 12, fontWeight: '600' },
  buttons: { flexDirection: 'row', gap: 8, marginTop: 8 },
  button: { flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  clear: { marginTop: 8, flex: 0 },
  buttonText: { fontSize: 14, fontWeight: '600' },
});
