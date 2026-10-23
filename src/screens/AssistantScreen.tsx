import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { Ionicons } from '../components/icons/Ionicons';
import FormattedText from '../components/FormattedText';
import { ask, notify } from '../components/surfaces/Ask';
import { useSoft } from '../theme/soft';
import { SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import {
  askAssistant,
  blocksOf,
  foldOlder,
  groupsOf,
  listChats,
  loadChat,
  loadChatById,
  memoryTexts,
  newChat,
  ROOT_TOPIC,
  saveChat,
  titleOf,
  topicPath,
  type AssistantChat,
  type AssistantMessage,
} from '../utils/assistant';
import { writeMemoryNote, writeMemoryTree } from '../utils/assistantTree';
import { shortTitle } from '../utils/assistant';
import { FEATURES } from '../features';
import { ASSIST_KEY, assistReturned, assistWash, closeAssistant } from '../utils/assistMorph';
import { morphLanded } from '../utils/morph';
import { speakThoughts, stopVoice, subscribeVoice } from '../utils/thoughtVoice';
import { useGeminiUsage } from '../utils/geminiUsage';
import { hapticPickUp } from '../utils/haptics';
import { getDocs, where } from '../firestore';
import { ownedQuery } from '../utils/owned';
import { parseFormattedText } from '../utils/documentBlocks';

// THE CONVERSATION WITH THE AI (the sketch is the canvas DsJtJiEDSEMWdhomAgJreE; built 2026-10-22/23).
// Opened from the round button beside «+» on the start desks: a thought to talk over comes as suddenly as one for «Думки».
// Plain talk, no modes and no buttons hanging over it (the user: they «лякають»). Each answer is a stack of BLOCKS (bold and
// lists drawn as in a note). A block HELD starts picking: taps add more; while anything is picked the field gives way to the
// picked blocks' actions: remember them as ONE memory, ask about them in more detail (that opens a BRANCH under the branch
// they were said in), copy. «В нотатку» lays the memories as a tree of nested notes and a board that shows it. The AI reads
// a summary of the older part of the talk + what was picked + the last messages (utils/assistant). An answer can be listened to
// with the same voice as «Думки», and the field takes dictation.

const blockKey = (messageId: string, index: number) => `${messageId}:${index}`;
const plainOf = (text: string) =>
  text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();

export default function AssistantScreen() {
  const S = useSoft();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<{ goBack: () => void; navigate: (name: string, params?: object) => void }>();
  const keyboard = useKeyboardHeight();
  const usage = useGeminiUsage();
  const [chat, setChat] = useState<AssistantChat | null>(null);
  const chatRef = useRef<AssistantChat | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  // The blocks picked right now, in the order they were picked.
  const [picked, setPicked] = useState<string[]>([]);
  // The branch the talk is in now (ROOT_TOPIC = the main topic).
  const [topic, setTopic] = useState<string>(ROOT_TOPIC);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const committed = useRef('');
  const scroll = useRef<ScrollView>(null);

  // Opened out of the balloon (utils/assistMorph): drawn - the sheet over it may go; gone - the dock's capsule goes home.
  useEffect(() => {
    const t = setTimeout(() => morphLanded(ASSIST_KEY), 60);
    return () => {
      clearTimeout(t);
      assistReturned();
    };
  }, []);
  useEffect(() => {
    loadChat().then((c) => {
      chatRef.current = c;
      setChat(c);
      // Back to the branch the last message was said in.
      const last = [...c.messages].reverse().find((m) => m.topicId);
      if (last?.topicId && c.topics?.some((t) => t.id === last.topicId)) setTopic(last.topicId);
    });
  }, []);
  const update = (next: AssistantChat) => {
    chatRef.current = next;
    setChat(next);
    saveChat(next);
  };
  useEffect(() => subscribeVoice((s) => !s.playing && setSpeaking(null)), []);
  useEffect(
    () => () => {
      ExpoSpeechRecognitionModule.stop();
      stopVoice().catch(() => {});
    },
    []
  );

  const groups = useMemo(() => (chat ? groupsOf(chat) : []), [chat]);
  // Each remembered block -> whether it is the last block of its memory (where «у пам'яті» is written).
  const memo = useMemo(() => {
    const m = new Map<string, { last: boolean }>();
    groups.forEach((g) => g.forEach((k, i) => m.set(k, { last: i === g.length - 1 })));
    return m;
  }, [groups]);
  // Every block's text and the branch its message belongs to, by key, in the order of the conversation.
  const blockInfo = useMemo(() => {
    const out: { key: string; text: string; topic: string }[] = [];
    (chat?.messages ?? []).forEach((m) => {
      if (m.role !== 'model' || m.error) return;
      blocksOf(m.text).forEach((text, i) => out.push({ key: blockKey(m.id, i), text, topic: m.topicId ?? ROOT_TOPIC }));
    });
    return out;
  }, [chat]);
  const textsOf = (keys: string[]) => blockInfo.filter((b) => keys.includes(b.key)).map((b) => b.text);
  const lastCost = [...(chat?.messages ?? [])].reverse().find((m) => m.role === 'model' && m.costUsd !== undefined)?.costUsd;
  const chatCost = (chat?.messages ?? []).reduce((sum, m) => sum + (m.costUsd ?? 0), 0);

  // `branch`: the answer opens a new branch under `parent` (null = the main topic) with this title.
  async function send(text: string, branch?: { title: string; parent: string }) {
    const base = chatRef.current;
    const clean = text.trim();
    if (!clean || !base || busy) return;
    setPicked([]);
    let here = topic;
    let withTopics = base;
    if (branch) {
      here = `t${Date.now()}`;
      withTopics = { ...base, topics: [...(base.topics ?? []), { id: here, parentId: branch.parent, title: branch.title }] };
      setTopic(here);
    }
    const mine: AssistantMessage = { id: `m${Date.now()}`, role: 'user', text: clean, at: Date.now(), ...(here !== ROOT_TOPIC ? { topicId: here } : {}) };
    const withMine = { ...withTopics, messages: [...withTopics.messages, mine] };
    update(withMine);
    setDraft('');
    setBusy(true);
    try {
      const { text: answer, costUsd } = await askAssistant(withMine, here);
      const answered = {
        ...withMine,
        messages: [...withMine.messages, { id: `a${Date.now()}`, role: 'model' as const, text: answer, at: Date.now(), costUsd, ...(here !== ROOT_TOPIC ? { topicId: here } : {}) }],
      };
      update(answered);
      // The older part is folded into the summary now and then, off to the side of the answer.
      foldOlder(answered)
        .then((folded) => {
          if (folded && chatRef.current?.id === answered.id) update({ ...chatRef.current, ...folded });
        })
        .catch(() => {});
    } catch (e) {
      update({ ...withMine, messages: [...withMine.messages, { id: `e${Date.now()}`, role: 'model', text: (e as Error).message, at: Date.now(), error: true, ...(here !== ROOT_TOPIC ? { topicId: here } : {}) }] });
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
    const ordered = blockInfo.map((b) => b.key).filter((k) => picked.includes(k));
    const rest = groupsOf(chat)
      .map((g) => g.filter((k) => !picked.includes(k)))
      .filter((g) => g.length > 0);
    const next = allRemembered ? rest : [...rest, ordered];
    update({ ...chat, groups: next, remembered: next.flat() });
    setPicked([]);
  }
  // «Детальніше» opens a branch under the branch the first picked block was said in.
  function moreAboutPicked() {
    const texts = textsOf(picked);
    if (texts.length === 0) return;
    const first = blockInfo.find((b) => b.key === picked[0]);
    const title = shortTitle(plainOf(texts[0])) || 'Гілка';
    send(
      texts.length === 1 ? `Розкажи детальніше про це: «${plainOf(texts[0])}»` : `Розкажи детальніше про це:\n${texts.map((t) => `«${plainOf(t)}»`).join('\n')}`,
      { title, parent: first?.topic ?? ROOT_TOPIC }
    );
  }
  function copyPicked() {
    Clipboard.setStringAsync(textsOf(picked).join('\n\n')).catch(() => {});
    setPicked([]);
  }

  const memories = useMemo(() => (chat ? memoryTexts(chat) : []), [chat]);
  const notedSet = useMemo(() => new Set((chat?.noted ?? []).map((t) => t.trim())), [chat]);
  const freshCount = memories.filter((p) => !notedSet.has(p.trim())).length;

  // THE TREE OF NOTES (utils/assistantTree): the main topic's note, a nested note for every branch that holds a memory, a
  // board that shows them. Only what is new is written. A conversation from before notes were bound finds its note by title.
  async function toNote() {
    const base = chatRef.current;
    if (!base || memories.length === 0) return;
    try {
      let current = base;
      if (!current.noteId) {
        const title = titleOf(current);
        const firstAsk = current.messages.find((m) => m.role === 'user')?.text ?? 'Розмова';
        const oldTitle = firstAsk.length > 60 ? `${firstAsk.slice(0, 57).trim()}…` : firstAsk;
        const same = await getDocs(ownedQuery('documents', where('title', 'in', Array.from(new Set([title, oldTitle])))));
        const newest = same.docs
          .map((d) => ({ id: d.id, data: d.data() as { deletedAt?: number; updatedAt?: number } }))
          .filter((d) => !d.data.deletedAt)
          .sort((x, y) => (y.data.updatedAt ?? 0) - (x.data.updatedAt ?? 0))[0];
        if (newest) current = { ...current, noteId: newest.id };
      }
      // One ordinary note with a heading per branch, or (FEATURES.assistantTree) the tree of nested notes and its board.
      const result = FEATURES.assistantTree ? await writeMemoryTree(current) : await writeMemoryNote(current);
      const { rootNoteId, ...kept } = result as { rootNoteId: string; created?: number } & Partial<typeof current>;
      delete (kept as { created?: number }).created;
      update({ ...(chatRef.current ?? current), ...kept });
      navigation.navigate('Editor', { documentId: rootNoteId });
    } catch (e) {
      notify('Не вдалося записати в нотатку', (e as Error).message);
    }
  }

  async function showMemory() {
    const c = chatRef.current;
    if (!c) return;
    const parts = [
      c.summary ? `Стисло про попередню частину розмови:\n${c.summary}` : 'Розмова ще коротка: я бачу її всю, стисле зведення поки не потрібне.',
      memories.length ? `\nВи відібрали як важливе: ${memories.length}. Я тримаюсь цього.` : '',
    ];
    notify('Що я пам\'ятаю', parts.join('\n'));
  }

  async function menu() {
    const c = chatRef.current;
    const choice = await ask({
      title: 'Розмова',
      actions: [
        { id: 'new', label: 'Нова розмова', icon: 'add' as const },
        { id: 'history', label: 'Попередні розмови', icon: 'time-outline' as const },
        { id: 'memory', label: "Що ти пам'ятаєш?", icon: 'bulb-outline' as const },
        ...(FEATURES.assistantTree && c?.boardId ? [{ id: 'tree', label: 'Дерево на дошці', icon: 'git-network-outline' as const }] : []),
      ],
    });
    if (choice === 'new') {
      // The one open now is kept (saveChat writes it to the database); nothing is deleted.
      if (c) saveChat(c);
      const fresh = newChat();
      chatRef.current = fresh;
      setChat(fresh);
      saveChat(fresh);
      setTopic(ROOT_TOPIC);
      setPicked([]);
    } else if (choice === 'history') openHistory();
    else if (choice === 'memory') showMemory();
    else if (choice === 'tree' && c?.boardId) navigation.navigate('BoardCopy', { boardId: c.boardId });
  }

  async function openHistory() {
    try {
      const list = (await listChats()).filter((c) => c.id !== chatRef.current?.id).slice(0, 30);
      if (list.length === 0) {
        notify('Попередніх розмов ще немає', "Нова розмова не стирає стару: вона з'явиться тут.");
        return;
      }
      const id = await ask({
        title: 'Попередні розмови',
        actions: list.map((c) => ({
          id: c.id,
          label: `${c.title} · ${new Date(c.updatedAt).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })}`,
          icon: 'chatbubble-outline' as const,
        })),
      });
      if (!id || id === 'cancel') return;
      const loaded = await loadChatById(id);
      if (!loaded) return;
      if (chatRef.current) saveChat(chatRef.current);
      chatRef.current = loaded;
      setChat(loaded);
      saveChat(loaded);
      setTopic(ROOT_TOPIC);
      setPicked([]);
    } catch (e) {
      notify('Не вдалося відкрити історію', (e as Error).message);
    }
  }

  // DICTATION - the same way as «Думки» (ThoughtCapture): Ukrainian, continuous, the words appearing as they are said.
  const stopListening = useCallback(() => {
    ExpoSpeechRecognitionModule.stop();
    setListening(false);
  }, []);
  const startListening = useCallback(async () => {
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      notify('Голосове введення недоступне', 'На цьому пристрої немає розпізнавання мови.');
      return;
    }
    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) return;
    committed.current = draft;
    ExpoSpeechRecognitionModule.start({ lang: 'uk-UA', interimResults: true, continuous: true, addsPunctuation: true });
    setListening(true);
  }, [draft]);
  useSpeechRecognitionEvent('result', (event) => {
    const heard = event.results?.[0]?.transcript ?? '';
    const before = committed.current;
    setDraft(before ? `${before} ${heard}`.replace(/\s+/g, ' ') : heard);
    if (event.isFinal) committed.current = before ? `${before} ${heard}`.replace(/\s+/g, ' ') : heard;
  });
  useSpeechRecognitionEvent('end', () => setListening(false));

  // «Послухати»: the same voicing as «Думки» (model, voice, kept file) - made only when asked.
  function listen(message: AssistantMessage) {
    if (speaking === message.id) {
      stopVoice().catch(() => {});
      setSpeaking(null);
      return;
    }
    setSpeaking(message.id);
    speakThoughts([{ title: '', text: plainOf(message.text), thoughtId: message.id }])
      .catch(() => {})
      .finally(() => setSpeaking((s) => (s === message.id ? null : s)));
  }

  const messages = chat?.messages ?? [];
  const count = memories.length;
  const styles = useMemo(() => makeStyles(S), [S]);
  const picking = picked.length > 0;
  const path = chat ? topicPath(chat, topic) : [];
  const parentTopic = path.length > 1 ? path[path.length - 2].id : path.length === 1 ? ROOT_TOPIC : null;

  function renderBlock(b: string) {
    const lines = b.split('\n');
    return (
      <View style={{ gap: 3 }}>
        {lines.map((line, i) => {
          const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
          const number = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
          const body = bullet ? bullet[1] : number ? number[2] : line;
          return (
            <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
              {bullet ? <Text style={styles.blockText}>•</Text> : number ? <Text style={styles.blockText}>{`${number[1]}.`}</Text> : null}
              <Text style={[styles.blockText, { flex: 1 }]}>
                <FormattedText segments={parseFormattedText(body)} defaultColor={S.ink} />
              </Text>
            </View>
          );
        })}
      </View>
    );
  }

  let shownTopic: string | undefined;
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
          <Pressable onPress={toNote} style={[styles.toNote, freshCount === 0 && styles.toNoteDone]} accessibilityLabel="Відібране в нотатку">
            <Text style={[styles.toNoteText, freshCount === 0 && styles.toNoteDoneText]}>
              {freshCount > 0 ? (chat?.noteId ? `В нотатку (+${freshCount})` : `В нотатку (${freshCount})`) : 'Нотатка'}
            </Text>
          </Pressable>
        ) : null}
        <Pressable onPress={() => closeAssistant(() => navigation.goBack(), S.bg, assistWash(S.dark))} style={styles.round} accessibilityLabel="Закрити" hitSlop={6}>
          <Ionicons name="close" size={18} color={S.ink} />
        </Pressable>
      </View>
      {path.length > 0 ? (
        <Pressable onPress={() => parentTopic !== null && setTopic(parentTopic)} style={styles.crumbs} accessibilityLabel="Вийти з гілки">
          <Ionicons name="chevron-back" size={14} color={S.ink2} />
          <Text style={styles.crumbsText} numberOfLines={1}>
            {`${path.map((t) => t.title).join(' › ')}`}
          </Text>
        </Pressable>
      ) : null}
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
        {messages.map((m) => {
          const t = m.topicId ?? ROOT_TOPIC;
          const marker =
            t !== (shownTopic ?? ROOT_TOPIC) && chat ? (
              <Pressable key={`${m.id}-branch`} onPress={() => setTopic(t)} style={styles.branchMark}>
                <Text style={styles.branchMarkText} numberOfLines={1}>
                  {t === ROOT_TOPIC ? 'Головна тема' : topicPath(chat, t).map((x) => x.title).join(' › ')}
                </Text>
              </Pressable>
            ) : null;
          shownTopic = t;
          return (
            <View key={m.id} style={{ gap: 14 }}>
              {marker}
              {m.role === 'user' ? (
                <View style={styles.mine}>
                  <Text style={styles.mineText}>{m.text}</Text>
                </View>
              ) : m.error ? (
                <Text style={styles.error}>{m.text}</Text>
              ) : (
                <View style={styles.answer}>
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
                        {renderBlock(b)}
                        {mem?.last ? <Text style={styles.memo}>у пам'яті</Text> : null}
                        {on ? (
                          <View style={styles.tick}>
                            <Ionicons name="checkmark" size={12} color={S.card} />
                          </View>
                        ) : null}
                      </Pressable>
                    );
                  })}
                  <Pressable onPress={() => listen(m)} style={styles.listen} hitSlop={8} accessibilityLabel="Послухати відповідь">
                    <Ionicons name={speaking === m.id ? 'stop-circle-outline' : 'volume-high-outline'} size={16} color={S.ink3} />
                    <Text style={styles.listenText}>{speaking === m.id ? 'Зупинити' : 'Послухати'}</Text>
                  </Pressable>
                </View>
              )}
            </View>
          );
        })}
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
              onPress={listening ? stopListening : startListening}
              style={[styles.mic, listening && styles.micOn]}
              accessibilityLabel={listening ? 'Зупинити диктування' : 'Диктувати'}
            >
              <Ionicons name={listening ? 'stop' : 'mic-outline'} size={17} color={listening ? S.card : S.ink2} />
            </Pressable>
            <Pressable
              onPress={() => {
                if (listening) stopListening();
                send(draft);
              }}
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
    toNoteDone: { backgroundColor: S.card, boxShadow: S.shadow } as never,
    toNoteDoneText: { color: S.ink },
    crumbs: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 18, paddingBottom: 6 },
    crumbsText: { flex: 1, fontSize: 12.5, color: S.ink2, fontFamily: SOFT_MEDIUM },
    list: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 24, gap: 14 },
    empty: { fontSize: 15, lineHeight: 22, color: S.ink2, fontFamily: SOFT_REGULAR, marginTop: 24 },
    branchMark: { alignSelf: 'flex-start', backgroundColor: S.fillSolid, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, maxWidth: '100%' },
    branchMarkText: { fontSize: 11.5, color: S.ink2, fontFamily: SOFT_MEDIUM },
    mine: { alignSelf: 'flex-end', maxWidth: '82%', backgroundColor: S.fillSolid, borderRadius: 18, borderBottomRightRadius: 4, paddingHorizontal: 14, paddingVertical: 10 },
    mineText: { fontSize: 15, lineHeight: 21, color: S.ink, fontFamily: SOFT_REGULAR },
    answer: { gap: 6 },
    block: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6, marginHorizontal: -8, borderWidth: 1.5, borderColor: 'transparent' },
    blockMem: { backgroundColor: S.dark ? 'rgba(217,121,63,0.18)' : '#FBEBD9' },
    blockPicked: { borderColor: S.accent },
    blockText: { fontSize: 15, lineHeight: 22, color: S.ink, fontFamily: SOFT_REGULAR },
    memo: { marginTop: 4, fontSize: 11, color: S.accent, fontFamily: SOFT_SEMIBOLD },
    tick: { position: 'absolute', right: -6, top: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: S.accent, alignItems: 'center', justifyContent: 'center' },
    listen: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingVertical: 2 },
    listenText: { fontSize: 12, color: S.ink3, fontFamily: SOFT_MEDIUM },
    error: { fontSize: 14, lineHeight: 20, color: '#B3402F', fontFamily: SOFT_REGULAR },
    thinking: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    thinkingText: { fontSize: 14, color: S.ink3, fontFamily: SOFT_REGULAR },
    foot: { paddingHorizontal: 12, paddingTop: 8, gap: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: S.line, backgroundColor: S.bg },
    field: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, backgroundColor: S.card, borderRadius: 22, paddingLeft: 14, paddingRight: 6, paddingVertical: 6 },
    input: { flex: 1, maxHeight: 140, fontSize: 15, lineHeight: 21, color: S.ink, fontFamily: SOFT_REGULAR, paddingVertical: 6 },
    mic: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    micOn: { backgroundColor: S.accent },
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
