import { useEffect, useState } from 'react';
import { navigationRef } from '../navigationRef';
import { tabKey, turnIntoStart, useStartFront } from './desktopTabs';

// THE LEVEL ABOVE a screen in the main pane - where its back arrow goes when
// the screen has no step of its own left (see innerBack). By what the
// screen IS, not by the order things were opened in: going back by history
// jumped into whatever tab was open before, which on a laptop with tabs
// means nothing. Null at the top of a section - no arrow.
const UP: Record<string, () => void> = {};
const go = (name: string, params?: unknown) => () =>
  (navigationRef.navigate as (n: string, p?: unknown) => void)(name, params);

const TO_HOME = go('Tabs', { screen: 'Документи' });
const TO_DATABASES = go('Tabs', { screen: 'Більше' });

// A note is left for the start page, in its own tab's place - where the
// next thing opened (from it, or «Відкрити в новій вкладці») goes.
// The note itself is closed under it (the main pane goes home), or what it
// portals above the page - its project badge - showed through. The start
// page comes up once that move is over: the tabs row hides the start page
// on every move of the navigator, and runs first.
const TO_START = () => {
  const id = (navigationRef.getCurrentRoute()?.params as { documentId?: string } | undefined)?.documentId;
  if (!id) {
    TO_HOME();
    return;
  }
  const off = navigationRef.addListener('state', () => {
    off();
    turnIntoStart(tabKey('note', id));
  });
  TO_HOME();
};
UP.Editor = TO_START;
UP.EditorModal = TO_START;
UP.Settings = TO_HOME;
UP.Search = TO_HOME;
UP.DocumentsCopy = TO_HOME;
UP.Board = go('Tabs', { screen: 'Дошки', params: { screen: 'BoardsList' } });
UP.BoardCopy = go('BoardsCopy');
for (const name of ['CustomDatabase', 'Links', 'Photos', 'Files', 'Stickers', 'Flashcards', 'Tasks', 'Tags', 'Groups', 'Diary', 'Chat', 'TagItems', 'BoardsCopy']) {
  UP[name] = TO_DATABASES;
}

export function useMainPaneUp(): (() => void) | null {
  const [route, setRoute] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setRoute(navigationRef.isReady() ? (navigationRef.getCurrentRoute()?.name ?? null) : null);
    read();
    return navigationRef.addListener('state', read);
  }, []);
  // The start page stands over the screen: nothing of it to leave.
  const startFront = useStartFront();
  if (startFront) return null;
  return route ? (UP[route] ?? null) : null;
}
