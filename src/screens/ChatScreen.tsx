import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import ScreenBackdrop from '../components/ScreenBackdrop';
import ContentColumn from '../components/ContentColumn';
import RenamePrompt from '../components/RenamePrompt';
import SaveDestinationSheet from '../components/SaveDestinationSheet';
import * as Clipboard from 'expo-clipboard';
import { ask, confirm, notify } from '../components/surfaces/Ask';
import { openCapture } from '../components/CaptureWindow';
import { useDockActions, useDockBeads, useDockLeave, useDockShowContext } from '../navigation/navDock';
import { CHROME_TOP, NAV_BOTTOM, NAV_BUTTON, NAV_PADDING } from '../constants/rail';
import {
  ChatMessage,
  deleteChatMessage,
  editChatMessage,
  markChatMessageTask,
  markChatMessagesUsed,
  watchChat,
} from '../utils/chat';
import {
  appendBlocksToToday,
  clipBlocksToNote,
  copyObjectsToNote,
  createTaskInToday,
} from '../utils/copyToNote';
import { formatShortDate } from '../utils/dateLocale';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { Block } from '../types';
import { RootStackParamList } from '../navigation';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';

const DOCK_CLEAR = NAV_BOTTOM + NAV_BUTTON + NAV_PADDING * 2 + 12;

// The history side of «загальний чат». The capture window is where things
// go IN; this is where they are read back and harvested. Nothing is ever
// consumed: a message gathered into a note stays here with a line saying
// which note took it - the user's own rule, and the reason they are not
// troubled by the history growing forever.

type Row =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'message'; key: string; message: ChatMessage };

