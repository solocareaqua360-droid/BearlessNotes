import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { doc, updateDoc } from '../firestore';
import { db } from '../firebase';
import Sheet from './surfaces/Sheet';
import StableTextInput from './StableTextInput';
import { useFlashcardLive } from '../hooks/useFlashcardLive';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';

// THE TWO FIELDS OF A CARD FROM «КАРТКИ», FILLED WHERE IT STANDS (the board, 2026-10-24: a card made on the board had nowhere
// to be written in). Term and explanation, saved into the card itself; pictures, folders and the rest stay in the base's own
// editor. Opened by the board for a card it has just made, and by a second tap on one that is already unfolded.
export default function FlashcardQuickSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const card = useFlashcardLive(id ?? undefined, { id: id ?? '', term: '', explanation: '', images: [] });
  const [term, setTerm] = useState('');
  const [explanation, setExplanation] = useState('');
  // Read once when it opens: what is typed must not be overwritten by the live copy arriving.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!id) {
      setLoadedFor(null);
      return;
    }
    if (loadedFor !== id && (card.updatedAt > 0 || card.term || card.explanation)) {
      setTerm(card.term);
      setExplanation(card.explanation);
      setLoadedFor(id);
    }
  }, [id, loadedFor, card.updatedAt, card.term, card.explanation]);

  async function save() {
    if (!id) return;
    try {
      await updateDoc(doc(db, 'flashcards', id), { term: term.trim(), explanation: explanation.trim(), updatedAt: Date.now() });
    } catch {
      // The card keeps what it had; the sheet closes all the same.
    }
    onClose();
  }

  return (
    <Sheet visible={id !== null} onClose={onClose} title="Картка" maxHeight="90%">
      <Text style={styles.label}>Термін</Text>
      <StableTextInput style={[styles.input, { minHeight: 48, maxHeight: 96 }]} value={term} onChangeText={setTerm} placeholder="Що це" placeholderTextColor={theme.field.placeholder} multiline />
      <Text style={styles.label}>Пояснення</Text>
      <StableTextInput
        style={[styles.input, { minHeight: 110, maxHeight: 230 }]}
        value={explanation}
        onChangeText={setExplanation}
        placeholder="Розгорнеться під терміном - необовʼязково"
        placeholderTextColor={theme.field.placeholder}
        multiline
        textAlignVertical="top"
      />
      <View style={styles.row}>
        <Pressable style={styles.side} onPress={onClose}>
          <Text style={styles.sideText}>Скасувати</Text>
        </Pressable>
        <Pressable style={styles.main} onPress={save}>
          <Text style={styles.mainText}>Зберегти</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    label: { fontSize: 13, fontFamily: FONT_SEMIBOLD, color: theme.ink.muted, marginTop: 8, marginBottom: 6 },
    input: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.field.edge,
      backgroundColor: theme.field.fill,
      color: theme.ink.primary,
      fontFamily: FONT_REGULAR,
      fontSize: 16,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    row: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
    side: { height: 44, borderRadius: 22, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.field.edge },
    sideText: { fontSize: 15, fontFamily: FONT_SEMIBOLD, color: theme.ink.primary },
    main: { height: 44, borderRadius: 22, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.ink.primary },
    mainText: { fontSize: 15, fontFamily: FONT_SEMIBOLD, color: theme.canvas.card },
  });
