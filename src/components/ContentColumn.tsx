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
export default function ContentColumn({ children }: { children: ReactNode }) {
  return <View style={styles.column}>{children}</View>;
}

const styles = StyleSheet.create({
  column: {
    flex: 1,
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
  },
});
