import { memo, useMemo, useState } from 'react';
import { FlatList, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '../icons/Ionicons';
import AttachmentImage from '../AttachmentImage';
import { useSoft } from '../../theme/soft';
import { SOFT_BOLD, SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../../utils/fonts';
import { hueOf, type Thought, type ThoughtTheme } from '../../hooks/useThoughts';
import { readable } from './ThoughtCapture';
import { KIND_LABEL, captionOf, cardTitle, kindOf, type ThoughtKind } from './thoughtText';

// THE INBOX AS A FOLDER (2026-11-16, the user's sketch round 3, reports/sketch-inbox-thoughts-3.png): no sky - an ordinary
// list, and over it ONE row of capsules. Its first capsule is the switch (# themes, ◧ types; the one in force lit orange)
// and decides what the capsules after it are: «Усі», «Без теми» and the themes - or «Усі» and the four types. The picked
// theme carries ⊞ inside its own capsule: that opens its board (a screen of its own, with the board's dock). No second
// row, nothing behind «···».

export const LOOSE = '__loose__';
const ALL = '__all__';
type Lens = 'themes' | 'types';
// Kept for the session, as the sky's own lens was.
let lastLens: Lens = 'themes';
let lastPick: string = ALL;

// «28 жовт.», with the year only when it is not this one - the theme's name needs the room more.
function shortDate(at: number) {
  const d = new Date(at);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('uk-UA', sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

const TYPES: ThoughtKind[] = ['doc', 'photo', 'video', 'link'];
const TYPE_PLURAL: Record<ThoughtKind, string> = { doc: 'Документи', photo: 'Фото', video: 'Відео', link: 'Посилання' };

export default function ThoughtsInbox({
  themes,
  thoughts,
  padTop,
  padBottom,
  width,
  onRead,
  onBoard,
  onHoldThought,
  onHoldTheme,
}: {
  themes: ThoughtTheme[];
  thoughts: Thought[];
  padTop: number;
  padBottom: number;
  width: number;
  onRead: (id: string) => void;
  onBoard: (themeId: string) => void;
  onHoldThought: (t: Thought) => void;
  onHoldTheme: (theme: ThoughtTheme) => void;
}) {
  const S = useSoft();
  const [lens, setLensState] = useState<Lens>(lastLens);
  const [pick, setPickState] = useState<string>(lastPick);
  const setLens = (l: Lens) => {
    lastLens = l;
    lastPick = ALL;
    setLensState(l);
    setPickState(ALL);
  };
  const setPick = (p: string) => {
    lastPick = p;
    setPickState(p);
  };
  // A theme deleted while it was picked (or a pick from the other lens): back to «Усі».
  const themePicked = lens === 'themes' && pick !== ALL && pick !== LOOSE ? themes.find((t) => t.id === pick) ?? null : null;
  const pickValid = pick === ALL || (lens === 'themes' ? pick === LOOSE || !!themePicked : (TYPES as string[]).includes(pick));
  const at = pickValid ? pick : ALL;

  const byTheme = useMemo(() => new Map(themes.map((t) => [t.id, t])), [themes]);
  const kinds = useMemo(() => new Map(thoughts.map((t) => [t.id, kindOf(t)])), [thoughts]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    const add = (k: string) => m.set(k, (m.get(k) ?? 0) + 1);
    thoughts.forEach((t) => {
      add(t.themeId ?? LOOSE);
      add(kinds.get(t.id)!);
    });
    return m;
  }, [thoughts, kinds]);
  // Themes by when they were last touched: the one being worked on stays near the switch.
  const themeOrder = useMemo(() => [...themes].sort((a, b) => b.touchedAt - a.touchedAt), [themes]);

  const shown = useMemo(() => {
    if (at === ALL) return thoughts;
    if (lens === 'themes') return thoughts.filter((t) => (at === LOOSE ? t.themeId === null : t.themeId === at));
    return thoughts.filter((t) => kinds.get(t.id) === at);
  }, [thoughts, kinds, lens, at]);
  const grid = lens === 'types' && at === 'photo';
  const showTheme = !(lens === 'themes' && at !== ALL);

  const lit = S.dark ? 'rgba(217,121,63,0.22)' : '#FBE6D6';
  const capsule = (key: string, label: string, n: number | null, dot: string | null, extra?: React.ReactNode, onLong?: () => void) => {
    const on = at === key;
    return (
      <Pressable
        key={key}
        onPress={() => setPick(key)}
        onLongPress={onLong}
        delayLongPress={380}
        style={[styles.pill, { backgroundColor: on ? S.ink : S.card, boxShadow: on ? undefined : S.shadow } as never]}
      >
        {!!dot && <View style={[styles.dot, { backgroundColor: dot }]} />}
        <Text style={[styles.pillText, { color: on ? S.card : S.ink }]} numberOfLines={1}>
          {label}
        </Text>
        {n !== null && n > 0 && <Text style={[styles.pillN, { color: on ? (S.dark ? '#6E6D68' : '#BDBBB5') : S.ink3 }]}>{n}</Text>}
        {on && extra}
      </Pressable>
    );
  };

  const header = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.row}>
      {/* The switch: two icons in one capsule, the one in force lit. */}
      <View style={[styles.lens, { backgroundColor: S.card, boxShadow: S.shadow } as never]}>
        {(['themes', 'types'] as Lens[]).map((l) => (
          <Pressable
            key={l}
            onPress={() => lens !== l && setLens(l)}
            accessibilityLabel={l === 'themes' ? 'Теми' : 'Типи'}
            style={[styles.lensHalf, lens === l && { backgroundColor: lit }]}
          >
            <Ionicons name={(l === 'themes' ? 'lc:hash' : 'lc:shapes') as never} size={17} color={lens === l ? S.accent : S.ink3} />
          </Pressable>
        ))}
      </View>
      <View style={[styles.cut, { backgroundColor: S.line }]} />
      {capsule(ALL, 'Усі', thoughts.length, null)}
      {lens === 'themes' ? (
        <>
          {(counts.get(LOOSE) ?? 0) > 0 && capsule(LOOSE, 'Без теми', counts.get(LOOSE) ?? 0, S.accent)}
          {themeOrder.map((t) =>
            capsule(
              t.id,
              t.name,
              counts.get(t.id) ?? 0,
              hueOf(t, S.dark).sub,
              <Pressable onPress={() => onBoard(t.id)} hitSlop={8} accessibilityLabel="Дошка теми" style={[styles.board, { backgroundColor: 'rgba(255,255,255,0.18)' }]}>
                <Ionicons name={'lc:layout-grid' as never} size={13} color={S.card} />
              </Pressable>,
              () => onHoldTheme(t)
            )
          )}
        </>
      ) : (
        TYPES.map((k) => capsule(k, TYPE_PLURAL[k], counts.get(k) ?? 0, null))
      )}
    </ScrollView>
  );

  const empty = (
    <Text style={[styles.empty, { color: S.ink3 }]}>
      {thoughts.length === 0 ? 'Тут житиме все, що ти поширюєш у застосунок' : 'Тут поки порожньо'}
    </Text>
  );

  if (grid) {
    const side = Math.floor((width - 28 - 12) / 3);
    return (
      <View style={{ flex: 1, paddingTop: padTop }}>
        {header}
        <FlatList
          key="grid"
          data={shown}
          numColumns={3}
          keyExtractor={(t) => t.id}
          columnWrapperStyle={{ gap: 6 }}
          contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 8, paddingBottom: padBottom, gap: 6 }}
          ListEmptyComponent={empty}
          renderItem={({ item }) => (
            <Pressable onPress={() => onRead(item.id)} onLongPress={() => onHoldThought(item)} delayLongPress={350}>
              <AttachmentImage uri={item.images![0].uri} driveFileId={item.images![0].driveFileId} style={{ width: side, height: side, borderRadius: 14 }} resizeMode="cover" />
              {!!captionOf(item) && (
                <View style={[styles.badge, { backgroundColor: 'rgba(255,255,255,0.92)' }]}>
                  <Ionicons name={'lc:message-circle' as never} size={11} color="#333" />
                </View>
              )}
            </Pressable>
          )}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, paddingTop: padTop }}>
      {header}
      <FlatList
        key="list"
        data={shown}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 8, paddingBottom: padBottom, gap: 10 }}
        ListEmptyComponent={empty}
        renderItem={({ item }) => (
          <Row
            t={item}
            kind={kinds.get(item.id)!}
            theme={showTheme ? (item.themeId ? byTheme.get(item.themeId) ?? null : null) : undefined}
            onPress={onRead}
            onLong={onHoldThought}
          />
        )}
      />
    </View>
  );
}

