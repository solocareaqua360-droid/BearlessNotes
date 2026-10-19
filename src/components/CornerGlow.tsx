import { ReactNode, useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import type { FolderItem } from '../hooks/useAllFolderItems';
import { Ionicons } from './icons/Ionicons';

// THE TYPE'S COLOUR, as a small light glow in ONE corner of the card's white part (the user's decision with ~10 sketches,
// 2026-10-14: «тільки градієнт, легкий, на самому куті, не на півкартки»; the corner is the right-bottom one everywhere).
// No icon badge, nothing on the picture: only a patch of colour that fades out ~62 pt from the corner. Documents and
// files have none; a photo is bare.
export const TYPE_GLOW = {
  video: '#E0484A',
  link: '#2F8FD8',
  geo: '#35A56A',
  card: '#7A5AD8',
  board: '#F2B01E',
} as const;

export function glowColorFor(item: FolderItem): string | null {
  if (item.kind === 'board') return TYPE_GLOW.board;
  if (item.kind === 'flashcard') return TYPE_GLOW.card;
  if (item.kind === 'link') {
    const category = item.linkCategory;
    return category === 'video' ? TYPE_GLOW.video : category === 'geo' ? TYPE_GLOW.geo : TYPE_GLOW.link;
  }
  return null;
}

const SIZE = 62;

export default function CornerGlow({ color, radius = 22, children }: { color: string | null; radius?: number; children: ReactNode }) {
  const id = `glow${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  if (!color) return <>{children}</>;
  return (
    <View>
      {children}
      {/* Over the card but clear of touches; clipped to the card's own corner. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}>
        <Svg width={SIZE} height={SIZE} style={{ position: 'absolute', right: 0, bottom: 0 }}>
          <Defs>
            <RadialGradient id={id} cx="100%" cy="100%" r="100%" fx="100%" fy="100%">
              <Stop offset="0" stopColor={color} stopOpacity={0.65} />
              <Stop offset="0.45" stopColor={color} stopOpacity={0.28} />
              <Stop offset="1" stopColor={color} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x={0} y={0} width={SIZE} height={SIZE} fill={`url(#${id})`} />
        </Svg>
      </View>
    </View>
  );
}

// THE TYPE AS A SMALL ICON IN A PALE CIRCLE, in the same right-bottom corner (2026-10-19, the user picked «блідий» from
// two sketches, HzgDVB6mD26bHCEdgpiZvJ): the type's colour at a light tint behind its own icon in full colour - as
// quiet as the glow was, but it says WHAT the thing is, not only that it differs. Same kinds as the glow; a document,
// a file and a photo have none. Yellow on white reads weakest, so the board's icon is a shade darker.
const BADGE = 28;
const BADGE_INSET = 10;

export function typeIconFor(item: FolderItem): keyof typeof Ionicons.glyphMap | null {
  if (item.kind === 'board') return 'easel-outline';
  if (item.kind === 'flashcard') return 'layers-outline';
  if (item.kind === 'link') {
    const category = item.linkCategory;
    return category === 'video' ? 'play' : category === 'geo' ? 'location-outline' : 'link-outline';
  }
  return null;
}

export function TypeBadge({ item, children }: { item: FolderItem; children: ReactNode }) {
  const color = glowColorFor(item);
  const icon = typeIconFor(item);
  if (!color || !icon) return <>{children}</>;
  const ink = color === TYPE_GLOW.board ? '#D69A06' : color;
  return (
    <View>
      {children}
      <View pointerEvents="none" style={[styles.badge, { backgroundColor: `${color}26` }]}>
        <Ionicons name={icon} size={15} color={ink} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    right: BADGE_INSET,
    bottom: BADGE_INSET,
    width: BADGE,
    height: BADGE,
    borderRadius: BADGE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
