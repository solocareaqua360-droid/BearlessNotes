import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import type { Theme } from '../theme/tokens';
import GlassLayer from './GlassLayer';
import { SHEET_WINDOW } from '../constants/glass';
import { FONT_BOLD, FONT_REGULAR } from '../utils/fonts';
import { sendChatMessage } from '../utils/chat';
import { ChatAttachment, attachLinkToChat, pickFileForChat, pickMediaForChat } from '../utils/chatAttach';
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

export default function CaptureWindow({ onOpenChat }: { onOpenChat: () => void }) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const [visible, setVisible] = useState(false);
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
      setVisible(true);
    };
    return () => {
      listener = null;
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
  // there is nothing to press before speaking.
  useEffect(() => {
    if (visible) startListening();
    // startListening is deliberately not a dependency: this fires on the
    // OPENING, not on every change of the text it closes over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useSpeechRecognitionEvent('result', (event) => {
    const heard = event.results?.[0]?.transcript ?? '';
    const before = committed.current;
    setText(before ? `${before} ${heard}`.replace(/\s+/g, ' ') : heard);
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
  }, []);

  async function send() {
    const toSend = text;
    const withThem = attachments;
    close();
    await sendChatMessage(toSend, withThem);
  }

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
    <GlassLayer visible={visible} onClose={close}>
      <View style={[styles.backdrop, { paddingBottom: keyboardHeight }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        <View style={styles.sheet}>
          <View style={styles.handle} />

          <View style={styles.headRow}>
            <Text style={styles.title}>{listening ? 'Слухаю…' : 'Думка'}</Text>
            <Pressable hitSlop={10} onPress={onOpenChat}>
              <Ionicons name="time-outline" size={22} color={theme.ink.muted} />
            </Pressable>
          </View>

          {/* What was heard, and what can still be corrected by hand. */}
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={(next) => {
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
                name="arrow-up"
                size={22}
                color={text.trim() || attachments.length > 0 ? theme.accent : theme.ink.faint}
              />
            </Pressable>
          </View>
        </View>
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
