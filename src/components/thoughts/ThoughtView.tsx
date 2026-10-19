import { useEffect, useState } from 'react';
import AttachmentImage from '../AttachmentImage';
import ZoomableImageViewer from '../ZoomableImageViewer';
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Sheet from '../surfaces/Sheet';
import GlassLayer from '../GlassLayer';
import { Ionicons } from '../icons/Ionicons';
import { useSoft } from '../../theme/soft';
import { SOFT_BOLD, SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../../utils/fonts';
import { formatAddedOn } from '../../utils/documentPreview';
import type { Thought } from '../../hooks/useThoughts';
import { readable } from './ThoughtCapture';
import { isYouTube } from '../../utils/thoughtAI';
import { pauseVoice, resumeVoice, seekVoice, skipVoice, stopVoice, subscribeVoice, type VoiceState } from '../../utils/thoughtVoice';
import { clearShownReader, setShownReader } from '../../utils/thoughtBus';
import { voiceTextOf } from './thoughtText';
import { ListenMarks, useListenMarks } from './ListenMarks';

// TikTok's app, handed a short link (vt./vm.tiktok.com), lands on its own feed instead of the video (the user,
// 2026-10-15: «не можу перейти по посиланню»). The short link is followed first, and the full address is opened.
async function openLink(url: string) {
  let target = url;
  if (/^https?:\/\/(vt|vm)\.tiktok\.com\//i.test(url)) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (res.url && /tiktok\.com\/@[^/]+\/video\//i.test(res.url)) target = res.url;
    } catch {}
  }
  Linking.openURL(target).catch(() => {});
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// The text with the sentence being said now marked (the player inside the card, sketch artboard 3).
function Spoken({ text, sentence, style, mark }: { text: string; sentence: string; style: object; mark: string }) {
  const at = sentence ? text.indexOf(sentence) : -1;
  if (at < 0) return <Text style={style} selectable>{text}</Text>;
  return (
    <Text style={style} selectable>
      {text.slice(0, at)}
      <Text style={{ backgroundColor: mark }}>{sentence}</Text>
      {text.slice(at + sentence.length)}
    </Text>
  );
}

// READING ONE THOUGHT (2026-10-15, the user: «у мене видно перші три слова - а як подивитися все інше?»). A card on
// the canvas is a glimpse; a tap opens the whole of it: what came in (the video or the page, with «Відкрити»; a long
// copied text in full, scrolling), what it stirred, and when.
export default function ThoughtView({
  thought,
  accent,
  onListen,
  onWatch,
  onClose,
}: {
  thought: Thought | null;
  accent?: string;
  onListen?: (t: Thought) => void;
  onWatch?: (t: Thought) => void;
  onClose: () => void;
}) {
  const S = useSoft();
  const src = thought?.source;
  const [v, setV] = useState<VoiceState | null>(null);
  useEffect(() => subscribeVoice(setV), []);
  // Open: the island steps aside while this card shows its own player.
  const id = thought?.id;
  useEffect(() => {
    if (!id) return;
    setShownReader(id);
    return () => clearShownReader(id);
  }, [id]);
  const mine = !!v?.playing && !!thought && v.thoughtId === thought.id;
  // A picture of this thought opened big (index), paged with the arrows.
  const [bigImage, setBigImage] = useState<number | null>(null);
  useEffect(() => setBigImage(null), [thought?.id]);
  // While Gemini is still making the voice, the listen button stays, its outline running; the player comes with
  // the sound.
  const sounding = mine && v!.source !== null;
  const marks = useListenMarks(thought && onListen ? [{ id: thought.id, text: voiceTextOf(thought) }] : []);
  const sentence = mine ? v!.sentence : '';
  const mark = '#FBEBD9';
  return (
    <>
    <Sheet visible={thought !== null} onClose={onClose} scroll maxHeight="86%" fadeEdges priority={25}>
      {thought && (
        <View style={{ gap: 14, paddingBottom: 10 }}>
          {src?.kind === 'link' && (
            <View style={[styles.link, { backgroundColor: S.fill }]}>
              {!!src.imageUrl && <Image source={{ uri: src.imageUrl }} style={styles.linkImage} resizeMode="cover" />}
              <View style={styles.linkBody}>
                <Text style={[styles.linkTitle, { color: S.ink }]}>{src.title || src.url}</Text>
                {!!src.siteName && <Text style={[styles.site, { color: S.ink3 }]}>{src.siteName}</Text>}
                <Pressable onPress={() => openLink(src.url)} style={[styles.open, { backgroundColor: S.ink }]}>
                  <Ionicons name={'open-outline' as never} size={16} color={S.card} />
                  <Text style={[styles.openText, { color: S.card }]}>Відкрити</Text>
                </Pressable>
              </View>
            </View>
          )}
          {!!thought.images?.length && (
            // THE PICTURES, whole: one - the full width, its own proportions; several - a row to swipe sideways. A tap
            // opens one big, with zoom.
            <View style={{ gap: 8 }}>
              {thought.images.length === 1 ? (
                <Pressable onPress={() => setBigImage(0)} accessibilityLabel="Відкрити зображення">
                  <AttachmentImage uri={thought.images[0].uri} driveFileId={thought.images[0].driveFileId} style={styles.imageOne} resizeMode="cover" />
                </Pressable>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled contentContainerStyle={{ gap: 8 }}>
                  {thought.images.map((im, i) => (
                    <Pressable key={im.uri} onPress={() => setBigImage(i)} accessibilityLabel={`Відкрити зображення ${i + 1}`}>
                      <AttachmentImage uri={im.uri} driveFileId={im.driveFileId} style={styles.imageMany} resizeMode="cover" />
                    </Pressable>
                  ))}
                </ScrollView>
              )}
            </View>
          )}
          {!!thought.ai && (
            <Text style={[styles.label, { color: '#B07A44' }]}>{thought.ai === 'summary' ? 'Резюме' : `Питання: ${thought.question ?? ''}`}</Text>
          )}
          {thought.aiState === 'error' && (
            <Text style={[styles.text, { color: '#B4533C' }]} selectable>{`Не вдалося: ${thought.aiError ?? ''}`}</Text>
          )}
          {thought.aiState === 'pending' && <Text style={[styles.text, { color: '#B07A44' }]}>Пишу…</Text>}
          {!!thought.videoGist && (
            <View style={{ gap: 4 }}>
              <Text style={[styles.label, { color: S.ink3 }]}>Зміст відео</Text>
              <Text style={[styles.text, { color: S.ink }]} selectable>{thought.videoGist}</Text>
            </View>
          )}
          {src?.kind === 'text' && <Spoken text={readable(src.text)} sentence={sentence} mark={mark} style={[styles.text, { color: S.ink }]} />}
          {!!thought.felt && (
            <View style={{ gap: 4 }}>
              {!thought.ai && <Text style={[styles.label, { color: S.ink3 }]}>{src ? 'Що зачепило' : 'Думка'}</Text>}
              {src ? (
                <Text style={[styles.felt, { color: accent ?? S.ink2 }]} selectable>{`«${thought.felt}»`}</Text>
              ) : (
                <Spoken text={readable(thought.felt)} sentence={sentence} mark={mark} style={[styles.text, { color: S.ink }]} />
              )}
            </View>
          )}
          {sounding && v && (
            // THE PLAYER IN THE CARD: where in the text, and the controls.
            <View style={[styles.player, { backgroundColor: S.fill }]}>
              <View style={[styles.track, { backgroundColor: 'rgba(30,30,28,0.12)' }]}>
                <View style={[styles.fill, { width: `${v.duration > 0 ? Math.min(100, (v.position / v.duration) * 100) : 0}%` }]} />
              </View>
              <View style={styles.times}>
                <Text style={[styles.time, { color: S.ink3 }]}>{mmss(v.position)}</Text>
                <Text style={[styles.time, { color: S.ink3 }]}>
                  {v.source === null ? 'готую голос…' : v.total > 1 ? `${v.index} з ${v.total}` : v.duration > 0 ? mmss(v.duration) : ''}
                </Text>
              </View>
              <View style={styles.controls}>
                {v.total > 1 && (
                  <Pressable onPress={() => skipVoice(-1)} accessibilityLabel="Попередня картка" style={styles.ctrl}>
                    <View style={{ transform: [{ rotate: '180deg' }] }}>
                      <Ionicons name={'play-skip-forward' as never} size={20} color={S.ink} />
                    </View>
                  </Pressable>
                )}
                <Pressable onPress={() => seekVoice(-15)} accessibilityLabel="Назад на 15 секунд" style={[styles.ctrlRound, { backgroundColor: S.card }]}>
                  <Text style={[styles.ctrlText, { color: S.ink }]}>−15</Text>
                </Pressable>
                <Pressable onPress={() => (v.paused ? resumeVoice() : pauseVoice())} accessibilityLabel={v.paused ? 'Грати' : 'Пауза'} style={[styles.ctrlMain, { backgroundColor: S.ink }]}>
                  <Ionicons name={(v.paused ? 'play' : 'pause') as never} size={22} color={S.card} />
                </Pressable>
                <Pressable onPress={() => seekVoice(15)} accessibilityLabel="Вперед на 15 секунд" style={[styles.ctrlRound, { backgroundColor: S.card }]}>
                  <Text style={[styles.ctrlText, { color: S.ink }]}>+15</Text>
                </Pressable>
                {v.total > 1 && (
                  <Pressable onPress={() => skipVoice(1)} accessibilityLabel="Наступна картка" style={styles.ctrl}>
                    <Ionicons name={'play-skip-forward' as never} size={20} color={S.ink} />
                  </Pressable>
                )}
              </View>
              <Pressable onPress={() => stopVoice()} style={styles.stopRow}>
                <Text style={styles.stopText}>Зупинити</Text>
              </Pressable>
            </View>
          )}
          <View style={styles.actions}>
            {!!onListen && !thought.aiState && !sounding && !!voiceTextOf(thought).trim() && (
              <Pressable onPress={() => !mine && onListen(thought)} style={[styles.action, { backgroundColor: S.fill }]}>
                <Ionicons name={'volume-high-outline' as never} size={17} color={S.ink} />
                <Text style={[styles.actionText, { color: S.ink }]}>{marks.voicing ? 'Готую голос…' : 'Прослухати'}</Text>
                <ListenMarks offline={marks.offline} voicing={marks.voicing} making={marks.making} ink={S.ink} ground={S.card} radius={20} />
              </Pressable>
            )}
            {!!onWatch && src?.kind === 'link' && isYouTube(src.url) && !thought.videoGist && (
              <Pressable onPress={() => onWatch(thought)} style={[styles.action, { backgroundColor: S.fill }]}>
                <Ionicons name={'film-outline' as never} size={17} color={S.ink} />
                <Text style={[styles.actionText, { color: S.ink }]}>Що в цьому відео?</Text>
              </Pressable>
            )}
          </View>
          <Text style={[styles.when, { color: S.ink3 }]}>{formatAddedOn(thought.createdAt, true)}</Text>
        </View>
      )}
    </Sheet>
      <GlassLayer visible={bigImage !== null && !!thought?.images?.[bigImage]} onClose={() => setBigImage(null)} priority={26}>
        {thought && bigImage !== null && thought.images?.[bigImage] && (
          <View style={StyleSheet.absoluteFill}>
            <ZoomableImageViewer
              uri={thought.images[bigImage].uri}
              driveFileId={thought.images[bigImage].driveFileId}
              onClose={() => setBigImage(null)}
              onPrev={bigImage > 0 ? () => setBigImage(bigImage - 1) : undefined}
              onNext={bigImage < (thought.images?.length ?? 0) - 1 ? () => setBigImage(bigImage + 1) : undefined}
            />
          </View>
        )}
      </GlassLayer>
    </>
  );
}

const styles = StyleSheet.create({
  imageOne: { width: '100%', aspectRatio: 4 / 3, borderRadius: 18 },
  imageMany: { width: 200, height: 150, borderRadius: 16 },
  link: { borderRadius: 18, overflow: 'hidden' },
  linkImage: { width: '100%', aspectRatio: 16 / 9 },
  linkBody: { padding: 14, gap: 6 },
  linkTitle: { fontSize: 17, lineHeight: 23, fontFamily: SOFT_BOLD },
  site: { fontSize: 13, fontFamily: SOFT_MEDIUM },
  open: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 38, borderRadius: 19, marginTop: 4 },
  openText: { fontSize: 14, fontFamily: SOFT_SEMIBOLD },
  text: { fontSize: 16, lineHeight: 24, fontFamily: SOFT_REGULAR },
  label: { fontSize: 11.5, fontFamily: SOFT_BOLD, letterSpacing: 0.5, textTransform: 'uppercase' },
  felt: { fontSize: 16, lineHeight: 23, fontFamily: SOFT_REGULAR, fontStyle: 'italic' },
  player: { borderRadius: 18, padding: 14, gap: 8 },
  track: { height: 5, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 5, backgroundColor: '#D9793F' },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { fontSize: 12, fontFamily: SOFT_SEMIBOLD },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  ctrl: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  ctrlRound: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  ctrlText: { fontSize: 12.5, fontFamily: SOFT_BOLD },
  ctrlMain: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  stopRow: { alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 12 },
  stopText: { fontSize: 13, fontFamily: SOFT_SEMIBOLD, color: '#B4533C' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 14, borderRadius: 20 },
  actionText: { fontSize: 14, fontFamily: SOFT_SEMIBOLD },
  when: { fontSize: 12.5, fontFamily: SOFT_MEDIUM },
});
