import { useId, useState } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
import AttachmentImage from './AttachmentImage';

// A NOTE'S COVER, ENDING RATHER THAN STOPPING.
//
// A picture cut off by a straight line across the page is a picture
// someone stopped drawing; the user asked for it to fade instead - a
// tenth of its height at the top and a tenth at the bottom - so it comes
// out of the page and goes back into it.
//
// Not a real transparency: a gradient of the PAGE'S OWN PAPER lies over
// the picture, opaque at the very edge and gone a tenth in. Against the
// page - which is the only place a cover is ever drawn - the two are the
// same thing to look at, and this one costs no image processing and
// works on a picture that is still loading.
//
// ONE COMPONENT, used by the page and by the cards that are that page
// made small. Drawn twice, the two would drift, and a card that is not
// the same picture as its page is the thing this whole direction exists
// to avoid.
const FADE = 0.1;

export default function PageCover({
  uri,
  driveFileId,
  style,
  countsAsUse,
}: {
  uri: string;
  driveFileId?: string;
  // The page's own `coverImage` - the caller decides how tall a cover
  // is, here and in a miniature alike.
  style?: StyleProp<ViewStyle>;
  countsAsUse?: boolean;
}) {
  const theme = useTheme();
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
      style={style}
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
        <Svg width={box.w} height={box.h} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Defs>
            <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={theme.paper.fill} stopOpacity={1} />
              <Stop offset={FADE} stopColor={theme.paper.fill} stopOpacity={0} />
              <Stop offset={1 - FADE} stopColor={theme.paper.fill} stopOpacity={0} />
              <Stop offset="1" stopColor={theme.paper.fill} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={box.w} height={box.h} fill={`url(#${gradientId})`} />
        </Svg>
      )}
    </View>
  );
}
