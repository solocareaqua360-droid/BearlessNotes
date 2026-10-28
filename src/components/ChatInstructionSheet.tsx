import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import TextInput from './AppTextInput';
import ChatSheetFrame from './ChatSheetFrame';
import { useSoft } from '../theme/soft';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import { SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';

// «ІНСТРУКЦІЯ РОЗМОВИ» (sketch chatp, 2026-10-24): what the AI always follows in THIS conversation. A text field, three quick
// phrases that add a sentence to it, «Прибрати» and «Зберегти».
const QUICK: { label: string; sentence: string }[] = [
  { label: 'Коротко', sentence: 'Відповідай коротко.' },
  { label: 'Як для школяра', sentence: 'Пояснюй просто, як для школяра.' },
  { label: 'Завжди з прикладом', sentence: 'До кожного пояснення додавай приклад.' },
];

export default function ChatInstructionSheet({
  visible,
  value,
  onSave,
  onClear,
  onClose,
}: {
  visible: boolean;
  value?: string;
  onSave: (text: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const S = useSoft();
  const keyboard = useKeyboardHeight();
  const styles = useMemo(() => makeStyles(S), [S]);
  const [text, setText] = useState(value ?? '');
  // Opened afresh each time with what is saved.
  useEffect(() => {
    if (visible) setText(value ?? '');
  }, [visible, value]);
  const add = (sentence: string) => setText((t) => (t.includes(sentence) ? t : `${t.trim()}${t.trim() ? ' ' : ''}${sentence}`));
  return (
    <ChatSheetFrame visible={visible} onClose={onClose} top={keyboard > 0 ? 60 : 150}>
      <View style={{ paddingHorizontal: 4 }}>
        <Text style={styles.title}>Інструкція розмови</Text>
        <Text style={styles.sub}>ШІ дотримується цього в кожній відповіді цієї розмови.</Text>
      </View>
      <View style={styles.field}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Наприклад: відповідай коротко, спершу висновок, потім причини."
          placeholderTextColor={S.ink3}
          style={styles.input}
          multiline
          textAlignVertical="top"
          autoFocus
        />
      </View>
      <View style={styles.quick}>
        {QUICK.map((q) => (
          <Pressable key={q.label} onPress={() => add(q.sentence)} style={styles.hint}>
            <Text style={styles.hintText}>{q.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flex: 1 }} />
      <View style={styles.buttons}>
        <Pressable
          onPress={() => {
            setText('');
            onClear();
          }}
          style={styles.side}
          accessibilityLabel="Прибрати інструкцію"
        >
          <Text style={styles.sideText}>Прибрати</Text>
        </Pressable>
        <Pressable onPress={() => onSave(text.trim())} style={styles.main} accessibilityLabel="Зберегти інструкцію">
          <Text style={styles.mainText}>Зберегти</Text>
        </Pressable>
      </View>
    </ChatSheetFrame>
  );
}

function makeStyles(S: ReturnType<typeof useSoft>) {
  return StyleSheet.create({
    title: { fontSize: 20, fontFamily: SOFT_SEMIBOLD, color: S.ink },
    sub: { fontSize: 12.5, lineHeight: 18, fontFamily: SOFT_REGULAR, color: S.ink2, marginTop: 2 },
    field: { borderRadius: 22, backgroundColor: S.card, paddingHorizontal: 16, paddingVertical: 12, minHeight: 150, boxShadow: S.shadow } as never,
    input: { fontSize: 15.5, lineHeight: 23, fontFamily: SOFT_REGULAR, color: S.ink, minHeight: 120, padding: 0 },
    quick: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    hint: { height: 36, borderRadius: 18, paddingHorizontal: 14, borderWidth: 1, borderColor: S.line, alignItems: 'center', justifyContent: 'center' },
    hintText: { fontSize: 13.5, fontFamily: SOFT_MEDIUM, color: S.ink },
    buttons: { flexDirection: 'row', gap: 10, justifyContent: 'center' },
    side: { height: 40, borderRadius: 20, paddingHorizontal: 20, backgroundColor: S.card, alignItems: 'center', justifyContent: 'center', boxShadow: S.shadow } as never,
    sideText: { fontSize: 15, fontFamily: SOFT_MEDIUM, color: S.ink },
    main: { height: 40, borderRadius: 20, paddingHorizontal: 22, backgroundColor: S.ink, alignItems: 'center', justifyContent: 'center' },
    mainText: { fontSize: 15, fontFamily: SOFT_MEDIUM, color: S.card },
  });
}
