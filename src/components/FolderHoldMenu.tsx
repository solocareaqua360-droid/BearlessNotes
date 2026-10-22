import { useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from './icons/Ionicons';
import SoftIcon from './SoftIcon';
import HoldMenu, { type HoldAction } from './HoldMenu';
import { useSoft } from '../theme/soft';
import { hapticPickUp } from '../utils/haptics';
import { deleteField } from '../firestore';
import { SOFT_MEDIUM, SOFT_SEMIBOLD } from '../utils/fonts';
import type { ExplorerFolder, useExplorer } from '../hooks/useExplorer';
import { FEATURES } from '../features';
import { useTags } from '../hooks/useTags';
import { FolderCardSheet, FolderProjectsSheet } from './FolderStyleSheets';
import type { Tag } from '../types';
import { ask, notify } from './surfaces/Ask';

// A folder HELD in a database's explorer - the chat's gesture, as on the
// folders' own screen (HoldMenu): everything else goes out of focus, the
// folder is lifted sharp over the blur and its menu opens beside it.
// "Треба ефект затискання, як в чаті, для папок" (2026-10-02) - it was a
// plain question window in the middle of the screen. One hook for every
// database, since the five menus were the same menu.

type Explorer = Pick<
  ReturnType<typeof useExplorer<{ id: string }>>,
  'setFolderPrompt' | 'pickDestination' | 'renameFolder' | 'deleteFolder' | 'tagForFolder'
> &
  Partial<Pick<ReturnType<typeof useExplorer<{ id: string }>>, 'baseOnly' | 'realPathOf'>>;
type Rect = { x: number; y: number; width: number; height: number };

const nameOf = (path: string) => path.split('/').pop() ?? path;

export function useFolderHold({
  explorer,
  itemIcon,
  extras,
  faceOf,
}: {
  explorer: Explorer;
  // What this database's records are - the icon beside the first number.
  itemIcon: string;
  // Rows only this database has, after «Перейменувати».
  extras?: (folder: ExplorerFolder) => HoldAction[];
  // A collection lifts as itself (CollectionCard), not as a folder row - the same face its screen draws.
  faceOf?: (folder: ExplorerFolder) => { node: ReactNode; wide: boolean } | null;
}) {
  const { width: windowW } = useWindowDimensions();
  const [held, setHeld] = useState<{ folder: ExplorerFolder; rect: Rect } | null>(null);
  const { setTagFields, tags: allTags, moveBranch, placeInExplorer, removeFromExplorer } = useTags();
  // The two folder windows (projects, card look), each for one folder.
  const [projectsFor, setProjectsFor] = useState<Tag | null>(null);
  const [cardFor, setCardFor] = useState<Tag | null>(null);

  // Where the held row stands on screen - measured on the row's OWN node.
  // The press event's currentTarget was measured first, and by the time a
  // long press fires that is no longer the row: the folder rose at the
  // left edge, wider than itself, from a tile in the right column
  // (2026-10-02). A right click brings no node - lifted near the top.
  const nodes = useRef(new Map<string, View>());
  const refFor = (path: string) => (node: View | null) => {
    if (node) nodes.current.set(path, node);
    else nodes.current.delete(path);
  };
  const open = (folder: ExplorerFolder, node?: View | null) => {
    hapticPickUp();
    const fallback = { x: 16, y: 120, width: Math.min(windowW - 32, 360), height: 64 };
    const target = node ?? nodes.current.get(folder.fullPath);
    if (target) {
      target.measureInWindow((x, y, width, height) =>
        setHeld({ folder, rect: width > 0 ? { x, y, width, height } : fallback })
      );
    } else setHeld({ folder, rect: fallback });
  };

  // A BASE'S COLLECTION (photos / YouTube / geo) held: «У провідник…» puts it in the explorer - at its root or in
  // one of its folders - and it stays in the base all the same (2026-10-15: «затискаю … і там немає пункту помістити
  // в провідник»). A collection inside another goes with the one it is in, so only a top one has the rows.
  function collectionRows(ownPath: string, realPathOf: (own: string) => string): HoldAction[] {
    if (ownPath.includes('/')) return [];
    const real = realPathOf(ownPath);
    const own = allTags.find((t) => t.path === real);
    const placed = !!own?.inExplorer;
    const rows: HoldAction[] = [
      {
        key: 'to-explorer',
        label: placed ? 'Інше місце в провіднику…' : 'У провідник…',
        icon: 'folder-open-outline',
        onPress: async () => {
          const folders = Array.from(
            new Set(
              allTags
                .filter((t) => !t.baseOnly || t.inExplorer)
                .flatMap((t) => {
                  const parts = t.path.split('/');
                  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
                })
            )
          )
            .filter((p) => p !== real && !p.startsWith(`${real}/`))
            .sort((x, y) => x.localeCompare(y));
          const choice = await ask({
            title: `«${ownPath}» у провідник`,
            actions: [
              { id: '/', label: 'У корінь провідника', icon: 'home-outline' },
              ...folders.map((p) => ({ id: `p:${p}`, label: p.split('/').join(' › '), icon: 'folder-outline' as const })),
            ],
          });
          if (choice === 'cancel') return;
          const next = choice === '/' ? ownPath : `${String(choice).slice(2)}/${ownPath}`;
          if (next !== real && allTags.some((t) => t.path === next || t.path.startsWith(`${next}/`))) {
            notify('Таке вже є', `У цьому місці провідника вже є «${ownPath}».`);
            return;
          }
          try {
            // Marked first, on the path the tags have NOW: placeInExplorer looks them up by path, and right after a
            // move this screen's tags still carry the old one - the mark found nothing and the collection stayed out.
            await placeInExplorer([real]);
            if (next !== real) await moveBranch(real, next);
            notify('У провіднику', choice === '/' ? `«${ownPath}» тепер і в корені провідника.` : `«${ownPath}» тепер і в «${nameOf(String(choice).slice(2))}».`);
          } catch (e) {
            notify('Не вдалося', (e as Error).message);
          }
        },
      },
    ];
    if (placed) {
      rows.push({
        key: 'from-explorer',
        label: 'Прибрати з провідника',
        icon: 'eye-off-outline',
        onPress: async () => {
          await removeFromExplorer([real]).catch(() => {});
          notify('Прибрано з провідника', `«${ownPath}» лишилась тут, у базі.`);
        },
      });
    }
    return rows;
  }

  const actions: HoldAction[] = held
    ? [
        {
          key: 'rename',
          label: 'Перейменувати',
          icon: 'pencil-outline',
          onPress: () => explorer.setFolderPrompt({ mode: 'rename', path: held.folder.fullPath }),
        },
        ...(FEATURES.projectFolders
          ? [
              {
                key: 'projects',
                label: 'Проєкти…',
                icon: 'folder-open-outline',
                // A folder that is only a path segment has no tag to carry
                // the fields - made here, kept like any folder made on purpose.
                onPress: async () => setProjectsFor(await explorer.tagForFolder(held.folder.fullPath)),
              },
              {
                key: 'cardlook',
                label: 'Вигляд картки',
                icon: 'image-outline',
                onPress: async () => setCardFor(await explorer.tagForFolder(held.folder.fullPath)),
              },
            ]
          : []),
        ...(extras?.(held.folder) ?? []),
        ...(explorer.baseOnly && explorer.realPathOf ? collectionRows(held.folder.fullPath, explorer.realPathOf) : []),
        {
          key: 'move',
          label: 'Перемістити в…',
          icon: 'arrow-forward-outline',
          onPress: async () => {
            const path = held.folder.fullPath;
            const dest = await explorer.pickDestination(`Перемістити «${nameOf(path)}» в…`, path);
            if (dest === 'cancel') return;
            await explorer.renameFolder(path, dest ? `${dest}/${nameOf(path)}` : nameOf(path));
          },
        },
        {
          key: 'delete',
          label: 'Видалити',
          icon: 'trash-outline',
          tone: 'danger',
          // Asks on its own (useExplorer.deleteFolder), saying where the
          // contents go.
          onPress: () => explorer.deleteFolder(held.folder.fullPath),
        },
      ]
    : [];

  // A face has no ground of its own (the grid's cover floats on the page); lifted, it sits on a card, or the lift's
  // shadow drew a grey slab around it.
  const liftedFace = held ? faceOf?.(held.folder)?.node ?? null : null;
  const S = useSoft();
  const menu = (
    <>
      <HoldMenu
        anchor={held?.rect ?? null}
        card={held ? (liftedFace ? <View style={{ backgroundColor: S.card, padding: 8, borderRadius: 20 }}>{liftedFace}</View> : <FolderFace folder={held.folder} itemIcon={itemIcon} height={held.rect.height} />) : null}
        actions={actions}
        onClose={() => setHeld(null)}
      />
      {FEATURES.projectFolders && (
        <>
          <FolderProjectsSheet
            visible={projectsFor !== null}
            folderName={projectsFor ? nameOf(projectsFor.path) : ''}
            selected={projectsFor?.groupIds ?? []}
            selectedRoots={projectsFor?.projectRoots ?? []}
            onClose={() => setProjectsFor(null)}
            onSave={(groupIds, projectRoots) => {
              if (projectsFor) setTagFields(projectsFor.id, { groupIds, projectRoots });
              setProjectsFor(null);
            }}
          />
          <FolderCardSheet
            visible={cardFor !== null}
            folderName={cardFor ? nameOf(cardFor.path) : ''}
            card={cardFor?.card}
            collection={!!explorer.baseOnly && FEATURES.collectionCards}
            onClose={() => setCardFor(null)}
            onSave={(card) => {
              // «Скинути» (null) takes the whole look off the folder.
              if (cardFor) setTagFields(cardFor.id, { card: card ?? (deleteField() as never) });
              setCardFor(null);
            }}
          />
        </>
      )}
    </>
  );
  return { open, refFor, menu };
}

// The folder as it stands in the list, drawn again over the blur.
function FolderFace({ folder, itemIcon, height }: { folder: ExplorerFolder; itemIcon: string; height: number }): ReactNode {
  const S = useSoft();
  return (
    <View style={[styles.face, { height, backgroundColor: S.card }]}>
      <View style={[styles.seat, { backgroundColor: S.fill }]}>
        {folder.tag?.icon ? (
          <Ionicons name={folder.tag.icon as never} size={17} color={folder.tag.color ?? S.ink2} />
        ) : (
          <SoftIcon name="folder" size={19} color={folder.tag?.color ?? S.ink2} strokeWidth={1.9} />
        )}
      </View>
      <View style={styles.body}>
        <Text style={[styles.name, { color: S.ink }]} numberOfLines={1}>
          {folder.name}
        </Text>
        <View style={styles.meta}>
          <Ionicons name={itemIcon as never} size={12} color={S.ink3} />
          <Text style={[styles.count, { color: S.ink3 }]}>{folder.docs}</Text>
          {folder.subfolders > 0 && (
            <>
              <SoftIcon name="folder" size={12} color={S.ink3} strokeWidth={2.2} />
              <Text style={[styles.count, { color: S.ink3 }]}>{folder.subfolders}</Text>
            </>
          )}
        </View>
      </View>
      <SoftIcon name="forward" size={16} color={S.ink3} />
    </View>
  );
}

const styles = StyleSheet.create({
  face: {
    borderRadius: 20,
    paddingLeft: 12,
    paddingRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  seat: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  name: {
    fontSize: 15,
    fontFamily: SOFT_SEMIBOLD,
    letterSpacing: -0.2,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  count: {
    fontSize: 12.5,
    fontFamily: SOFT_MEDIUM,
    fontVariant: ['tabular-nums'],
    marginRight: 6,
  },
});
