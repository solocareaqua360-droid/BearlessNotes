import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import ScreenBackdrop from '../components/ScreenBackdrop';
import ContentColumn from '../components/ContentColumn';
import RenamePrompt from '../components/RenamePrompt';
import { notify } from '../components/surfaces/Ask';
import { openCapture } from '../components/CaptureWindow';
import { useDockActions, useDockBeads, useDockLeave, useDockShowContext } from '../navigation/navDock';
import { CHROME_TOP, NAV_BOTTOM, NAV_BUTTON, NAV_PADDING } from '../constants/rail';
import { ChatMessage, markChatMessagesUsed, watchChat } from '../utils/chat';
import { clipBlocksToNote } from '../utils/copyToNote';
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
  const [naming, setNaming] = useState(false);
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
            onPress: () => setNaming(true),
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

  async function gatherIntoNote(title: string) {
    const chosen = messages.filter((m) => selected.has(m.id));
    if (chosen.length === 0) {
      setNaming(false);
      return;
    }
    setBusy(true);
    try {
      const blocks: Block[] = chosen.map((m) => ({
        id: newBlockId(),
        text: m.text,
        type: 'paragraph',
        createdAt: m.createdAt,
      }));
      const documentId = await clipBlocksToNote(title.trim() || 'Без назви', blocks);
      // The message stays where it is and says where it went.
      await markChatMessagesUsed(chosen.map((m) => m.id), documentId, title.trim() || 'Без назви');
      setNaming(false);
      setSelected(new Set());
      setIsSelectMode(false);
      navigation.navigate('Editor', { documentId, offerBoard: true });
    } catch (e) {
      notify('Не збереглося', (e as Error).message);
    } finally {
      setBusy(false);
    }
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
                    setIsSelectMode(true);
                    setSelected(new Set([message.id]));
                  }}
                >
                  <Text style={styles.bubbleText}>{message.text}</Text>
                  <View style={styles.bubbleFoot}>
                    <Text style={styles.bubbleTime}>
                      {new Date(message.createdAt).toLocaleTimeString('uk-UA', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Text>
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

      <RenamePrompt
        visible={naming}
        title="Нотатка з думок"
        initialValue={`Думки · ${formatShortDate(new Date())}`}
        placeholder="Назва нотатки"
        busy={busy}
        onCancel={() => setNaming(false)}
        onSave={gatherIntoNote}
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
