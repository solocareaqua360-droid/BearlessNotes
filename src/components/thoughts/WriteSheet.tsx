import { useEffect, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import Sheet from '../surfaces/Sheet';
import StableTextInput from '../StableTextInput';
import { Ionicons } from '../icons/Ionicons';
import { useSoft } from '../../theme/soft';
import { SOFT_BOLD, SOFT_REGULAR } from '../../utils/fonts';

// A FIELD TO WRITE IN, over the keyboard (the quick-create window's own anchor): a card's words on the canvas, or a
// question to the assistant. Long text scrolls in the field; «Готово» or the keyboard's own key keeps it.
export default function WriteSheet({
  visible,
  title,
  placeholder,
  initial = '',
  doneLabel = 'Готово',
  onDone,
  onClose,
}: {
  visible: boolean;
  title: string;
  placeholder: string;
  initial?: string;
  doneLabel?: string;
  onDone: (text: string) => void;
  onClose: () => void;
}) {
  const S = useSoft();
  const [text, setText] = useState(initial);
  useEffect(() => {
    if (visible) setText(initial);
  }, [visible, initial]);
  const ok = text.trim().length > 0;
  return (
    <Sheet visible={visible} onClose={onClose} handle={false} anchor="bottom" inset={16} priority={25}>
      <View style={{ gap: 12 }}>
        <Text style={[styles.title, { color: S.ink }]}>{title}</Text>
        <StableTextInput
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={S.ink3}
          multiline
          autoFocus
          autoCorrect={false}
          spellCheck={false}
          style={[styles.input, { color: S.ink, backgroundColor: S.fill }]}
        />
        <Pressable
          disabled={!ok}
          onPress={() => {
            Keyboard.dismiss();
            onDone(text.trim());
          }}
          style={[styles.done, { backgroundColor: ok ? S.ink : S.fill }]}
        >
          <Ionicons name={'checkmark' as never} size={20} color={ok ? S.card : S.ink3} />
          <Text style={[styles.doneText, { color: ok ? S.card : S.ink3 }]}>{doneLabel}</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontFamily: SOFT_BOLD },
  input: { fontSize: 17, lineHeight: 24, fontFamily: SOFT_REGULAR, borderRadius: 16, padding: 14, minHeight: 110, maxHeight: 260, textAlignVertical: 'top' },
  done: { height: 52, borderRadius: 26, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  doneText: { fontSize: 16, fontFamily: SOFT_BOLD },
});
