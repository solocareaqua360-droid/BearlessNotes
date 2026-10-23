import { memo, useRef } from 'react';
import CornerGlow, { glowColorFor, TypeBadge } from './CornerGlow';
import { FEATURES } from '../features';
import { Image, StyleSheet, Text, View } from 'react-native';
import HoldPressable from './HoldPressable';
import TurningPressable from './TurningPressable';
import { plainPreview } from '../utils/richText';
import { markHeld } from '../utils/heldNode';
import { morphCardRef } from '../utils/morph';
import { boardZoomKey } from '../utils/boardZoom';
import { Ionicons } from './icons/Ionicons';
import { FileGridCell, FileRow, LinkGridCell, LinkRow, PhotoCell, PhotoRow } from './ItemCards';
import DocumentCard from './DocumentCard';
import { PAGE_HEIGHT_RATIO } from './folderCardMetrics';
import AttachmentImage from './AttachmentImage';
import TagChips from './TagChips';
import { formatAddedOn } from '../utils/documentPreview';
import BoardPreviewImage from './BoardPreviewImage';
import DocumentPageMiniature from './DocumentPageMiniature';
import BoardMiniMap from './BoardMiniMap';
import { CoverGradientView, defaultCoverFor } from '../theme/covers';
import { readBoardPart } from '../utils/boardStorage';
import type { BoardCard, BoardColumn } from '../types';
import { useSoft } from '../theme/soft';
import { extractPreview } from '../utils/documentPreview';
import { SOFT_MEDIUM, SOFT_SEMIBOLD } from '../utils/fonts';
import type { FolderItem } from '../hooks/useAllFolderItems';
import { SHORTCUT_ICON, type ShortcutSource } from '../utils/shortcuts';
import type { Block, Tag } from '../types';

// A RECORD IN A FOLDER, drawn as the card its own database draws it (the user,
// 2026-10-10: "всі файли відображались своїми картками, а не стрічками без
// превʼю") - a photo as its picture, a note as its page, a link with its
// image, a file with its preview, a board as its map. Built from the record
// as stored (FolderItem.raw), the way the databases' own lists build theirs.

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' ? v : undefined);

export type FolderCardMode = 'list' | 'grid' | 'wide';

