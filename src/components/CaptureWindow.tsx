import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from './icons/Ionicons';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import type { Theme } from '../theme/tokens';
import GlassLayer from './GlassLayer';
import { useBottomSheet } from './surfaces/bottomSheet';
import { SHEET_WINDOW, PHONE_ONLY } from '../constants/glass';
import { FONT_BOLD, FONT_REGULAR } from '../utils/fonts';
import { ChatMessage, editChatMessage, markChatMessagesUsed, sendChatMessage } from '../utils/chat';
import { clipBlocksToNote } from '../utils/copyToNote';
import { buildBlock, generateId, newBlock } from '../utils/documentBlocks';
import { notify } from './surfaces/Ask';
import { ChatAttachment, attachLinkToChat, clipboardHasPicture, pasteClipboardPicture, pickFileForChat, pickMediaForChat } from '../utils/chatAttach';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'react-native';
import { hapticButtonDown } from '../utils/haptics';
import { useTheme, useStyles } from '../theme/ThemeProvider';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';

// The capture window - what the dock's long press opens. Its whole job is
// to cost nothing: it comes up ALREADY LISTENING, so "зажав док і сразу
// говорю" is literally what happens. Typing is a button beside the
// microphone, for when they want it - the user was explicit that the
// microphone is the point and the keyboard is the exception.
//
// Mounted once at the root, like AskHost, so anything anywhere can open
// it without holding a piece of state for it.

let listener: ((open: boolean) => void) | null = null;

export function openCapture() {
  listener?.(true);
}

// The SAME window, opened over an EXISTING message instead of a blank
// one - "при редагуванні повідомлення в чаті в нього можна відредагувати
// не тільки текст, але й додати вкладення". One editor for both jobs
// rather than a second, poorer one (the plain text-only RenamePrompt
// this replaced): every attach/remove button already here works exactly
// the same way whether the message is new or not.
let editListener: ((message: ChatMessage) => void) | null = null;

export function openCaptureForEdit(message: ChatMessage) {
  editListener?.(message);
}

