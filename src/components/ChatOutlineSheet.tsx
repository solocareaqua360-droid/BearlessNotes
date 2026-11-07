import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from './icons/Ionicons';
import RichText from './RichText';
import { useSoft } from '../theme/soft';
import { SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';
import { readBoardStructure, type BoardStructure } from '../utils/chatStructureRead';
import { structureToOutline } from '../utils/structureTree';

// THE CHAT'S STRUCTURE AS A NOTE (the «Нотатка» half of the switch in «Матеріали розмови»): the same tree the board shows,
// read as a document - a heading for every card (its depth the heading's size), the card's text under it. Read-only: the
// structure is one thing with two looks, and it is changed on the board or by asking. «Копіювати» puts the outline (the
// text the AI reads) on the clipboard. A plain absolute View over the screen, not a Modal.
export default function ChatOutlineSheet({ boardId, onClose, top = 84, refreshTick }: { boardId: string; onClose: () => void; top?: number; refreshTick?: number }) {
  const S = useSoft();
  const styles = useMemo(() => makeStyles(S), [S]);
  const [data, setData] = useState<BoardStructure | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    readBoardStructure(boardId)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [boardId, refreshTick]);

  const copy = () => {
    if (!data) return;
    Clipboard.setStringAsync(structureToOutline(data.nodes, { seeAlso: false })).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable style={[StyleSheet.absoluteFill, styles.dim]} onPress={onClose} accessibilityLabel="Закрити нотатку структури" />
      <View style={[styles.sheet, { top }]}>
        <View style={styles.handle} />
        <View style={styles.head}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.title} numberOfLines={1}>
              {data?.title ?? 'Структура розмови'}
            </Text>
            <Text style={styles.sub}>нотатка · лише для читання</Text>
          </View>
          <Pressable onPress={copy} disabled={!data} style={[styles.copy, !data && { opacity: 0.4 }]} accessibilityLabel="Копіювати схему">
            <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={17} color={S.card} />
            <Text style={styles.copyText}>{copied ? 'Скопійовано' : 'Копіювати'}</Text>
          </Pressable>
          <Pressable onPress={onClose} style={styles.close} accessibilityLabel="Закрити" hitSlop={6}>
            <Ionicons name="close" size={17} color={S.ink} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {!data && !error ? <ActivityIndicator color={S.ink3} style={{ marginTop: 30 }} /> : null}
          {data?.nodes.map((n) => {
            const level = Math.min(n.depth, 3);
            return (
              <View key={n.id} style={{ gap: 6, paddingLeft: Math.max(0, n.depth - 2) * 10 }}>
                <Text style={[styles.heading, level === 1 && styles.h1, level === 2 && styles.h2, level === 3 && styles.h3]}>{n.title}</Text>
                {n.body.length ? <RichText text={n.body.join('\n')} color={S.ink} style={styles.text} /> : null}
                {n.refs?.length ? <Text style={styles.note}>{`→ збирає з інших гілок: ${n.refs.map((id) => data.nodes.find((x) => x.id === id)?.title ?? '').filter(Boolean).join('; ')}`}</Text> : null}
                {n.seeAlso.length ? <Text style={styles.note}>{`↔ див. також: ${n.seeAlso.map((id) => data.nodes.find((x) => x.id === id)?.title ?? '').filter(Boolean).join('; ')}`}</Text> : null}
              </View>
            );
          })}
          {data && data.nodes.length === 0 ? <Text style={styles.note}>У структурі ще немає карток.</Text> : null}
        </ScrollView>
      </View>
    </View>
  );
}

function makeStyles(S: ReturnType<typeof useSoft>) {
  return StyleSheet.create({
    dim: { backgroundColor: S.dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.22)' },
    sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: S.bg, paddingTop: 10, boxShadow: S.shadow } as never,
    handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: S.line, marginBottom: 8 },
    head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
    title: { fontSize: 20, fontFamily: SOFT_SEMIBOLD, color: S.ink },
    sub: { fontSize: 12.5, fontFamily: SOFT_REGULAR, color: S.ink2 },
    copy: { height: 40, borderRadius: 20, paddingHorizontal: 14, backgroundColor: S.ink, flexDirection: 'row', alignItems: 'center', gap: 6 },
    copyText: { fontSize: 15, fontFamily: SOFT_MEDIUM, color: S.card },
    close: { width: 40, height: 40, borderRadius: 20, backgroundColor: S.card, alignItems: 'center', justifyContent: 'center', boxShadow: S.shadow } as never,
    body: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 40, gap: 16 },
    heading: { color: S.ink, fontFamily: SOFT_SEMIBOLD },
    h1: { fontSize: 26, lineHeight: 32 },
    h2: { fontSize: 21, lineHeight: 27, marginTop: 6 },
    h3: { fontSize: 17.5, lineHeight: 23 },
    text: { fontSize: 15.5, lineHeight: 23, fontFamily: SOFT_REGULAR },
    note: { fontSize: 12.5, lineHeight: 18, color: S.ink2, fontFamily: SOFT_REGULAR },
    error: { fontSize: 14, color: '#B3402F', fontFamily: SOFT_REGULAR },
  });
}
