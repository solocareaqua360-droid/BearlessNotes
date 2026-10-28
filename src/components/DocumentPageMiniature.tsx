import type { ImageFrame } from '../utils/imageFrame';
import { BlocksFontContext, NoteFontContext, resolveNoteFont } from '../utils/noteFont';
import { listNumbers } from '../utils/documentBlocks';
import { memo, useContext, useRef, useState } from 'react';
import { IS_POINTER } from '../utils/pointer';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from './icons/Ionicons';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Block, Tag } from '../types';
import PageCover from './PageCover';
import BlockRow from './BlockRow';
import { SearchMarked } from './FormattedText';
import { visibleBlocks } from '../utils/toggleBlocks';
import { blockMatchesQuery } from '../utils/documentPreview';
import DocumentTagsBlock from './DocumentTagsBlock';
import { PAGE_HEADER_TOP, PAGE_SHEET_INSET, makeStyles as makeEditorStyles } from './documentEditorStyles';
import { PreviewDepthContext } from './previewDepth';
import PagePreviewRow, { isLightRow } from './PagePreviewRow';
import { useTextScale } from '../theme/ThemeProvider';

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
// While searching: a first match at this block or later is too far down
// the page to be seen on a card, so the card shows the title, a "…", and
// the page from LEAD_BLOCKS before the match instead of from the top.
const SLIDE_FROM = 3;
const LEAD_BLOCKS = 2;

