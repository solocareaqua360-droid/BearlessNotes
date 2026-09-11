import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { collection, onSnapshot, orderBy, query } from '@react-native-firebase/firestore';
import { db } from '../firebase';
import { ImportableItem, MAX_CARDS_PER_COLUMN } from '../utils/importGroupToBoard';
import { hapticSelectItem, hapticWarning } from '../utils/haptics';

const ACCENT = '#3B82F6';

type BoardRow = { id: string; title: string };

type Props = {
  visible: boolean;
  groupName: string;
  // Set when the sheet is opened FROM a board: there is nothing to choose
  // about where the items go, so the second step is skipped entirely.
  fixedBoardId?: string;
  items: ImportableItem[];
  labelForKind: (kind: string) => string;
  titleForItem: (item: ImportableItem) => string;
  onCancel: () => void;
  onConfirm: (selected: ImportableItem[], target: { boardId: string } | { newBoard: true }) => void;
};

// Picking what of a group goes onto a board, and where. A group can hold a
// hundred items of mixed kinds; a board is a thinking surface, not a dump,
// so nothing is imported without being chosen - and no more than
// MAX_CARDS_PER_COLUMN of any one kind, since each kind becomes its own
// column and a column has to stay short enough to take in at a glance.
export default function GroupImportSheet({
  visible,
  groupName,
  fixedBoardId,
  items,
  labelForKind,
  titleForItem,
  onCancel,
  onConfirm,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<'items' | 'board'>('items');
  const [boards, setBoards] = useState<BoardRow[]>([]);

  useEffect(() => {
    if (!visible) {
      setSelected(new Set());
      setStep('items');
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    return onSnapshot(query(collection(db, 'boards'), orderBy('updatedAt', 'desc')), (snapshot) => {
      setBoards(snapshot.docs.map((d) => ({ id: d.id, title: (d.data().title as string) || 'Без назви' })));
    });
  }, [visible]);

  const kinds = Array.from(new Set(items.map((i) => i.kind)));
  const keyOf = (item: ImportableItem) => `${item.kind}:${item.id}`;
  const selectedOfKind = (kind: string) => items.filter((i) => i.kind === kind && selected.has(keyOf(i)));

  function toggle(item: ImportableItem) {
    const key = keyOf(item);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        return next;
      }
      // The cap is per kind, because each kind becomes its own column.
      // A blocked tap says so by feel as well as visually - otherwise it
      // reads as the checkbox simply not working.
      if (selectedOfKind(item.kind).length >= MAX_CARDS_PER_COLUMN) {
        hapticWarning();
        return prev;
      }
      hapticSelectItem();
      next.add(key);
      return next;
    });
  }

  function toggleKind(kind: string) {
    const ofKind = items.filter((i) => i.kind === kind);
    const chosen = selectedOfKind(kind);
    setSelected((prev) => {
      const next = new Set(prev);
      if (chosen.length > 0) {
        ofKind.forEach((i) => next.delete(keyOf(i)));
      } else {
        ofKind.slice(0, MAX_CARDS_PER_COLUMN).forEach((i) => next.add(keyOf(i)));
      }
      return next;
    });
  }

  const chosenItems = items.filter((i) => selected.has(keyOf(i)));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>
            {step === 'items' ? `Що імпортувати з "${groupName}"` : 'На яку дошку'}
          </Text>

          {step === 'items' ? (
            <>
              <ScrollView style={styles.list}>
                {items.length === 0 && <Text style={styles.empty}>У цій групі поки нічого немає.</Text>}
                {kinds.map((kind) => {
                  const ofKind = items.filter((i) => i.kind === kind);
                  const chosen = selectedOfKind(kind).length;
                  const capped = chosen >= MAX_CARDS_PER_COLUMN;
                  return (
                    <View key={kind}>
                      <Pressable style={styles.kindHeader} onPress={() => toggleKind(kind)}>
                        <Text style={styles.kindLabel}>{labelForKind(kind)}</Text>
                        <Text style={[styles.kindCount, capped && styles.kindCountCapped]}>
                          {chosen}/{Math.min(ofKind.length, MAX_CARDS_PER_COLUMN)}
                        </Text>
                      </Pressable>
                      {ofKind.map((item) => {
                        const on = selected.has(keyOf(item));
                        const blocked = !on && capped;
                        return (
                          <Pressable
                            key={keyOf(item)}
                            style={[styles.itemRow, blocked && styles.itemRowBlocked]}
                            onPress={() => toggle(item)}
                          >
                            <Ionicons
                              name={on ? 'checkbox' : 'square-outline'}
                              size={18}
                              color={on ? ACCENT : blocked ? '#E5E7EB' : '#9CA3AF'}
                            />
                            <Text style={[styles.itemLabel, blocked && styles.itemLabelBlocked]} numberOfLines={1}>
                              {titleForItem(item)}
                            </Text>
                          </Pressable>
                        );
                      })}
                      {capped && (
                        <Text style={styles.capHint}>
                          Більше {MAX_CARDS_PER_COLUMN} за раз не варто — решту можна імпортувати окремою колонкою
                          пізніше.
                        </Text>
                      )}
                    </View>
                  );
                })}
              </ScrollView>
              <View style={styles.buttons}>
                <Pressable style={styles.cancelButton} onPress={onCancel}>
                  <Text style={styles.cancelLabel}>Скасувати</Text>
                </Pressable>
                <Pressable
                  style={[styles.saveButton, chosenItems.length === 0 && styles.saveButtonDisabled]}
                  disabled={chosenItems.length === 0}
                  onPress={() =>
                    fixedBoardId ? onConfirm(chosenItems, { boardId: fixedBoardId }) : setStep('board')
                  }
                >
                  <Text style={styles.saveLabel}>
                    {fixedBoardId ? 'Додати' : 'Далі'} ({chosenItems.length})
                  </Text>
                </Pressable>
              </View>
            </>
          ) : (
            <ScrollView style={styles.list}>
              <Pressable style={styles.boardRow} onPress={() => onConfirm(chosenItems, { newBoard: true })}>
                <View style={styles.boardIcon}>
                  <Ionicons name="add" size={18} color={ACCENT} />
                </View>
                <Text style={styles.itemLabel} numberOfLines={1}>
                  Нова дошка "{groupName}"
                </Text>
              </Pressable>
              {boards.map((board) => (
                <Pressable
                  key={board.id}
                  style={styles.boardRow}
                  onPress={() => onConfirm(chosenItems, { boardId: board.id })}
                >
                  <View style={styles.boardIcon}>
                    <Ionicons name="apps-outline" size={18} color={ACCENT} />
                  </View>
                  <Text style={styles.itemLabel} numberOfLines={1}>
                    {board.title}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    maxHeight: '80%',
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#E5E7EB',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  list: {
    flexShrink: 1,
  },
  empty: {
    fontSize: 13,
    color: '#9CA3AF',
    paddingVertical: 16,
  },
  kindHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    marginTop: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  kindLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6B7280',
  },
  kindCount: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  kindCountCapped: {
    color: ACCENT,
    fontWeight: '600',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
  },
  itemRowBlocked: {
    opacity: 0.5,
  },
  itemLabel: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
  },
  itemLabelBlocked: {
    color: '#9CA3AF',
  },
  capHint: {
    fontSize: 12,
    color: '#9CA3AF',
    paddingBottom: 8,
  },
  boardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  boardIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 10,
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
