import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
// gesture-handler's ScrollView, not the core RN one: on Android a drag that
// starts on a TextInput never reaches an RN ScrollView's scroll recognition,
// so a sheet with a search/name field only scrolled when a finger happened to
// land between rows. Same fix, same reason, as FieldsEditorSheet.
import { ScrollView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { onSnapshot } from '../firestore';
import { ownedQuery } from '../utils/owned';
import { SHEET_BACKDROP, SHEET_WINDOW } from '../constants/glass';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import GlassLayer from './GlassLayer';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';

type PickableDocument = { id: string; title: string };
type PickableBoard = { id: string; title: string };

type Props = {
  visible: boolean;
  title: string;
  // The one caller-specific choice, shown first and highlighted - "У базу"
  // for Files/Photos/Links' own "+", "Зберегти в Посилання" / "Зберегти як
  // стікер" for ShareIntentHandler. Every other row (Сьогодні / notes /
  // boards) is the same for every caller, so it's the only thing that
  // varies between them.
  defaultLabel?: string;
  onPickDefault?: () => void;
  // The three note destinations are optional, and left out together:
  // a caller with something that is already a note has only boards to
  // offer (see boardsOnly).
  onPickToday?: () => void;
  onPickNew?: () => void;
  // The title comes with the id because a caller that RECORDS where
  // something went needs the name, and the sheet is holding it already.
  onPickExisting?: (documentId: string, title: string) => void;
  // Boards and nothing else - the whole note half of the sheet goes.
  boardsOnly?: boolean;
  // The other way round: notes and nothing else, for something that is
  // already on a board or has no business being on one.
  notesOnly?: boolean;
  onPickNewBoard?: () => void;
  onPickExistingBoard?: (boardId: string) => void;
  onClose: () => void;
};

// Where a newly created file/photo/link/geo point/video, or a shared
// link/text, should land: straight into its own database (the default,
// fast path everywhere this is offered from), today's daily note, a new or
// existing regular note, or a new or existing board. One shared sheet
// rather than a picker per screen, since the five non-default choices are
// identical everywhere.
export default function SaveDestinationSheet({
  visible,
  title,
  boardsOnly,
  notesOnly,
  defaultLabel,
  onPickDefault,
  onPickToday,
  onPickNew,
  onPickExisting,
  onPickNewBoard,
  onPickExistingBoard,
  onClose,
}: Props) {
  const theme = useTheme();
  const accent = theme.accent;
  const styles = useStyles(makeStyles);
  const keyboardHeight = useKeyboardHeight();
  const [documents, setDocuments] = useState<PickableDocument[]>([]);
  const [boards, setBoards] = useState<PickableBoard[]>([]);
  const [noteSearch, setNoteSearch] = useState('');
  const [boardSearch, setBoardSearch] = useState('');

  useEffect(() => {
    if (!visible) return;
    return onSnapshot(ownedQuery('documents'), (snapshot) => {
      setDocuments(
        [...snapshot.docs]
          .sort((a, b) => ((b.data().updatedAt as number) ?? 0) - ((a.data().updatedAt as number) ?? 0))
          .filter((d) => !d.data().calendarDate && !d.data().deletedAt)
          .map((d) => ({ id: d.id, title: d.data().title }))
      );
    });
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    return onSnapshot(ownedQuery('boards'), (snapshot) => {
      setBoards(
        [...snapshot.docs]
          .sort((a, b) => ((b.data().updatedAt as number) ?? 0) - ((a.data().updatedAt as number) ?? 0))
          .map((d) => ({ id: d.id, title: d.data().title }))
      );
    });
  }, [visible]);

  // Reset between openings - a search left over from one add shouldn't
  // still be filtering the list the next time this sheet opens.
  useEffect(() => {
    if (!visible) {
      setNoteSearch('');
      setBoardSearch('');
    }
  }, [visible]);

  const noteNeedle = noteSearch.trim().toLowerCase();
  const filteredDocuments = noteNeedle
    ? documents.filter((d) => (d.title || 'Без назви').toLowerCase().includes(noteNeedle))
    : documents;
  const boardNeedle = boardSearch.trim().toLowerCase();
  const filteredBoards = boardNeedle
    ? boards.filter((b) => (b.title || 'Без назви').toLowerCase().includes(boardNeedle))
    : boards;

  return (
    <GlassLayer visible={visible} onClose={onClose}>
      {/* Backdrop as a SIBLING behind the sheet, not its parent - as a
          parent it took the RN touch responder for every drag that did
          not land on a deeper child, which is what kept the list from
          scrolling. A tap outside still closes it. */}
      <View style={[styles.backdrop, { paddingBottom: keyboardHeight }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>{title}</Text>

          <ScrollView keyboardShouldPersistTaps="handled">
            {defaultLabel && onPickDefault && (
              <Pressable style={styles.row} onPress={onPickDefault}>
                <View style={styles.actionIcon}>
                  <Ionicons name="flash-outline" size={16} color={accent} />
                </View>
                <Text style={[styles.rowText, styles.rowTextAction]}>{defaultLabel}</Text>
              </Pressable>
            )}

            {!boardsOnly && onPickToday && (
              <Pressable style={styles.row} onPress={onPickToday}>
                <View style={styles.actionIcon}>
                  <Ionicons name="today-outline" size={16} color={accent} />
                </View>
                <Text style={[styles.rowText, styles.rowTextAction]}>Сьогодні</Text>
              </Pressable>
            )}

            {!boardsOnly && onPickNew && (
              <Pressable style={styles.row} onPress={onPickNew}>
                <View style={styles.actionIcon}>
                  <Ionicons name="add" size={16} color={accent} />
                </View>
                <Text style={[styles.rowText, styles.rowTextAction]}>Нова нотатка</Text>
              </Pressable>
            )}

            {!boardsOnly && (
            <>
            <Text style={styles.sectionLabel}>Існуюча нотатка</Text>
            <View style={styles.searchRow}>
              <Ionicons name="search" size={14} color={theme.ink.faint} />
              <TextInput
                value={noteSearch}
                onChangeText={setNoteSearch}
                placeholder="Пошук за назвою"
                placeholderTextColor={theme.ink.faint}
                style={styles.searchInput}
              />
            </View>
            {filteredDocuments.length === 0 ? (
              <Text style={styles.emptyLabel}>Нічого не знайдено</Text>
            ) : (
              filteredDocuments.map((d) => (
                <Pressable key={d.id} style={styles.row} onPress={() => onPickExisting?.(d.id, d.title || 'Без назви')}>
                  <View style={styles.docIcon}>
                    <Ionicons name="document-text-outline" size={16} color={accent} />
                  </View>
                  <Text style={styles.rowText} numberOfLines={1}>
                    {d.title || 'Без назви'}
                  </Text>
                </Pressable>
              ))
            )}
            </>
            )}

            {!notesOnly && (
            <>
            <Pressable style={styles.row} onPress={() => onPickNewBoard?.()}>
              <View style={styles.actionIcon}>
                <Ionicons name="add" size={16} color={accent} />
              </View>
              <Text style={[styles.rowText, styles.rowTextAction]}>Нова дошка</Text>
            </Pressable>

            <Text style={styles.sectionLabel}>Існуюча дошка</Text>
            <View style={styles.searchRow}>
              <Ionicons name="search" size={14} color={theme.ink.faint} />
              <TextInput
                value={boardSearch}
                onChangeText={setBoardSearch}
                placeholder="Пошук за назвою"
                placeholderTextColor={theme.ink.faint}
                style={styles.searchInput}
              />
            </View>
            {filteredBoards.length === 0 ? (
              <Text style={styles.emptyLabel}>Нічого не знайдено</Text>
            ) : (
              filteredBoards.map((b) => (
                <Pressable key={b.id} style={styles.row} onPress={() => onPickExistingBoard?.(b.id)}>
                  <View style={styles.docIcon}>
                    <Ionicons name="grid-outline" size={16} color={accent} />
                  </View>
                  <Text style={styles.rowText} numberOfLines={1}>
                    {b.title || 'Без назви'}
                  </Text>
                </Pressable>
              ))
            )}
            </>
            )}
          </ScrollView>
        </View>
      </View>
    </GlassLayer>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  backdrop: {
    ...SHEET_BACKDROP,
  },
  sheet: {
    backgroundColor: t.raised,
    ...SHEET_WINDOW,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    maxHeight: '80%',
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: t.edge.hairline,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: t.ink.primary,
    marginBottom: 4,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: t.ink.faint,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingTop: 10,
    paddingBottom: 2,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: t.edge.hairline,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 4,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: t.ink.primary,
  },
  emptyLabel: {
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: t.ink.faint,
    textAlign: 'center',
    paddingVertical: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  docIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: t.selected,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: t.selected,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    color: t.ink.primary,
  },
  rowTextAction: {
    color: t.accent,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
  },
});
