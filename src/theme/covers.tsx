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
// invented for this.
//
// Each runs from the colour ITSELF up to nearly white, rather than from
// a shade below it: the first cut started dark and the covers read as
// black holes in a very light layout - the eye caught them before the
// titles. A cover is a patch of colour, not a weight.
export const COVER_GRADIENTS: CoverGradient[] = [
  { id: 'beige', stops: ['#DAA587', '#EAC6AF', '#F8EEE5'] },
  { id: 'green', stops: ['#84B799', '#AFD3BE', '#E7F3EC'] },
  { id: 'terracotta', stops: ['#BE7657', '#D8A489', '#F4E1D4'] },
  { id: 'greygreen', stops: ['#69736E', '#9AA49F', '#E1E6E3'] },
  { id: 'mint', stops: ['#A0B4AF', '#C3D2CE', '#EDF3F1'] },
  { id: 'slate', stops: ['#556E78', '#8FA6AE', '#E0E8EB'] },
  { id: 'pale', stops: ['#788782', '#A7B3AF', '#E6EBE9'] },
  { id: 'clay', stops: ['#C98C6B', '#E0B296', '#F7E9DE'] },
  { id: 'lagoon', stops: ['#6E93A0', '#A3C4BE', '#E6F1EE'] },
  { id: 'fog', stops: ['#8C9A95', '#BFCCC7', '#EFF4F1'] },
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
