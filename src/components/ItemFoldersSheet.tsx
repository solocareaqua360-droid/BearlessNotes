import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import Sheet from './surfaces/Sheet';
import { Ionicons } from './icons/Ionicons';
import { useTheme } from '../theme/ThemeProvider';

// «ПАПКИ» OF A THING (the single explorer): one thing may lie in several
// folders at once - each ticked folder is one more place it stands (the user's
// model: like a shortcut). `initial` = the folders it is in now (for several
// things: the ones ALL of them share); saving reports what was added and what
// was taken away, and the caller does the filing.
export default function ItemFoldersSheet({
  visible,
  paths,
  initial,
  count,
  onSave,
  onClose,
}: {
  visible: boolean;
  paths: string[];
  initial: string[];
  count: number;
  onSave: (add: string[], remove: string[]) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (visible) setPicked(new Set(initial));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const toggle = (p: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  const sorted = [...paths].sort((a, b) => a.localeCompare(b));
  return (
    <Sheet visible={visible} onClose={onClose} title={count > 1 ? `Папки для (${count})` : 'Папки'}>
      {sorted.length === 0 && <Text style={[styles.hint, { color: theme.ink.faint }]}>Папок ще немає. Створіть першу в «⋯» → «Нова папка».</Text>}
      <ScrollView style={styles.listBox} showsVerticalScrollIndicator={false}>
        {sorted.map((p) => {
          const on = picked.has(p);
          const depth = p.split('/').length - 1;
          return (
            <Pressable key={p} style={[styles.row, { paddingLeft: depth * 18 }]} onPress={() => toggle(p)}>
              <View style={[styles.box, { borderColor: on ? theme.accent : theme.ink.faint }, on && { backgroundColor: theme.accent }]}>
                {on && <Ionicons name="checkmark" size={15} color={theme.onAccent} />}
              </View>
              <Text style={[styles.rowText, { color: theme.ink.primary }]} numberOfLines={1}>
                {p.split('/').pop()}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <Text style={[styles.hint, { color: theme.ink.faint }]}>Позначай кожну папку окремо: річ буде в усіх позначених, а вкладені не підтягуються самі.</Text>
      <View style={styles.buttons}>
        <Pressable onPress={onClose} style={[styles.button, { borderColor: theme.edge.hairline, borderWidth: 1.5 }]}>
          <Text style={[styles.buttonText, { color: theme.ink.primary }]}>Скасувати</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            const before = new Set(initial);
            onSave(
              sorted.filter((p) => picked.has(p) && !before.has(p)),
              sorted.filter((p) => !picked.has(p) && before.has(p))
            );
          }}
          style={[styles.button, { backgroundColor: theme.accent }]}
        >
          <Text style={[styles.buttonText, { color: theme.onAccent }]}>Готово</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  listBox: { maxHeight: 360 },
  hint: { fontSize: 12, lineHeight: 17, marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  box: { width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, fontSize: 15.5 },
  buttons: { flexDirection: 'row', gap: 8, marginTop: 14, marginBottom: 4 },
  button: { flex: 1, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 14, fontWeight: '600' },
});
