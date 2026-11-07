import { Pressable, StyleSheet, Text } from 'react-native';
import { Ionicons } from './icons/Ionicons';
import { useSoft } from '../theme/soft';
import { SOFT_MEDIUM } from '../utils/fonts';

// THE CONVERSATION'S INSTRUCTION, as one quiet line under the header (sketch chato, 2026-10-24): it says the AI is following
// something the person wrote, and opens the editor. Nothing when there is no instruction.
export default function ChatInstructionChip({ instruction, onPress }: { instruction?: string; onPress: () => void }) {
  const S = useSoft();
  const text = instruction?.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return (
    <Pressable onPress={onPress} style={[styles.chip, { backgroundColor: S.dark ? '#534034' : '#F9EAE0' }]} accessibilityLabel="Інструкція розмови">
      <Ionicons name="book-outline" size={17} color={S.accent} />
      <Text style={[styles.text, { color: S.ink }]} numberOfLines={1}>{`Інструкція: ${text}`}</Text>
      <Ionicons name="chevron-forward" size={15} color={S.ink2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { height: 38, borderRadius: 19, marginHorizontal: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8 },
  text: { flex: 1, fontSize: 13.5, fontFamily: SOFT_MEDIUM },
});
