import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import GlassLayer from './GlassLayer';
import { GLASS_BODY_BLURRED, GLASS_LINE, GLASS_TEXT, GLASS_TEXT_FAINT, GLASS_TEXT_MUTED, SHEET_WINDOW } from '../constants/glass';
import { FONT_BOLD, FONT_REGULAR } from '../utils/fonts';
import { sendChatMessage } from '../utils/chat';
import { hapticButtonDown } from '../utils/haptics';
import { useTheme } from '../theme/ThemeProvider';

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
  const [visible, setVisible] = useState(false);
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [typing, setTyping] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
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
      setTrouble(null);
      setTyping(false);
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
      setTrouble('Розпізнавання тут недоступне - напишіть або скористайтеся мікрофоном клавіатури');
      setTyping(true);
      return;
    }
    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) {
      setTrouble('Без дозволу на мікрофон лишається клавіатура');
      setTyping(true);
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
    setTyping(true);
  });

  const close = useCallback(() => {
    ExpoSpeechRecognitionModule.stop();
    setListening(false);
    Keyboard.dismiss();
    setVisible(false);
  }, []);

  async function send() {
    const toSend = text;
    close();
    await sendChatMessage(toSend);
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
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        <View style={styles.sheet}>
          <View style={styles.handle} />

          <View style={styles.headRow}>
            <Text style={styles.title}>{listening ? 'Слухаю…' : 'Думка'}</Text>
            <Pressable hitSlop={10} onPress={onOpenChat}>
              <Ionicons name="time-outline" size={22} color={GLASS_TEXT_MUTED} />
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
            placeholderTextColor={GLASS_TEXT_FAINT}
            style={styles.input}
            showSoftInputOnFocus={typing}
          />

          {!!trouble && <Text style={styles.trouble}>{trouble}</Text>}

          <View style={styles.row}>
            <Pressable
              hitSlop={8}
              style={styles.sideButton}
              onPress={() => {
                stopListening();
                setTyping(true);
                inputRef.current?.focus();
              }}
            >
              <Ionicons name="keypad-outline" size={22} color={GLASS_TEXT_MUTED} />
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
                <Ionicons name={listening ? 'stop' : 'mic'} size={30} color={GLASS_TEXT} />
              </Animated.View>
            </Pressable>

            <Pressable
              hitSlop={8}
              disabled={!text.trim()}
              style={[styles.sideButton, !text.trim() && styles.sideButtonOff]}
              onPress={send}
            >
              <Ionicons
                name="arrow-up"
                size={22}
                color={text.trim() ? theme.accent : GLASS_TEXT_FAINT}
              />
            </Pressable>
          </View>
        </View>
      </View>
    </GlassLayer>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: GLASS_BODY_BLURRED,
    ...SHEET_WINDOW,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: GLASS_LINE,
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
    color: GLASS_TEXT,
  },
  input: {
    minHeight: 96,
    maxHeight: 220,
    fontSize: 17,
    lineHeight: 24,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT,
    textAlignVertical: 'top',
  },
  trouble: {
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT_MUTED,
    marginTop: 6,
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
