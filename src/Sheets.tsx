import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from './sketch/icons/Ionicons';
import { useSoft } from './sketch/theme';
import { SOFT_MEDIUM, SOFT_SEMIBOLD } from './sketch/fonts';

// App-only bottom sheets: a list of actions, and a one-line name dialog.
export type SheetAction = {
  label: string;
  icon?: string;
  destructive?: boolean;
  checked?: boolean;
  header?: boolean; // a small grey heading, not a button
  onPress?: () => void;
};

export function ActionSheet({ title, actions, onClose }: { title?: string; actions: SheetAction[] | null; onClose: () => void }) {
  const S = useSoft();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={actions !== null} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: S.chrome, paddingBottom: insets.bottom + 16, boxShadow: S.popShadow }]}>
        <View style={[styles.grip, { backgroundColor: S.line }]} />
        {title ? <Text style={[styles.title, { color: S.ink }]} numberOfLines={1}>{title}</Text> : null}
        {(actions ?? []).map((a, i) =>
          a.header ? (
            <Text key={i} style={[styles.header, { color: S.ink3 }]}>{a.label}</Text>
          ) : (
            <Pressable
              key={i}
              onPress={() => {
                onClose();
                a.onPress?.();
              }}
              style={styles.item}
            >
              {a.icon ? <Ionicons name={a.icon as never} size={22} color={a.destructive ? '#D4503F' : S.ink} /> : null}
              <Text style={[styles.itemText, { color: a.destructive ? '#D4503F' : S.ink }]}>{a.label}</Text>
              {a.checked ? <Ionicons name="checkmark" size={22} color={S.accent} /> : null}
            </Pressable>
          )
        )}
      </View>
    </Modal>
  );
}

export function NameDialog({
  visible,
  title,
  initial,
  confirm,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  title: string;
  initial: string;
  confirm: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const S = useSoft();
  const [text, setText] = useState(initial);
  useEffect(() => {
    if (visible) setText(initial);
  }, [visible, initial]);
  const ok = text.trim().length > 0;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.center}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.dialog, { backgroundColor: S.chrome, boxShadow: S.popShadow }]}>
          <Text style={[styles.title, { color: S.ink }]}>{title}</Text>
          <TextInput
            value={text}
            onChangeText={setText}
            autoFocus
            selectTextOnFocus
            maxLength={60}
            placeholderTextColor={S.ink3}
            style={[styles.input, { color: S.ink, backgroundColor: S.fill }]}
            onSubmitEditing={() => ok && onSubmit(text.trim())}
          />
          <View style={styles.buttons}>
            <Pressable onPress={onClose} style={[styles.btn, { backgroundColor: S.fill }]}>
              <Text style={[styles.btnText, { color: S.ink }]}>Скасувати</Text>
            </Pressable>
            <Pressable onPress={() => ok && onSubmit(text.trim())} style={[styles.btn, { backgroundColor: S.ink, opacity: ok ? 1 : 0.4 }]}>
              <Text style={[styles.btnText, { color: S.chrome }]}>{confirm}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 10 },
  grip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 14 },
  title: { fontSize: 20, fontFamily: SOFT_SEMIBOLD, marginBottom: 8 },
  header: { fontSize: 13, fontFamily: SOFT_MEDIUM, marginTop: 10, marginBottom: 2 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, height: 52 },
  itemText: { flex: 1, fontSize: 17, fontFamily: SOFT_MEDIUM },
  center: { flex: 1, justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)', padding: 24 },
  dialog: { borderRadius: 28, padding: 20 },
  input: { height: 50, borderRadius: 16, paddingHorizontal: 16, fontSize: 17, fontFamily: SOFT_MEDIUM, marginTop: 6 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 16 },
  btn: { flex: 1, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 16, fontFamily: SOFT_SEMIBOLD },
});
