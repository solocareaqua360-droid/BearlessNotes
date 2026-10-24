import { useEffect, useState, type Ref } from 'react';
import { Image, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Ionicons } from '../icons/Ionicons';
import { useKeyboardRide } from '../../hooks/useKeyboardRide';
import { useSoft } from '../../theme/soft';
import { SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../../utils/fonts';
import { chatColours } from './chatTokens';
import HintBalloon from './HintBalloon';
import DockGlassFill, { useDockSurface } from '../DockGlassFill';
import { useDockGlass } from '../../utils/dockGlass';

export type ComposerAttachment = { id: string; kind: 'photo' | 'file' | 'note' | 'folder' | 'link'; name: string; sub: string; uri?: string };

const STRIP_H = 56;
const ROW_H = 44;

// THE CHAT'S DOCK (sketches fin2/fin3/fin6 of 2026-10-24, after Claude's own): at rest a narrow strip - «+», the field, the «?»
// balloon (the hints), the microphone; while writing (focused, words typed, or something attached) the same thing GROWS into a
// card: what is attached, the words on top, and ONE row of buttons under them - what you ADD and the help on the left, what
// SENDS on the right. One TextInput the whole time: only its frame changes, so the keyboard never drops on the way.
export default function ChatComposer({
  value,
  onChangeText,
  onSend,
  sending,
  listening,
  onMic,
  onPlus,
  hintsOpen,
  onHints,
  attachments,
  onRemoveAttachment,
  estimate,
  placeholder,
  keyboardHeight,
  bottomInset,
  inputRef,
  onHeight,
}: {
  value: string;
  onChangeText: (t: string) => void;
  onSend: () => void;
  sending: boolean;
  listening: boolean;
  onMic: () => void;
  onPlus: () => void;
  hintsOpen: boolean;
  onHints: () => void;
  attachments: ComposerAttachment[];
  onRemoveAttachment: (id: string) => void;
  estimate?: { text: string; warn: boolean } | null;
  placeholder: string;
  keyboardHeight: number;
  bottomInset: number;
  inputRef?: Ref<TextInput>;
  // The dock's drawn height, for the host to keep the chat (and the hints band) clear of it.
  onHeight?: (h: number) => void;
}) {
  const S = useSoft();
  const C = chatColours(S);
  // «Скло» (utils/dockGlass): glass over the conversation (its blur target - AssistantScreen).
  const glassOn = useDockGlass();
  const glassSurface = useDockSurface(S, glassOn);
  const [focused, setFocused] = useState(false);
  // Android's back gesture puts the keyboard away WITHOUT blurring the field: the card stayed open over an empty field. The
  // keyboard going down ends the writing.
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidHide', () => setFocused(false));
    return () => sub.remove();
  }, []);
  const open = focused || value.length > 0 || attachments.length > 0;
  const canSend = !sending && (value.trim().length > 0 || attachments.length > 0);
  // 0 = the strip, 1 = the card - the radius and the padding follow it, the height is the content's own.
  const t = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    t.value = withTiming(open ? 1 : 0, { duration: 220, easing: Easing.out(Easing.cubic) });
  }, [open, t]);
  const frame = useAnimatedStyle(() => ({
    borderRadius: 28 - 2 * t.value,
    paddingTop: 8 + 6 * t.value,
  }));
  // It RIDES THE KEYBOARD frame by frame (the same ride as the app's dock, ContextDock): placed by the keyboard's height
  // as an event it got there before the keyboard did - the card jumped up, then the keyboard rose under it.
  const ride = useKeyboardRide();
  const rest = bottomInset + 14;
  const bottom = rest;
  const lift = useAnimatedStyle(() => ({ transform: [{ translateY: Math.min(0, ride.height.value - 8 + rest) }] }));
  void keyboardHeight;

  const circle = (child: React.ReactNode, onPress: () => void, label: string, fill: string, size = 40) => (
    <Pressable onPress={onPress} accessibilityLabel={label} hitSlop={4} style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: fill }]}>
      {child}
    </Pressable>
  );
  const plus = circle(<Ionicons name="add" size={21} color={S.ink} />, onPlus, 'Додати', C.circle);
  const hints = hintsOpen
    ? circle(<Ionicons name="chevron-down" size={19} color="#FFFFFF" />, onHints, 'Сховати підказки', S.accent)
    : circle(<HintBalloon color={S.accent} />, onHints, 'Підказки', C.wash);
  const mic = circle(<Ionicons name={listening ? 'stop' : 'mic-outline'} size={21} color={listening ? '#FFFFFF' : S.ink} />, onMic, listening ? 'Зупинити диктування' : 'Диктувати', listening ? S.accent : 'transparent');

  return (
    <Animated.View
      onLayout={(e) => onHeight?.(Math.round(e.nativeEvent.layout.height))}
      style={[
        styles.dock,
        { bottom, backgroundColor: C.dockCard, borderColor: S.line, boxShadow: S.dark ? '0px 10px 34px rgba(0,0,0,0.55)' : '0px 10px 34px rgba(0,0,0,0.16)' } as never,
        glassOn && ([glassSurface, { borderWidth: 0 }] as never),
        frame,
        lift,
      ]}
    >
      {glassOn && <DockGlassFill soft={S} dense radius={28} />}
      {open && attachments.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
          {attachments.map((a) =>
            a.kind === 'photo' && a.uri ? (
              <View key={a.id} style={styles.photoChip}>
                <Image source={{ uri: a.uri }} style={styles.photo} />
                <Pressable hitSlop={6} onPress={() => onRemoveAttachment(a.id)} accessibilityLabel="Прибрати" style={[styles.photoX, { backgroundColor: C.darkBtn }]}>
                  <Ionicons name="close" size={11} color={C.darkBtnInk} />
                </Pressable>
              </View>
            ) : (
              <View key={a.id} style={[styles.fileChip, { backgroundColor: C.tileGround }]}>
                <View style={[styles.fileIcon, { backgroundColor: C.wash }]}>
                  <Ionicons name={a.kind === 'folder' ? 'folder-outline' : a.kind === 'note' ? 'document-text-outline' : a.kind === 'link' ? 'link-outline' : 'document-outline'} size={18} color={S.accent} />
                </View>
                <View style={{ maxWidth: 110 }}>
                  <Text numberOfLines={1} style={[styles.fileName, { color: S.ink }]}>
                    {a.name}
                  </Text>
                  <Text numberOfLines={1} style={[styles.fileSub, { color: S.ink2 }]}>
                    {a.sub}
                  </Text>
                </View>
                <Pressable hitSlop={6} onPress={() => onRemoveAttachment(a.id)} accessibilityLabel="Прибрати" style={[styles.fileX, { backgroundColor: C.dockCard }]}>
                  <Ionicons name="close" size={11} color={S.ink2} />
                </Pressable>
              </View>
            )
          )}
        </ScrollView>
      )}
      {/* The strip's own row: «+» and the field and the two circles. In the card the field takes the whole first line and the
          buttons go down to their own row - the SAME TextInput moves, it is never a second one. */}
      <View style={[styles.line, open && styles.lineOpen]}>
        {!open && plus}
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          placeholderTextColor={S.ink3}
          multiline
          style={[styles.input, { color: S.ink }, open ? styles.inputOpen : styles.inputRest]}
        />
        {!open && hints}
        {!open && mic}
      </View>
      {open && (
        <View style={styles.row}>
          {plus}
          {hints}
          <View style={{ flex: 1 }} />
          {!!estimate && (
            <Text numberOfLines={1} style={[styles.estimate, { color: estimate.warn ? S.accent : S.ink2 }]}>
              {estimate.text}
            </Text>
          )}
          {mic}
          <Pressable
            onPress={canSend ? onSend : undefined}
            disabled={!canSend}
            accessibilityLabel="Надіслати"
            style={[styles.circle, { width: ROW_H, height: ROW_H, borderRadius: ROW_H / 2, backgroundColor: canSend ? C.send : C.circle }]}
          >
            <Ionicons name="arrow-up" size={19} color={canSend ? '#FFFFFF' : S.ink3} />
          </Pressable>
        </View>
      )}
    </Animated.View>
  );
}

