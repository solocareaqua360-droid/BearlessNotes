import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from './icons/Ionicons';
import { useSoft } from '../theme/soft';
import { SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';
import { listChatObjects, type ChatObject } from '../utils/chatObjects';
import { useBoardCardCount } from '../utils/chatStructureRead';
import { listenError } from '../utils/listenError';

// «МАТЕРІАЛИ РОЗМОВИ» (sketch chati, 2026-10-24): everything the conversation made, in one window, opened from the circle in
// the chat's header. A conversation has ONE structure (the draft board) which has two looks - the board and the note - so it
// is one card with a switch, not two rows; below it the other things the chat made (documents), filtered by kind (only the
// kinds that really exist get a chip). They are kept with the chat, so they open without asking the AI anything.
// Props-driven: the host decides what each action does (open the board window, the note view, a note, the folder sheet).
// A plain absolute View over the screen, never a Modal.
type Mode = 'board' | 'note';
type Kind = 'all' | 'note' | 'board';

const KIND_LABEL: Record<Kind, string> = { all: 'Усе', note: 'Документи', board: 'Дошки' };

function stamp(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
}

export default function ChatMaterialsSheet({
  chatId,
  board,
  onClose,
  onOpenBoard,
  onOpenOutline,
  onOpenNote,
  onSave,
  top = 84,
}: {
  chatId: string;
  // The conversation's draft board, if the AI has laid a topic out.
  board: { boardId: string; title: string } | null;
  onClose: () => void;
  onOpenBoard: (boardId: string) => void;
  onOpenOutline: (boardId: string) => void;
  onOpenNote: (noteId: string) => void;
  onSave: () => void;
  top?: number;
}) {
  const S = useSoft();
  const styles = useMemo(() => makeStyles(S), [S]);
  const [mode, setMode] = useState<Mode>('board');
  const [kind, setKind] = useState<Kind>('all');
  const [objects, setObjects] = useState<ChatObject[]>([]);
  const cardCount = useBoardCardCount(board?.boardId);

  useEffect(() => {
    // A refused read must never take the screen down: it speaks once (listenError) and the list stays as it was.
    const onError = listenError('chat materials');
    const stop = listChatObjects(chatId, setObjects, (e) => onError(e as Error));
    return () => stop();
  }, [chatId]);

  // The structure itself is the top card; the notes that are its cards and its own board are not listed again.
  const others = useMemo(
    () => objects.filter((o) => !(o.kind === 'note' && o.partOfBoard) && !(o.kind === 'board' && o.id === board?.boardId)),
    [objects, board?.boardId]
  );
  const kinds = useMemo(() => (['note', 'board'] as const).filter((k) => others.some((o) => o.kind === k)), [others]);
  const shown = kind === 'all' ? others : others.filter((o) => o.kind === kind);
  // A chip whose kind is gone (its last object was saved elsewhere) must not leave the list empty under it.
  useEffect(() => {
    if (kind !== 'all' && !kinds.includes(kind)) setKind('all');
  }, [kind, kinds]);

  const openStructure = () => {
    if (!board) return;
    if (mode === 'board') onOpenBoard(board.boardId);
    else onOpenOutline(board.boardId);
  };
  const pickMode = (m: Mode) => {
    setMode(m);
    if (!board) return;
    if (m === 'board') onOpenBoard(board.boardId);
    else onOpenOutline(board.boardId);
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable style={[StyleSheet.absoluteFill, styles.dim]} onPress={onClose} accessibilityLabel="Закрити матеріали" />
      <View style={[styles.sheet, { top }]}>
        <View style={styles.handle} />
        <View style={styles.head}>
          <Text style={styles.title}>Матеріали розмови</Text>
          <View style={styles.offline}>
            <Ionicons name="cloud-done-outline" size={17} color={S.accent} />
            <Text style={styles.offlineText}>без запиту до ШІ</Text>
          </View>
        </View>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {board ? (
            <View style={styles.struct}>
              <Pressable onPress={openStructure} style={styles.structRow} accessibilityLabel="Відкрити структуру розмови">
                <View style={styles.tile}>
                  <Ionicons name="grid-outline" size={26} color={S.accent} />
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                  <Text style={styles.itemTitle}>Структура розмови</Text>
                  <Text style={styles.itemSub} numberOfLines={1}>
                    {`«${board.title}»${cardCount !== null ? ` · ${cardCount} карток` : ''} · чернетка`}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={S.ink3} />
              </Pressable>
              <View style={styles.switchRow}>
                <View style={styles.segment}>
                  {(['board', 'note'] as const).map((m) => (
                    <Pressable key={m} onPress={() => pickMode(m)} style={[styles.seg, mode === m && styles.segOn]} accessibilityLabel={m === 'board' ? 'Показати дошкою' : 'Показати нотаткою'}>
                      <Text style={[styles.segText, mode === m && styles.segTextOn]}>{m === 'board' ? 'Дошка' : 'Нотатка'}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.switchHint}>одне й те саме, два вигляди</Text>
              </View>
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Структури ще немає</Text>
              <Text style={styles.itemSub}>Попроси ШІ розкласти тему, і вона з'явиться тут.</Text>
            </View>
          )}

          {kinds.length > 0 ? (
            <View style={styles.chips}>
              {(['all', ...kinds] as Kind[]).map((k) => (
                <Pressable key={k} onPress={() => setKind(k)} style={[styles.chip, kind === k && styles.chipOn]}>
                  <Text style={[styles.chipText, kind === k && styles.chipTextOn]}>{KIND_LABEL[k]}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {shown.map((o) => (
            <Pressable key={`${o.kind}-${o.id}`} onPress={() => (o.kind === 'board' ? onOpenBoard(o.id) : onOpenNote(o.id))} style={styles.item}>
              <View style={styles.tile}>
                <Ionicons name={o.kind === 'board' ? 'grid-outline' : 'document-text-outline'} size={24} color={o.kind === 'board' ? S.accent : S.ink2} />
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                <Text style={styles.itemTitle} numberOfLines={1}>
                  {o.title}
                </Text>
                <Text style={styles.itemSub}>{`${o.kind === 'board' ? 'дошка' : 'документ'} · чернетка`}</Text>
              </View>
              <Text style={styles.stamp}>{stamp(o.updatedAt)}</Text>
              <Ionicons name="chevron-forward" size={16} color={S.ink3} />
            </Pressable>
          ))}
          {board && others.length === 0 ? <Text style={styles.hint}>Інших матеріалів поки немає: таблиці й зображення з'являться тут, щойно ШІ їх зробить.</Text> : null}
        </ScrollView>
        {board ? (
          <View style={styles.foot}>
            <Pressable onPress={onSave} style={styles.save} accessibilityLabel="Зберегти структуру в папку">
              <Ionicons name="folder-outline" size={18} color={S.card} />
              <Text style={styles.saveText}>Зберегти структуру в папку…</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function makeStyles(S: ReturnType<typeof useSoft>) {
  const wash = S.dark ? '#534034' : '#F9EAE0';
  return StyleSheet.create({
    dim: { backgroundColor: S.dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.22)' },
    sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: S.bg, paddingTop: 10, boxShadow: S.shadow } as never,
    handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: S.line, marginBottom: 6 },
    head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingBottom: 10 },
    title: { flex: 1, fontSize: 20, fontFamily: SOFT_SEMIBOLD, color: S.ink },
    offline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    offlineText: { fontSize: 12.5, fontFamily: SOFT_REGULAR, color: S.ink2 },
    body: { paddingHorizontal: 14, paddingBottom: 12, gap: 10 },
    struct: { borderRadius: 22, backgroundColor: S.card, padding: 12, gap: 12, boxShadow: S.shadow } as never,
    structRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    tile: { width: 52, height: 52, borderRadius: 16, backgroundColor: wash, alignItems: 'center', justifyContent: 'center' },
    item: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 76, paddingLeft: 12, paddingRight: 14, borderRadius: 20, backgroundColor: S.card, boxShadow: S.shadow } as never,
    itemTitle: { fontSize: 16, fontFamily: SOFT_SEMIBOLD, color: S.ink },
    itemSub: { fontSize: 12.5, fontFamily: SOFT_REGULAR, color: S.ink2 },
    stamp: { fontSize: 12, fontFamily: SOFT_REGULAR, color: S.ink2 },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    segment: { flexDirection: 'row', padding: 3, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: S.line },
    seg: { height: 34, borderRadius: 17, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
    segOn: { backgroundColor: S.ink },
    segText: { fontSize: 13.5, fontFamily: SOFT_MEDIUM, color: S.ink },
    segTextOn: { color: S.card },
    switchHint: { flex: 1, fontSize: 12, fontFamily: SOFT_REGULAR, color: S.ink2 },
    chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    chip: { height: 36, borderRadius: 18, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: S.line },
    chipOn: { backgroundColor: S.ink, borderColor: S.ink },
    chipText: { fontSize: 13.5, fontFamily: SOFT_MEDIUM, color: S.ink },
    chipTextOn: { color: S.card },
    empty: { borderRadius: 22, backgroundColor: S.card, padding: 16, gap: 4, boxShadow: S.shadow } as never,
    emptyTitle: { fontSize: 16, fontFamily: SOFT_SEMIBOLD, color: S.ink },
    hint: { fontSize: 12.5, lineHeight: 18, fontFamily: SOFT_REGULAR, color: S.ink2, textAlign: 'center', paddingHorizontal: 12, paddingTop: 4 },
    foot: { alignItems: 'center', paddingTop: 6, paddingBottom: 18 },
    save: { height: 40, borderRadius: 20, paddingHorizontal: 20, backgroundColor: S.ink, flexDirection: 'row', alignItems: 'center', gap: 8 },
    saveText: { fontSize: 15, fontFamily: SOFT_MEDIUM, color: S.card },
  });
}
