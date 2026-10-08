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
  if (!blocks) return null;
  const all = visibleBlocks(blocks).filter((b) => !(isLightRow(b) && !b.text?.trim() && (b.type ?? 'paragraph') === 'paragraph'));
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
            <PagePreviewRow
              key={item.id}
              item={item}
              indented={rowIndented}
              listNumber={item.type === 'numbered' ? numbered : undefined}
              paperColor={null}
              styles={editorStyles}
              theme={theme}
              textScale={textScale}
            />
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
            paperColor={null}
            preview
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: -12, marginTop: 4 },
});
