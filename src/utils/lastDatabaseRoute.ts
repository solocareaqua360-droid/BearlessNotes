// Which database screen (Files/Photos/Links/Tasks) was last visited - a
// plain in-memory singleton, not persisted or reactive, since it's only
// ever read at the moment someone taps the island's "Бази даних" button
// from Документи/Календар (see FloatingIslandTabBar) and written on focus
// by each database screen (see DatabaseIslandBar's callers). Resets to
// null on a fresh app launch, in which case that button just falls back to
// the databases hub.
export type LastDatabaseRoute =
  | { name: 'Files' }
  | { name: 'Photos' }
  | { name: 'Tasks' }
  | { name: 'Links'; params: { category: 'video' | 'geo' | 'other' } };

let lastRoute: LastDatabaseRoute | null = null;

export function setLastDatabaseRoute(route: LastDatabaseRoute) {
  lastRoute = route;
}

export function getLastDatabaseRoute(): LastDatabaseRoute | null {
  return lastRoute;
}
