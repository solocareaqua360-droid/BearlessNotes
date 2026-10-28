import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Keyboard, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import TextInput from './AppTextInput';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { Ionicons } from './icons/Ionicons';
import { useSoft } from '../theme/soft';
import { SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';
import { chatColours } from './chat/chatTokens';
import { useKeyboardRide } from '../hooks/useKeyboardRide';
import { useGeminiUsage } from '../utils/geminiUsage';
import { askEdit, type AiEditRound } from '../utils/aiEdit';
import { wordDiff } from '../utils/wordDiff';
import { parsePastedText, type ParsedBlock } from '../utils/pasteBlocks';
import { usd } from './chat/money';
import { notify } from './surfaces/Ask';

// THE AI ON THE CHOSEN BLOCKS (sketch V4 of 2026-10-23, «Що зробити з виділеним…»): a line like the quick-create one - the
// request, the microphone, below it a few quiet capsules and the price ring. The answer comes as a COPY in a card above it
// («Залишити» / «Скасувати»); «Показати зміни» marks what changed the way a teacher would - the old struck through in grey,
// the new on a soft warm ground (the user's pick, Notion's way, without red and green). Further asks («Ще поміняй…») go from
// the last version. Nothing in the note changes before «Залишити».
//
// A plain absolute View, never a Modal (the keyboard and the app's own ask() sheets would draw under a Modal): the owner puts
// it last in its root.

const FIRST_ASKS = ['Скоротити', 'У таблицю', 'Простіше'];
const NEXT_ASKS = ['Ще раз', 'Коротше'];
// What a capsule asks of the AI, in full (the capsule shows one word).
const ASK_TEXT: Record<string, string> = {
  Скоротити: 'Скороти цей текст, зберігши всю суть.',
  'У таблицю': 'Підбий ці дані в таблицю.',
  Простіше: 'Перепиши простішими словами, зберігши зміст.',
  Коротше: 'Зроби ще коротше.',
};

export default function AiEditSheet({
  visible,
  source,
  bottomInset,
  onClose,
  onKeep,
}: {
  visible: boolean;
  // The chosen blocks as Markdown (utils/blocksText).
  source: string;
  bottomInset: number;
  onClose: () => void;
  // The kept version, as blocks the paste reader made of it.
  onKeep: (blocks: ParsedBlock[]) => void;
}) {
  const S = useSoft();
  const C = chatColours(S);
  const { height } = useWindowDimensions();
  const usage = useGeminiUsage();
  const [ask, setAsk] = useState('');
  const [rounds, setRounds] = useState<AiEditRound[]>([]);
  const [busy, setBusy] = useState(false);
  const [showChanges, setShowChanges] = useState(false);
  const [costOpen, setCostOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const listeningRef = useRef(false);
  const committed = useRef('');
  // A new choice of blocks starts over.
  useEffect(() => {
    if (!visible) return;
    setAsk('');
    setRounds([]);
    setShowChanges(false);
    setCostOpen(false);
  }, [visible, source]);
  // Android's «back» closes the window too (it was only «Скасувати», after an answer - the user, 2026-10-24: before one there
  // was no way out but the edge swipe).
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);
  const ride = useKeyboardRide();
  const rest = bottomInset + 12;
  const lift = useAnimatedStyle(() => ({ transform: [{ translateY: Math.min(0, ride.height.value - 8 + rest) }] }));

  // DICTATION, as in the chat: Ukrainian, the words appearing as they are said. Only while THIS window listens (the chat
  // screen may be mounted under the note and hears the same events).
  const stopListening = () => {
    ExpoSpeechRecognitionModule.stop();
    listeningRef.current = false;
    setListening(false);
  };
  const startListening = async () => {
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      notify('Голосове введення недоступне', 'На цьому пристрої немає розпізнавання мови.');
      return;
    }
    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) return;
    committed.current = ask;
    ExpoSpeechRecognitionModule.start({ lang: 'uk-UA', interimResults: true, continuous: true, addsPunctuation: true });
    listeningRef.current = true;
    setListening(true);
  };
  useSpeechRecognitionEvent('result', (event) => {
    if (!listeningRef.current) return;
    const heard = event.results?.[0]?.transcript ?? '';
    const before = committed.current;
    const joined = before ? `${before} ${heard}`.replace(/\s+/g, ' ') : heard;
    setAsk(joined);
    if (event.isFinal) committed.current = joined;
  });
  useSpeechRecognitionEvent('end', () => {
    listeningRef.current = false;
    setListening(false);
  });

  if (!visible) return null;
  const last = rounds[rounds.length - 1];
  const spent = rounds.reduce((n, r) => n + r.costUsd, 0);

  async function run(words: string) {
    const said = words.trim();
    if (!said || busy) return;
    if (listeningRef.current) stopListening();
    // «Ще раз» is the last ask once more, from the original - another variant, not a change of the last one.
    const again = said === 'Ще раз';
    const request = again ? last?.ask ?? '' : ASK_TEXT[said] ?? said;
    if (!request) return;
    setBusy(true);
    setCostOpen(false);
    Keyboard.dismiss();
    try {
      const { text, costUsd } = await askEdit(source, again ? `${request} (Дай інший варіант, ніж попередній.)` : request, again ? undefined : last?.text);
      setRounds((list) => [...list, { ask: request, text, costUsd }]);
      setAsk('');
      committed.current = '';
    } catch (e) {
      notify('ШІ не відповів', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const parsed = last ? parsePastedText(last.text) : [];
  const hasTable = parsed.some((b) => b.type === 'table');
  const capsule = (label: string) => (
    <Pressable key={label} onPress={() => run(label)} disabled={busy} style={[styles.capsule, { backgroundColor: C.circle, opacity: busy ? 0.5 : 1 }]}>
      <Text style={[styles.capsuleText, { color: S.ink }]}>{label}</Text>
    </Pressable>
  );
  const card = { backgroundColor: C.dockCard, borderColor: S.line, boxShadow: S.dark ? '0px 10px 34px rgba(0,0,0,0.55)' : '0px 10px 34px rgba(0,0,0,0.16)' } as never;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* The note stays in view, dimmed: the chosen blocks are still marked on it. A tap on it only puts the keyboard away -
          a result must not vanish under a stray touch. */}
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: S.dark ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.12)' }]} onPress={() => Keyboard.dismiss()} accessible={false} />
      <Animated.View style={[styles.stack, { bottom: rest }, lift]} pointerEvents="box-none">
        {costOpen && (
          <View style={[styles.costCard, card]}>
            <Text style={[styles.costHead, { color: S.ink2 }]}>ВАРТІСТЬ</Text>
            <CostRow label="Цей запит" value={last ? usd(last.costUsd) : '—'} S={S} />
            <CostRow label="Ці правки" value={usd(spent)} S={S} />
            <CostRow label="Усього з ШІ" value={usage ? usd(usage.costUsd) : '—'} S={S} strong />
            <Text style={[styles.costNote, { color: S.ink2 }]}>У кільці - загальна сума, завжди вгору до наступної десятої долара.</Text>
          </View>
        )}
        {(busy || last) && (
          <View style={[styles.result, card]}>
            {busy ? (
              <View style={styles.busy}>
                <ActivityIndicator color={S.accent} />
                <Text style={[styles.busyText, { color: S.ink2 }]}>Пишу…</Text>
              </View>
            ) : last ? (
              <>
                <ScrollView style={{ maxHeight: Math.round(height * 0.38) }} contentContainerStyle={{ gap: 8 }}>
                  {showChanges && !hasTable ? <Changes before={source} after={last.text} S={S} wash={C.wash} /> : <Clean blocks={parsed} S={S} />}
                </ScrollView>
                <View style={styles.buttons}>
                  <Pressable onPress={() => onKeep(parsed)} style={[styles.button, { backgroundColor: C.darkBtn }]}>
                    <Text style={[styles.buttonText, { color: C.darkBtnInk }]}>Залишити</Text>
                  </Pressable>
                  <Pressable onPress={onClose} style={[styles.button, { backgroundColor: C.circle }]}>
                    <Text style={[styles.buttonText, { color: S.ink }]}>Скасувати</Text>
                  </Pressable>
                  <View style={{ flex: 1 }} />
                  {!hasTable && (
                    <Pressable onPress={() => setShowChanges((v) => !v)} style={[styles.button, styles.outline, { borderColor: S.line }]}>
                      <Ionicons name={showChanges ? 'eye-off-outline' : 'eye-outline'} size={16} color={S.ink} />
                      <Text style={[styles.outlineText, { color: S.ink }]}>{showChanges ? 'Сховати зміни' : 'Показати зміни'}</Text>
                    </Pressable>
                  )}
                </View>
              </>
            ) : null}
          </View>
        )}
        <View style={[styles.line, card]}>
          <View style={styles.inputRow}>
            <Pressable onPress={onClose} accessibilityLabel="Закрити" hitSlop={4} style={[styles.circle, { backgroundColor: C.circle }]}>
              <Ionicons name="close" size={19} color={S.ink} />
            </Pressable>
            <TextInput
              value={ask}
              onChangeText={setAsk}
              placeholder={last ? 'Ще поміняй…' : 'Що зробити з виділеним…'}
              placeholderTextColor={S.ink3}
              multiline
              onSubmitEditing={() => run(ask)}
              style={[styles.input, { color: S.ink }]}
            />
            {ask.trim() ? (
              <Pressable onPress={() => run(ask)} disabled={busy} accessibilityLabel="Надіслати" style={[styles.circle, { backgroundColor: C.send }]}>
                <Ionicons name="arrow-up" size={18} color="#FFFFFF" />
              </Pressable>
            ) : (
              <Pressable
                onPress={() => (listening ? stopListening() : startListening())}
                accessibilityLabel={listening ? 'Зупинити диктування' : 'Диктувати'}
                style={[styles.circle, { backgroundColor: listening ? S.accent : 'transparent' }]}
              >
                <Ionicons name={listening ? 'stop' : 'mic-outline'} size={20} color={listening ? '#FFFFFF' : S.ink} />
              </Pressable>
            )}
          </View>
          <View style={styles.capsules}>
            {(last ? NEXT_ASKS : FIRST_ASKS).map(capsule)}
            <View style={{ flex: 1 }} />
            <Pressable onPress={() => setCostOpen((v) => !v)} accessibilityLabel="Вартість" hitSlop={6}>
              <CostRing total={usage?.costUsd ?? 0} color={S.accent} track={S.line} ink={S.ink} />
            </Pressable>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

function CostRow({ label, value, S, strong }: { label: string; value: string; S: ReturnType<typeof useSoft>; strong?: boolean }) {
  const font = strong ? SOFT_SEMIBOLD : SOFT_REGULAR;
  return (
    <View style={styles.costRow}>
      <Text style={[styles.costText, { color: S.ink, fontFamily: font }]}>{label}</Text>
      <Text style={[styles.costText, { color: S.ink, fontFamily: font }]}>{value}</Text>
    </View>
  );
}

// The ring with one figure in it: the whole sum spent on the AI, rounded UP to the next tenth of a dollar; the arc is how far
// into that tenth it is.
function CostRing({ total, color, track, ink }: { total: number; color: string; track: string; ink: string }) {
  const size = 28;
  const r = 11.5;
  const c = 2 * Math.PI * r;
  const tenths = total * 10;
  const ceil = Math.max(1, Math.ceil(tenths - 1e-9));
  const used = tenths <= 0 ? 0 : tenths - (ceil - 1);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={2.2} />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeDasharray={`${Math.max(0.04, Math.min(1, used)) * c} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <Text style={{ fontSize: 8.5, fontFamily: SOFT_SEMIBOLD, color: ink }}>{(ceil / 10).toFixed(1).replace('.', ',')}</Text>
    </View>
  );
}

// The markers of bold/italic are not shown in the window: it reads as text, not as Markdown.
const plain = (s: string) => s.replace(/\*\*|__/g, '').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2');
// In «Показати зміни» the block marks read as they look in the note: no «#» before a heading, a dot before a list item.
const readable = (s: string) =>
  plain(s)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^(\s*)[-*]\s+\[([ xX])\]\s+/gm, (_, sp: string, x: string) => `${sp}${x === ' ' ? '☐' : '☑'}  `)
    .replace(/^(\s*)[-*]\s+/gm, '$1•  ');

// The new version as it will stand in the note: headings, list marks, a table as a grid.
function Clean({ blocks, S }: { blocks: ParsedBlock[]; S: ReturnType<typeof useSoft> }) {
  let number = 0;
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type !== 'numbered') number = 0;
        if (b.type === 'table' && b.tableRows) {
          // One width per column (the longest cell in it), or the head and the rows under it do not line up.
          const widths = (b.tableRows[0]?.cells ?? []).map((_, c) =>
            Math.max(80, Math.min(200, 18 + 8 * Math.max(...b.tableRows!.map((row) => plain(row.cells[c] ?? '').length))))
          );
          return (
            <ScrollView key={i} horizontal showsHorizontalScrollIndicator={false}>
              <View style={[styles.table, { borderColor: S.line }]}>
                {b.tableRows.map((row, r) => (
                  <View key={r} style={[styles.tableRow, { borderColor: S.line }, r === 0 && { backgroundColor: S.fillSolid }]}>
                    {row.cells.map((cell, c) => (
                      <Text key={c} style={[styles.tableCell, { width: widths[c] ?? 120, color: S.ink, borderColor: S.line, fontFamily: r === 0 ? SOFT_SEMIBOLD : SOFT_REGULAR }]}>
                        {plain(cell)}
                      </Text>
                    ))}
                  </View>
                ))}
              </View>
            </ScrollView>
          );
        }
        if (b.type === 'divider') return <View key={i} style={{ height: StyleSheet.hairlineWidth, backgroundColor: S.line }} />;
        if (b.type === 'numbered') number += 1;
        const mark = b.type === 'bulleted' ? '•  ' : b.type === 'numbered' ? `${number}.  ` : b.type === 'checkbox' ? (b.checked ? '☑  ' : '☐  ') : '';
        const heading = b.type === 'heading';
        return (
          <Text key={i} style={[styles.text, { color: S.ink }, heading && { fontFamily: SOFT_SEMIBOLD, fontSize: (b.headingLevel ?? 2) <= 1 ? 20 : 17 }]}>
            {mark}
            {plain(b.text)}
          </Text>
        );
      })}
    </>
  );
}

// What changed: the old struck through in grey, the new on a soft warm ground.
function Changes({ before, after, S, wash }: { before: string; after: string; S: ReturnType<typeof useSoft>; wash: string }) {
  const pieces = wordDiff(readable(before), readable(after));
  return (
    <Text style={[styles.text, { color: S.ink }]}>
      {pieces.map((p, i) =>
        p.kind === 'same' ? (
          p.text
        ) : p.kind === 'del' ? (
          <Text key={i}>
            <Text style={{ color: S.ink3, textDecorationLine: 'line-through' }}>{p.text}</Text>
            {/* Gone and added side by side need a space between them, or they read as one word. */}
            {pieces[i + 1]?.kind === 'ins' && !/\s$/.test(p.text) && !/^\s/.test(pieces[i + 1].text) ? ' ' : ''}
          </Text>
        ) : (
          <Text key={i} style={{ backgroundColor: wash }}>
            {p.text}
          </Text>
        )
      )}
    </Text>
  );
}

const styles = StyleSheet.create({
  stack: { position: 'absolute', left: 12, right: 12, gap: 10 },
  line: { borderRadius: 26, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10, gap: 10 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40 },
  input: { flex: 1, fontSize: 16.5, lineHeight: 23, fontFamily: SOFT_REGULAR, paddingVertical: 0, paddingLeft: 4, maxHeight: 23 * 4 + 4 },
  circle: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  capsules: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  capsule: { height: 32, borderRadius: 16, paddingHorizontal: 13, justifyContent: 'center' },
  capsuleText: { fontSize: 13.5, fontFamily: SOFT_MEDIUM },
  result: { borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 14 },
  busy: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  busyText: { fontSize: 14, fontFamily: SOFT_MEDIUM },
  text: { fontSize: 15.5, lineHeight: 23, fontFamily: SOFT_REGULAR },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  button: { height: 42, borderRadius: 21, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  buttonText: { fontSize: 14.5, fontFamily: SOFT_SEMIBOLD },
  outline: { borderWidth: 1, paddingHorizontal: 13 },
  outlineText: { fontSize: 13, fontFamily: SOFT_MEDIUM },
  costCard: { alignSelf: 'flex-end', width: 270, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 8 },
  costHead: { fontSize: 11, fontFamily: SOFT_SEMIBOLD, letterSpacing: 0.6 },
  costRow: { flexDirection: 'row', justifyContent: 'space-between' },
  costText: { fontSize: 13.5 },
  costNote: { fontSize: 11.5, fontFamily: SOFT_REGULAR, lineHeight: 15 },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, overflow: 'hidden' },
  tableRow: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  tableCell: { paddingHorizontal: 8, paddingVertical: 6, fontSize: 13.5, borderRightWidth: StyleSheet.hairlineWidth },
});