// One card of the list, the folder's own shape: a picture of the thing on the left, its words on the right.
// `theme`: undefined = the list is one theme's already (no theme line); null = «Без теми».
const Row = memo(function Row({
  t,
  kind,
  theme,
  onPress,
  onLong,
}: {
  t: Thought;
  kind: ThoughtKind;
  theme: ThoughtTheme | null | undefined;
  onPress: (id: string) => void;
  onLong: (t: Thought) => void;
}) {
  const S = useSoft();
  const src = t.source;
  const caption = captionOf(t);
  // A document: its first line is its title, the rest its words. A link: its own title. A photo or a video file has no
  // words of its own - its caption stands in the title's place.
  const body = kind === 'doc' ? (src?.kind === 'text' ? readable(src.text) + (t.felt ? `\n${t.felt}` : '') : t.ai ? t.felt : readable(t.felt)) : '';
  const lines = body.trim().split('\n').filter((l) => l.trim());
  let title = '';
  let desc = '';
  if (kind === 'doc') {
    title = t.ai ? cardTitle(t) || lines[0] || '' : lines[0] || '';
    desc = (t.ai && cardTitle(t) ? lines : lines.slice(1)).join(' ');
    if (t.aiState === 'pending') desc = 'Пишу…';
  } else if (src?.kind === 'link') {
    title = src.title || src.siteName || src.url;
  } else {
    title = caption || t.video?.name || (kind === 'photo' ? 'Фото' : 'Відео');
  }
  const showCaption = !!caption && src?.kind === 'link';
  const themeDot = theme ? hueOf(theme, S.dark).sub : S.accent;
  return (
    <Pressable
      onPress={() => onPress(t.id)}
      onLongPress={() => onLong(t)}
      delayLongPress={350}
      style={[styles.card, { backgroundColor: S.card, boxShadow: S.shadow } as never]}
    >
      <Thumb t={t} kind={kind} hasCaption={!!caption} />
      <View style={{ flex: 1, minWidth: 0 }}>
        {!!title && (
          <Text style={[styles.title, { color: S.ink }]} numberOfLines={2}>
            {title}
          </Text>
        )}
        {!!desc && (
          <Text style={[styles.desc, { color: S.ink3 }]} numberOfLines={2}>
            {desc}
          </Text>
        )}
        {showCaption && (
          <Text style={[styles.caption, { color: S.ink2, backgroundColor: S.fill }]} numberOfLines={2}>
            {caption}
          </Text>
        )}
        <View style={styles.meta}>
          <Text style={[styles.kind, { color: S.ink2, backgroundColor: S.fill }]}>{KIND_LABEL[kind]}</Text>
          {theme !== undefined && (
            <>
              <View style={[styles.dot, { backgroundColor: themeDot }]} />
              <Text style={[styles.metaText, { color: S.ink3 }]} numberOfLines={1}>
                {theme ? theme.name : 'Без теми'}
              </Text>
            </>
          )}
          <Text style={[styles.metaText, { color: S.ink3, flexShrink: 0 }]}>{shortDate(t.createdAt)}</Text>
        </View>
      </View>
    </Pressable>
  );
});

