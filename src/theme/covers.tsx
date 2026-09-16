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

// Built from the app's OWN palette - the seven colours the tile board
// and the record cards already speak (see DOCUMENT_PALETTE), not a set
// invented for this. Seven are one hue each, a shade below it to a tint
// above it, which is what makes a flat colour read as light on a
// surface; three are the blends between neighbours, for variety without
// leaving the family.
export const COVER_GRADIENTS: CoverGradient[] = [
  { id: 'beige', stops: ['#B8845F', '#DAA587', '#F1DCC9'] },
  { id: 'green', stops: ['#5E937A', '#84B799', '#CFE5D6'] },
  { id: 'terracotta', stops: ['#8F4E3A', '#BE7657', '#E6BBA6'] },
  { id: 'greygreen', stops: ['#454E4A', '#69736E', '#B7C0BB'] },
  { id: 'mint', stops: ['#7C918C', '#A0B4AF', '#DDE6E3'] },
  { id: 'slate', stops: ['#3A4F58', '#556E78', '#A8BBC3'] },
  { id: 'pale', stops: ['#56645F', '#788782', '#C2CBC7'] },
  { id: 'clay', stops: ['#BE7657', '#DAA587', '#F1DCC9'] },
  { id: 'lagoon', stops: ['#556E78', '#84B799', '#CFE5D6'] },
  { id: 'fog', stops: ['#69736E', '#A0B4AF', '#E6EBE6'] },
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
