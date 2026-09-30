import { GRID_TILES, WIDE_TILES } from '../constants/databaseTiles';
import type { PaneTarget } from './paneTarget';
import { navigationRef } from '../navigationRef';

// What a PaneTarget is called and drawn with, off the database tiles - one
// source, so a panel's header says what the tile it came from said. A
// personal database's own name is not known here (it lives in Firestore):
// `name` stands in for it once the caller has it.
export function targetInfo(target: PaneTarget, name?: string | null): { icon: string; title: string } {
  const tiles = [...WIDE_TILES, ...GRID_TILES];
  const tile =
    target.kind === 'links'
      ? tiles.find((t) => t.linkCategory === target.category)
      : target.kind === 'documents'
        ? tiles.find((t) => t.opensDocumentsTab)
        : target.kind === 'boards'
          ? tiles.find((t) => t.opensBoardsTab)
          : target.kind === 'route'
            ? tiles.find((t) => t.route === target.route)
            : undefined;
  if (target.kind === 'custom') return { icon: 'grid-outline', title: name || 'База' };
  if (target.kind === 'boards') return { icon: 'easel-outline', title: 'Дошки' };
  return { icon: tile?.icon ?? 'apps-outline', title: tile?.label ?? 'База' };
}

// Where the main pane goes for a target - what a NEW WINDOW opens on, since
// a window is a whole app and shows it in its own main pane.
export function navigateToTarget(target: PaneTarget): void {
  if (!navigationRef.isReady()) return;
  const go = navigationRef.navigate as (name: string, params?: unknown) => void;
  if (target.kind === 'custom') go('CustomDatabase', { databaseId: target.databaseId });
  else if (target.kind === 'links') go('Links', { category: target.category });
  else if (target.kind === 'documents') go('Tabs', { screen: 'Документи' });
  else if (target.kind === 'boards') go('Tabs', { screen: 'Дошки' });
  else go(target.route);
}

// The address of a new window on a target.
export function windowUrlFor(target: PaneTarget): string {
  return `${window.location.origin}/?desktop=1&open=${encodeURIComponent(JSON.stringify(target))}`;
}

// The other direction: a screen asked for by name (what a tile's press does
// on the phone) as a target, for a panel to show inside itself. Null for
// what is not a pane's business - a note, the settings - which goes to the
// main pane.
export function targetFromRoute(name: string, params?: Record<string, unknown>): PaneTarget | null {
  switch (name) {
    case 'CustomDatabase':
      return typeof params?.databaseId === 'string' ? { kind: 'custom', databaseId: params.databaseId } : null;
    case 'Links':
      return { kind: 'links', category: (params?.category as 'video' | 'geo' | 'other') ?? 'other' };
    case 'Photos':
    case 'Files':
    case 'Stickers':
    case 'Flashcards':
    case 'Tasks':
    case 'Tags':
    case 'Groups':
    case 'Diary':
      return { kind: 'route', route: name };
    case 'DocumentsCopy':
      return { kind: 'documents' };
    case 'BoardsCopy':
      return { kind: 'boards' };
    case 'Tabs': {
      const screen = params?.screen;
      if (screen === 'Документи') return { kind: 'documents' };
      if (screen === 'Дошки') return { kind: 'boards' };
      return null;
    }
    default:
      return null;
  }
}
