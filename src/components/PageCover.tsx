import { useId, useState } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
import AttachmentImage from './AttachmentImage';

// A NOTE'S COVER, ENDING RATHER THAN STOPPING.
//
// A picture cut off by a straight line across the page is a picture
// someone stopped drawing; the user asked for it to fade instead - a
// fifth of its height at the top and a fifth at the bottom - so it comes
// out of the page and goes back into it. A tenth was tried first and
// read as an edge with a soft rim rather than as a fade.
//
// Not a real transparency: a gradient of the PAGE'S OWN PAPER lies over
// the picture, opaque at the very edge and gone a fifth in. Against the
// page - which is the only place a cover is ever drawn - the two are the
// same thing to look at, and this one costs no image processing and
// works on a picture that is still loading.
//
// ONE COMPONENT, used by the page and by the cards that are that page
// made small. Drawn twice, the two would drift, and a card that is not
// the same picture as its page is the thing this whole direction exists
// to avoid.
const FADE = 0.2;
// The cover's own last row of pixels was surviving as a hard line: a
// laid-out height is not always a whole number, and an <Svg> sized to a
// fractional one paints a row short of it. The fade is drawn a couple of
// points larger than the box, and the box clips the difference.
//
// The gradient is measured against the BOX, though, not against that
// larger rectangle - which is what went wrong on the first try. Stretched
// over the bleed, its last stop landed below the visible edge, so the
// bottom row came out at ninety-odd per cent and the picture showed
// through it as exactly the line this was meant to remove. In user space
// it reaches full paper at the box's own bottom and simply stays there
// for the bleed.
const BLEED = 2;
// HOW THE FADE FALLS, and why it is not a straight line. Alpha is
// composited in gamma space, so paper at half opacity over a dark
// picture already reads as light grey rather than as half way: a linear
// ramp looks like solid paper that gives up all at once near its inner
// edge, which is exactly what it looked like - "білий папір рівномірний,
// зменшується тільки біля самого свого краю". Raised to this power it
// leaves early and trails off, which is what the eye reads as even.
const FALL = 2.2;
// Enough to draw a curve out of straight segments without anyone being
// able to see the corners.
const STEPS = 6;

// The stops of one edge's fade. Offsets always ASCEND - a gradient whose
// stops run backwards is not a gradient - so the bottom edge is the same
// curve read the other way: solid at the very end, and arriving late
// exactly as the top leaves early.
function fadeStops(from: number, to: number, color: string, key: string, arriving: boolean) {
  const out = [];
  for (let i = 0; i <= STEPS; i++) {
    const u = i / STEPS;
    out.push(
      <Stop
        key={`${key}-${i}`}
        offset={from + (to - from) * u}
        stopColor={color}
        stopOpacity={Math.pow(arriving ? u : 1 - u, FALL)}
      />
    );
  }
  return out;
}

export default function PageCover({
  uri,
  driveFileId,
  style,
  countsAsUse,
  paper,
}: {
  uri: string;
  driveFileId?: string;
  // The colour of the page it lies on. A note can carry a paper colour
  // of its own, and an edge that fades to white on coloured paper is a
  // white haze rather than an edge going away.
  paper?: string;
  // The page's own `coverImage` - the caller decides how tall a cover
  // is, here and in a miniature alike.
  style?: StyleProp<ViewStyle>;
  countsAsUse?: boolean;
}) {
  const theme = useTheme();
  const into = paper ?? theme.paper.fill;
  // Measured, never "100%": react-native-svg's percentage width and
  // height on the root <Svg> are not reliable here - this repo's own
  // list screen says so about a gradient that stayed sized to a folded
  // phone's width, and a tile's own fade did not paint at all that way.
  const [box, setBox] = useState({ w: 0, h: 0 });
  // A gradient id is a name in the whole document, so every cover on
  // screen needs its own or they all share whichever was defined last.
  const gradientId = `cover-${useId()}`;
  return (
    <View
      // Clips the bleed above, so a fade drawn past the cover's edge
      // cannot land on the page below it.
      style={[style, styles.clip]}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setBox((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
      }}
    >
      <AttachmentImage
        uri={uri}
        driveFileId={driveFileId}
        style={StyleSheet.absoluteFill}
        countsAsUse={countsAsUse}
      />
      {box.w > 0 && box.h > 0 && (
        <Svg
          width={Math.ceil(box.w) + BLEED}
          height={Math.ceil(box.h) + BLEED}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        >
          <Defs>
            <LinearGradient
              id={gradientId}
              x1={0}
              y1={0}
              x2={0}
              y2={Math.ceil(box.h)}
              gradientUnits="userSpaceOnUse"
            >
              {[
                ...fadeStops(0, FADE, into, 'top', false),
                ...fadeStops(1 - FADE, 1, into, 'bottom', true),
              ]}
            </LinearGradient>
          </Defs>
          <Rect
            x={0}
            y={0}
            width={Math.ceil(box.w) + BLEED}
            height={Math.ceil(box.h) + BLEED}
            fill={`url(#${gradientId})`}
          />
        </Svg>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
  },
});
