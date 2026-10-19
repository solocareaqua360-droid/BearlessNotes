import { useEffect, useState } from 'react';
import { navigationRef } from '../navigationRef';
import { StackActions } from '@react-navigation/native';
import { FEATURES } from '../features';
import { LEAN_WINDOW } from '../utils/leanWindow';
import { tabKey, turnIntoStart, useStartFront } from './desktopTabs';
import { useWorkspace } from './workspace';
import { targetFromRoute } from './paneTargetInfo';
import { flashDatabase } from './databaseFlash';
import { morph } from '../utils/morph';
import { goHome, placeNow } from '../components/DesktopTabs';

// THE LEVEL ABOVE a screen in the main pane - where its back arrow goes when
// the screen has no step of its own left (see innerBack). By what the
// screen IS, not by the order things were opened in: going back by history
// jumped into whatever tab was open before, which on a laptop with tabs
// means nothing. Null at the top of a section - no arrow.
const UP: Record<string, () => void> = {};
const go = (name: string, params?: unknown) => () =>
  (navigationRef.navigate as (n: string, p?: unknown) => void)(name, params);

// FRAME B (2026-10-19): the home is the explorer, under everything - back DOWN to it, never a copy on top (the old
// «Документи» tab is not drawn in frame B, so going there showed an empty column).
const toExplorer = () => {
  const state = navigationRef.getRootState();
  const at = state?.routes?.findIndex((r) => r.name === 'Explorer') ?? -1;
  if (at >= 0) navigationRef.dispatch(StackActions.popTo('Explorer'));
  else (navigationRef.navigate as (n: string) => void)('Explorer');
};
const TO_HOME = FEATURES.macFrameB ? toExplorer : go('Tabs', { screen: 'Документи' });
const TO_DATABASES = go('Tabs', { screen: 'Більше' });

// A note is left for the start page, in its own tab's place - where the
// next thing opened (from it, or «Відкрити в новій вкладці») goes.
// The note itself is closed under it (the main pane goes home), or what it
// portals above the page - its project badge - showed through. The start
// page comes up once that move is over: the tabs row hides the start page
// on every move of the navigator, and runs first.
function startInPlaceOf(key: string) {
  const off = navigationRef.addListener('state', () => {
    off();
    turnIntoStart(key);
  });
  TO_HOME();
}
const TO_START = () => {
  const id = (navigationRef.getCurrentRoute()?.params as { documentId?: string } | undefined)?.documentId;
  if (!id) {
    TO_HOME();
    return;
  }
  // The sheet shrinks back into its card on the start page (utils/morph).
  morph(`note:${id}`, () => startInPlaceOf(tabKey('note', id)));
};

// A database is left the same way - the databases list never stands in the
// main pane (the user's, 2026-09-30) - and the databases panel opens beside
// it with the database just left lit for a moment (databaseFlash).
type Opener = { openAtRoot: (spec: { kind: 'databases' }) => void } | null;
const leaveDatabase = (workspace: Opener) => () => {
  if (FEATURES.macFrameB) {
    toExplorer();
    return;
  }
  const route = navigationRef.getCurrentRoute();
  const target = route ? targetFromRoute(route.name, route.params as Record<string, unknown> | undefined) : null;
  const place = placeNow();
  startInPlaceOf(place && place.kind !== 'home' ? tabKey(place.kind, place.ref) : '');
  if (!workspace) return;
  // At its list, not at a database a click inside it had opened.
  workspace.openAtRoot({ kind: 'databases' });
  if (target) flashDatabase(target);
};
const DATABASE_ROUTES = new Set(['CustomDatabase', 'Links', 'Photos', 'Files', 'Stickers', 'Flashcards', 'Tasks', 'Tags', 'Groups', 'Explorer', 'Diary', 'Chat', 'TagItems', 'BoardsCopy']);
UP.Editor = TO_START;
UP.EditorModal = TO_START;
// A file in its tab is left the same way as a note.
UP.FileView = () => {
  const id = (navigationRef.getCurrentRoute()?.params as { fileId?: string } | undefined)?.fileId;
  if (id) startInPlaceOf(tabKey('file', id));
  else TO_HOME();
};
// Home is the start page (see DesktopTabs' goHome).
UP.Settings = () => goHome();
UP.Search = () => goHome();
UP.DocumentsCopy = () => goHome();
UP.Board = FEATURES.macFrameB ? toExplorer : go('Tabs', { screen: 'Дошки', params: { screen: 'BoardsList' } });
// Frame B: a board is left for the home (the explorer), not for the boards list - that list is one base among the
// sidebar's, and a board opened from the calendar's day would land in it.
UP.BoardCopy = FEATURES.macFrameB ? toExplorer : go('BoardsCopy');
for (const name of ['CustomDatabase', 'Links', 'Photos', 'Files', 'Stickers', 'Flashcards', 'Tasks', 'Tags', 'Groups', 'Explorer', 'Diary', 'Chat', 'TagItems', 'BoardsCopy']) {
  UP[name] = TO_DATABASES;
}

// FRAME B: the sections (what the sidebar switches between) stand level with each other - nothing to go up to. What
// was opened from inside one goes back ONE level, to where it came from, never to the home.
const FRAME_B_SECTIONS = new Set(['Explorer', 'Thoughts', 'Tasks', 'Tabs', 'Календар', 'Більше', 'Документи']);
const backOneLevel = () => {
  // A note's own window: its one step down is out of the window (utils/leanWindow).
  if (LEAN_WINDOW && (navigationRef.getRootState()?.routes?.length ?? 0) <= 2 && typeof window !== 'undefined') {
    window.close();
    return;
  }
  if (navigationRef.canGoBack()) navigationRef.goBack();
  else toExplorer();
};

export function useMainPaneUp(): (() => void) | null {
  const [route, setRoute] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setRoute(navigationRef.isReady() ? (navigationRef.getCurrentRoute()?.name ?? null) : null);
    read();
    return navigationRef.addListener('state', read);
  }, []);
  // The start page stands over the screen: nothing of it to leave.
  const startFront = useStartFront();
  const workspace = useWorkspace();
  if (startFront) return null;
  if (FEATURES.macFrameB) {
    if (!route || FRAME_B_SECTIONS.has(route)) return null;
    const state = navigationRef.getRootState();
    const depth = state?.routes?.length ?? 0;
    // A base opened from the sidebar stands on the explorer (depth 2): it is a section too, no «up».
    if (depth <= 2 && DATABASE_ROUTES.has(route)) return null;
    return backOneLevel;
  }
  if (route && DATABASE_ROUTES.has(route)) return leaveDatabase(workspace);
  return route ? (UP[route] ?? null) : null;
}
