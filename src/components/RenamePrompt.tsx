import { useEffect, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import GlassLayer from './GlassLayer';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { SHEET_FRAME, SHEET_WINDOW } from '../constants/glass';

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
  // For text rather than a name: the box grows with what is in it and
  // Enter makes a line instead of saving. A whole spoken thought in a
  // one-line field ran off the end of it, which is no way to correct
  // anything - "вузька строчка з текстом який уходе за межі поля вводу".
  multiline?: boolean;
  // Lets Save fire with nothing typed - opt-in (default false, every
  // existing caller keeps requiring a real name) for a field that means
  // something by being cleared, like a list's own optional description.
  allowEmpty?: boolean;
  onCancel: () => void;
  onSave: (value: string) => void;
};

// «Питання», with something to type into: the shared naming dialog, used
// by nearly every screen in the app.
//
// It was a white card in a Modal of its own, which cost it three things.
// A Modal is a separate Android window, so the blur had nothing behind it
// to work on and the screen showed through sharp; and a TextInput inside a
// Modal nested in another Modal loses focus on Android the moment the
// keyboard opens - the bug that took three attempts in the sketch editor.
// As a layer inside the screen, both stop existing.
//
// The third, the keyboard covering the field, did NOT stop existing, and
// this file claimed it had. See the keyboard tracking below.
//
// Being a layer has its own price, and it is the caller's to pay: a layer
// draws inside the screen, so opening one from behind a Modal - the photo
// viewer, say - puts it underneath, where it stays invisible until that
// Modal closes. Close the Modal first.
export default function RenamePrompt({
  visible,
  title,
  initialValue,
  placeholder,
  busy,
  multiline,
  allowEmpty,
  onCancel,
  onSave,
}: Props) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const [value, setValue] = useState(initialValue);
  // Some Android keyboards (Samsung's own, confirmed on-device) silently
  // reset the cursor to the START of the field after every character
  // typed instead of leaving it where it was - a whole word types out
  // back to front ("things" -> "sgniht"), every single letter, not a
  // flake. Pinning `selection` explicitly after each change is what
  // overrides that; a real tap still moves it correctly, since
  // onSelectionChange keeps this in sync with wherever the user actually
  // put the cursor themselves.
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>(undefined);

  function handleChangeText(text: string) {
    setValue(text);
    setSelection({ start: text.length, end: text.length });
  }

  // Lifted clear of the keyboard by hand, the way TagPicker,
  // GroupPickerSheet and FieldsEditorSheet all already do it.
  //
  // The comment above says the screen resizing under the keyboard carries
  // this card up. It does not: KeyboardProvider (App.tsx) puts the window
  // edge-to-edge and takes that resize away, which is exactly why the
  // editor has to move its own toolbar by the keyboard's height. So this
  // card stayed where it was and the keyboard covered the field.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => setKeyboardHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // `title` is in here as well as `initialValue` because a caller that
  // keeps this dialog open across two questions changes the heading to ask
  // the second one - the field has to clear with it, or the answer to the
  // first question is still sitting there.
  useEffect(() => {
    if (visible) {
      setValue(initialValue);
      setSelection({ start: initialValue.length, end: initialValue.length });
    }
  }, [visible, initialValue, title]);

  return (
    <GlassLayer visible={visible} onClose={onCancel} intensity={60}>
      {/* Centred in what the keyboard leaves: the bottom margin is the
          keyboard's height, so the card sits in the middle of the free
          part of the screen rather than under the keys. */}
      <View style={styles.frame} pointerEvents="box-none">
      <View style={[styles.card, { marginBottom: keyboardHeight }]}>
        <Text style={styles.title}>{title}</Text>
        <TextInput
          autoFocus
          editable={!busy}
          value={value}
          onChangeText={handleChangeText}
          selection={selection}
          onSelectionChange={(e) => setSelection(e.nativeEvent.selection)}
          placeholder={placeholder ?? 'Назва'}
          placeholderTextColor={theme.ink.faint}
          multiline={multiline}
          style={[styles.input, multiline && styles.inputTall, busy && styles.inputBusy]}
          onSubmitEditing={
            multiline ? undefined : () => (allowEmpty || value.trim()) && !busy && onSave(value.trim())
          }
          returnKeyType={multiline ? 'default' : 'done'}
        />
        {busy ? (
          <View style={styles.busyRow}>
            <ActivityIndicator color={theme.ink.primary} />
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
                !allowEmpty && !value.trim() && styles.saveButtonDisabled,
                pressed && styles.pressed,
              ]}
              disabled={!allowEmpty && !value.trim()}
              onPress={() => onSave(value.trim())}
            >
              <Text style={styles.saveLabel}>Зберегти</Text>
            </Pressable>
          </View>
        )}
      </View>
      </View>
    </GlassLayer>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  frame: SHEET_FRAME,
  card: {
    ...SHEET_WINDOW,
    // Lighter than an unblurred sheet: at the opaque strength the blur
    // underneath stops showing through at all.
    backgroundColor: t.raised,
    borderWidth: 1,
    borderColor: t.edge.hairline,
    padding: 20,
    gap: 12,
  },
  title: {
    fontSize: 19,
    fontFamily: FONT_BOLD,
    color: t.ink.primary,
  },
  input: {
    backgroundColor: t.field.fill,
    borderWidth: 1,
    borderColor: t.edge.hairline,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: FONT_REGULAR,
    color: t.ink.primary,
  },
  inputTall: {
    minHeight: 110,
    maxHeight: 260,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
  inputBusy: {
    color: t.ink.muted,
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
    color: t.ink.muted,
  },
  saveButton: {
    backgroundColor: t.accent,
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
    color: t.onAccent,
  },
});
