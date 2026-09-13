import { useContext, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import GlassLayer from './GlassLayer';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import {
  GLASS_BODY_BLURRED,
  GLASS_EDGE,
  GLASS_INPUT,
  GLASS_LINE,
  GLASS_TEXT,
  GLASS_TEXT_FAINT,
  GLASS_TEXT_MUTED,
} from '../constants/glass';

type Props = {
  visible: boolean;
  title: string;
  initialValue: string;
  placeholder?: string;
  // Shows a spinner in place of the buttons and locks the field, for a
  // caller that has to go away and do something (fetch a link preview,
  // say) before it knows what to ask next. Lets one dialog stay mounted
  // across those steps instead of closing and reopening, which on Android
  // reads as a flicker between two windows.
  busy?: boolean;
  onCancel: () => void;
  onSave: (value: string) => void;
};

// «Питання», with something to type into: the shared naming dialog, used
// by nearly every screen in the app.
//
// It was a white card in a Modal of its own, which cost it three things.
// A Modal is a separate Android window, so the blur had nothing behind it
// to work on and the screen showed through sharp; that same window sits
// outside the activity's resize handling, so the keyboard overlapped the
// buttons and needed a KeyboardAvoidingView to be dragged back into view;
// and a TextInput inside a Modal nested in another Modal loses focus on
// Android the moment the keyboard opens - the bug that took three
// attempts in the sketch editor. As a layer inside the screen, all three
// stop existing.
export default function RenamePrompt({ visible, title, initialValue, placeholder, busy, onCancel, onSave }: Props) {
  const [value, setValue] = useState(initialValue);
  const insets = useContext(SafeAreaInsetsContext);

  // `title` is in here as well as `initialValue` because a caller that
  // keeps this dialog open across two questions changes the heading to ask
  // the second one - the field has to clear with it, or the answer to the
  // first question is still sitting there.
  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue, title]);

  return (
    <GlassLayer visible={visible} onClose={onCancel} intensity={60}>
      {/* Bottom of the screen rather than the middle: the keyboard is
          about to take the lower half, and the activity resizing under it
          carries the card up with it. */}
      <View style={[styles.card, { marginBottom: (insets?.bottom ?? 0) + 16 }]}>
        <Text style={styles.title}>{title}</Text>
        <TextInput
          autoFocus
          editable={!busy}
          value={value}
          onChangeText={setValue}
          placeholder={placeholder ?? 'Назва'}
          placeholderTextColor={GLASS_TEXT_FAINT}
          style={[styles.input, busy && styles.inputBusy]}
          onSubmitEditing={() => value.trim() && !busy && onSave(value.trim())}
          returnKeyType="done"
        />
        {busy ? (
          <View style={styles.busyRow}>
            <ActivityIndicator color={GLASS_TEXT} />
          </View>
        ) : (
          <View style={styles.buttons}>
            <Pressable
              style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
              onPress={onCancel}
            >
              <Text style={styles.cancelLabel}>Скасувати</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.saveButton,
                !value.trim() && styles.saveButtonDisabled,
                pressed && styles.pressed,
              ]}
              disabled={!value.trim()}
              onPress={() => onSave(value.trim())}
            >
              <Text style={styles.saveLabel}>Зберегти</Text>
            </Pressable>
          </View>
        )}
      </View>
    </GlassLayer>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    borderRadius: 28,
    // Lighter than an unblurred sheet: at the opaque strength the blur
    // underneath stops showing through at all.
    backgroundColor: GLASS_BODY_BLURRED,
    borderWidth: 1,
    borderColor: GLASS_EDGE,
    padding: 20,
    gap: 12,
  },
  title: {
    fontSize: 19,
    fontFamily: FONT_BOLD,
    color: GLASS_TEXT,
  },
  input: {
    backgroundColor: GLASS_INPUT,
    borderWidth: 1,
    borderColor: GLASS_LINE,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT,
  },
  inputBusy: {
    color: GLASS_TEXT_MUTED,
  },
  // Same height the buttons row occupies, so swapping to the spinner
  // doesn't make the dialog jump.
  busyRow: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    marginTop: 4,
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  pressed: {
    opacity: 0.6,
  },
  cancelButton: {
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  cancelLabel: {
    fontSize: 16,
    fontFamily: FONT_SEMIBOLD,
    color: GLASS_TEXT_MUTED,
  },
  saveButton: {
    backgroundColor: '#F5C77E',
    borderRadius: 18,
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  saveButtonDisabled: {
    opacity: 0.4,
  },
  saveLabel: {
    fontSize: 16,
    fontFamily: FONT_SEMIBOLD,
    color: '#171310',
  },
});
