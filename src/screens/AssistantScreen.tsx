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
import { askAssistant, blocksOf, loadChat, newChat, saveChat, type AssistantChat, type AssistantMessage } from '../utils/assistant';
import { useGeminiUsage } from '../utils/geminiUsage';
import { collection } from '../firestore';
import { db } from '../firebase';
import { addDoc } from '../utils/owned';
import { newBlock } from '../utils/documentBlocks';

// THE CONVERSATION WITH THE AI (step 1, 2026-10-22; the sketch is the canvas DsJtJiEDSEMWdhomAgJreE, frame «2. Розмова»).
// Opened from the round button beside «+» on the start desks: a thought to talk over comes as suddenly as one for «Думки».
// Plain talk, no modes and no buttons hanging over it (the user: they «лякають»). Each answer is a stack of BLOCKS; a block
// held shows its three actions above it - «Запам'ятати», «Детальніше», «Копіювати». What was remembered goes into a note
// with «В нотатку», at the end of the talk, when the user wants it.

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
  // The block whose actions are showing (held), if any.
  const [held, setHeld] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    loadChat().then(setChat);
  }, []);
  const update = (next: AssistantChat) => {
    setChat(next);
    saveChat(next);
  };

  const remembered = useMemo(() => new Set(chat?.remembered ?? []), [chat]);
  const lastCost = [...(chat?.messages ?? [])].reverse().find((m) => m.role === 'model' && m.costUsd !== undefined)?.costUsd;
  const chatCost = (chat?.messages ?? []).reduce((sum, m) => sum + (m.costUsd ?? 0), 0);

  async function send(text: string) {
    const clean = text.trim();
    if (!clean || !chat || busy) return;
    setHeld(null);
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

  function toggleRemember(key: string) {
    if (!chat) return;
    const has = chat.remembered.includes(key);
    update({ ...chat, remembered: has ? chat.remembered.filter((k) => k !== key) : [...chat.remembered, key] });
    setHeld(null);
  }

  // The remembered blocks in the order they were said.
  function rememberedTexts(c: AssistantChat): string[] {
    const out: string[] = [];
    c.messages.forEach((m) => {
      if (m.role !== 'model' || m.error) return;
      blocksOf(m.text).forEach((b, i) => {
        if (c.remembered.includes(blockKey(m.id, i))) out.push(b);
      });
    });
    return out;
  }

  async function toNote() {
    if (!chat) return;
    const texts = rememberedTexts(chat);
    if (texts.length === 0) return;
    const firstAsk = chat.messages.find((m) => m.role === 'user')?.text ?? 'Розмова';
    const title = firstAsk.length > 60 ? `${firstAsk.slice(0, 57).trim()}…` : firstAsk;
    try {
      const now = Date.now();
      const ref = await addDoc(collection(db, 'documents'), {
        title,
        createdAt: now,
        updatedAt: now,
        blocks: texts.map((text) => ({ ...newBlock(), type: 'paragraph', text })),
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
      const fresh = newChat();
      update(fresh);
      setHeld(null);
    }
  }

  const messages = chat?.messages ?? [];
  const count = chat?.remembered.length ?? 0;
  const styles = useMemo(() => makeStyles(S), [S]);

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
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        onScrollBeginDrag={() => setHeld(null)}
      >
        {messages.length === 0 && !busy ? (
          <Text style={styles.empty}>Про що хочете поговорити? Пишіть як зручно, хоч хаотично. Утримайте абзац відповіді, щоб запам'ятати його.</Text>
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
                const on = remembered.has(key);
                return (
                  <View key={key} style={{ position: 'relative' }}>
                    <Pressable
                      onLongPress={() => setHeld(key)}
                      onPress={() => setHeld(null)}
                      delayLongPress={350}
                      style={[styles.block, on && styles.blockOn, held === key && styles.blockHeld]}
                    >
                      <Text style={styles.blockText}>{b}</Text>
                      {on ? <Text style={styles.memo}>у пам'яті</Text> : null}
                    </Pressable>
                    {held === key ? (
                      <View style={styles.actions}>
                        <Pressable onPress={() => toggleRemember(key)} style={styles.actionMain}>
                          <Text style={styles.actionMainText}>{on ? 'Забути' : "Запам'ятати"}</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => {
                            setHeld(null);
                            send(`Розкажи детальніше про це: «${b}»`);
                          }}
                          style={styles.action}
                        >
                          <Text style={styles.actionText}>Детальніше</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => {
                            Clipboard.setStringAsync(b).catch(() => {});
                            setHeld(null);
                          }}
                          style={styles.action}
                        >
                          <Text style={styles.actionText}>Копіювати</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
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
      <View style={[styles.foot, { paddingBottom: (keyboard > 0 ? keyboard : insets.bottom) + 10 }]}>
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
    answer: { gap: 8 },
    block: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6, marginHorizontal: -8 },
    blockOn: { backgroundColor: S.dark ? 'rgba(217,121,63,0.18)' : '#FBEBD9' },
    blockHeld: { backgroundColor: S.fill },
    blockText: { fontSize: 15, lineHeight: 22, color: S.ink, fontFamily: SOFT_REGULAR },
    memo: { marginTop: 4, fontSize: 11, color: S.accent, fontFamily: SOFT_SEMIBOLD },
    actions: { position: 'absolute', right: 0, top: -44, flexDirection: 'row', gap: 4, backgroundColor: S.ink, borderRadius: 18, padding: 5, zIndex: 10, boxShadow: S.popShadow } as never,
    actionMain: { backgroundColor: S.card, borderRadius: 13, paddingHorizontal: 11, paddingVertical: 7 },
    actionMainText: { color: S.ink, fontSize: 12.5, fontFamily: SOFT_SEMIBOLD },
    action: { borderRadius: 13, paddingHorizontal: 10, paddingVertical: 7 },
    actionText: { color: S.card, fontSize: 12.5, fontFamily: SOFT_MEDIUM },
    error: { fontSize: 14, lineHeight: 20, color: '#B3402F', fontFamily: SOFT_REGULAR },
    thinking: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    thinkingText: { fontSize: 14, color: S.ink3, fontFamily: SOFT_REGULAR },
    foot: { paddingHorizontal: 12, paddingTop: 8, gap: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: S.line, backgroundColor: S.bg },
    field: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, backgroundColor: S.card, borderRadius: 22, paddingLeft: 14, paddingRight: 6, paddingVertical: 6 },
    input: { flex: 1, maxHeight: 140, fontSize: 15, lineHeight: 21, color: S.ink, fontFamily: SOFT_REGULAR, paddingVertical: 6 },
    send: { width: 36, height: 36, borderRadius: 18, backgroundColor: S.ink, alignItems: 'center', justifyContent: 'center' },
    cost: { textAlign: 'center', fontSize: 11.5, color: S.ink3, fontFamily: SOFT_REGULAR },
  });
}
