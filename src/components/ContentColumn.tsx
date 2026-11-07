import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

// How wide one column of content is ever allowed to get. Past this a list
// row becomes a hairline of text stretched across a table, and the eye has
// to travel the whole window to pair a title on the left with its date on
// the right. 760 keeps a card readable while still using the extra room a
// Fold's inner screen (984dp) or a tablet gives.
export const MAX_CONTENT_WIDTH = 760;

// A screen's content, centred and capped. A no-op on a phone: the column is
// width:'100%' and no phone reaches the cap, so nothing about the layout
// changes below it. Deliberately wraps the content only - a screen's
// background gradient stays full-bleed behind it, and anything that must
// cover the whole window (the tags drawer) stays outside.
// `full`: the cap lifted - for what is a surface rather than a column of
// rows (a map), which should have all the room there is.
export default function ContentColumn({ children, full = false }: { children: ReactNode; full?: boolean }) {
  // A separate style, not the cap overridden with undefined: an undefined in
  // a later style does not take an earlier value away.
  return <View style={full ? styles.full : styles.column}>{children}</View>;
}

const styles = StyleSheet.create({
  column: {
    flex: 1,
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
  },
  full: {
    flex: 1,
    width: '100%',
  },
});