export default function CaptureWindow({ onOpenChat, onOpenNote }: { onOpenChat: () => void; onOpenNote?: (documentId: string) => void }) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const [visible, setVisible] = useState(false);
  // An arrow, not `close` itself: that is declared further down, and is only CALLED once the drag ends.
  const b = useBottomSheet(visible, () => close());
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  // The window stands at the foot of the screen, so the keyboard would
  // stand ON it - which is what made the keyboard button look dead: it
  // worked, and then what it opened covered the thing it opened.
  const keyboardHeight = useKeyboardHeight();
  const [trouble, setTrouble] = useState<string | null>(null);
  // As many as were put on one thought: a screenshot AND the link it came
  // from belong in the same message. Each record is already written by
  // the time it is shown here (see chatAttach), so the picture in the
  // chat IS the one in its database.
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  // Which message is being edited, or null while this is a fresh
  // thought. Gates both the sending call (edit vs. a new message) and
  // the auto-listening below - starting the mic over someone's existing
  // words would just as soon erase the point of opening this to fix
  // them.
  const [editingId, setEditingId] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  // What the recogniser has heard so far in THIS run. Kept apart from
  // `text` so that a second run appends rather than replacing what the
  // first one heard, and so that editing by hand is never overwritten
  // mid-sentence.
  const committed = useRef('');

  useEffect(() => {
    listener = (open) => {
      if (!open) return;
      setText('');
      committed.current = '';
      setAttachments([]);
      setTrouble(null);
      setEditingId(null);
      setVisible(true);
    };
    editListener = (message) => {
      setText(message.text);
      committed.current = message.text;
      setAttachments(message.attachments ?? []);
      setTrouble(null);
      setEditingId(message.id);
      setVisible(true);
    };
    return () => {
      listener = null;
      editListener = null;
    };
  }, []);

  const stopListening = useCallback(() => {
    ExpoSpeechRecognitionModule.stop();
    setListening(false);
  }, []);

  const startListening = useCallback(async () => {
    setTrouble(null);
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      setTrouble('Розпізнавання тут недоступне - напишіть');
      inputRef.current?.focus();
      return;
    }
    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) {
      setTrouble('Без дозволу на мікрофон лишається клавіатура');
      inputRef.current?.focus();
      return;
    }
    committed.current = text;
    ExpoSpeechRecognitionModule.start({
      lang: 'uk-UA',
      // The words appear while they are still being said, so a long
      // thought can be watched rather than waited for.
      interimResults: true,
      // Android ends a run at the first pause otherwise, and a thought
      // has pauses in it. This one ends when the speaker says it does.
      continuous: true,
      addsPunctuation: true,
    });
    setListening(true);
  }, [text]);

  // Opened by the dock's long press: listening starts with the window, so
  // there is nothing to press before speaking. Not while EDITING though -
  // the mic taking over would talk straight over the words already there
  // instead of leaving them to be fixed by hand or added to.
  useEffect(() => {
    if (visible && !editingId) startListening();
    // startListening is deliberately not a dependency: this fires on the
    // OPENING, not on every change of the text it closes over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, editingId]);

  useSpeechRecognitionEvent('result', (event) => {
    const heard = event.results?.[0]?.transcript ?? '';
    const before = committed.current;
    const merged = before ? `${before} ${heard}`.replace(/\s+/g, ' ') : heard;
    setText(merged);
    // A SEGMENT THAT CLOSED is part of the text now (2026-10-04: "старі
    // слова заміняються новими"): the recogniser starts every segment after
    // a pause from nothing, so what followed the words heard before the
    // pause replaced them - only the last line survived. Closed, a segment
    // is taken into what the next one is added to.
    if (event.isFinal) committed.current = merged;
  });
  useSpeechRecognitionEvent('end', () => setListening(false));
  useSpeechRecognitionEvent('error', (event) => {
    setListening(false);
    // "no-speech" is not a failure worth a sentence on the screen - it is
    // what silence sounds like.
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    setTrouble('Не почулося. Спробуйте ще раз або напишіть');
  });

  const close = useCallback(() => {
    ExpoSpeechRecognitionModule.stop();
    setListening(false);
    Keyboard.dismiss();
    setVisible(false);
    setEditingId(null);
  }, []);

  async function send() {
    const toSend = text;
    const withThem = attachments;
    const wasEditing = editingId;
    close();
    if (wasEditing) await editChatMessage(wasEditing, toSend, withThem);
    else await sendChatMessage(toSend, withThem);
  }

  // A THOUGHT THAT GROWS (2026-10-12, the user's: in the chat «думка несеться… ти вже хочеш створювати прям
  // документ», and a message is one unbroken text). This turns what is typed so far into a real note - the first
  // line its title, every paragraph a block, an empty block to go on in - and opens it. The chat keeps the thought
  // as a message that says where it went, as a message gathered into a note always has.
  async function expandToNote() {
    const raw = text.trim();
    const withThem = attachments;
    if (!raw) return;
    close();
    try {
      const lines = raw.split('\n');
      const first = lines[0].trim();
      const title = first.length <= 80 ? first : '';
      const rest = (title ? lines.slice(1) : lines).join('\n').trim();
      const blocks = [
        ...rest
          .split(/\n\s*\n/)
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p) => buildBlock(generateId(), 'paragraph', p)),
        newBlock(),
      ];
      const name = title || 'Без назви';
      const documentId = await clipBlocksToNote(name, blocks);
      const messageId = await sendChatMessage(raw, withThem);
      if (messageId) await markChatMessagesUsed([messageId], documentId, name);
      onOpenNote?.(documentId);
    } catch (e) {
      notify('Не збереглося', (e as Error).message);
    }
  }

  // Whether the clipboard holds a picture right now - asked each time the
  // window opens, so «Вставити скріншот» stands there only when it can work.
  const [clipPicture, setClipPicture] = useState(false);
  useEffect(() => {
    if (visible) clipboardHasPicture().then(setClipPicture);
  }, [visible]);

  async function attach(pick: () => Promise<ChatAttachment[]>) {
    setAttaching(true);
    try {
      const picked = await pick();
      // Never the same record twice: a link taken from the clipboard a
      // second time is the same link, and its id says so.
      if (picked.length > 0)
        setAttachments((prev) => [
          ...prev,
          ...picked.filter((one) => !prev.some((had) => had.id === one.id)),
        ]);
    } catch (e) {
      setTrouble((e as Error).message);
    } finally {
      setAttaching(false);
    }
  }

  // A link comes off the clipboard, because that is where a link always
  // is at the moment you want to keep it. Which of the three databases it
  // lands in - посилання, геоточка or відео - the URL decides by itself.
  async function attachLink() {
    setAttaching(true);
    try {
      const fromClipboard = (await Clipboard.getStringAsync()).trim();
      if (!/^https?:\/\//i.test(fromClipboard)) {
        setTrouble('У буфері немає посилання - скопіюйте його спершу');
        return;
      }
      const link = await attachLinkToChat(fromClipboard);
      if (link.length > 0)
        setAttachments((prev) =>
          prev.some((had) => had.id === link[0].id) ? prev : [...prev, link[0]]
        );
    } catch (e) {
      setTrouble((e as Error).message);
    } finally {
      setAttaching(false);
    }
  }

  // The button breathes while it is listening, so there is never a doubt
  // about whether it is.
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = listening
      ? withRepeat(withTiming(1.12, { duration: 700 }), -1, true)
      : withTiming(1, { duration: 150 });
  }, [listening, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  return (
    <GlassLayer visible={visible} onClose={close} rise={b.on}>
      <View style={[styles.backdrop, b.frame, { paddingBottom: keyboardHeight }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        <Animated.View style={[styles.sheet, b.window, b.padBottom(24)]}>
          {b.fill}
          {b.grab}
          <View style={[styles.handle, b.on && { opacity: 0 }]} />

          <View style={styles.headRow}>
            <Text style={styles.title}>
              {listening ? 'Слухаю…' : editingId ? 'Редагування' : 'Думка'}
            </Text>
            <Pressable hitSlop={10} onPress={onOpenChat}>
              <Ionicons name="time-outline" size={22} color={theme.ink.muted} />
            </Pressable>
          </View>

          {/* What was heard, and what can still be corrected by hand. */}
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={(next) => {
              // A picture «pasted» by the keyboard arrives as a page of
              // replacement characters. It is not text: drop it, and take
              // the picture from the clipboard instead.
              if (isGarbagePaste(next, text)) {
                attach(pasteClipboardPicture);
                return;
              }
              setText(next);
              // Typed over: what the recogniser adds next follows this,
              // rather than the words it heard before the correction.
              committed.current = next;
            }}
            multiline
            placeholder={listening ? 'Говоріть…' : 'Скажіть або напишіть'}
            placeholderTextColor={theme.ink.faint}
            style={styles.input}
          />

          {attachments.map((item, index) => (
            <View key={`${item.kind}-${item.id}-${index}`} style={styles.attached}>
              {item.kind === 'photo' ? (
                <Image source={{ uri: item.uri }} style={styles.attachedThumb} />
              ) : (
                <View style={[styles.attachedThumb, styles.attachedIcon]}>
                  <Ionicons
                    name={
                      item.kind === 'file'
                        ? 'videocam-outline'
                        : item.siteName === 'Геоточка'
                          ? 'location-outline'
                          : 'link-outline'
                    }
                    size={20}
                    color={theme.ink.muted}
                  />
                </View>
              )}
              <Text style={styles.attachedLabel} numberOfLines={2}>
                {item.kind === 'link'
                  ? item.title || item.url
                  : item.kind === 'file'
                    ? item.name
                    : 'Зображення'}
              </Text>
              <Pressable
                hitSlop={8}
                onPress={() => setAttachments((prev) => prev.filter((_, i) => i !== index))}
              >
                <Ionicons name="close" size={18} color={theme.ink.muted} />
              </Pressable>
            </View>
          ))}

          {!!trouble && <Text style={styles.trouble}>{trouble}</Text>}

          <View style={styles.attachRow}>
            <Pressable
              hitSlop={8}
              style={styles.attachButton}
              disabled={attaching}
              onPress={() => attach(pickMediaForChat)}
            >
              <Ionicons name="image-outline" size={20} color={theme.ink.muted} />
            </Pressable>
            <Pressable
              hitSlop={8}
              style={styles.attachButton}
              disabled={attaching}
              onPress={() => attach(pickFileForChat)}
            >
              <Ionicons name="document-outline" size={20} color={theme.ink.muted} />
            </Pressable>
            <Pressable hitSlop={8} style={styles.attachButton} disabled={attaching} onPress={attachLink}>
              <Ionicons name="link-outline" size={20} color={theme.ink.muted} />
            </Pressable>
            {!editingId && onOpenNote && (
              <Pressable
                hitSlop={8}
                style={[styles.attachButton, styles.expandButton, !text.trim() && styles.sideButtonOff]}
                disabled={!text.trim()}
                onPress={expandToNote}
                accessibilityLabel="Розгорнути в нотатку"
              >
                <Ionicons name="expand-outline" size={18} color={text.trim() ? theme.accent : theme.ink.faint} />
                <Text style={[styles.expandLabel, { color: text.trim() ? theme.ink.primary : theme.ink.faint }]}>У нотатку</Text>
              </Pressable>
            )}
            {clipPicture && (
              <Pressable
                hitSlop={8}
                style={styles.attachButton}
                disabled={attaching}
                onPress={() => {
                  attach(pasteClipboardPicture);
                  setClipPicture(false);
                }}
              >
                <Ionicons name="clipboard-outline" size={20} color={theme.accent} />
              </Pressable>
            )}
          </View>

          <View style={styles.row}>
            <Pressable
              hitSlop={8}
              style={styles.sideButton}
              onPress={() => {
                stopListening();
                inputRef.current?.focus();
              }}
            >
              <Ionicons name="keypad-outline" size={22} color={theme.ink.muted} />
            </Pressable>

            <Pressable
              onPress={() => {
                hapticButtonDown();
                if (listening) stopListening();
                else startListening();
              }}
            >
              <Animated.View
                style={[
                  styles.mic,
                  { backgroundColor: listening ? theme.accent : 'rgba(255,255,255,0.12)' },
                  pulseStyle,
                ]}
              >
                <Ionicons name={listening ? 'stop' : 'mic'} size={30} color={theme.ink.primary} />
              </Animated.View>
            </Pressable>

            <Pressable
              hitSlop={8}
              disabled={!text.trim() && attachments.length === 0}
              style={[
                styles.sideButton,
                !text.trim() && attachments.length === 0 && styles.sideButtonOff,
              ]}
              onPress={send}
            >
              <Ionicons
                name={editingId ? 'checkmark' : 'arrow-up'}
                size={22}
                color={text.trim() || attachments.length > 0 ? theme.accent : theme.ink.faint}
              />
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </GlassLayer>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: t.raised,
    ...SHEET_WINDOW,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
  },
  handle: {
    ...PHONE_ONLY,
    width: 36,
    height: 4,
    backgroundColor: t.edge.hairline,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  title: {
    fontSize: 17,
    fontFamily: FONT_BOLD,
    color: t.ink.primary,
  },
  input: {
    minHeight: 96,
    maxHeight: 220,
    fontSize: 17,
    lineHeight: 24,
    fontFamily: FONT_REGULAR,
    color: t.ink.primary,
    textAlignVertical: 'top',
  },
  trouble: {
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: t.ink.muted,
    marginTop: 6,
  },
  attached: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    padding: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  attachedThumb: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  attachedIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachedLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: t.ink.muted,
  },
  attachRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 10,
  },
  attachButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  // «У нотатку»: wider than the round ones, it carries its word.
  expandButton: {
    width: undefined,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 14,
    marginLeft: 'auto',
  },
  expandLabel: {
    fontFamily: FONT_REGULAR,
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  sideButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideButtonOff: {
    opacity: 0.5,
  },
  mic: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

// What a «paste» of a picture looks like in a text field: many replacement
// characters (U+FFFD) and control bytes arriving at once.
function isGarbagePaste(next: string, previous: string): boolean {
  const added = next.length - previous.length;
  if (added < 20) return false;
  const bad = (next.match(/[\uFFFD\u0000-\u0008\u000E-\u001F]/g) ?? []).length;
  return bad >= 8;
}
