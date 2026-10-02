import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, useWindowDimensions, type GestureResponderEvent } from 'react-native';
import { Ionicons } from './icons/Ionicons';
import SoftIcon from './SoftIcon';
import HoldMenu, { type HoldAction } from './HoldMenu';
import { useSoft } from '../theme/soft';
import { SOFT_MEDIUM, SOFT_SEMIBOLD } from '../utils/fonts';
import type { ExplorerFolder, useExplorer } from '../hooks/useExplorer';

// A folder HELD in a database's explorer - the chat's gesture, as on the
// folders' own screen (HoldMenu): everything else goes out of focus, the
// folder is lifted sharp over the blur and its menu opens beside it.
// "Треба ефект затискання, як в чаті, для папок" (2026-10-02) - it was a
// plain question window in the middle of the screen. One hook for every
// database, since the five menus were the same menu.

type Explorer = Pick<
  ReturnType<typeof useExplorer<{ id: string }>>,
  'setFolderPrompt' | 'pickDestination' | 'renameFolder' | 'deleteFolder'
>;
type Rect = { x: number; y: number; width: number; height: number };

const nameOf = (path: string) => path.split('/').pop() ?? path;

export function useFolderHold({
  explorer,
  itemIcon,
  extras,
}: {
  explorer: Explorer;
  // What this database's records are - the icon beside the first number.
  itemIcon: string;
  // Rows only this database has, after «Перейменувати».
  extras?: (folder: ExplorerFolder) => HoldAction[];
}) {
  const { width: windowW } = useWindowDimensions();
  const [held, setHeld] = useState<{ folder: ExplorerFolder; rect: Rect } | null>(null);

  // Where the held row stands on screen. A right click brings no event
  // to measure - the folder is then lifted near the top.
  const open = (folder: ExplorerFolder, e?: GestureResponderEvent) => {
    const fallback = { x: 16, y: 120, width: Math.min(windowW - 32, 360), height: 64 };
    const target = e?.currentTarget as unknown as
      | { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void }
      | undefined;
    if (target?.measureInWindow) {
      target.measureInWindow((x, y, width, height) =>
        setHeld({ folder, rect: width > 0 ? { x, y, width, height } : fallback })
      );
    } else setHeld({ folder, rect: fallback });
  };

  const actions: HoldAction[] = held
    ? [
        {
          key: 'rename',
          label: 'Перейменувати',
          icon: 'pencil-outline',
          onPress: () => explorer.setFolderPrompt({ mode: 'rename', path: held.folder.fullPath }),
        },
        ...(extras?.(held.folder) ?? []),
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

  const menu = (
    <HoldMenu
      anchor={held?.rect ?? null}
      card={held ? <FolderFace folder={held.folder} itemIcon={itemIcon} height={held.rect.height} /> : null}
      actions={actions}
      onClose={() => setHeld(null)}
    />
  );
  return { open, menu };
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
