import { memo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { makeStyles as makeEditorStyles } from './documentEditorStyles';
import type { Block } from '../types';
import BlockRow from './BlockRow';
import { visibleBlocks } from '../utils/toggleBlocks';

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
// ONE FOR ONE with the page it stands for, not merely like it. The user
// asked for the zoom to read as one picture being made bigger, and it
// only can if the two are the same picture: anything this draws a few
// points from where the editor draws it ghosts across the hand-over.
// That is why the tail below is the editor's own «Додати блок» row in
// the editor's own styles rather than an empty page bottom.
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
  const editorStyles = useStyles(makeEditorStyles);
  const width = pageWidth * scale;
  const height = pageHeight * scale;
  let runningNumber = 0;
  // A folded section is folded here too - see visibleBlocks. A card that
  // showed what its page hides would stop being the same picture.
  const shown = visibleBlocks(blocks).slice(0, MAX_ROWS);
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
        {/* The rows are laid out inside a scroll view, exactly as the
            editor lays them out - one that never scrolls. Under a plain
            View of fixed height a task's row (flex:1, which fills its
            line in the editor) and a link card's title came out at no
            height at all, even on a page with room to spare: only the
            "Нагадування" line and the picture were left. A scroll view's
            content is measured with no height limit, which is the
            condition every row here was written against. */}
        <ScrollView scrollEnabled={false} style={styles.fill} contentContainerStyle={styles.content}>
        {/* The blocks carry the block list's own side padding and the add
            row below does NOT - in the editor they are siblings inside
            the scroll, and only the list is indented. Folding that 12
            into the whole page pushed the add row 12 points further in
            than the page it stands for. */}
        <View style={editorStyles.blockListContainer}>
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
        {/* The editor draws this under every note that is not picking
            blocks, so a page that ends without it ends in the wrong
            place. Inert, like everything else here. */}
        <View style={editorStyles.addBlockRow}>
          <View style={editorStyles.addBlock}>
            <Ionicons name="add" size={18} color={theme.paper.ink} />
            <Text style={editorStyles.addBlockLabel}>Додати блок</Text>
          </View>
        </View>
        </ScrollView>
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
    overflow: 'hidden',
  },
  fill: {
    flex: 1,
  },
  // `scrollAreaEmbedded`, which is all the editor's own scroll adds.
  content: {
    paddingTop: 4,
  },
});
