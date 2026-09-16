import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

// Every note has a cover. Not the first picture in it, not a grey glyph:
// a cover of its own, the way a book has one - so a list of notes stops
// being a column of identical white rectangles (the user's complaint,
// side by side with the photo grid that never has that problem).
//
// By default it is one of these gradients, picked by the note's id the
// same way colorForDocument picks its colour - deterministic, so it never
// flickers between renders and never needs a write to exist. The user
// can choose a different one (coverGradient on the document), or their
// own picture (coverImageUri), which wins over any gradient.
export type CoverGradient = { id: string; stops: [string, string, string] };

export const COVER_GRADIENTS: CoverGradient[] = [
  { id: 'slate', stops: ['#5B6B78', '#96A7A2', '#D8CFC4'] },
  { id: 'dusk', stops: ['#2F2A27', '#7A6355', '#C9A184'] },
  { id: 'sky', stops: ['#7FA6C9', '#B7D3E6', '#EAF2F8'] },
  { id: 'mint', stops: ['#6E9E97', '#A9CFC9', '#E2F0EC'] },
  { id: 'lilac', stops: ['#8B8FB8', '#C0C4E0', '#EEF0F8'] },
  { id: 'amber', stops: ['#B4713F', '#DAA587', '#F3E2D3'] },
  { id: 'moss', stops: ['#4E6B58', '#84B799', '#D6E8DC'] },
  { id: 'terracotta', stops: ['#8F4E3A', '#BE7657', '#EBC9B4'] },
  { id: 'graphite', stops: ['#2B2F36', '#69736E', '#B9C0BC'] },
  { id: 'rose', stops: ['#9C6B7C', '#D0A3B1', '#F4E3E9'] },
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash;
}

// The note's own default - stable for its id, and deliberately a
// different hash step from colorForDocument's so the two do not always
// land on the same hue together.
export function defaultCoverFor(id: string): CoverGradient {
  return COVER_GRADIENTS[(hashString(id) >>> 3) % COVER_GRADIENTS.length];
}

export function coverById(id: string | undefined): CoverGradient | undefined {
  return id ? COVER_GRADIENTS.find((g) => g.id === id) : undefined;
}

// The gradient, drawn to fill whatever it is put in. Diagonal, top-left
// to bottom-right, so it reads as light falling on a surface rather than
// as a stripe.
export function CoverGradientView({
  gradient,
  style,
}: {
  gradient: CoverGradient;
  style?: StyleProp<ViewStyle>;
}) {
  const uid = `cover-${gradient.id}`;
  return (
    <View style={[styles.box, style]} pointerEvents="none">
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={uid} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={gradient.stops[0]} />
            <Stop offset="0.55" stopColor={gradient.stops[1]} />
            <Stop offset="1" stopColor={gradient.stops[2]} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${uid})`} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden' },
});