function Thumb({ t, kind, hasCaption }: { t: Thought; kind: ThoughtKind; hasCaption: boolean }) {
  const S = useSoft();
  const src = t.source;
  const play = (
    <View style={styles.play}>
      <Ionicons name={'lc:play' as never} size={14} color="#fff" />
    </View>
  );
  const note = hasCaption && kind !== 'link' && (
    <View style={[styles.badge, { backgroundColor: 'rgba(255,255,255,0.92)' }]}>
      <Ionicons name={'lc:message-circle' as never} size={11} color="#333" />
    </View>
  );
  if (kind === 'photo' && t.images?.length) {
    return (
      <View style={styles.thumb}>
        <AttachmentImage uri={t.images[0].uri} driveFileId={t.images[0].driveFileId} style={StyleSheet.absoluteFill} resizeMode="cover" />
        {t.images.length > 1 && (
          <Text style={styles.more}>{`+${t.images.length - 1}`}</Text>
        )}
        {note}
      </View>
    );
  }
  if (kind === 'video' && t.video) {
    return (
      <View style={[styles.thumb, { backgroundColor: '#2A2A2C' }]}>
        {!!t.video.thumbUri && (
          <AttachmentImage uri={t.video.thumbUri} driveFileId={t.video.thumbDriveFileId} style={StyleSheet.absoluteFill} resizeMode="cover" />
        )}
        {play}
        {note}
      </View>
    );
  }
  if ((kind === 'video' || kind === 'link') && src?.kind === 'link') {
    return (
      <View style={[styles.thumb, { backgroundColor: S.fill, alignItems: 'center', justifyContent: 'center' }]}>
        {src.imageUrl ? (
          <Image source={{ uri: src.imageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <Ionicons name={(kind === 'video' ? 'lc:film' : 'lc:link') as never} size={22} color={S.ink2} />
        )}
        {kind === 'video' && play}
        {note}
      </View>
    );
  }
  // A document: a little page with its first words.
  const words = src?.kind === 'text' ? readable(src.text) : t.ai ? t.felt : readable(t.felt);
  return (
    <View style={[styles.thumb, styles.page, { backgroundColor: S.dark ? '#262624' : '#FBFAF7', borderColor: S.line }]}>
      <Text style={[styles.pageText, { color: S.ink2 }]} numberOfLines={7}>
        {words}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  lens: { flexDirection: 'row', alignItems: 'center', height: 36, borderRadius: 18, paddingHorizontal: 4, gap: 2 },
  lensHalf: { width: 36, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  cut: { width: StyleSheet.hairlineWidth * 2, height: 20, marginHorizontal: 2 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, borderRadius: 18, paddingHorizontal: 14, maxWidth: 240 },
  pillText: { fontSize: 14, fontFamily: SOFT_MEDIUM, flexShrink: 1 },
  pillN: { fontSize: 13, fontFamily: SOFT_MEDIUM },
  dot: { width: 9, height: 9, borderRadius: 5 },
  board: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginLeft: 2, marginRight: -6 },
  card: { flexDirection: 'row', gap: 12, padding: 12, borderRadius: 22 },
  thumb: { width: 84, height: 84, borderRadius: 14, overflow: 'hidden' },
  page: { borderWidth: StyleSheet.hairlineWidth, padding: 8 },
  pageText: { fontSize: 8, lineHeight: 10.5, fontFamily: SOFT_REGULAR },
  play: { position: 'absolute', left: 27, top: 27, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', paddingLeft: 2 },
  badge: { position: 'absolute', right: 5, bottom: 5, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  more: { position: 'absolute', left: 5, bottom: 5, fontSize: 11, fontFamily: SOFT_SEMIBOLD, color: '#fff', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 8, paddingHorizontal: 5, overflow: 'hidden' },
  title: { fontSize: 16, lineHeight: 21, fontFamily: SOFT_BOLD, marginBottom: 2 },
  desc: { fontSize: 13, lineHeight: 18, fontFamily: SOFT_REGULAR },
  caption: { fontSize: 13, lineHeight: 18, fontFamily: SOFT_REGULAR, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5, marginTop: 4, overflow: 'hidden' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  kind: { fontSize: 11, fontFamily: SOFT_SEMIBOLD, borderRadius: 7, paddingHorizontal: 7, paddingVertical: 2, overflow: 'hidden' },
  metaText: { fontSize: 12, fontFamily: SOFT_MEDIUM, flexShrink: 1 },
  empty: { textAlign: 'center', marginTop: 60, fontSize: 14, fontFamily: SOFT_MEDIUM },
});