function newBlockId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function ChatScreen() {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const isFocused = useIsFocused();
  const showContext = useDockShowContext();
  const listRef = useRef<FlatList<Row>>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Which messages are on their way somewhere - one from its own menu, or
  // everything chosen in select mode. The destination sheet and the name
  // prompt both read this, so one path serves both.
  const [sending, setSending] = useState<string[] | null>(null);
  const [naming, setNaming] = useState(false);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(
    () =>
      watchChat(setMessages, (e) => notify('Чат не завантажився', e.message)),
    []
  );

  // Day headings, in the order a chat is read: oldest at the top, today
  // at the bottom, where the newest thing said always is.
  const rows = useMemo(() => {
    const out: Row[] = [];
    let lastDay = '';
    messages.forEach((message) => {
      const date = new Date(message.createdAt);
      const day = date.toDateString();
      if (day !== lastDay) {
        lastDay = day;
        out.push({ kind: 'day', key: `day-${day}`, label: formatShortDate(date) });
      }
      out.push({ kind: 'message', key: message.id, message });
    });
    return out;
  }, [messages]);

  useDockLeave('chatbubbles-outline', () => navigation.goBack());
  useDockBeads(
    isFocused
      ? {
          icon: isSelectMode ? 'close-outline' : 'checkmark-circle-outline',
          active: isSelectMode,
          onPress: () => {
            setSelected(new Set());
            setIsSelectMode((prev) => !prev);
            if (isSelectMode) showContext();
          },
        }
      : null,
    isFocused ? { icon: 'mic-outline', onPress: openCapture } : null
  );
  useDockActions(
    isFocused && isSelectMode && selected.size > 0
      ? [
          {
            key: 'note',
            icon: 'document-text-outline',
            onPress: () => setSending([...selected]),
            closesStack: true,
          },
          {
            key: 'delete',
            icon: 'trash-outline',
            onPress: () => deleteChosen(),
            closesStack: true,
          },
        ]
      : null
  );

  // Straight to the newest, every time - a chat is read from its end.
  useEffect(() => {
    if (rows.length === 0) return;
    const id = setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 0);
    return () => clearTimeout(id);
  }, [rows.length]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // The messages on their way somewhere, as blocks. New ids: the message
  // stays in the chat, so what lands in the note is a copy of it.
  function blocksFor(ids: string[]): { chosen: ChatMessage[]; blocks: Block[] } {
    const chosen = messages.filter((m) => ids.includes(m.id));
    return {
      chosen,
      blocks: chosen.map((m) => ({
        id: newBlockId(),
        text: m.text,
        type: 'paragraph' as const,
        createdAt: m.createdAt,
      })),
    };
  }

  function doneSending() {
    setSending(null);
    setNaming(false);
    setSelected(new Set());
    setIsSelectMode(false);
  }

  // Into a note that already exists, or into today's - the two that need
  // no name. A new one asks for one first (see gatherIntoNewNote).
  async function sendInto(where: 'today' | { id: string; title: string }) {
    const ids = sending ?? [];
    const { chosen, blocks } = blocksFor(ids);
    if (chosen.length === 0) return doneSending();
    setBusy(true);
    try {
      const documentId =
        where === 'today'
          ? await appendBlocksToToday(blocks, [])
          : await copyObjectsToNote(where.id, blocks, []);
      const title = where === 'today' ? `Сьогодні · ${formatShortDate(new Date())}` : where.title;
      await markChatMessagesUsed(chosen.map((m) => m.id), documentId, title);
      doneSending();
      navigation.navigate('Editor', { documentId });
    } catch (e) {
      notify('Не збереглося', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function gatherIntoNewNote(title: string) {
    const ids = sending ?? [];
    const { chosen, blocks } = blocksFor(ids);
    if (chosen.length === 0) return doneSending();
    setBusy(true);
    try {
      const name = title.trim() || 'Без назви';
      const documentId = await clipBlocksToNote(name, blocks);
      // The message stays where it is and says where it went.
      await markChatMessagesUsed(chosen.map((m) => m.id), documentId, name);
      doneSending();
      navigation.navigate('Editor', { documentId, offerBoard: true });
    } catch (e) {
      notify('Не збереглося', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Everything one message can become, in the menu every list in this app
  // opens on a long press.
  async function openMessageMenu(message: ChatMessage) {
    const choice = await ask({
      title: message.text.length > 60 ? `${message.text.slice(0, 60)}…` : message.text,
      actions: [
        { id: 'copy', label: 'Копіювати', icon: 'copy-outline' },
        { id: 'edit', label: 'Виправити', icon: 'pencil-outline' },
        { id: 'note', label: 'У нотатку…', icon: 'document-text-outline' },
        { id: 'task', label: 'Зробити справою', icon: 'checkbox-outline' },
        { id: 'select', label: 'Вибрати кілька', icon: 'checkmark-circle-outline' },
        { id: 'delete', label: 'Видалити', icon: 'trash-outline', tone: 'danger' },
      ],
    });
    if (choice === 'copy') await Clipboard.setStringAsync(message.text);
    else if (choice === 'edit') setEditing(message);
    else if (choice === 'note') setSending([message.id]);
    else if (choice === 'task') makeTask(message);
    else if (choice === 'select') {
      setIsSelectMode(true);
      setSelected(new Set([message.id]));
    } else if (choice === 'delete') {
      const sure = await confirm({
        title: 'Видалити повідомлення?',
        message: 'Це єдине, що справді прибирає його з чату.',
        confirmLabel: 'Видалити',
      });
      if (sure) await deleteChatMessage(message.id).catch((e: Error) => notify('Не вдалося', e.message));
    }
  }

  // A checkbox in TODAY's daily note - which is where every task in this
  // app lives, so it shows up in the calendar's day and in Справи at once.
  async function makeTask(message: ChatMessage) {
    try {
      const { taskId, documentId } = await createTaskInToday(message.text);
      await markChatMessageTask(message.id, taskId, documentId);
    } catch (e) {
      notify('Не вдалося створити справу', (e as Error).message);
    }
  }

  async function deleteChosen() {
    const ids = [...selected];
    if (ids.length === 0) return;
    const sure = await confirm({
      title: ids.length === 1 ? 'Видалити повідомлення?' : `Видалити ${ids.length} повідомлень?`,
      message: 'Це єдине, що справді прибирає їх з чату.',
      confirmLabel: 'Видалити',
    });
    if (!sure) return;
    try {
      await Promise.all(ids.map((id) => deleteChatMessage(id)));
      setSelected(new Set());
      setIsSelectMode(false);
    } catch (e) {
      notify('Не вдалося', (e as Error).message);
    }
  }

  async function saveEdit(text: string) {
    const message = editing;
    setEditing(null);
    if (!message || !text.trim()) return;
    await editChatMessage(message.id, text).catch((e: Error) => notify('Не збереглося', e.message));
  }

  return (
    <View style={styles.container}>
      <ScreenBackdrop id="chatBg" colors={['#705648', '#69736E', '#000000']} />
      <ContentColumn>
        <View style={{ height: insets.top + CHROME_TOP + 8 }} />
        {rows.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="chatbubbles-outline" size={32} color={theme.ink.faint} />
            <Text style={styles.emptyLabel}>Поки порожньо</Text>
            <Text style={styles.emptyHint}>
              Затисніть док будь-де в застосунку і скажіть, що думаєте
            </Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={rows}
            keyExtractor={(row) => row.key}
            contentContainerStyle={[styles.list, { paddingBottom: DOCK_CLEAR + insets.bottom }]}
            onScrollToIndexFailed={() => {}}
            renderItem={({ item }) => {
              if (item.kind === 'day') {
                return (
                  <View style={styles.dayRow}>
                    <Text style={styles.dayLabel}>{item.label}</Text>
                  </View>
                );
              }
              const message = item.message;
              const used = Object.entries(message.usedIn ?? {});
              const picked = selected.has(message.id);
              return (
                <Pressable
                  style={[styles.bubble, picked && { borderColor: theme.accent }]}
                  onPress={() => (isSelectMode ? toggle(message.id) : undefined)}
                  onLongPress={() => {
                    if (isSelectMode) return;
                    openMessageMenu(message);
                  }}
                >
                  {/* What came with the words. It is already a record in
                      its own database - this is the same picture, not a
                      copy - so touching it goes there. */}
                  {!!message.attachment && (
                    <Pressable
                      style={styles.attachment}
                      onPress={() => {
                        if (isSelectMode) return toggle(message.id);
                        const a = message.attachment!;
                        if (a.kind === 'photo') navigation.navigate('Photos');
                        else if (a.kind === 'file') navigation.navigate('Files');
                        else Linking.openURL(a.url).catch(() => {});
                      }}
                    >
                      {message.attachment.kind === 'photo' ? (
                        <Image source={{ uri: message.attachment.uri }} style={styles.attachmentPhoto} />
                      ) : (
                        <View style={styles.attachmentRow}>
                          <Ionicons
                            name={
                              message.attachment.kind === 'file'
                                ? 'videocam-outline'
                                : message.attachment.siteName === 'Геоточка'
                                  ? 'location-outline'
                                  : 'link-outline'
                            }
                            size={16}
                            color={theme.ink.muted}
                          />
                          <Text style={styles.attachmentLabel} numberOfLines={2}>
                            {message.attachment.kind === 'file'
                              ? message.attachment.name
                              : message.attachment.title || message.attachment.url}
                          </Text>
                        </View>
                      )}
                    </Pressable>
                  )}
                  {!!message.text && <Text style={styles.bubbleText}>{message.text}</Text>}
                  <View style={styles.bubbleFoot}>
                    <Text style={styles.bubbleTime}>
                      {new Date(message.createdAt).toLocaleTimeString('uk-UA', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Text>
                    {Object.entries(message.tasks ?? {}).map(([taskId]) => (
                      <Pressable
                        key={taskId}
                        style={styles.usedChip}
                        onPress={() => navigation.navigate('Tasks')}
                      >
                        <Ionicons name="checkbox-outline" size={11} color={theme.accent} />
                        <Text style={[styles.usedLabel, { color: theme.accent }]}>Справа</Text>
                      </Pressable>
                    ))}
                    {used.map(([documentId, documentTitle]) => (
                      <Pressable
                        key={documentId}
                        style={styles.usedChip}
                        onPress={() => navigation.navigate('Editor', { documentId })}
                      >
                        <Ionicons name="document-text-outline" size={11} color={theme.accent} />
                        <Text style={[styles.usedLabel, { color: theme.accent }]} numberOfLines={1}>
                          {documentTitle}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  {isSelectMode && (
                    <View style={styles.tick}>
                      <Ionicons
                        name={picked ? 'checkmark-circle' : 'ellipse-outline'}
                        size={20}
                        color={picked ? theme.accent : theme.ink.faint}
                      />
                    </View>
                  )}
                </Pressable>
              );
            }}
          />
        )}
      </ContentColumn>

      {/* Where the chosen messages go. Notes only: a message is text, and
          what it becomes is a note - putting it straight on a board is
          what the note's own offer is for. */}
      <SaveDestinationSheet
        visible={!!sending && !naming}
        notesOnly
        title={sending && sending.length > 1 ? `${sending.length} повідомлень у…` : 'Повідомлення у…'}
        onPickToday={() => sendInto('today')}
        onPickNew={() => setNaming(true)}
        onPickExisting={(documentId, documentTitle) => sendInto({ id: documentId, title: documentTitle })}
        onClose={() => setSending(null)}
      />

      <RenamePrompt
        visible={naming}
        title="Нотатка з думок"
        initialValue={`Думки · ${formatShortDate(new Date())}`}
        placeholder="Назва нотатки"
        busy={busy}
        onCancel={() => {
          setNaming(false);
          setSending(null);
        }}
        onSave={gatherIntoNewNote}
      />

      <RenamePrompt
        visible={!!editing}
        multiline
        title="Виправити"
        initialValue={editing?.text ?? ''}
        placeholder="Текст повідомлення"
        onCancel={() => setEditing(null)}
        onSave={saveEdit}
      />
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
    },
    list: {
      paddingHorizontal: 20,
      paddingTop: 8,
      gap: 8,
    },
    dayRow: {
      alignItems: 'center',
      paddingVertical: 10,
    },
    dayLabel: {
      fontSize: 12,
      fontFamily: FONT_SEMIBOLD,
      color: t.ink.muted,
    },
    bubble: {
      backgroundColor: t.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: 'transparent',
      paddingHorizontal: 14,
      paddingVertical: 10,
      gap: 6,
    },
    bubbleText: {
      fontSize: 16,
      lineHeight: 22,
      fontFamily: FONT_REGULAR,
      color: t.ink.primary,
    },
    attachment: {
      borderRadius: 12,
      overflow: 'hidden',
    },
    attachmentPhoto: {
      width: '100%',
      height: 180,
      borderRadius: 12,
      backgroundColor: 'rgba(255,255,255,0.06)',
    },
    attachmentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      padding: 10,
      borderRadius: 12,
      backgroundColor: 'rgba(255,255,255,0.06)',
    },
    attachmentLabel: {
      flex: 1,
      minWidth: 0,
      fontSize: 13,
      fontFamily: FONT_REGULAR,
      color: t.ink.muted,
    },
    bubbleFoot: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 8,
    },
    bubbleTime: {
      fontSize: 11,
      fontFamily: FONT_REGULAR,
      color: t.ink.faint,
    },
    usedChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      maxWidth: 200,
    },
    usedLabel: {
      fontSize: 11,
      fontFamily: FONT_SEMIBOLD,
    },
    tick: {
      position: 'absolute',
      right: 10,
      top: 10,
    },
    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingHorizontal: 40,
    },
    emptyLabel: {
      fontSize: 16,
      fontFamily: FONT_BOLD,
      color: t.ink.primary,
    },
    emptyHint: {
      fontSize: 13,
      fontFamily: FONT_REGULAR,
      color: t.ink.muted,
      textAlign: 'center',
    },
  });
