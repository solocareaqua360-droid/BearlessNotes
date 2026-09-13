import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FONT_BOLD, FONT_REGULAR } from '../utils/fonts';
import { GLASS_BODY, GLASS_EDGE, GLASS_TEXT, GLASS_TEXT_MUTED } from '../constants/glass';

// The note editor, as far as the browser build is concerned: not here.
//
// This is deliberate, and it is what keeps the web bundle small. The real
// editor carries the scanner, the text recogniser, the file previews and
// the quick look - four native modules with no browser build between
// them - and the board only reaches for it to open a document card. One
// stub at this name and none of that enters the bundle at all.
//
// The board itself is the point of the browser build; notes are still
// written on the phone.
export default function DocumentEditorScreen({
  onClose,
}: {
  onClose?: () => void;
  [key: string]: unknown;
}) {
  return (
    <View style={styles.wrap}>
      <Ionicons name="phone-portrait-outline" size={30} color={GLASS_TEXT_MUTED} />
      <Text style={styles.title}>Нотатки поки що на телефоні</Text>
      <Text style={styles.body}>
        У браузері працює дошка. Редактор нотаток тягне за собою сканер і розпізнавання тексту, яких тут немає.
      </Text>
      {!!onClose && (
        <Pressable style={styles.button} onPress={onClose}>
          <Text style={styles.buttonLabel}>Закрити</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 32,
    backgroundColor: GLASS_BODY,
    borderLeftWidth: 1,
    borderLeftColor: GLASS_EDGE,
  },
  title: {
    fontSize: 17,
    fontFamily: FONT_BOLD,
    color: GLASS_TEXT,
    textAlign: 'center',
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT_MUTED,
    textAlign: 'center',
    maxWidth: 320,
  },
  button: {
    marginTop: 6,
    borderRadius: 16,
    backgroundColor: '#F5C77E',
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  buttonLabel: {
    fontSize: 15,
    fontFamily: FONT_BOLD,
    color: '#171310',
  },
});
