// WHAT A PANE CAN HOLD: the databases a wide screen opens beside the board
// (the databases screen's own pane) and the laptop's side panels both
// hold one of these. The tabs (documents, boards) are whole screens with
// their own two-pane logic, `inPane` tells them not to split again.
export type PaneTarget =
  | { kind: 'custom'; databaseId: string }
  | { kind: 'links'; category: 'video' | 'geo' | 'other' }
  | { kind: 'documents' }
  | { kind: 'boards' }
  // The three registries - the diary, the groups and the tags - open in
  // the pane like every other database now. They are not lists of records
  // and carry no chrome of their own; see PlainScreenShell.
  | { kind: 'route'; route: 'Photos' | 'Files' | 'Stickers' | 'Flashcards' | 'Tasks' | 'Tags' | 'Groups' | 'Diary' | 'Chat' };

export const sameTarget = (a: PaneTarget, b: PaneTarget) => JSON.stringify(a) === JSON.stringify(b);