function DocumentPageMiniature({
  title,
  blocks,
  tagIds,
  tags,
  project,
  coverImageUri,
  coverDriveFileId,
  coverFrame,
  paperColor = null,
  width,
  height,
  offsetY = 0,
  highlight,
}: {
  // A search query, while the list is being searched: every match on the
  // page is marked in yellow where it really stands, and a match below
  // the top slides the window down to it (see SLIDE_FROM).
  highlight?: string;
  title: string;
  blocks: Block[];
  tagIds: string[];
  tags: Tag[];
  // Drawn by the card over this, not here - kept in the signature so
  // the call site reads as 'this is the page of that document'.
  project: { name: string; color: string } | null;
  coverImageUri?: string;
  coverDriveFileId?: string;
  coverFrame?: ImageFrame;
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
  // Under a mouse the window is a desk-wide 1300+, and a page laid out that
  // wide and shrunk into a 380 tile came out at 5px type - unreadable
  // ("мініатюра занадто дрібна"). There the page is laid out as a phone's
  // sheet is (440), so the tile shows it at nearly its own size.
  const pageWidth = IS_POINTER ? Math.max(width, 440) : windowWidth - PAGE_SHEET_INSET * 2;
  const scale = width / pageWidth;
  let numbered = 0;
  let indented = false;
  // A folded section is folded here too - see visibleBlocks. A card that
  // showed what its page hides would stop being the same picture.
  const all = visibleBlocks(blocks);
  const query = highlight?.trim().toLowerCase() ?? '';
  const firstMatch = query ? all.findIndex((b) => blockMatchesQuery(b, query)) : -1;
  const from = firstMatch >= SLIDE_FROM ? firstMatch - LEAD_BLOCKS : 0;
  // The skipped blocks still carry their list numbering and toggle indent
  // into the first ones shown.
  const numbers = listNumbers(all);
  for (let i = 0; i < from; i++) {
    const item = all[i];
    numbered = numbers[i];
    if (item.exitsToggle) indented = false;
    if (item.type === 'toggle') indented = true;
  }
  const sliding = from > 0;
  // As many rows as the card can show at all - a short block is about 26
  // of the page's points - rather than a flat 24 laid out and cut away.
  const fits = Math.ceil((height / scale + offsetY) / 26);
  const counted = all.slice(from, from + Math.min(MAX_ROWS, Math.max(4, fits)));
  // ROWS BELOW THE CARD'S EDGE GO (2026-10-28): `fits` counts a row as a line of text, so a page of pictures had all of
  // them laid out under the card's foot, cut away but still drawn - and Android prepares every bitmap it draws, seen or
  // not, on every frame. Three map snapshots of «таблиці тестую» in its Start card were half of what overfilled the
  // GPU's cache while that note folded back. Once the rows are laid out, the first one starting below the edge and all
  // after it are dropped; the rows above keep their places, so the picture does not change.
  const [cut, setCut] = useState<{ blocks: Block[]; at: number } | null>(null);
  const cutAt = cut && cut.blocks === blocks ? cut.at : null;
  const shown = cutAt === null ? counted : counted.slice(0, cutAt);
  const rowsTop = useRef<number | null>(null);
  const rowYs = useRef<number[]>([]);
  const recut = () => {
    if (rowsTop.current === null || cutAt !== null) return;
    const edge = offsetY + height / scale;
    const at = rowYs.current.findIndex((y) => y !== undefined && rowsTop.current! + y > edge);
    if (at > 0) setCut({ blocks, at });
  };
  const depth = useContext(PreviewDepthContext);
  const textScale = useTextScale();
  return (
    <PreviewDepthContext.Provider value={depth + 1}>
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
        {!!coverImageUri && !sliding && (
          <PageCover
            uri={coverImageUri}
            driveFileId={coverDriveFileId}
            frame={coverFrame}
            style={editorStyles.coverImage}
            paper={paperColor?.background}
          />
        )}
        <Text style={[editorStyles.titleInput, paperColor && { color: paperColor.text }]} numberOfLines={2}>
          <SearchMarked text={title || 'Без назви'} search={highlight} />
        </Text>
        {sliding ? (
          <Text style={[styles.skipped, { color: paperColor?.textMuted ?? theme.paper.inkMuted }]}>…</Text>
        ) : (
        <DocumentTagsBlock
          tagIds={tagIds}
          tags={tags}
          onAttach={noop}
          onDetach={noop}
          onCreateAndAttach={noop}
          onRenameTag={noop}
        />
        )}
        {/* The rows go in a scroll view that never scrolls, because that
            is the shape they were written against: laid straight into a
            box of fixed height they lose every row that fills its line -
            a task's row, a link card's title - and only the small print
            under them is left. DayPageMiniature learned this the hard
            way and says so too. */}
        <ScrollView
          scrollEnabled={false}
          contentContainerStyle={styles.rows}
          onLayout={(e) => {
            rowsTop.current = e.nativeEvent.layout.y + styles.rows.paddingTop;
            recut();
          }}
        >
          <View style={editorStyles.blockListContainer}>
            {shown.map((item, index) => (
              <View
                key={item.id}
                onLayout={(e) => {
                  rowYs.current[index] = e.nativeEvent.layout.y;
                  recut();
                }}
              >
              {(() => {
              numbered = numbers[from + index];
              // Same run as BlockList's own - the miniature draws the
              // same indent the editor does, or a card would show a
              // flatter page than the one it stands for.
              if (item.exitsToggle) indented = false;
              const rowIndented = indented;
              if (item.type === 'toggle') indented = true;
              // Text rows drawn directly, the rest through BlockRow's
              // preview - the same look either way (see PagePreviewRow).
              if (isLightRow(item)) {
                return (
                  <PagePreviewRow
                    key={item.id}
                    item={item}
                    indented={rowIndented}
                    listNumber={item.type === 'numbered' ? numbered : undefined}
                    paperColor={paperColor}
                    searchHighlight={highlight}
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
                  searchHighlight={highlight}
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
                  paperColor={paperColor}
                  preview
                />
              );
              })()}
              </View>
            ))}
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
    </PreviewDepthContext.Provider>
  );
}

// A wall of these re-renders whenever the list's own state moves; a page
// only changes when its document does.
// The note's own face reaches the rows drawn inside (utils/noteFont): `font` is the document's `noteFont`.
function DocumentPageMiniatureInFont({ font, fontMode, ...rest }: React.ComponentProps<typeof DocumentPageMiniature> & { font?: unknown; fontMode?: unknown }) {
  const r = resolveNoteFont(font, fontMode);
  return (
    <NoteFontContext.Provider value={r.font}>
      <BlocksFontContext.Provider value={r.blocks}>
        <DocumentPageMiniature {...rest} />
      </BlocksFontContext.Provider>
    </NoteFontContext.Provider>
  );
}
export default memo(DocumentPageMiniatureInFont);

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
  // Where a search result's page skips down to its match - in the page's
  // own points, so it scales with the rest of the picture.
  skipped: {
    fontSize: 40,
    lineHeight: 44,
    paddingHorizontal: 20,
    marginTop: -8,
  },
});
