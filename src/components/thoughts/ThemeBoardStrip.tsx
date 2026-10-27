import { useEffect, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '../icons/Ionicons';
import { useSoft } from '../../theme/soft';
import { SOFT_BOLD, SOFT_REGULAR } from '../../utils/fonts';
import { setConclusion, type ThoughtTheme } from '../../hooks/useThoughts';

// UNDER A THEME BOARD'S TITLE (sketch artboard «Тема відкрита»): the theme's conclusion in one line - a tap writes it,
// the keyboard put away keeps it - and the switch between the board and the same theme read as a note.
export default function ThemeBoardStrip({
  theme,
  top,
  mode,
  onMode,
}: {
  theme: ThoughtTheme;
  top: number;
  mode: 'board' | 'note';
  onMode: (m: 'board' | 'note') => void;
}) {
  const S = useSoft();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(theme.conclusion);
  useEffect(() => {
    if (!editing) setDraft(theme.conclusion);
  }, [theme.conclusion, editing]);
  const save = () => {
    setEditing(false);
    if (draft.trim() !== theme.conclusion.trim()) setConclusion(theme.id, draft.trim()).catch(() => {});
  };
  useEffect(() => {
    if (!editing) return;
    const sub = Keyboard.addListener('keyboardDidHide', save);
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, draft]);

  const seg = (m: 'board' | 'note', icon: string, label: string) => (
    <Pressable
      onPress={() => onMode(m)}
      accessibilityLabel={label}
      accessibilityState={{ selected: mode === m }}
      style={[styles.seg, mode === m && { backgroundColor: S.dark ? '#48484C' : S.card }]}
    >
      <Ionicons name={icon as never} size={18} color={mode === m ? S.ink : S.ink3} />
    </Pressable>
  );

  return (
    <View style={[styles.strip, { top, backgroundColor: S.card, boxShadow: S.popShadow }, editing && styles.open]}>
      {editing ? (
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[styles.label, { color: S.ink3 }]}>Висновок теми</Text>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            autoFocus
            multiline
            autoCorrect={false}
            placeholder="Що з цього ти вже точно знаєш?"
            placeholderTextColor={S.ink3}
            onBlur={save}
            style={[styles.input, { color: S.ink }]}
          />
        </View>
      ) : (
        <Pressable onPress={() => setEditing(true)} style={styles.line} accessibilityLabel="Висновок теми">
          <Text style={[styles.text, { color: theme.conclusion ? S.ink : S.ink3 }]} numberOfLines={1}>
            {theme.conclusion || 'Що з цього ти вже точно знаєш?'}
          </Text>
        </Pressable>
      )}
      {!editing && (
        <View style={[styles.switch, { backgroundColor: S.fill }]}>
          {seg('board', 'easel-outline', 'Дошка')}
          {seg('note', 'document-text-outline', 'Нотатка')}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { position: 'absolute', left: 16, right: 16, minHeight: 48, borderRadius: 24, flexDirection: 'row', alignItems: 'center', paddingLeft: 18, paddingRight: 6, gap: 10, zIndex: 40 },
  open: { borderRadius: 20, paddingVertical: 12, paddingRight: 18, alignItems: 'flex-start' },
  line: { flex: 1, height: 48, justifyContent: 'center' },
  text: { fontSize: 15, fontFamily: SOFT_REGULAR },
  label: { fontSize: 11.5, fontFamily: SOFT_BOLD, letterSpacing: 0.5, textTransform: 'uppercase' },
  input: { fontSize: 16, lineHeight: 22, fontFamily: SOFT_REGULAR, padding: 0, maxHeight: 180, textAlignVertical: 'top' },
  switch: { flexDirection: 'row', gap: 2, padding: 3, borderRadius: 20 },
  seg: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
});
