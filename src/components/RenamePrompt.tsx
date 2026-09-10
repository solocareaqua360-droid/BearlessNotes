import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

const ACCENT = '#3B82F6';

type Props = {
  visible: boolean;
  title: string;
  initialValue: string;
  placeholder?: string;
  // Shows a spinner in place of the buttons and locks the field, for a
  // caller that has to go away and do something (fetch a link preview,
  // say) before it knows what to ask next. Lets one dialog stay mounted
  // across those steps instead of closing and reopening, which on Android
  // reads as a flicker between two modals.
  busy?: boolean;
  onCancel: () => void;
  onSave: (value: string) => void;
};

// Shared "always available" rename dialog - used by Links/Photos/Files
// screens (and DocumentEditorScreen's mandatory-name-on-conversion prompt
// has its own copy of this same shape, since that one guards a different,
// non-cancellable flow at the moment a link is first created).
export default function RenamePrompt({ visible, title, initialValue, placeholder, busy, onCancel, onSave }: Props) {
  const [value, setValue] = useState(initialValue);

  // `title` is in here as well as `initialValue` because a caller that
  // keeps this dialog open across two questions changes the heading to ask
  // the second one - the field has to clear with it, or the answer to the
  // first question is still sitting there.
  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue, title]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      {/* A transparent Modal renders in its own Android window, outside the
          activity's own resize handling - the keyboard just overlaps it
          instead of pushing it up, which is what buried the buttons under
          it. KeyboardAvoidingView is the fix Android still needs here even
          though the rest of the app relies on windowSoftInputMode for
          every non-Modal screen. */}
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <TextInput
            autoFocus
            editable={!busy}
            value={value}
            onChangeText={setValue}
            placeholder={placeholder ?? 'Назва'}
            style={[styles.input, busy && styles.inputBusy]}
          />
          {busy ? (
            <View style={styles.busyRow}>
              <ActivityIndicator color={ACCENT} />
            </View>
          ) : (
            <View style={styles.buttons}>
              <Pressable style={styles.cancelButton} onPress={onCancel}>
                <Text style={styles.cancelLabel}>Скасувати</Text>
              </Pressable>
              <Pressable
                style={[styles.saveButton, !value.trim() && styles.saveButtonDisabled]}
                disabled={!value.trim()}
                onPress={() => onSave(value.trim())}
              >
                <Text style={styles.saveLabel}>Зберегти</Text>
              </Pressable>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    gap: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
  },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
  },
  inputBusy: {
    color: '#9CA3AF',
  },
  // Same height the buttons row occupies, so swapping to the spinner
  // doesn't make the dialog jump.
  busyRow: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    marginTop: 4,
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 4,
  },
  cancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  cancelLabel: {
    fontSize: 15,
    color: '#6B7280',
  },
  saveButton: {
    backgroundColor: ACCENT,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  saveButtonDisabled: {
    backgroundColor: '#BFDBFE',
  },
  saveLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
});
