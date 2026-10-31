// «ЯРЛИК-ПРОГРАМА» (the one plan's part 2, 2026-10-11): the explorer is the Finder, a base's
// own screen is the program, and a shortcut is a file in a folder that starts the program
// already set to what you meant - a table, one project's tasks, a collection of links. Opening
// is plain navigation to the existing screen with its params; closing it (the way back) lands
// in the same folder of the explorer. `source` and `params` are free so more kinds can join.
import { requestFolder } from '../navigation/folderArrival';

export type ShortcutSource = 'database' | 'tasks' | 'links';

export type ShortcutParams = {
  databaseId?: string;
  openViewId?: string;
  projectId?: string;
  category?: 'video' | 'geo' | 'other';
  folderPath?: string;
};

export const SHORTCUT_ICON: Record<ShortcutSource, string> = {
  database: 'grid-outline',
  tasks: 'checkbox-outline',
  links: 'link-outline',
};

export function openShortcut(navigation: unknown, raw: Record<string, unknown>): boolean {
  const nav = navigation as { navigate: (name: string, params?: object) => void };
  const source = raw.source as ShortcutSource | undefined;
  const p = (raw.params ?? {}) as ShortcutParams;
  if (source === 'database' && p.databaseId) {
    nav.navigate('CustomDatabase', { databaseId: p.databaseId, ...(p.openViewId ? { openViewId: p.openViewId } : {}) });
    return true;
  }
  if (source === 'tasks') {
    nav.navigate('Tasks', p.projectId ? { openProjectId: p.projectId } : undefined);
    return true;
  }
  if (source === 'links') {
    const category = p.category ?? 'other';
    // Standing in that folder when it arrives (folderArrival, as the start desk does).
    if (p.folderPath) requestFolder(`link-${category}`, p.folderPath, 'screen');
    nav.navigate('Links', { category });
    return true;
  }
  return false;
}
