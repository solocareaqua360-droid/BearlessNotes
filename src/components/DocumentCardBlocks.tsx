import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { doc, onSnapshot } from '../firestore';
import { db } from '../firebase';
import { useStyles, useTheme, useTextScale } from '../theme/ThemeProvider';
import type { Block } from '../types';
import BlockRow from './BlockRow';
import PagePreviewRow, { isLightRow } from './PagePreviewRow';
import { makeStyles as makeEditorStyles } from './documentEditorStyles';
import { visibleBlocks } from '../utils/toggleBlocks';

// A DOCUMENT CARD OPENED OUT ON A BOARD, showing its blocks as they are -
// headings, tasks with their boxes, lists, pictures, link cards - instead of
// the flat text snapshot it showed before (2026-10-08, the user's: "ми
// можемо розгорнути картку і побачити всі формати блоків як вони є").
// Read live from the note, drawn the way a page miniature draws its rows
// (PagePreviewRow for text, BlockRow's preview for the rest), at the card's
// own width. Inert: the card's own touches belong to the card.
const noop = () => {};

export default function DocumentCardBlocks({ documentId }: { documentId: string }) {
  const theme = useTheme();
  const editorStyles = useStyles(makeEditorStyles);
  const textScale = useTextScale();
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  useEffect(
    () =>
      onSnapshot(
        doc(db, 'documents', documentId),
        (snapshot) => setBlocks(((snapshot.data() as { blocks?: Block[] } | undefined)?.blocks ?? []) as Block[]),
        () => setBlocks([])
      ),
    [documentId]
  );
  // The card's own ground shows through: no sheet behind the rows, no row
  // frames (the user: "не впевнений чи взагалі треба відображати їх контур").
  const clear = { background: 'transparent', text: theme.paper.ink, textMuted: theme.paper.inkMuted };
  if (!blocks) return null;
  // Empty rows are left out: on a card an empty line is only a gap.
  const all = visibleBlocks(blocks).filter((b) => !(isLightRow(b) && !b.text?.trim()));
  let numbered = 0;
  let indented = false;
  return (
    <View style={styles.wrap} pointerEvents="none">
      {all.map((item, index) => {
        numbered = item.type === 'numbered' ? (all[index - 1]?.type === 'numbered' ? numbered + 1 : 1) : 0;
        if (item.exitsToggle) indented = false;
        const rowIndented = indented;
        if (item.type === 'toggle') indented = true;
        if (isLightRow(item)) {
          return (
            // The row's own width, given: a task's text is a flex child of a
            // row that otherwise had nothing to measure it against on a
            // card, and came out zero wide - the box with no words.
            <View key={item.id} style={styles.full}>
            <PagePreviewRow
              key={item.id}
              item={item}
              indented={rowIndented}
              listNumber={item.type === 'numbered' ? numbered : undefined}
              paperColor={clear}
              styles={editorStyles}
              theme={theme}
              textScale={textScale}
            />
            </View>
          );
        }
        return (
          <BlockRow
            key={item.id}
            item={item}
            hideHandle
            indented={rowIndented}
            isSelected={false}
            isSelectMode={false}
            isActive={false}
            showBoundary={false}
            listNumber={item.type === 'numbered' ? numbered : undefined}
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
            paperColor={clear}
            preview
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // Inside the card, never past its edges.
  wrap: { marginTop: 4, overflow: 'hidden' },
  full: { width: '100%' },
});
