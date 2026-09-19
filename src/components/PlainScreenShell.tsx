import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ContentColumn from './ContentColumn';
import ScreenBackdrop from './ScreenBackdrop';
import { CHROME_TOP } from '../constants/rail';

// The frame the three registry screens share - the diary, the groups and
// the tags.
//
// They are not databases of records the way Files or Photos are: there is
// nothing to sort, group or put in folders, so DatabaseChrome (which is
// built around useDatabaseList) has nothing to work with. What they DO
// share with every other screen now is the dock - the way out, and
// whatever action each one has, are published straight from the screen
// itself (useDockLeave/useDockActions), the same as everywhere else. This
// shell is left holding only what has nothing to do with navigation: the
// app's own backdrop, and the line the content starts on.
export default function PlainScreenShell({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <ScreenBackdrop id={id} />
      <ContentColumn>
        {/* The band the status bar stands in - the dock carries the way
            out now, at the foot of the screen, not a capsule up here. */}
        <View style={{ height: insets.top + CHROME_TOP + 8 }} />
        {children}
      </ContentColumn>
    </View>
  );
}

// What a list inside the shell keeps clear of. Plain padding now - there
// is no side rail any more to leave room for.
export function shellClear(_railSide: 'left' | 'right', base: number) {
  return { paddingHorizontal: base };
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
