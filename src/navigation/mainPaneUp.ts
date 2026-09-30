import { useEffect, useState } from 'react';
import { navigationRef } from '../navigationRef';

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

UP.Editor = TO_HOME;
UP.EditorModal = TO_HOME;
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
  return route ? (UP[route] ?? null) : null;
}
