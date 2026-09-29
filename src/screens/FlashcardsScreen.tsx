import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Ionicons } from '../components/icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { deleteField, doc, onSnapshot, updateDoc, writeBatch } from '../firestore';
import { db } from '../firebase';
import { ownedQuery } from '../utils/owned';
import { RootStackParamList } from '../navigation';
import { Flashcard } from '../types';
import { useRecordColour, useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import { withAlpha } from '../utils/color';
import { railClear } from '../constants/rail';
import DatabaseChrome, { menuStyles } from '../components/DatabaseChrome';
import { useDatabaseList } from '../hooks/useDatabaseList';
import AttachmentImage from '../components/AttachmentImage';
import FlashcardReader from '../components/FlashcardReader';
import FlashcardEditor from '../components/FlashcardEditor';
import GroupPickerSheet from '../components/GroupPickerSheet';
import TagPicker from '../components/TagPicker';
import CopyToNoteModal from '../components/CopyToNoteModal';
import SaveDestinationSheet from '../components/SaveDestinationSheet';
import { blockFromFlashcard, copyObjectsToNote } from '../utils/copyToNote';
import { addItemToBoard, createBoardAndAddItem } from '../utils/addItemToBoard';
import { ImportableItem } from '../utils/importGroupToBoard';
import { notify } from '../components/surfaces/Ask';
import { detachTagFromDeletedItem } from '../hooks/useTags';
import ZoomableImageViewer from '../components/ZoomableImageViewer';
import UndoToast from '../components/UndoToast';
import { confirm } from '../components/surfaces/Ask';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { listenError } from '../utils/listenError';
import { formatUpdatedAt } from '../utils/documentPreview';

// «Картки» - things to learn, one card each: a term, an explanation that
// stays folded until it is wanted, and pictures. THE LINK CARD IS THE
// REFERENCE, the user's own words, repeated until it was heard: small
// cards in the list (rows, or two columns - «Змінити вигляд»), each with
// its whole term, and a tap turns the card over into a window for
// reading (FlashcardReader) with «Редагувати» at its top. There the stack
// is flipped through sideways. Decks are projects; smartfolders narrow
// the list and so the stack opened from it.
//
// A project («Проект», the app's one grouping) is a deck. A deck can be
// put into LEARNING mode - its cards then carry «Знаю» / «Ще вчу», and
// the learned ones can be left out of the stack. It is a switch on the
// deck, not on the database: "як опція для певної групи карток".
export default function FlashcardsScreen({ inPane }: { inPane?: boolean } = {}) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const recordColour = useRecordColour();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const accent = theme.sections.custom;
  const accentGlass = withAlpha(accent, 0.55);

  const [cards, setCards] = useState<Flashcard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editor, setEditor] = useState<{ card: Flashcard | null } | null>(null);
  const [viewer, setViewer] = useState<{ card: Flashcard; index: number } | null>(null);
  const [bulkGroupPickerVisible, setBulkGroupPickerVisible] = useState(false);
  const [bulkTagPickerVisible, setBulkTagPickerVisible] = useState(false);
  const [bulkNoteVisible, setBulkNoteVisible] = useState(false);
  const [bulkBoardVisible, setBulkBoardVisible] = useState(false);
  const [hideKnown, setHideKnown] = useState(false);
  // The card opened for reading, and the stack it was opened from - the
  // list as it stood at that tap, by id, so marking a card learned (and
  // so hiding it) does not pull the stack out from under the reader.
  const [reading, setReading] = useState<{ ids: string[]; index: number } | null>(null);

  useEffect(
    () =>
      onSnapshot(ownedQuery('flashcards'), (snapshot) => {
        setCards(
          snapshot.docs.map((d) => {
            const data = d.data() as Omit<Flashcard, 'id'>;
            return {
              id: d.id,
              ...data,
              term: data.term ?? '',
              explanation: data.explanation ?? '',
              images: data.images ?? [],
              tagIds: data.tagIds ?? [],
              updatedAt: data.updatedAt ?? 0,
            };
          })
        );
        setIsLoading(false);
      }, listenError('FlashcardsScreen:flashcards')),
    []
  );

  const list = useDatabaseList<Flashcard>({
    prefsKey: 'flashcardsPrefs',
    groupKind: 'flashcard',
    tagKind: 'flashcard',
    items: cards,
    tagIdsOf: (c) => c.tagIds ?? [],
    groupIdOf: (c) => c.groupId,
    titleOf: (c) => c.term || 'Без терміна',
    createdAtOf: (c) => c.createdAt,
    updatedAtOf: (c) => c.updatedAt,
    searchTextOf: (c) => `${c.term}\n${c.explanation}`,
  });

  // Every deck being learned, not only the one in front: in «Всі» a
  // learned card still says so.
  const learningGroupIds = useMemo(
    () => new Set(list.groups.filter((g) => g.flashcardLearning).map((g) => g.id)),
    [list.groups]
  );
  const isLearning = (card: Flashcard) => !!card.groupId && learningGroupIds.has(card.groupId);
  const activeGroup = list.groups.find((g) => g.id === list.selectedGroupId) ?? null;
  const shown = hideKnown ? list.displayed.filter((c) => !(isLearning(c) && c.known)) : list.displayed;
  const readerCards = reading
    ? reading.ids.map((id) => cards.find((c) => c.id === id)).filter((c): c is Flashcard => !!c)
    : null;

  function openReader(card: Flashcard) {
    const ids = shown.map((c) => c.id);
    setReading({ ids, index: Math.max(0, ids.indexOf(card.id)) });
  }

  function setKnown(card: Flashcard, known: boolean) {
    updateDoc(doc(db, 'flashcards', card.id), { known, updatedAt: Date.now() });
  }

  function toggleLearning() {
    if (!activeGroup) return;
    updateDoc(doc(db, 'groups', activeGroup.id), { flashcardLearning: !activeGroup.flashcardLearning });
  }

  async function resetKnown() {
    if (!activeGroup) return;
    const yes = await confirm({
      title: 'Почати заново?',
      message: `Усі картки проекту «${activeGroup.name}» знову стануть невивченими.`,
      confirmLabel: 'Скинути',
      tone: 'normal',
    });
    if (!yes) return;
    const batch = writeBatch(db);
    cards
      .filter((c) => c.groupId === activeGroup.id && c.known)
      .forEach((c) => batch.update(doc(db, 'flashcards', c.id), { known: false }));
    await batch.commit();
  }

  async function bulkAssignGroup(groupId: string | null) {
    setBulkGroupPickerVisible(false);
    const batch = writeBatch(db);
    list.selected.forEach((c) => batch.update(doc(db, 'flashcards', c.id), { groupId: groupId ?? deleteField() }));
    await batch.commit();
    list.clear();
  }

  function deleteSelected() {
    const doomed = list.selected;
    if (doomed.length === 0) return;
    list.requestDeleteMany(doomed, doomed.length === 1 ? 'Картку видалено' : `Видалено карток: ${doomed.length}`, () => {
      const batch = writeBatch(db);
      doomed.forEach((c) => batch.delete(doc(db, 'flashcards', c.id)));
      batch.commit();
      // A deleted card lets go of its smartfolders, or they would count it.
      doomed.forEach((c) =>
        (c.tagIds ?? []).forEach((tagId) => {
          const tag = list.tags.find((t) => t.id === tagId);
          if (tag) detachTagFromDeletedItem(tag, 'flashcard', c.id);
        })
      );
    });
    list.clear();
  }

  // The selection into a note - one card block each, in the list's order.
  async function bulkToNote(documentId: string | null) {
    setBulkNoteVisible(false);
    const chosen = shown.filter((c) => list.selectedIds.has(c.id));
    if (chosen.length === 0) return;
    const newId = await copyObjectsToNote(documentId, chosen.map(blockFromFlashcard), []);
    list.clear();
    if (!documentId) navigation.navigate('Editor', { documentId: newId });
  }

  // ...or onto a board, as a column of cards («Картки»), in the same order.
  async function bulkToBoard(boardId: string | null) {
    setBulkBoardVisible(false);
    const chosen = shown.filter((c) => list.selectedIds.has(c.id));
    if (chosen.length === 0) return;
    const items: ImportableItem[] = chosen.map((c) => ({
      id: c.id,
      kind: 'flashcard',
      title: c.term,
      data: { term: c.term, explanation: c.explanation, images: c.images },
    }));
    try {
      let target = boardId;
      let rest = items;
      if (!target) {
        target = await createBoardAndAddItem(activeGroup?.name ?? 'Картки', items[0]);
        rest = items.slice(1);
      }
      // One at a time: each lands under the one before it in the column.
      for (const item of rest) await addItemToBoard(target, item);
      list.clear();
      navigation.navigate('BoardCopy', { boardId: target });
    } catch (e) {
      notify('Не вдалося додати на дошку', (e as Error).message);
    }
  }

  async function bulkAttachTag(tag: Parameters<typeof list.attachTag>[0]) {
    setBulkTagPickerVisible(false);
    await Promise.all(list.selected.map((c) => list.attachTag(tag, 'flashcard', c.id, 'flashcards')));
    list.clear();
  }

  async function bulkCreateAndAttachTag(path: string, icon: string, color: string) {
    setBulkTagPickerVisible(false);
    await list.createAndAttachTagToMany(path, icon, color, 'flashcard', list.selected.map((c) => c.id), 'flashcards');
    list.clear();
  }

  const anyLearning = learningGroupIds.size > 0;
  const menuRows =
    activeGroup || anyLearning
      ? (close: () => void) => (
          <>
            {activeGroup && (
              <Pressable
                style={menuStyles.menuRow}
                onPress={() => {
                  close();
                  toggleLearning();
                }}
              >
                <Ionicons
                  name={activeGroup.flashcardLearning ? 'checkbox' : 'square-outline'}
                  size={17}
                  color={theme.ink.primary}
                />
                <Text style={menuStyles.menuRowLabel}>Режим навчання</Text>
              </Pressable>
            )}
            {anyLearning && (
              <Pressable
                style={menuStyles.menuRow}
                onPress={() => {
                  close();
                  setHideKnown((v) => !v);
                }}
              >
                <Ionicons name={hideKnown ? 'eye-outline' : 'eye-off-outline'} size={17} color={theme.ink.primary} />
                <Text style={menuStyles.menuRowLabel}>{hideKnown ? 'Показати вивчені' : 'Сховати вивчені'}</Text>
              </Pressable>
            )}
            {activeGroup?.flashcardLearning && (
              <Pressable
                style={menuStyles.menuRow}
                onPress={() => {
                  close();
                  resetKnown();
                }}
              >
                <Ionicons name="refresh-outline" size={17} color={theme.ink.primary} />
                <Text style={menuStyles.menuRowLabel}>Почати заново</Text>
              </Pressable>
            )}
          </>
        )
      : undefined;

  function renderRow(card: Flashcard) {
    const { background, text, textMuted } = recordColour(card.id);
    const selected = list.selectedIds.has(card.id);
    const first = card.images[0];
    return (
      <Pressable
        key={card.id}
        style={[styles.row, { backgroundColor: background }, selected && { borderColor: theme.accent, borderWidth: 2 }]}
        onPress={() => (list.isSelectMode ? list.toggle(card.id) : openReader(card))}
        onLongPress={() => list.enterWith(card.id)}
      >
        {list.isSelectMode && (
          <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={text} />
        )}
        {/* Laid out like a link's card: the picture's window on the
            left, the words beside it. The term WHOLE, however long -
            "весь текст терміну повинен бути видним" - at a smaller size
            rather than cut; the explanation stays for the opened card. */}
        {first && (
          <View style={styles.rowThumb}>
            <AttachmentImage uri={first.uri} driveFileId={first.driveFileId} style={styles.rowThumbImage} />
            {card.images.length > 1 && (
              <View style={styles.rowThumbCount}>
                <Text style={styles.rowThumbCountText}>{card.images.length}</Text>
              </View>
            )}
          </View>
        )}
        <View style={styles.rowBody}>
          <Text style={[styles.rowTitle, { color: text }]}>{card.term || 'Без терміна'}</Text>
          <View style={styles.knownRow}>
            {!!(card.createdAt ?? card.updatedAt) && (
              <Text style={[styles.rowCaption, { color: textMuted }]}>
                {formatUpdatedAt((card.createdAt ?? card.updatedAt) as number)}
              </Text>
            )}
            {isLearning(card) && card.known && (
              <>
                <Ionicons name="checkmark-done-outline" size={13} color={textMuted} />
                <Text style={[styles.rowCaption, { color: textMuted }]}>Вивчено</Text>
              </>
            )}
          </View>
        </View>
      </Pressable>
    );
  }

  // Two to a line - the link grid's card: the picture's 16:9 window on
  // top, the whole term under it. Rows of PAIRS, each pair as tall as its
  // taller card - the user's call: "міряємо розмір картки по найбільшій",
  // the shorter one simply keeps some empty room. A cascade (each column
  // at its own pace) is a later step, named but not taken.
  function renderCell(card: Flashcard) {
    const { background, text, textMuted } = recordColour(card.id);
    const selected = list.selectedIds.has(card.id);
    const first = card.images[0];
    return (
      <Pressable
        key={card.id}
        style={[styles.cell, { backgroundColor: background }, selected && { borderColor: theme.accent, borderWidth: 2 }]}
        onPress={() => (list.isSelectMode ? list.toggle(card.id) : openReader(card))}
        onLongPress={() => list.enterWith(card.id)}
      >
        {first && (
          <View style={styles.cellThumb}>
            <AttachmentImage uri={first.uri} driveFileId={first.driveFileId} style={styles.rowThumbImage} />
            {card.images.length > 1 && (
              <View style={styles.rowThumbCount}>
                <Text style={styles.rowThumbCountText}>{card.images.length}</Text>
              </View>
            )}
          </View>
        )}
        <Text style={[styles.cellTitle, { color: text }]}>{card.term || 'Без терміна'}</Text>
        <View style={styles.knownRow}>
          {!!(card.createdAt ?? card.updatedAt) && (
            <Text style={[styles.cellCaption, { color: textMuted }]}>
              {formatUpdatedAt((card.createdAt ?? card.updatedAt) as number)}
            </Text>
          )}
          {isLearning(card) && card.known && (
            <>
              <Ionicons name="checkmark-done-outline" size={12} color={textMuted} />
              <Text style={[styles.cellCaption, { color: textMuted }]}>Вивчено</Text>
            </>
          )}
        </View>
        {list.isSelectMode && (
          <View style={styles.cellCheck}>
            <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={text} />
          </View>
        )}
      </Pressable>
    );
  }

  const viewerImage = viewer ? viewer.card.images[viewer.index] : null;

  return (
    <DatabaseChrome
      list={list}
      accent={accent}
      accentGlass={accentGlass}
      onBack={() => navigation.goBack()}
      leaveIcon="albums-outline"
      navTitle={inPane ? undefined : { icon: 'albums-outline', label: 'Картки' }}
      railSide={inPane ? 'left' : 'right'}
      searchPlaceholder="Пошук по картках"
      onAdd={() => setEditor({ card: null })}
      menuRows={menuRows}
      shape={{
        icon: list.viewMode === 'grid' ? 'grid-outline' : 'reorder-four-outline',
        onToggle: () => list.changeViewMode(list.viewMode === 'grid' ? 'list' : 'grid'),
      }}
      bulk={{
        onTag: () => setBulkTagPickerVisible(true),
        onGroup: () => setBulkGroupPickerVisible(true),
        onBoard: () => setBulkBoardVisible(true),
        onCopy: () => setBulkNoteVisible(true),
        onDelete: deleteSelected,
      }}
      overlay={
        <>
          {list.toast && <UndoToast message={list.toast.message} onUndo={() => list.toast && list.undo(list.toast.id)} />}
          <FlashcardEditor
            visible={editor !== null}
            card={editor?.card ?? null}
            groups={list.groups}
            defaultGroupId={list.selectedGroupId}
            tagApi={list}
            onClose={() => setEditor(null)}
          />
          <TagPicker
            visible={bulkTagPickerVisible}
            kind="flashcard"
            tags={list.tags}
            selectedTagIds={[]}
            onAttach={bulkAttachTag}
            onDetach={() => {}}
            onCreateAndAttach={bulkCreateAndAttachTag}
            onRenameTag={list.renameTag}
            onClose={() => setBulkTagPickerVisible(false)}
          />
          <FlashcardReader
            cards={readerCards}
            startIndex={reading?.index ?? 0}
            isLearning={isLearning}
            onSetKnown={setKnown}
            onEdit={(card) => setEditor({ card })}
            onOpenImage={(card, index) => setViewer({ card, index })}
            onClose={() => setReading(null)}
          />
          <CopyToNoteModal
            visible={bulkNoteVisible}
            onPickExisting={(documentId) => bulkToNote(documentId)}
            onPickNew={() => bulkToNote(null)}
            onClose={() => setBulkNoteVisible(false)}
          />
          <SaveDestinationSheet
            visible={bulkBoardVisible}
            boardsOnly
            title="На яку дошку?"
            onPickNewBoard={() => bulkToBoard(null)}
            onPickExistingBoard={(boardId) => bulkToBoard(boardId)}
            onClose={() => setBulkBoardVisible(false)}
          />
          <GroupPickerSheet
            visible={bulkGroupPickerVisible}
            kind="flashcard"
            groups={list.groups}
            onPick={bulkAssignGroup}
            onClose={() => setBulkGroupPickerVisible(false)}
          />
          {viewer && viewerImage && (
            <Modal visible transparent animationType="fade" onRequestClose={() => setViewer(null)}>
              <GestureHandlerRootView style={{ flex: 1 }}>
                <ZoomableImageViewer
                  uri={viewerImage.uri}
                  driveFileId={viewerImage.driveFileId}
                  onClose={() => setViewer(null)}
                  onPrev={viewer.index > 0 ? () => setViewer({ ...viewer, index: viewer.index - 1 }) : undefined}
                  onNext={
                    viewer.index < viewer.card.images.length - 1
                      ? () => setViewer({ ...viewer, index: viewer.index + 1 })
                      : undefined
                  }
                />
              </GestureHandlerRootView>
            </Modal>
          )}
        </>
      }
    >
      {(listTopPad, listProps) => (
        // The list is the detector's DIRECT child - DatabaseChrome's pull
        // gesture declares it with Gesture.Native(), which binds to the
        // view it is handed; a wrapper View in between took that role and
        // the list stopped scrolling at all.
        isLoading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator color={theme.ink.muted} />
            </View>
          ) : shown.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="albums-outline" size={40} color={theme.ink.muted} />
              <Text style={styles.emptyLabel}>
                {list.needle ? 'Нічого не знайдено' : hideKnown && list.displayed.length > 0 ? 'Усе вивчено' : 'Ще немає карток'}
              </Text>
              {!list.needle && list.displayed.length === 0 && (
                <Text style={styles.emptyHint}>Термін, пояснення під ним і фото - щоб вивчити й повторювати</Text>
              )}
            </View>
          ) : list.viewMode === 'grid' ? (
            <ScrollView
              {...listProps}
              contentContainerStyle={[styles.list, railClear(inPane ? 'left' : 'right', 20), { paddingTop: listTopPad }]}
            >
              {Array.from({ length: Math.ceil(shown.length / 2) }, (_, row) => (
                <View key={shown[row * 2].id} style={styles.pair}>
                  {renderCell(shown[row * 2])}
                  {shown[row * 2 + 1] ? renderCell(shown[row * 2 + 1]) : <View style={styles.pairFiller} />}
                </View>
              ))}
            </ScrollView>
          ) : (
            <ScrollView
              {...listProps}
              contentContainerStyle={[styles.list, railClear(inPane ? 'left' : 'right', 20), { paddingTop: listTopPad }]}
            >
              {shown.map(renderRow)}
            </ScrollView>
          )
      )}
    </DatabaseChrome>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    // alignItems stretch (the default): both cards take the taller one's
    // height.
    pair: {
      flexDirection: 'row',
      gap: 10,
    },
    pairFiller: {
      flex: 1,
    },
    cell: {
      flex: 1,
      minWidth: 0,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: 'rgba(176,176,176,0.5)',
      padding: 10,
      gap: 6,
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 4,
    },
    cellThumb: {
      width: '100%',
      aspectRatio: 16 / 9,
      borderRadius: 10,
      overflow: 'hidden',
      backgroundColor: '#E5E7EB',
    },
    cellTitle: {
      fontSize: 13,
      lineHeight: 18,
      fontFamily: FONT_SEMIBOLD,
    },
    cellCaption: {
      fontSize: 11,
      fontFamily: FONT_REGULAR,
    },
    cellCheck: {
      position: 'absolute',
      top: 6,
      right: 6,
    },
    list: {
      paddingBottom: 120,
      gap: 10,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
      borderRadius: 14,
      padding: 10,
      borderWidth: 1,
      borderColor: 'rgba(176,176,176,0.5)',
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 3,
    },
    rowBody: {
      flex: 1,
      minWidth: 0,
      gap: 4,
    },
    rowTitle: {
      fontSize: 14,
      lineHeight: 19,
      fontFamily: FONT_SEMIBOLD,
    },
    rowCaption: {
      fontSize: 13,
      fontFamily: FONT_REGULAR,
    },
    knownRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    // A link card's own window: 104 across, a video's proportion.
    rowThumb: {
      width: 104,
      aspectRatio: 16 / 9,
      borderRadius: 8,
      overflow: 'hidden',
      backgroundColor: '#E5E7EB',
    },
    rowThumbImage: {
      width: '100%',
      height: '100%',
    },
    rowThumbCount: {
      position: 'absolute',
      right: 3,
      bottom: 3,
      minWidth: 18,
      height: 18,
      borderRadius: 9,
      paddingHorizontal: 4,
      backgroundColor: 'rgba(0,0,0,0.6)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowThumbCountText: {
      fontSize: 11,
      fontFamily: FONT_SEMIBOLD,
      color: '#fff',
    },
    emptyState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
      gap: 10,
    },
    emptyLabel: {
      fontSize: 15,
      fontFamily: FONT_REGULAR,
      color: t.ink.primary,
      textAlign: 'center',
    },
    emptyHint: {
      fontSize: 13,
      fontFamily: FONT_REGULAR,
      color: t.ink.muted,
      textAlign: 'center',
    },
  });