export const CHAT_DOCK_REST_H = STRIP_H;

const styles = StyleSheet.create({
  dock: { position: 'absolute', left: 14, right: 14, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 8, paddingBottom: 8, minHeight: STRIP_H, gap: 10 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 40 },
  lineOpen: { paddingHorizontal: 8 },
  input: { flex: 1, fontSize: 16.5, lineHeight: 23, fontFamily: SOFT_REGULAR, paddingVertical: 0 },
  inputRest: { maxHeight: 40, paddingLeft: 6 },
  inputOpen: { maxHeight: 23 * 6 + 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  circle: { alignItems: 'center', justifyContent: 'center' },
  estimate: { fontSize: 11.5, fontFamily: SOFT_MEDIUM, maxWidth: 150, paddingRight: 2 },
  chips: { gap: 8, paddingTop: 4, paddingHorizontal: 2 },
  photoChip: { width: 52, height: 52 },
  photo: { width: 52, height: 52, borderRadius: 14 },
  photoX: { position: 'absolute', top: -5, right: -5, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  fileChip: { height: 52, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8 },
  fileIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  fileName: { fontSize: 12.5, fontFamily: SOFT_SEMIBOLD },
  fileSub: { fontSize: 11, fontFamily: SOFT_REGULAR },
  fileX: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
});
