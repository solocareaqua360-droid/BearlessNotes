import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '../components/icons/Ionicons';
import { ask, notify } from '../components/surfaces/Ask';
import { useSoft } from '../theme/soft';
import { SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import { askAssistant, blocksOf, groupsOf, loadChat, newChat, saveChat, type AssistantChat, type AssistantMessage } from '../utils/assistant';
import { useGeminiUsage } from '../utils/geminiUsage';
import { hapticPickUp } from '../utils/haptics';
import { collection } from '../firestore';
import { db } from '../firebase';
import { addDoc } from '../utils/owned';
import { newBlock } from '../utils/documentBlocks';

// THE CONVERSATION WITH THE AI (step 1, 2026-10-22; the sketch is the canvas DsJtJiEDSEMWdhomAgJreE, frame «2. Розмова»).
// Opened from the round button beside «+» on the start desks: a thought to talk over comes as suddenly as one for «Думки».
// Plain talk, no modes and no buttons hanging over it (the user: they «лякають»). Each answer is a stack of BLOCKS.
// A block HELD starts picking: taps add or take away more blocks (a topic is often told over several of them - the user,
// the same evening), and while anything is picked the field gives way to the picked blocks' actions: remember them as ONE
// memory, ask about them in more detail together, copy them. What was remembered goes into a note with «В нотатку».

const blockKey = (messageId: string, index: number) => `${messageId}:${index}`;

export default function AssistantScreen() {
  const S = useSoft();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<{ goBack: () => void; navigate: (name: string, params?: object) => void }>();
  const keyboard = useKeyboardHeight();
  const usage = useGeminiUsage();
  const [chat, setChat] = useState<AssistantChat | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  // The blocks picked right now, in the order they were picked.
  const [picked, setPicked] = useState<string[]>([]);
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    loadChat().then(setChat);
  }, []);
  const update = (next: AssistantChat) => {
    setChat(next);
    saveChat(next);
  };

  const groups = useMemo(() => (chat ? groupsOf(chat) : []), [chat]);
  // Each remembered block -> its group, and whether it is the last block of it (where «у пам'яті» is written).
  const memo = useMemo(() => {
    const m = new Map<string, { last: boolean }>();
    groups.forEach((g) => g.forEach((k, i) => m.set(k, { last: i === g.length - 1 })));
    return m;
  }, [groups]);
  // Every block's text by its key, in the order of the conversation - picked blocks are read back in that order.
  const blockTexts = useMemo(() => {
    const out: { key: string; text: string }[] = [];
    (chat?.messages ?? []).forEach((m) => {
      if (m.role !== 'model' || m.error) return;
      blocksOf(m.text).forEach((text, i) => out.push({ key: blockKey(m.id, i), text }));
    });
    return out;
  }, [chat]);
  const textsOf = (keys: string[]) => blockTexts.filter((b) => keys.includes(b.key)).map((b) => b.text);
  const lastCost = [...(chat?.messages ?? [])].reverse().find((m) => m.role === 'model' && m.costUsd !== undefined)?.costUsd;
  const chatCost = (chat?.messages ?? []).reduce((sum, m) => sum + (m.costUsd ?? 0), 0);

  async function send(text: string) {
    const clean = text.trim();
    if (!clean || !chat || busy) return;
    setPicked([]);
    const mine: AssistantMessage = { id: `m${Date.now()}`, role: 'user', text: clean, at: Date.now() };
    const withMine = { ...chat, messages: [...chat.messages, mine] };
    update(withMine);
    setDraft('');
    setBusy(true);
    try {
      const { text: answer, costUsd } = await askAssistant(withMine.messages);
      update({ ...withMine, messages: [...withMine.messages, { id: `a${Date.now()}`, role: 'model', text: answer, at: Date.now(), costUsd }] });
    } catch (e) {
      update({ ...withMine, messages: [...withMine.messages, { id: `e${Date.now()}`, role: 'model', text: (e as Error).message, at: Date.now(), error: true }] });
    } finally {
      setBusy(false);
    }
  }

  function hold(key: string) {
    hapticPickUp();
    setPicked((p) => (p.includes(key) ? p : [...p, key]));
  }
  function tap(key: string) {
    if (picked.length === 0) return;
    setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));
  }

  // All picked already remembered: forget them. Otherwise they become ONE memory, taken out of any they were in.
  const allRemembered = picked.length > 0 && picked.every((k) => memo.has(k));
  function rememberPicked() {
    if (!chat || picked.length === 0) return;
    const ordered = blockTexts.map((b) => b.key).filter((k) => picked.includes(k));
    const rest = groupsOf(chat)
      .map((g) => g.filter((k) => !picked.includes(k)))
      .filter((g) => g.length > 0);
    const next = allRemembered ? rest : [...rest, ordered];
    update({ ...chat, groups: next, remembered: next.flat() });
    setPicked([]);
  }
  function moreAboutPicked() {
    const texts = textsOf(picked);
    if (texts.length === 0) return;
    setPicked([]);
    send(texts.length === 1 ? `Розкажи детальніше про це: «${texts[0]}»` : `Розкажи детальніше про це:\n${texts.map((t) => `«${t}»`).join('\n')}`);
  }
  function copyPicked() {
    Clipboard.setStringAsync(textsOf(picked).join('\n\n')).catch(() => {});
    setPicked([]);
  }

  async function toNote() {
    if (!chat || groups.length === 0) return;
    const firstAsk = chat.messages.find((m) => m.role === 'user')?.text ?? 'Розмова';
    const title = firstAsk.length > 60 ? `${firstAsk.slice(0, 57).trim()}…` : firstAsk;
    try {
      const now = Date.now();
      const ref = await addDoc(collection(db, 'documents'), {
        title,
        createdAt: now,
        updatedAt: now,
        // One memory = one block, its parts as paragraphs of it.
        blocks: groups.map((g) => ({ ...newBlock(), type: 'paragraph', text: textsOf(g).join('\n\n') })),
      });
      navigation.navigate('Editor', { documentId: ref.id });
    } catch (e) {
      notify('Не вдалося створити нотатку', (e as Error).message);
    }
  }

  async function menu() {
    const choice = await ask({
      title: 'Розмова',
      actions: [{ id: 'new', label: 'Нова розмова', icon: 'add' as const }],
    });
    if (choice === 'new') {
      update(newChat());
      setPicked([]);
    }
  }

  const messages = chat?.messages ?? [];
  const count = groups.length;
  const styles = useMemo(() => makeStyles(S), [S]);
  const picking = picked.length > 0;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={menu} style={styles.round} accessibilityLabel="Меню розмови" hitSlop={6}>
          <Ionicons name="ellipsis-horizontal" size={18} color={S.ink} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          Розмова
        </Text>
        {count > 0 ? (
          <Pressable onPress={toNote} style={styles.toNote} accessibilityLabel="Відібране в нотатку">
            <Text style={styles.toNoteText}>{`В нотатку (${count})`}</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={() => navigation.goBack()} style={styles.round} accessibilityLabel="Закрити" hitSlop={6}>
          <Ionicons name="close" size={18} color={S.ink} />
        </Pressable>
      </View>
      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => {
          if (!picking) scroll.current?.scrollToEnd({ animated: true });
        }}
      >
        {messages.length === 0 && !busy ? (
          <Text style={styles.empty}>Про що хочете поговорити? Пишіть як зручно, хоч хаотично. Утримайте абзац відповіді, щоб вибрати його, а тапами додайте ще.</Text>
        ) : null}
        {messages.map((m) =>
          m.role === 'user' ? (
            <View key={m.id} style={styles.mine}>
              <Text style={styles.mineText}>{m.text}</Text>
            </View>
          ) : m.error ? (
            <Text key={m.id} style={styles.error}>
              {m.text}
            </Text>
          ) : (
            <View key={m.id} style={styles.answer}>
              {blocksOf(m.text).map((b, i) => {
                const key = blockKey(m.id, i);
                const mem = memo.get(key);
                const on = picked.includes(key);
                return (
                  <Pressable
                    key={key}
                    onLongPress={() => hold(key)}
                    onPress={() => tap(key)}
                    delayLongPress={350}
                    style={[styles.block, mem && styles.blockMem, on && styles.blockPicked]}
                  >
                    <Text style={styles.blockText}>{b}</Text>
                    {mem?.last ? <Text style={styles.memo}>у пам'яті</Text> : null}
                    {on ? (
                      <View style={styles.tick}>
                        <Ionicons name="checkmark" size={12} color={S.card} />
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          )
        )}
        {busy ? (
          <View style={styles.thinking}>
            <ActivityIndicator size="small" color={S.ink3} />
            <Text style={styles.thinkingText}>Думаю…</Text>
          </View>
        ) : null}
      </ScrollView>
      <View style={[styles.foot, { paddingBottom: (keyboard > 0 && !picking ? keyboard : insets.bottom) + 10 }]}>
        {picking ? (
          <View style={styles.pickBar}>
            <Pressable onPress={() => setPicked([])} style={styles.pickClose} accessibilityLabel="Скасувати вибір" hitSlop={6}>
              <Ionicons name="close" size={16} color={S.card} />
            </Pressable>
            <Text style={styles.pickCount}>{`Вибрано ${picked.length}`}</Text>
            <Pressable onPress={rememberPicked} style={styles.pickMain}>
              <Text style={styles.pickMainText}>{allRemembered ? 'Забути' : "Запам'ятати"}</Text>
            </Pressable>
            <Pressable onPress={moreAboutPicked} style={styles.pickAction}>
              <Text style={styles.pickActionText}>Детальніше</Text>
            </Pressable>
            <Pressable onPress={copyPicked} style={styles.pickAction} accessibilityLabel="Копіювати">
              <Ionicons name="copy-outline" size={16} color={S.card} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.field}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Пишіть як зручно"
              placeholderTextColor={S.ink3}
              style={styles.input}
              multiline
            />
            <Pressable
              onPress={() => send(draft)}
              disabled={busy || !draft.trim()}
              style={[styles.send, (busy || !draft.trim()) && { opacity: 0.35 }]}
              accessibilityLabel="Надіслати"
            >
              <Ionicons name="arrow-up" size={18} color={S.card} />
            </Pressable>
          </View>
        )}
        <Text style={styles.cost}>
          {`${lastCost !== undefined ? `≈ $${lastCost.toFixed(4)} остання відповідь · ` : ''}розмова $${chatCost.toFixed(3)}${usage ? ` · усього $${usage.costUsd.toFixed(2)}` : ''}`}
        </Text>
      </View>
    </View>
  );
}

function makeStyles(S: ReturnType<typeof useSoft>) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: S.bg },
    header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
    round: { width: 40, height: 40, borderRadius: 20, backgroundColor: S.card, alignItems: 'center', justifyContent: 'center', boxShadow: S.shadow } as never,
    title: { flex: 1, textAlign: 'center', fontSize: 16, fontFamily: SOFT_SEMIBOLD, color: S.ink },
    toNote: { height: 36, borderRadius: 18, paddingHorizontal: 14, backgroundColor: S.ink, alignItems: 'center', justifyContent: 'center' },
    toNoteText: { color: S.card, fontSize: 13, fontFamily: SOFT_SEMIBOLD },
    list: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 24, gap: 14 },
    empty: { fontSize: 15, lineHeight: 22, color: S.ink2, fontFamily: SOFT_REGULAR, marginTop: 24 },
    mine: { alignSelf: 'flex-end', maxWidth: '82%', backgroundColor: S.fillSolid, borderRadius: 18, borderBottomRightRadius: 4, paddingHorizontal: 14, paddingVertical: 10 },
    mineText: { fontSize: 15, lineHeight: 21, color: S.ink, fontFamily: SOFT_REGULAR },
    answer: { gap: 6 },
    block: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6, marginHorizontal: -8, borderWidth: 1.5, borderColor: 'transparent' },
    blockMem: { backgroundColor: S.dark ? 'rgba(217,121,63,0.18)' : '#FBEBD9' },
    blockPicked: { borderColor: S.accent },
    blockText: { fontSize: 15, lineHeight: 22, color: S.ink, fontFamily: SOFT_REGULAR },
    memo: { marginTop: 4, fontSize: 11, color: S.accent, fontFamily: SOFT_SEMIBOLD },
    tick: { position: 'absolute', right: -6, top: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: S.accent, alignItems: 'center', justifyContent: 'center' },
    error: { fontSize: 14, lineHeight: 20, color: '#B3402F', fontFamily: SOFT_REGULAR },
    thinking: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    thinkingText: { fontSize: 14, color: S.ink3, fontFamily: SOFT_REGULAR },
    foot: { paddingHorizontal: 12, paddingTop: 8, gap: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: S.line, backgroundColor: S.bg },
    field: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, backgroundColor: S.card, borderRadius: 22, paddingLeft: 14, paddingRight: 6, paddingVertical: 6 },
    input: { flex: 1, maxHeight: 140, fontSize: 15, lineHeight: 21, color: S.ink, fontFamily: SOFT_REGULAR, paddingVertical: 6 },
    send: { width: 36, height: 36, borderRadius: 18, backgroundColor: S.ink, alignItems: 'center', justifyContent: 'center' },
    pickBar: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: S.ink, borderRadius: 24, padding: 6, minHeight: 48 },
    pickClose: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
    pickCount: { flex: 1, color: S.card, fontSize: 13, fontFamily: SOFT_MEDIUM },
    pickMain: { backgroundColor: S.card, borderRadius: 17, paddingHorizontal: 13, paddingVertical: 9 },
    pickMainText: { color: S.ink, fontSize: 13, fontFamily: SOFT_SEMIBOLD },
    pickAction: { borderRadius: 17, paddingHorizontal: 11, paddingVertical: 9, alignItems: 'center', justifyContent: 'center' },
    pickActionText: { color: S.card, fontSize: 13, fontFamily: SOFT_MEDIUM },
    cost: { textAlign: 'center', fontSize: 11.5, color: S.ink3, fontFamily: SOFT_REGULAR },
  });
}
