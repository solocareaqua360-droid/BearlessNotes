// THE BASE LEFT BY A DESK (2026-10-31, the user's: «чому кулька "Бази" не відкриває базу, з якої я не виходив»): a base is a screen pushed over
// the desks, so a desk bead pressed from it pops it. The place is remembered here, and the next press of the «Бази» bead from another desk
// opens it again where the person was (the view, filters and sort of a base are kept per base anyway) instead of the list. Used once.
export type RememberedBase = { name: string; params?: object };

// The screens that are bases (a note, a board or a file is not: the desk the person pressed goes on from there).
const BASE_ROUTES = new Set(['CustomDatabase', 'Links', 'Photos', 'Files', 'Stickers', 'Flashcards', 'Tasks', 'Tags', 'Groups', 'Diary', 'Chat', 'TagItems', 'BoardsCopy', 'DocumentsCopy']);

let remembered: RememberedBase | null = null;

export function rememberBase(route: { name: string; params?: object } | undefined): void {
  remembered = route && BASE_ROUTES.has(route.name) ? { name: route.name, params: route.params } : null;
}
export function forgetBase(): void {
  remembered = null;
}
export function takeBase(): RememberedBase | null {
  const base = remembered;
  remembered = null;
  return base;
}
export function hasBase(): boolean {
  return remembered !== null;
}
