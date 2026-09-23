import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { Block } from '../types';
import CardPreview from './CardPreview';

// A day's page, shrunk - what the calendar's overview on a phone is made
// of. Not a document card: the user pinched the page, liked what they
// saw half-way ("хотілося щоб мініатюри залишались в такому вигляді"),
// and that is a white sheet at the page's own proportions with the note
// running down it, cut off where the sheet ends.
//
// The blocks are drawn by CardPreview - cheap, flat, the same reading of
// the blocks every card uses - but on a box `TEXT_ZOOM` times smaller
// and scaled back up, because the card's type is sized for a card and
// here it has to read like the page itself at this scale.
const TEXT_ZOOM = 1.27;

export default function DayPageMiniature({
  blocks,
  width,
  height,
  radius,
}: {
  blocks: Block[];
  width: number;
  height: number;
  radius: number;
}) {
  const theme = useTheme();
  const innerW = width / TEXT_ZOOM;
  const innerH = height / TEXT_ZOOM;
  return (
    <View style={[styles.sheet, { width, height, borderRadius: radius, backgroundColor: theme.paper.fill }]}>
      {/* Scaled about its centre, so it is placed centred on the sheet
          and grows out to exactly the sheet's edges. */}
      <View
        style={[
          styles.inner,
          {
            width: innerW,
            height: innerH,
            left: (width - innerW) / 2,
            top: (height - innerH) / 2,
            transform: [{ scale: TEXT_ZOOM }],
          },
        ]}
      >
        <CardPreview blocks={blocks} color={theme.paper.ink} mutedColor={theme.paper.inkMuted} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    overflow: 'hidden',
  },
  inner: {
    position: 'absolute',
    paddingHorizontal: 16,
    paddingTop: 18,
  },
});
