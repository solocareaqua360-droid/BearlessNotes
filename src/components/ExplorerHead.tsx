import { lift } from '../utils/lift';
import { cardRadius } from '../theme/scale';
import { useRef, useState, type ReactNode } from 'react';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from './icons/Ionicons';
import { ExplorerFolder } from '../hooks/useExplorer';
import { FONT_REGULAR, FONT_SEMIBOLD, SOFT_MEDIUM, SOFT_SEMIBOLD } from '../utils/fonts';
import { softCardFrame, softenStyles, useSoft, useSoftSurface, type SoftTokens } from '../theme/soft';
import { gridBasis, gridFillerCount } from './ItemCards';
import DropTint from './DropTint';

// What stands above a database's records while it is in explorer mode:
// where you are, and the folders at this level.
//
// Written inside DocumentsScreen; boards need the same rows, so it is a
// component. A folder row deliberately wears the record row's clothes -
// the same card, with the tag's icon in a frame where a record shows its
// picture - so the two read as one list rather than two.

export default function ExplorerHead({
  path,
  folders,
  onGo,
  onFolderMenu,
  // The icon beside a folder's first number - what this database's
  // records ARE (a document, a board), since that number counts them.
  itemIcon,
  // The bin, at the root, after the folders - where a file manager keeps
  // it. Absent on a database that has no bin yet.
  trash,
  columns,
  folderRef,
  faceOf,
  builtIn = [],
  look,
  gridColumns = 2,
}: {
  path: string;
  folders: ExplorerFolder[];
  onGo: (path: string) => void;
  onFolderMenu: (folder: ExplorerFolder, node?: View | null) => void;
  itemIcon: keyof typeof Ionicons.glyphMap;
  trash?: { count: number; onOpen: () => void };
  // How many folders stand across a line. One on a phone; two or three
  // on the Fold's inner screen, where a folder row - an icon, a name and
  // two small numbers - is a very long way to say very little at full
  // width. The rows are sized from this component's OWN measured width,
  // so it is right whatever list it stands in.
  columns?: number;
  // A card being carried (see useCardCarry) needs to measure a target at
  // drop time to know whether it landed on one - this hands each one's
  // node out for that, and nothing else. Folder rows register under their
  // own path; the crumbs register under the path they lead to, which is
  // what lets the second finger step back OUT of a folder mid-carry (and
  // a card be dropped straight onto a parent). Absent on a screen that
  // has not joined drag-and-drop yet.
  folderRef?: (path: string) => (node: View | null) => void;
  // A base of collections draws each of its collections by what is in it (CollectionCard) - the screen hands the face
  // over; null keeps the ordinary folder row. Faced folders stand together above the rest, so a tall face never
  // stretches a short row beside it.
  faceOf?: (folder: ExplorerFolder) => { node: ReactNode; wide: boolean } | null;
  // Built-in faces that stand FIRST among the collections, sized like them (the Photos base's «З камери»): not folders, just a card and a tap.
  builtIn?: { key: string; node: ReactNode; onPress: () => void }[];
  // THE FOLDER TAKES THE SHAPE OF THE CARDS AROUND IT (the links bases, 2026-11-16, the user: «папка не міняє свій вигляд
  // на відміну від карток посилань»): in the grid a tile of a card's width with the folder where a card has its picture,
  // in the list a whole-width card with the picture box on its left, in «Рядки» a row with the hairline under it. Absent:
  // the folder pills, as everywhere else.
  look?: 'list' | 'grid' | 'rows';
  gridColumns?: number;
}) {
  const theme = useTheme();
  const S = useSoft();
  // Soft (a database's chrome says so - see SoftSurfaceContext): the same
  // folder tiles the Documents desk has - two across, a quiet card, a
  // small tinted seat for the icon, Inter - instead of the tall glass rows
  // with an outlined box: "папки зі старим виглядом ... у всіх змінених
  // базах".
  const soft = useSoftSurface();
  const styles = softenStyles(useStyles(makeStyles), soft, softExplorer);
  const [width, setWidth] = useState(0);
  // Each row's own node, for a held folder's menu to rise exactly where
  // it stands (see FolderHoldMenu).
  const rowNodes = useRef(new Map<string, View>());
  const cols = Math.max(soft ? 2 : 1, columns ?? 1);
  // A point short of the exact share: two halves and the gap came to the
  // row's width EXACTLY, and a fraction of a point of rounding sent the
  // second folder onto a line of its own - folders stood one under another.
  const rowWidth = cols > 1 && width > 0 ? Math.floor((width - FOLDER_GAP * (cols - 1)) / cols) - 1 : undefined;

  // Nothing above the list unless there is something to put there. The
  // path used to count as something; it lives in the dock now.
  if (folders.length === 0 && !trash && builtIn.length === 0) return null;
  const faced: { folder: ExplorerFolder; face: ReactNode; wide: boolean }[] = [];
  const plain: ExplorerFolder[] = [];
  folders.forEach((folder) => {
    const got = faceOf?.(folder) ?? null;
    if (got) faced.push({ folder, face: got.node, wide: got.wide });
    else plain.push(folder);
  });
  // Faces stand two across at least (a face a whole line wide on the cover screen is a poster).
  const faceCols = Math.max(2, cols);
  const faceWidth = width > 0 ? Math.floor((width - FOLDER_GAP * (faceCols - 1)) / faceCols) - 1 : undefined;

  return (
    <View style={styles.head} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {faced.length + builtIn.length > 0 && (
        <View style={[styles.folderGrid, { alignItems: 'flex-start', marginBottom: plain.length > 0 || (!!trash && trash.count > 0 && path === '') ? FOLDER_GAP : 0 }]}>
          {builtIn.map((b) => (
            <View key={b.key} style={faceWidth !== undefined && { width: faceWidth }}>
              <Pressable {...lift()} onPress={b.onPress}>
                {b.node}
              </Pressable>
            </View>
          ))}
          {faced.map(({ folder, face, wide }) => (
            <View key={folder.fullPath} ref={folderRef?.(folder.fullPath)} collapsable={false} style={wide ? { width: '100%' } : faceWidth !== undefined && { width: faceWidth }}>
              <Pressable
                {...lift()}
                onPress={() => onGo(folder.fullPath)}
                ref={(node) => {
                  if (node) rowNodes.current.set(folder.fullPath, node);
                  else rowNodes.current.delete(folder.fullPath);
                }}
                onLongPress={() => onFolderMenu(folder, rowNodes.current.get(folder.fullPath))}
              >
                {face}
                <DropTint path={folder.fullPath} radius={20} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
      {look ? (
        <ShapedFolders
          look={look}
          gridColumns={gridColumns}
          S={S}
          entries={[
            ...plain.map((folder) => ({
              key: folder.fullPath,
              dropPath: folder.fullPath,
              name: folder.name,
              icon: (folder.tag?.icon as keyof typeof Ionicons.glyphMap) || 'folder-outline',
              color: folder.tag?.color,
              docs: folder.docs,
              subs: folder.subfolders as number | undefined,
              ref: folderRef?.(folder.fullPath),
              onPress: () => onGo(folder.fullPath),
              onLongPress: () => onFolderMenu(folder, rowNodes.current.get(folder.fullPath)),
              nodeRef: (node: View | null) => {
                if (node) rowNodes.current.set(folder.fullPath, node);
                else rowNodes.current.delete(folder.fullPath);
              },
            })),
            ...(!!trash && trash.count > 0 && path === ''
              ? [{ key: '__bin__', name: 'Кошик', icon: 'trash-outline' as const, color: undefined, docs: trash.count, subs: undefined, ref: undefined, dropPath: undefined, onPress: trash.onOpen, onLongPress: undefined, nodeRef: undefined }]
              : []),
          ]}
          itemIcon={itemIcon}
        />
      ) : (
      <View style={cols > 1 ? styles.folderGrid : styles.folderStack}>
      {plain.map((folder) => (
        <View key={folder.fullPath} ref={folderRef?.(folder.fullPath)} collapsable={false}>
          <Pressable
            {...lift()}
            style={[styles.folderRow, rowWidth !== undefined && { width: rowWidth }]}
            onPress={() => onGo(folder.fullPath)}
            ref={(node) => {
              if (node) rowNodes.current.set(folder.fullPath, node);
              else rowNodes.current.delete(folder.fullPath);
            }}
            onLongPress={() => onFolderMenu(folder, rowNodes.current.get(folder.fullPath))}
          >
            <View style={[styles.folderThumb, !soft && { borderColor: folder.tag?.color ?? theme.ink.faint }]}>
              <Ionicons
                name={(folder.tag?.icon as keyof typeof Ionicons.glyphMap) || 'folder-outline'}
                size={soft ? 20 : 26}
                color={folder.tag?.color ?? (soft ? soft.ink2 : theme.ink.muted)}
              />
            </View>
            <View style={styles.folderBody}>
              <Text style={styles.folderName} numberOfLines={1}>
                {folder.name}
              </Text>
              <View style={styles.folderMeta}>
                <Ionicons name={itemIcon} size={soft ? 13 : 14} color={soft ? soft.ink3 : theme.ink.muted} />
                <Text style={styles.folderCount}>{folder.docs}</Text>
                <Ionicons name="folder-outline" size={soft ? 13 : 14} color={soft ? soft.ink3 : theme.ink.muted} style={styles.folderMetaGap} />
                <Text style={styles.folderCount}>{folder.subfolders}</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={soft ? 16 : 18} color={soft ? soft.ink3 : theme.ink.faint} />
            <DropTint path={folder.fullPath} radius={soft ? cardRadius(20) : 14} />
          </Pressable>
        </View>
      ))}

      {!!trash && trash.count > 0 && path === '' && (
        <Pressable
          {...lift()}
            style={[styles.folderRow, styles.trashRow, rowWidth !== undefined && { width: rowWidth }]}
          onPress={trash.onOpen}
        >
          <View style={[styles.folderThumb, !soft && { borderColor: theme.ink.faint }]}>
            <Ionicons name="trash-outline" size={soft ? 20 : 26} color={soft ? soft.ink2 : theme.ink.muted} />
          </View>
          <View style={styles.folderBody}>
            <Text style={[styles.folderName, { color: soft ? soft.ink2 : theme.ink.muted }]}>Кошик</Text>
            <View style={styles.folderMeta}>
              <Ionicons name={itemIcon} size={soft ? 13 : 14} color={soft ? soft.ink3 : theme.ink.muted} />
              <Text style={styles.folderCount}>{trash.count}</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={soft ? 16 : 18} color={soft ? soft.ink3 : theme.ink.faint} />
        </Pressable>
      )}
      </View>
      )}
    </View>
  );
}

type ShapedEntry = {
  key: string;
  // The folder a carried card is over gets its tint (DropTint) - the explorer's own «куди ляже».
  dropPath?: string;
  name: string;
  icon: keyof typeof Ionicons.glyphMap;
  color?: string;
  docs: number;
  subs?: number;
  ref?: (node: View | null) => void;
  nodeRef?: (node: View | null) => void;
  onPress: () => void;
  onLongPress?: () => void;
};

// The three shapes (see `look`): the sizes are the link cards' own (ItemCards' LinkGridCell / LinkRow and
// FolderItemCard's FolderRowItem), so a folder stands among them as one of them.
function ShapedFolders({ look, gridColumns, entries, itemIcon, S }: { look: 'list' | 'grid' | 'rows'; gridColumns: number; entries: ShapedEntry[]; itemIcon: keyof typeof Ionicons.glyphMap; S: SoftTokens }) {
  if (entries.length === 0) return null;
  const meta = (e: ShapedEntry, size: number) => (
    <View style={shaped.meta}>
      <Ionicons name={itemIcon} size={size} color={S.ink3} />
      <Text style={[shaped.count, { color: S.ink3, fontSize: size - 1 }]}>{e.docs}</Text>
      {e.subs !== undefined && (
        <>
          <Ionicons name="folder-outline" size={size} color={S.ink3} style={{ marginLeft: 8 }} />
          <Text style={[shaped.count, { color: S.ink3, fontSize: size - 1 }]}>{e.subs}</Text>
        </>
      )}
    </View>
  );
  const picture = (e: ShapedEntry, size: number) => <Ionicons name={e.icon} size={size} color={e.color ?? S.ink2} />;
  if (look === 'grid') {
    return (
      <View style={shaped.grid}>
        {entries.map((e) => (
          <View key={e.key} ref={e.ref} collapsable={false} style={{ flexBasis: gridBasis(gridColumns), flexGrow: 1 }}>
            <Pressable {...lift()} ref={e.nodeRef} onPress={e.onPress} onLongPress={e.onLongPress} style={[shaped.tile, softCardFrame(S, cardRadius(16)), { backgroundColor: S.card }]}>
              <View style={[shaped.tilePic, { backgroundColor: S.fill }]}>{picture(e, 30)}</View>
              <Text style={[shaped.tileName, { color: S.ink }]} numberOfLines={2}>
                {e.name}
              </Text>
              {meta(e, 12)}
              {!!e.dropPath && <DropTint path={e.dropPath} radius={cardRadius(16)} />}
            </Pressable>
          </View>
        ))}
        {Array.from({ length: gridFillerCount(entries.length, gridColumns) }).map((_, i) => (
          <View key={`filler-${i}`} style={{ flexBasis: gridBasis(gridColumns), flexGrow: 1 }} />
        ))}
      </View>
    );
  }
  if (look === 'list') {
    return (
      <View style={shaped.stack}>
        {entries.map((e) => (
          <View key={e.key} ref={e.ref} collapsable={false}>
            <Pressable {...lift()} ref={e.nodeRef} onPress={e.onPress} onLongPress={e.onLongPress} style={[shaped.card, softCardFrame(S), { backgroundColor: S.card }]}>
              <View style={[shaped.cardPic, { backgroundColor: S.fill }]}>{picture(e, 26)}</View>
              <View style={shaped.body}>
                <Text style={[shaped.cardName, { color: S.ink }]} numberOfLines={2}>
                  {e.name}
                </Text>
                {meta(e, 13)}
              </View>
              <Ionicons name="chevron-forward" size={16} color={S.ink3} style={{ alignSelf: 'center' }} />
              {!!e.dropPath && <DropTint path={e.dropPath} radius={cardRadius(20)} />}
            </Pressable>
          </View>
        ))}
      </View>
    );
  }
  return (
    <View>
      {entries.map((e) => (
        <View key={e.key} ref={e.ref} collapsable={false}>
          <Pressable ref={e.nodeRef} onPress={e.onPress} onLongPress={e.onLongPress} style={shaped.line}>
            <View style={[shaped.linePic, { backgroundColor: S.fill, borderColor: S.line }]}>{picture(e, 20)}</View>
            <View style={shaped.body}>
              <Text style={[shaped.lineName, { color: S.ink }]} numberOfLines={1}>
                {e.name}
              </Text>
              {meta(e, 13)}
            </View>
            <Ionicons name="chevron-forward" size={16} color={S.ink3} />
            {!!e.dropPath && <DropTint path={e.dropPath} radius={12} inset={-6} />}
          </Pressable>
          <View pointerEvents="none" style={[shaped.rule, { backgroundColor: S.line }]} />
        </View>
      ))}
    </View>
  );
}

const shaped = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 12, marginBottom: 4 },
  tile: { padding: 10, gap: 4, overflow: 'hidden' },
  tilePic: { width: '100%', aspectRatio: 16 / 9, borderRadius: 10, marginBottom: 4, alignItems: 'center', justifyContent: 'center' },
  tileName: { fontSize: 13, fontFamily: SOFT_SEMIBOLD },
  stack: { gap: 10, marginBottom: 2 },
  card: { flexDirection: 'row', gap: 12, padding: 10 },
  cardPic: { width: 104, aspectRatio: 4 / 3, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardName: { fontSize: 15, fontFamily: SOFT_SEMIBOLD },
  body: { flex: 1, minWidth: 0, gap: 4, justifyContent: 'center' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 14, height: 68 },
  linePic: { width: 40, height: 49, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  lineName: { fontSize: 16, fontFamily: SOFT_SEMIBOLD },
  rule: { position: 'absolute', left: 54, right: 0, bottom: 0, height: StyleSheet.hairlineWidth },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  count: { fontFamily: SOFT_MEDIUM },
});

const FOLDER_GAP = 10;

// The soft overlay (theme/soft's softenStyles) - matched to the Documents
// desk's own soft folders (DocumentsScreen's softFolder*).
const softExplorer = (S: SoftTokens) =>
  StyleSheet.create({
    folderGrid: { gap: 12 },
    folderRow: {
      height: 64,
      gap: 10,
      paddingLeft: 12,
      paddingRight: 10,
      paddingVertical: 0,
      borderRadius: cardRadius(20),
      borderWidth: 0,
      backgroundColor: S.card,
      boxShadow: S.shadow,
    },
    trashRow: { backgroundColor: S.card },
    folderThumb: { width: 38, height: 38, borderRadius: 13, borderWidth: 0, backgroundColor: S.fill },
    folderBody: { gap: 3 },
    folderName: { fontSize: 15, fontFamily: SOFT_SEMIBOLD, letterSpacing: -0.2, color: S.ink },
    folderMetaGap: { marginLeft: 6 },
    folderCount: { fontSize: 12.5, fontFamily: SOFT_MEDIUM, fontVariant: ['tabular-nums'], color: S.ink3 },
  }) as Record<string, object>;

const makeStyles = (t: Theme) =>
  StyleSheet.create({
  head: {
    gap: 8,
    marginBottom: 8,
  },
  folderGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: FOLDER_GAP,
  },
  // One to a line: the same 8 between rows the head itself keeps, which
  // the rows lost when they moved one level down into this wrapper.
  folderStack: {
    gap: 8,
  },
  crumbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  crumbUp: {
    padding: 4,
  },
  crumbStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 8,
  },
  crumbPair: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  crumbSegment: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  crumbSegmentCurrent: {
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  crumbLabel: {
    fontSize: 15,
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.muted,
  },
  crumbLabelCurrent: {
    color: t.ink.primary,
  },
  // Glass, like every row of the app's own lists, in the record row's
  // size - the user's words: the glass stays, only the size grows.
  folderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: cardRadius(16),
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  trashRow: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  folderThumb: {
    width: 56,
    height: 56,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  folderBody: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  folderName: {
    fontSize: 18,
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.primary,
  },
  folderMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  folderMetaGap: {
    marginLeft: 10,
  },
  folderCount: {
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: t.ink.muted,
  },
  });
