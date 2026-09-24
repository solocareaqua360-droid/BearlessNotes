import { memo } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Block, Tag } from '../types';
import PageCover from './PageCover';
import BlockRow from './BlockRow';
import DocumentTagsBlock from './DocumentTagsBlock';
import { PAGE_HEADER_TOP, PAGE_SHEET_INSET, makeStyles as makeEditorStyles } from './documentEditorStyles';

// A DOCUMENT'S OWN PAGE, made small - the card as a picture of the thing
// rather than a design about it.
//
// The user's reasoning, and it settles two questions at once. A card
// built as its own composition can never GROW into the page: the two are
// different pictures, so every move between them is a swap, which is
// what the morph fell over on. And a cover that belongs to the CARD is a
// decoration; a cover that belongs to the PAGE is simply what the page
// starts with, and the card shows it because the page does.
//
// It follows that the list's three ways round stop being three layouts
// and become three sizes of window onto the same picture: a tile is the
// top of the page, a wide card a wider piece of it, a row a strip. Only
// the tile is built this way so far - one screen, one feeling, easy to
// take back.
//
// EVERYTHING HERE IS INERT. No field is ever active (an inactive
// BlockRow draws plain Text, never a TextInput), every handler is a
// no-op, and the whole surface takes no touches: the card's own press
// belongs to the card.
//
// Past this nothing can be seen on even the tallest card.
const MAX_ROWS = 24;
const noop = () => {};

function DocumentPageMiniature({
  title,
  blocks,
  tagIds,
  tags,
  project,
  coverImageUri,
  coverDriveFileId,
  paperColor = null,
  width,
  height,
  offsetY = 0,
}: {
  title: string;
  blocks: Block[];
  tagIds: string[];
  tags: Tag[];
  // Drawn by the card over this, not here - kept in the signature so
  // the call site reads as 'this is the page of that document'.
  project: { name: string; color: string } | null;
  coverImageUri?: string;
  coverDriveFileId?: string;
  // The note's OWN paper, where it has one: the sheet, the ink of every
  // block on it, and what its cover fades into are all that colour then.
  paperColor?: { background: string; text: string; textMuted: string } | null;
  // The card's own box. The page is laid out at the width a page really
  // has and scaled into this, so what is drawn is the page - not the
  // page's content re-flowed into a card, which is a different picture.
  width: number;
  height: number;
  // How far down the PAGE this window starts, in the page's own points.
  // A row is a short strip and would otherwise be nothing but the empty
  // band the editor leaves above the title; starting below it shows the
  // same picture, further down. A morph out of such a card grows and
  // slides to the page's own top, which is what it looks like anyway.
  offsetY?: number;
}) {
  const theme = useTheme();
  const editorStyles = useStyles(makeEditorStyles);
  // The SHEET'S width, not the window's: a page is a sheet standing in
  // from both edges now (see DocumentEditorScreen's `sheetPage`), and a
  // picture of it laid out at the window's width would be a picture of
  // something else.
  const { width: windowWidth } = useWindowDimensions();
  const pageWidth = windowWidth - PAGE_SHEET_INSET * 2;
  const scale = width / pageWidth;
  let numbered = 0;
  const shown = blocks.slice(0, MAX_ROWS);
  return (
    <View
      style={[styles.sheet, { width, height, backgroundColor: paperColor?.background ?? theme.paper.fill }]}
      pointerEvents="none"
    >
      {/* Laid out at page size, pinned to the top left and scaled about
          that corner, so the card shows the TOP of the page and cuts off
          wherever its own height ends - the way a page of paper ends. */}
      <View style={[styles.page, { width: pageWidth, top: -offsetY * scale, transform: [{ scale }] }]}>
        {/* THE EDITOR'S OWN ORDER, and its own styles at every step: the
            empty header band it leaves above the title, the cover, the
            name, the folders, the blocks, the row it ends with. */}
        <View style={styles.headerBand} />
        {!!coverImageUri && (
          <PageCover
            uri={coverImageUri}
            driveFileId={coverDriveFileId}
            style={editorStyles.coverImage}
            paper={paperColor?.background}
          />
        )}
        <Text style={[editorStyles.titleInput, paperColor && { color: paperColor.text }]} numberOfLines={2}>
          {title || 'Без назви'}
        </Text>
        <DocumentTagsBlock
          tagIds={tagIds}
          tags={tags}
          onAttach={noop}
          onDetach={noop}
          onCreateAndAttach={noop}
          onRenameTag={noop}
        />
        {/* The rows go in a scroll view that never scrolls, because that
            is the shape they were written against: laid straight into a
            box of fixed height they lose every row that fills its line -
            a task's row, a link card's title - and only the small print
            under them is left. DayPageMiniature learned this the hard
            way and says so too. */}
        <ScrollView scrollEnabled={false} contentContainerStyle={styles.rows}>
          <View style={editorStyles.blockListContainer}>
            {shown.map((item, index) => {
              if (item.type === 'numbered') {
                numbered = index > 0 && shown[index - 1].type === 'numbered' ? numbered + 1 : 1;
              } else {
                numbered = 0;
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
                  paperColor={paperColor}
                />
              );
            })}
          </View>
          <View style={editorStyles.addBlockRow}>
            <View style={editorStyles.addBlock}>
              <Ionicons name="add" size={18} color={paperColor?.text ?? theme.paper.ink} />
              <Text style={[editorStyles.addBlockLabel, paperColor && { color: paperColor.text }]}>
                Додати блок
              </Text>
            </View>
          </View>
        </ScrollView>
      </View>
      {/* The project badge is a card's own chrome, not the page's - see
          DocumentCard, which draws it over this. */}
    </View>
  );
}

// A wall of these re-renders whenever the list's own state moves; a page
// only changes when its document does.
export default memo(DocumentPageMiniature);

const styles = StyleSheet.create({
  sheet: {
    overflow: 'hidden',
  },
  page: {
    position: 'absolute',
    left: 0,
    top: 0,
    transformOrigin: 'top left',
  },
  rows: {
    // `scrollAreaEmbedded` is the editor's own, and this is its page
    // equivalent: nothing but the small top the scroll itself adds.
    paddingTop: 4,
  },
  // The editor's own `header` with both its buttons gone to the dock,
  // and nothing in between.
  headerBand: {
    height: PAGE_HEADER_TOP + 12,
  },
});
