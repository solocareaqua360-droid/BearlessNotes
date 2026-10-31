import { createContext, useContext } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import AttachmentImage from '../AttachmentImage';
import { useSoft } from '../../theme/soft';
import { SOFT_BOLD, SOFT_REGULAR, SOFT_SEMIBOLD } from '../../utils/fonts';
import type { Thought } from '../../hooks/useThoughts';
import { FEELINGS } from './feelings';
import { cardTitle } from './thoughtText';
import { readable } from './ThoughtCapture';

// The thoughts a theme's board shows, by id - handed down by BoardScreen (useThemeBoard), read by each card.
export const ThoughtCardsContext = createContext<Map<string, Thought> | null>(null);

const AI_LABEL: Record<NonNullable<Thought['ai']>, string> = { summary: 'Резюме', answer: 'Питання', deepen: 'Глибше', branch: 'Гілка' };

// A THOUGHT ON ITS THEME'S BOARD (sketch artboard «Картки думок зблизька»): what came in big - the video's or the page's
// picture, a photo - then its name and site, then what it stirred; a written thought shows its words whole. The feeling
// glows in the bottom-right corner, in its own colour; none said, no glow. The card grows with its words up to a dozen
// lines - the whole of it is a tap away (the thought's own card, as everywhere).
export default function ThoughtBoardCard({ thoughtId, width }: { thoughtId?: string; width: number }) {
  const S = useSoft();
  const map = useContext(ThoughtCardsContext);
  const t = thoughtId ? map?.get(thoughtId) : undefined;
  const frame = [styles.card, { width, backgroundColor: S.card, boxShadow: S.shadow }] as never;
  if (!t) {
    return (
      <View style={frame}>
        <Text style={[styles.body, { color: S.ink3, padding: 14 }]}>{map ? 'Думки вже немає' : '…'}</Text>
      </View>
    );
  }
  const src = t.source;
  const picture = src?.kind === 'link' && src.imageUrl ? src.imageUrl : null;
  const photo = !picture && t.images?.length ? t.images[0] : null;
  const title = t.ai ? (t.ai === 'answer' ? t.question ?? '' : '') : cardTitle(t);
  const words = t.ai ? t.felt : src ? t.felt : readable(t.felt);
  const glow = t.feel ? FEELINGS[t.feel].c : null;
  const gid = `g${t.id}`;
  const onlyPhoto = !!photo && !title && !words;
  return (
    <View style={frame}>
      {picture && <Image source={{ uri: picture }} style={[styles.picture, { width }]} resizeMode="cover" />}
      {photo && (
        <AttachmentImage
          uri={photo.uri}
          driveFileId={photo.driveFileId}
          style={[styles.picture, { width, height: onlyPhoto ? width : 120 }]}
          resizeMode="cover"
          countsAsUse={false}
        />
      )}
      {!onlyPhoto && (
        <View style={styles.text}>
          {!!t.ai && <Text style={[styles.label, { color: '#C8925E' }]}>{AI_LABEL[t.ai]}</Text>}
          {!!title && (
            <Text style={[styles.title, { color: S.ink }]} numberOfLines={3}>
              {title}
            </Text>
          )}
          {src?.kind === 'link' && !!src.siteName && (
            <Text style={[styles.site, { color: S.ink3 }]} numberOfLines={1}>
              {src.siteName}
            </Text>
          )}
          {t.aiState === 'pending' ? (
            <Text style={[styles.body, { color: '#B07A44' }]}>Пишу…</Text>
          ) : t.aiState === 'error' ? (
            <Text style={[styles.body, { color: '#B4533C' }]} numberOfLines={3}>{`Не вдалося: ${t.aiError ?? ''}`}</Text>
          ) : words ? (
            <Text
              style={[src && !t.ai ? styles.felt : t.ai || title ? styles.body : styles.title, { color: src && !t.ai ? S.ink2 : S.ink }]}
              numberOfLines={12}
            >
              {src && !t.ai ? `«${words}»` : words}
            </Text>
          ) : null}
        </View>
      )}
      {glow && (
        <View pointerEvents="none" style={styles.glow}>
          <Svg width={120} height={120}>
            <Defs>
              <RadialGradient id={gid} cx="120" cy="120" r="120" gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor={`rgb(${glow.join(',')})`} stopOpacity={0.5} />
                <Stop offset="1" stopColor={`rgb(${glow.join(',')})`} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Rect x="0" y="0" width="120" height="120" fill={`url(#${gid})`} />
          </Svg>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, overflow: 'hidden' },
  picture: { height: 120 },
  text: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, gap: 4 },
  label: { fontSize: 11.5, fontFamily: SOFT_BOLD, letterSpacing: 0.5, textTransform: 'uppercase' },
  title: { fontSize: 15, lineHeight: 20, fontFamily: SOFT_SEMIBOLD },
  site: { fontSize: 12, fontFamily: SOFT_REGULAR },
  felt: { fontSize: 13.5, lineHeight: 18, fontFamily: SOFT_REGULAR, fontStyle: 'italic' },
  body: { fontSize: 14, lineHeight: 19, fontFamily: SOFT_REGULAR },
  glow: { position: 'absolute', right: 0, bottom: 0, width: 120, height: 120 },
});
