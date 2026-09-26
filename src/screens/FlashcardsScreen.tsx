import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { useDockClearance } from '../navigation/dockGeometry';
import AttachmentImage from '../components/AttachmentImage';
import FlashcardView from '../components/FlashcardView';
import FlashcardEditor from '../components/FlashcardEditor';
import GroupPickerSheet from '../components/GroupPickerSheet';
import ZoomableImageViewer from '../components/ZoomableImageViewer';
import UndoToast from '../components/UndoToast';
import { confirm } from '../components/surfaces/Ask';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { listenError } from '../utils/listenError';

// «Картки» - things to learn, one card each: a term, an explanation that
// stays folded until it is wanted, and pictures shown large. Two ways to
// look at them, one button apart (the bar's "⋯" → «Змінити вигляд»): a
// LIST, to find and fix a card, and the STACK, one card to a screen,
// flipped upward like pages - "гортати картки". A tap on a card in the
// list opens the stack at that card.
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
  const insets = useSafeAreaInsets();
  const dockClear = useDockClearance();
  const accent = theme.sections.custom;
  const accentGlass = withAlpha(accent, 0.55);

  const [cards, setCards] = useState<Flashcard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editor, setEditor] = useState<{ card: Flashcard | null } | null>(null);
  const [viewer, setViewer] = useState<{ card: Flashcard; index: number } | null>(null);
  const [bulkGroupPickerVisible, setBulkGroupPickerVisible] = useState(false);
  const [hideKnown, setHideKnown] = useState(false);
  // The card the stack opens at - by id, so it is found again whatever
  // search or deck the list was showing when it was tapped.
  const [startId, setStartId] = useState<string | null>(null);
  const [area, setArea] = useState({ width: 0, height: 0 });

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
    tagIdsOf: () => [],
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
  // Choosing and searching are done in the list; the stack is for looking.
  const stack = list.viewMode === 'grid' && !list.isSelectMode && !list.isSearching;

  function openStackAt(card: Flashcard) {
    setStartId(card.id);
    if (list.isSearching) {
      list.setSearchQuery('');
      list.setIsSearching(false);
    }
    if (list.viewMode !== 'grid') list.changeViewMode('grid');
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
    });
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
        onPress={() => (list.isSelectMode ? list.toggle(card.id) : openStackAt(card))}
        onLongPress={() => list.enterWith(card.id)}
      >
        {list.isSelectMode && (
          <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={text} />
        )}
        <View style={styles.rowBody}>
          <Text style={[styles.rowTitle, { color: text }]} numberOfLines={2}>
            {card.term || 'Без терміна'}
          </Text>
          {!!card.explanation && (
            <Text style={[styles.rowCaption, { color: textMuted }]} numberOfLines={1}>
              {card.explanation}
            </Text>
          )}
          {isLearning(card) && card.known && (
            <View style={styles.knownRow}>
              <Ionicons name="checkmark-done-outline" size={13} color={textMuted} />
              <Text style={[styles.rowCaption, { color: textMuted }]}>Вивчено</Text>
            </View>
          )}
        </View>
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
      </Pressable>
    );
  }

  function renderStack(listTopPad: number, listProps: Record<string, unknown>) {
    const pageH = Math.max(0, area.height - listTopPad - dockClear - insets.bottom);
    const cardW = Math.max(0, area.width - 40);
    if (pageH <= 0 || cardW <= 0) return null;
    const start = Math.max(0, shown.findIndex((c) => c.id === startId));
    return (
      <FlatList
        {...listProps}
        // A new deck, a new stack - opened at its top.
        key={`stack:${list.groupFilter ?? 'all'}`}
        data={shown}
        keyExtractor={(c) => c.id}
        style={{ marginTop: listTopPad, height: pageH, flexGrow: 0 }}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        initialScrollIndex={shown.length > 0 ? Math.min(start, shown.length - 1) : undefined}
        getItemLayout={(_, index) => ({ length: pageH, offset: pageH * index, index })}
        windowSize={3}
        initialNumToRender={2}
        maxToRenderPerBatch={2}
        renderItem={({ item }) => (
          <View style={[styles.page, { height: pageH }]}>
            <FlashcardView
              card={item}
              width={cardW}
              height={pageH - 16}
              learning={isLearning(item) ? { onSetKnown: (known) => setKnown(item, known) } : null}
              onEdit={() => setEditor({ card: item })}
              onOpenImage={(index) => setViewer({ card: item, index })}
            />
          </View>
        )}
      />
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
      hideDrawer
      onAdd={() => setEditor({ card: null })}
      menuRows={menuRows}
      shape={{
        icon: list.viewMode === 'grid' ? 'albums-outline' : 'reorder-four-outline',
        onToggle: () => list.changeViewMode(list.viewMode === 'grid' ? 'list' : 'grid'),
      }}
      bulk={{
        onGroup: () => setBulkGroupPickerVisible(true),
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
            onClose={() => setEditor(null)}
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
        <View
          style={styles.area}
          onLayout={(e) => setArea({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
        >
          {isLoading ? (
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
          ) : stack ? (
            renderStack(listTopPad, listProps)
          ) : (
            <ScrollView
              {...listProps}
              contentContainerStyle={[styles.list, railClear(inPane ? 'left' : 'right', 20), { paddingTop: listTopPad }]}
            >
              {shown.map(renderRow)}
            </ScrollView>
          )}
        </View>
      )}
    </DatabaseChrome>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    area: {
      flex: 1,
    },
    page: {
      paddingHorizontal: 20,
      paddingVertical: 8,
    },
    list: {
      paddingBottom: 120,
      gap: 10,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderRadius: 14,
      padding: 12,
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
      gap: 3,
    },
    rowTitle: {
      fontSize: 16,
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
    rowThumb: {
      width: 56,
      height: 56,
      borderRadius: 10,
      overflow: 'hidden',
    },
    rowThumbImage: {
      width: 56,
      height: 56,
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
