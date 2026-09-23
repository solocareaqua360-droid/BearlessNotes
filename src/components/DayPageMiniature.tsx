import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { Block } from '../types';
import BlockRow from './BlockRow';

// A day's page, shrunk - what the calendar's overview on a phone is made
// of.
//
// Drawn by the PAGE'S OWN RENDERER now, not CardPreview's flat reading of
// the blocks: "давай повноцінну промальовку". Every block is the same
// BlockRow the editor draws, laid out at the page's real size and then
// scaled down as one piece, so a miniature is the page - its pictures,
// its links, its spacing - only smaller.
//
// What keeps that affordable: nothing here is live. No field is ever
// active (an inactive row draws plain Text, never a TextInput), every
// handler is a no-op, and the sheet takes no touches at all - the tap on
// it belongs to the overview. And the overview only mounts one month of
// these at a time.
//
// A page never shows more than its own height, so rows past this are
// never seen; drawing them would only cost.
const MAX_ROWS = 40;
const noop = () => {};

function DayPageMiniature({
  blocks,
  pageWidth,
  pageHeight,
  scale,
  radius,
}: {
  blocks: Block[];
  // The page's real size - what the rows are laid out against.
  pageWidth: number;
  pageHeight: number;
  scale: number;
  radius: number;
}) {
  const theme = useTheme();
  const width = pageWidth * scale;
  const height = pageHeight * scale;
  let runningNumber = 0;
  const shown = blocks.slice(0, MAX_ROWS);
  return (
    <View
      style={[styles.sheet, { width, height, borderRadius: radius, backgroundColor: theme.paper.fill }]}
      pointerEvents="none"
    >
      {/* Laid out at full size, centred, and scaled about its centre - so
          it lands exactly on the sheet's edges. */}
      <View
        style={[
          styles.page,
          {
            width: pageWidth,
            height: pageHeight,
            left: (width - pageWidth) / 2,
            top: (height - pageHeight) / 2,
            transform: [{ scale }],
          },
        ]}
      >
        {/* Rows go in a column of their OWN height. Laid straight into
            the fixed-height page, they overflowed it, and Yoga answered
            by shrinking whatever could shrink: a task's row is flex:1
            (it fills its line in the editor), so every task collapsed to
            nothing and only its "Нагадування" line was left. */}
        <View>
        {shown.map((item, index) => {
          if (item.type === 'numbered') {
            runningNumber = index > 0 && shown[index - 1].type === 'numbered' ? runningNumber + 1 : 1;
          } else {
            runningNumber = 0;
          }
          return (
            <BlockRow
              key={item.id}
              item={item}
              hideHandle
              isSelected={false}
              isSelectMode={false}
              isActive={false}
              showBoundary={false}
              listNumber={item.type === 'numbered' ? runningNumber : undefined}
              textVersion={0}
              onActivate={noop}
              onBlur={noop}
              onChangeText={noop}
              onBackspaceEmpty={noop}
              onToggleSelected={noop}
              onToggleChecked={noop}
              onOpenReminder={noop}
              onUpdateBlock={noop}
              onFocus={noop}
              onSelectionChange={noop}
              onOpenImage={noop}
              onToggleImageFit={noop}
              onDrawOverImage={noop}
              onOpenFile={noop}
              onDownloadFile={noop}
              onOpenFileDatabase={noop}
              onOpenLink={noop}
              onOpenLinkDatabase={noop}
              onOpenSketch={noop}
              allTags={[]}
              onOpenCustomRow={noop}
              onOpenCustomView={noop}
              inputRef={noop}
              paperColor={null}
            />
          );
        })}
        </View>
      </View>
    </View>
  );
}

// A month of these is re-rendered every time the overview's state moves
// (a month added, the scroll settling); the page itself only changes
// when its blocks do.
export default memo(DayPageMiniature);

const styles = StyleSheet.create({
  sheet: {
    overflow: 'hidden',
  },
  // The editor's own insets for a daily note: the block list's side
  // padding, and the scroll area's small top.
  page: {
    position: 'absolute',
    paddingHorizontal: 12,
    paddingTop: 4,
    overflow: 'hidden',
  },
});