// A TILE (the explorer's «Сітка» and «Широкі картки»): the picture of the thing on top - a note
// as its real page (DocumentPageMiniature: «every card is the page»), a photo, a link's image, a
// board's map - then its name and a line. `width` is the tile's own width; the picture is a
// fixed share of it (taller on a grid tile, a wide strip on a wide card).
function FolderTile({
  item,
  tags,
  width,
  wide,
  onPress,
  onLongPress,
}: {
  item: FolderItem;
  tags: Tag[];
  width: number;
  wide: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const S = useSoft();
  const raw = (item.raw ?? {}) as Record<string, unknown>;
  // A wide card lays the picture BESIDE the text (about two fifths of the card); a tile puts it above.
  const picW = wide ? Math.round(width * 0.42) : width;
  const picH = wide ? Math.round(width * 0.34) : Math.round(width * 0.78);
  const when = num(raw.updatedAt) ?? num(raw.createdAt);
  let picture: React.ReactNode;
  let sub = '';
  if (item.kind === 'document') {
    picture = (
      <DocumentPageMiniature
        title={item.title}
        blocks={(raw.blocks as Block[]) ?? []}
        tagIds={[]}
        tags={[]}
        project={null}
        coverImageUri={str(raw.coverImageUri)}
        coverDriveFileId={str(raw.coverDriveFileId)}
        coverFrame={raw.coverFrame as never}
        width={picW}
        height={picH}
      />
    );
    sub = when ? formatAddedOn(when, true) : 'Нотатка';
  } else if (item.kind === 'photo' && str(raw.imageUri)) {
    picture = <AttachmentImage uri={raw.imageUri as string} driveFileId={str(raw.driveFileId)} style={{ width: '100%', height: '100%' }} resizeMode="cover" />;
    sub = when ? formatAddedOn(when, true) : 'Фото';
  } else if (item.kind === 'link' && str(raw.imageUrl)) {
    picture = <Image source={{ uri: raw.imageUrl as string }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />;
    sub = [str(raw.siteName), when ? formatAddedOn(when, true) : ''].filter(Boolean).join(' · ');
  } else if (item.kind === 'board') {
    const cardsMap = raw.cards as Record<string, unknown> | unknown[] | undefined;
    const count = Array.isArray(cardsMap) ? cardsMap.length : cardsMap ? Object.keys(cardsMap).length : 0;
    picture = (
      <BoardPreviewImage
        boardId={item.docId}
        uri={str(raw.previewImageUri)}
        driveFileId={str(raw.previewDriveFileId)}
        fallback={<Ionicons name="easel-outline" size={30} color={S.ink3} />}
      />
    );
    sub = `Дошка · ${count} карток`;
  } else {
    const icon =
      item.kind === 'file'
        ? 'document-outline'
        : item.kind === 'flashcard'
          ? 'albums-outline'
          : item.kind === 'shortcut'
            ? SHORTCUT_ICON[raw.source as ShortcutSource] ?? 'rocket-outline'
            : item.kind === 'link'
              ? 'link-outline'
              : 'grid-outline';
    picture = <Ionicons name={icon as never} size={32} color={S.ink3} />;
    sub =
      item.kind === 'file'
        ? (str(raw.fileName)?.split('.').pop() ?? 'файл').toUpperCase()
        : item.kind === 'flashcard'
          ? 'Картка'
          : item.kind === 'shortcut'
            ? 'Ярлик'
            : item.kind === 'link'
              ? [str(raw.siteName), 'Посилання'].filter(Boolean)[0] ?? 'Посилання'
              : 'Запис';
  }
  const blurb = item.kind === 'document' ? extractPreview((raw.blocks as Block[]) ?? [], undefined, undefined, undefined).previewText : '';
  const own = tags.filter((t) => item.tagIds.includes(t.id));
  return (
    <HoldPressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={[tileStyles.tile, wide && { flexDirection: 'row' }, { width, backgroundColor: S.card, boxShadow: S.shadow }]}
    >
      <View style={[tileStyles.pic, { width: picW, height: picH, backgroundColor: S.fill }]}>{picture}</View>
      <View style={[tileStyles.text, wide && { flex: 1, minWidth: 0 }]}>
        <Text style={[styles.title, { color: S.ink }]} numberOfLines={wide ? 3 : 2}>{item.title}</Text>
        {wide && !!blurb && <Text style={[styles.sub, { color: S.ink3 }]} numberOfLines={3}>{blurb}</Text>}
        {!!sub && <Text style={[styles.sub, { color: S.ink3 }]} numberOfLines={1}>{sub}</Text>}
        {wide && own.length > 0 && <TagChips tags={own} onPress={() => {}} glass max={2} />}
      </View>
    </HoldPressable>
  );
}

const boardTileStyles = StyleSheet.create({
  tile: { borderRadius: 18, overflow: 'hidden' },
  map: { width: '100%', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 12, paddingVertical: 10, gap: 2 },
});

const tileStyles = StyleSheet.create({
  tile: { borderRadius: 22, overflow: 'hidden' },
  pic: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  text: { padding: 12, gap: 2 },
});

// A card that turns over when it opens (utils/flipOpen) and still says "this one" when held.
function TurningHold({ cardKey, onLongPress, ...rest }: React.ComponentProps<typeof TurningPressable>) {
  const node = useRef<View | null>(null);
  return (
    <TurningPressable
      ref={node}
      cardKey={cardKey}
      {...rest}
      onLongPress={
        onLongPress
          ? (e) => {
              markHeld(node.current);
              onLongPress(e);
            }
          : undefined
      }
    />
  );
}

function FolderItemCardInner({
  item,
  tags,
  onPress,
  onLongPress,
  mode = 'list',
  tileWidth = 160,
  columns = 2,
  isSelectMode,
  isSelected,
  onToggleSelect,
  noCount,
}: {
  item: FolderItem;
  tags: Tag[];
  // A small copy of the thing (a leaf on a folder's card) keeps its picture and name and drops the count line - the
  // count belongs to the original card (the user, 2026-10-13).
  noCount?: boolean;
  // The press event goes through: a card that opens by turning over is measured from it.
  onPress: (event?: import('react-native').GestureResponderEvent) => void;
  onLongPress?: () => void;
  mode?: FolderCardMode;
  tileWidth?: number;
  // How many cells stand across a line (the bases' own grid cells size themselves by it).
  columns?: number;
  isSelectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
}) {
  const S = useSoft();
  const raw = (item.raw ?? {}) as Record<string, unknown>;
  // `tags` is the whole list; a card shows only ITS OWN (it showed every tag
  // there is, 12 chips on one photo - 2026-10-10).
  const own = tags.filter((t) => item.tagIds.includes(t.id));
  const common = { tags: own, onPress, onLongPress };
  const pick = { isSelectMode, isSelected, onToggleSelect };

  // THE GRID and the WIDE CARDS are the bases' OWN cards (the user, 2026-10-11: my own tiles
  // «виглядають дуже жахливо» - every base's grid looks right on its own, so use theirs):
  // a photo's PhotoCell, a file's and a link's grid cell, a note's DocumentCard. The wide
  // view is a note's wide card; everything else has no wide card in its base and keeps its row.
  if (mode !== 'list') {
    if (item.kind === 'photo' && str(raw.imageUri) && mode === 'grid') {
      return (
        <PhotoCell
          columns={columns}
          photo={{
            id: item.docId,
            imageUri: raw.imageUri as string,
            driveFileId: str(raw.driveFileId),
            documentIds: Object.keys((raw.usedInDocuments as Record<string, boolean>) ?? {}),
            tagIds: item.tagIds,
            title: str(raw.title),
            createdAt: num(raw.createdAt),
            updatedAt: num(raw.updatedAt),
          }}
          {...common}
          {...pick}
        />
      );
    }
    if (item.kind === 'file' && mode === 'grid') {
      return (
        <FileGridCell
          natural
          columns={columns}
          file={{
            id: item.docId,
            fileName: str(raw.fileName) ?? item.title,
            fileUri: str(raw.fileUri),
            title: str(raw.title),
            tagIds: item.tagIds,
            createdAt: num(raw.createdAt),
            updatedAt: num(raw.updatedAt),
          }}
          {...common}
          {...pick}
        />
      );
    }
    if (item.kind === 'link' && mode === 'grid') {
      return (
        <LinkGridCell
          columns={columns}
          link={{
            id: item.docId,
            url: str(raw.url) ?? '',
            title: str(raw.title),
            siteName: str(raw.siteName),
            imageUrl: str(raw.imageUrl),
            tagIds: item.tagIds,
            createdAt: num(raw.createdAt),
            updatedAt: num(raw.updatedAt),
            geoLat: num(raw.geoLat),
            geoLng: num(raw.geoLng),
          }}
          {...common}
          {...pick}
        />
      );
    }
    if (item.kind === 'document') {
      const blocks = (raw.blocks as Block[]) ?? [];
      const preview = extractPreview(blocks, str(raw.coverImageUri), 600, str(raw.coverDriveFileId));
      return (
        <DocumentCard
          id={item.docId}
          morphRef={morphCardRef(`note:${item.docId}`)}
          title={item.title}
          updatedAt={num(raw.updatedAt) ?? 0}
          imageUri={preview.imageUri}
          coverGradient={str(raw.coverGradient)}
          imageDriveFileId={preview.imageDriveFileId}
          imageUris={preview.imageUris}
          imageDriveFileIds={preview.imageDriveFileIds}
          previewText={preview.previewText}
          previewTail={preview.previewTail}
          blocks={blocks}
          checklistItems={preview.checklistItems}
          onPress={onPress}
          onLongPress={onLongPress}
          isSelectMode={isSelectMode}
          isSelected={isSelected}
          onToggleSelect={onToggleSelect}
          layout="grid"
          gridWidth={mode === 'wide' ? undefined : tileWidth}
          wide={mode === 'wide'}
          pageHeight={mode === 'grid' ? Math.round(tileWidth * PAGE_HEIGHT_RATIO) : undefined}
          page={{
            tagIds: item.tagIds,
            tags: own,
            coverImageUri: str(raw.coverImageUri),
            coverDriveFileId: str(raw.coverDriveFileId),
            coverFrame: raw.coverFrame as never,
            paperColorEnabled: !!raw.paperColorEnabled,
          }}
          project={null}
          soft={S}
        />
      );
    }
    // A BOARD as the Boards base draws its tile: its own map on the muted cover, name, count.
    if (item.kind === 'board' && mode === 'grid') {
      const bcards = readBoardPart<BoardCard>(raw.cards);
      const bcolumns = readBoardPart<BoardColumn>(raw.columns);
      const mapHeight = Math.round(tileWidth * 0.72);
      return (
        <HoldPressable onPress={onPress} onLongPress={onLongPress} style={[boardTileStyles.tile, { width: tileWidth, backgroundColor: S.card, boxShadow: S.shadow }]}>
          <View ref={morphCardRef(boardZoomKey(item.docId))} collapsable={false} style={[boardTileStyles.map, { height: mapHeight, backgroundColor: S.fill }]}>
            <BoardPreviewImage
              boardId={item.docId}
              uri={str(raw.previewImageUri)}
              driveFileId={str(raw.previewDriveFileId)}
              fallback={
                <>
                  <CoverGradientView gradient={defaultCoverFor(item.docId)} style={[StyleSheet.absoluteFill, { opacity: 0.55 }]} />
                  {bcards.length > 0 || bcolumns.length > 0 ? (
                    <BoardMiniMap cards={bcards} columns={bcolumns} width={tileWidth} height={mapHeight} showText />
                  ) : (
                    <Ionicons name="apps-outline" size={24} color={S.ink3} />
                  )}
                </>
              }
            />
          </View>
          <View style={boardTileStyles.body}>
            <Text style={[styles.title, { color: S.ink }]} numberOfLines={1}>{item.title}</Text>
            {!noCount && <Text style={[styles.sub, { color: S.ink3 }]}>{`${bcards.length} ${bcards.length === 1 ? 'картка' : 'карток'}`}</Text>}
          </View>
        </HoldPressable>
      );
    }
    // A FLASHCARD as the Cards base draws its cell: the first picture, the whole term, the date.
    if (item.kind === 'flashcard' && mode === 'grid') {
      const imgs = (raw.images as { uri: string; driveFileId?: string }[]) ?? [];
      const first = imgs[0];
      const when = num(raw.createdAt) ?? num(raw.updatedAt);
      return (
        <TurningHold cardKey={item.docId} onPress={onPress} onLongPress={onLongPress} style={[boardTileStyles.tile, { width: tileWidth, backgroundColor: S.card, boxShadow: S.shadow }]}>
          {first && !FEATURES.itemLook && (
            <View style={[boardTileStyles.map, { height: Math.round(tileWidth * 0.62), backgroundColor: S.fill }]}>
              <AttachmentImage uri={first.uri} driveFileId={first.driveFileId} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
              {imgs.length > 1 && (
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{imgs.length}</Text>
                </View>
              )}
            </View>
          )}
          <View style={boardTileStyles.body}>
            <Text style={[styles.title, { color: S.ink }, FEATURES.itemLook && { fontSize: 17 }]} numberOfLines={raw.short ? 3 : undefined}>{plainPreview(item.title)}</Text>
            {FEATURES.itemLook && !!str(raw.explanation) && (
              <Text style={[styles.sub, { color: S.ink2, fontSize: 13, lineHeight: 18, marginTop: 4 }]} numberOfLines={4}>{plainPreview(String(raw.explanation))}</Text>
            )}
            {!!when && <Text style={[styles.sub, { color: S.ink3, marginTop: FEATURES.itemLook ? 8 : 0 }]}>{(FEATURES.itemLook ? 'Картка · ' : '') + formatAddedOn(when, true)}</Text>}
          </View>
        </TurningHold>
      );
    }
    // Shortcuts and the rest: a quiet tile of ours.
    if (mode === 'grid') {
      return <FolderTile item={item} tags={tags} width={tileWidth} wide={false} onPress={onPress} onLongPress={onLongPress} />;
    }
    // Wide, not a note: the base's row, as in the list.
  }

  if (item.kind === 'photo' && str(raw.imageUri)) {
    return (
      <PhotoRow
        photo={{
          id: item.docId,
          imageUri: raw.imageUri as string,
          driveFileId: str(raw.driveFileId),
          documentIds: Object.keys((raw.usedInDocuments as Record<string, boolean>) ?? {}),
          tagIds: item.tagIds,
          title: str(raw.title),
          createdAt: num(raw.createdAt),
          updatedAt: num(raw.updatedAt),
        }}
        {...common}
      />
    );
  }
  if (item.kind === 'file') {
    return (
      <FileRow
        file={{
          id: item.docId,
          fileName: str(raw.fileName) ?? item.title,
          fileUri: str(raw.fileUri),
          title: str(raw.title),
          tagIds: item.tagIds,
          createdAt: num(raw.createdAt),
          updatedAt: num(raw.updatedAt),
        }}
        {...common}
      />
    );
  }
  if (item.kind === 'link') {
    return (
      <LinkRow
        link={{
          id: item.docId,
          url: str(raw.url) ?? '',
          title: str(raw.title),
          siteName: str(raw.siteName),
          imageUrl: str(raw.imageUrl),
          tagIds: item.tagIds,
          createdAt: num(raw.createdAt),
          updatedAt: num(raw.updatedAt),
          geoLat: num(raw.geoLat),
          geoLng: num(raw.geoLng),
        }}
        {...common}
      />
    );
  }
  if (item.kind === 'document') {
    // A note drawn as the same ROW every other kind has (the user, 2026-10-11: the notes wore
    // the old Documents card): a picture or a quiet tile on the left, name, a line of text, date.
    const blocks = (raw.blocks as Block[]) ?? [];
    const preview = extractPreview(blocks, str(raw.coverImageUri), undefined, str(raw.coverDriveFileId));
    const when = num(raw.updatedAt) ?? num(raw.createdAt);
    return (
      <HoldPressable onPress={onPress} onLongPress={onLongPress} style={[styles.row, { backgroundColor: S.card, boxShadow: S.shadow, alignItems: 'flex-start' }]}>
        <View style={[styles.noteThumb, { backgroundColor: S.fill }]}>
          <DocumentPageMiniature
            title={item.title}
            blocks={blocks}
            tagIds={[]}
            tags={[]}
            project={null}
            coverImageUri={str(raw.coverImageUri)}
            coverDriveFileId={str(raw.coverDriveFileId)}
        coverFrame={raw.coverFrame as never}
            width={104}
            height={78}
          />
        </View>
        <View style={styles.body}>
          <Text style={[styles.title, { color: S.ink }]} numberOfLines={2}>{item.title}</Text>
          {!!preview.previewText && (
            <Text style={[styles.sub, { color: S.ink3 }]} numberOfLines={2}>{preview.previewText}</Text>
          )}
          {!!when && <Text style={[styles.sub, { color: S.ink3 }]}>{formatAddedOn(when, true)}</Text>}
          {own.length > 0 && <TagChips tags={own} onPress={() => {}} glass max={2} />}
        </View>
      </HoldPressable>
    );
  }
  if (item.kind === 'board') {
    // A board as the Boards base draws its row: the board's own map on its muted cover.
    const cards = readBoardPart<BoardCard>(raw.cards);
    const columns = readBoardPart<BoardColumn>(raw.columns);
    return (
      <HoldPressable onPress={onPress} onLongPress={onLongPress} style={[styles.row, { backgroundColor: S.card, boxShadow: S.shadow, alignItems: 'center' }]}>
        <View style={[styles.boardThumb, { backgroundColor: S.fill }]}>
          <BoardPreviewImage
            boardId={item.docId}
            uri={str(raw.previewImageUri)}
            driveFileId={str(raw.previewDriveFileId)}
            fallback={
              <>
                <CoverGradientView gradient={defaultCoverFor(item.docId)} style={[StyleSheet.absoluteFill, { opacity: 0.55 }]} />
                {cards.length > 0 || columns.length > 0 ? (
                  <BoardMiniMap cards={cards} columns={columns} width={FEATURES.itemLook ? 104 : 52} height={FEATURES.itemLook ? 78 : 52} />
                ) : (
                  <Ionicons name="apps-outline" size={20} color={S.ink3} />
                )}
              </>
            }
          />
        </View>
        <View style={styles.body}>
          <Text style={[styles.title, { color: S.ink }]} numberOfLines={2}>{item.title}</Text>
          {!noCount && <Text style={[styles.sub, { color: S.ink3 }]}>{`${cards.length} ${cards.length === 1 ? 'картка' : 'карток'}`}</Text>}
          {own.length > 0 && <TagChips tags={own} onPress={() => {}} glass max={2} />}
        </View>
      </HoldPressable>
    );
  }
  if (item.kind === 'shortcut') {
    const icon = (SHORTCUT_ICON[raw.source as ShortcutSource] ?? 'rocket-outline') as never;
    return (
      <HoldPressable onPress={onPress} onLongPress={onLongPress} style={[styles.row, { backgroundColor: S.card, boxShadow: S.shadow }]}>
        <View style={[styles.thumb, { backgroundColor: S.fill }]}>
          <Ionicons name={icon} size={26} color={S.ink2} />
        </View>
        <View style={styles.body}>
          <Text style={[styles.title, { color: S.ink }]} numberOfLines={2}>{item.title}</Text>
          <Text style={[styles.sub, { color: S.ink3 }]} numberOfLines={1}>{`Ярлик${str(raw.subtitle) ? ` · ${str(raw.subtitle)}` : ''}`}</Text>
        </View>
        <Ionicons name={'arrow-forward-outline' as never} size={18} color={S.ink3} />
      </HoldPressable>
    );
  }
  if (item.kind === 'flashcard') {
    // A card as the Cards base draws its row: the first picture in a window on the left (with
    // how many there are), the whole term, the date.
    const images = (raw.images as { uri: string; driveFileId?: string }[]) ?? [];
    const first = images[0];
    const when = num(raw.createdAt) ?? num(raw.updatedAt);
    return (
      <TurningHold cardKey={item.docId} onPress={onPress} onLongPress={onLongPress} style={[styles.row, { backgroundColor: S.card, boxShadow: S.shadow, alignItems: 'flex-start' }]}>
        {FEATURES.itemLook ? null : first ? (
          <View style={[styles.noteThumb, { backgroundColor: S.fill }]}>
            <AttachmentImage uri={first.uri} driveFileId={first.driveFileId} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            {images.length > 1 && (
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{images.length}</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={[styles.thumb, { backgroundColor: S.fill }]}>
            <Ionicons name={'albums-outline' as never} size={24} color={S.ink3} />
          </View>
        )}
        <View style={styles.body}>
          <Text style={[styles.title, { color: S.ink }]} numberOfLines={raw.short ? 3 : undefined}>{plainPreview(item.title)}</Text>
          {FEATURES.itemLook && !!str(raw.explanation) && (
            <Text style={[styles.sub, { color: S.ink2, fontSize: 13, lineHeight: 18 }]} numberOfLines={2}>{plainPreview(String(raw.explanation))}</Text>
          )}
          {!!when && <Text style={[styles.sub, { color: S.ink3 }]}>{(FEATURES.itemLook ? 'Картка · ' : '') + formatAddedOn(when, true)}</Text>}
          {own.length > 0 && <TagChips tags={own} onPress={() => {}} glass max={2} />}
        </View>
      </TurningHold>
    );
  }
  // A record of a personal database: its name and what it is.
  return (
    <HoldPressable onPress={onPress} onLongPress={onLongPress} style={[styles.row, { backgroundColor: S.card, boxShadow: S.shadow }]}>
      <View style={[styles.thumb, { backgroundColor: S.fill }]}>
        <Ionicons name={'grid-outline' as never} size={24} color={S.ink3} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { color: S.ink }]} numberOfLines={2}>{item.title}</Text>
        <Text style={[styles.sub, { color: S.ink3 }]}>Запис</Text>
      </View>
    </HoldPressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 22, ...(FEATURES.itemLook ? { minHeight: 98 } : null) },
  boardThumb: FEATURES.itemLook
    ? { width: 104, height: 78, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }
    : { width: 52, height: 52, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  countBadge: { position: 'absolute', right: 4, bottom: 4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  countBadgeText: { color: '#fff', fontSize: 11, fontFamily: SOFT_SEMIBOLD },
  noteThumb: { width: 104, height: 78, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  thumb: FEATURES.itemLook
    ? { width: 104, height: 78, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }
    : { width: 84, height: 62, borderRadius: 14, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 15, fontFamily: SOFT_SEMIBOLD },
  sub: { fontSize: 12, fontFamily: SOFT_MEDIUM },
});

// The type's corner glow around whichever card was drawn (features.itemGlow) - one place, not one per card kind.
function FolderItemCardGlowed(props: React.ComponentProps<typeof FolderItemCardInner>) {
  const inner = <FolderItemCardInner {...props} />;
  if (FEATURES.typeBadge) return <TypeBadge item={props.item}>{inner}</TypeBadge>;
  if (!FEATURES.itemGlow) return inner;
  return <CornerGlow color={glowColorFor(props.item)}>{inner}</CornerGlow>;
}

export default memo(FolderItemCardGlowed);
