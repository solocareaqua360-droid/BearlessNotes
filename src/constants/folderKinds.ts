// EVERY KIND OF THING A FOLDER CAN HOLD (the unified-explorer plan, stage 1a,
// 2026-10-10). A universal folder lists all of them in its `types`, so every
// database's explorer shows it and an item of any kind hangs on the one tag.
// Custom-database rows are left out on purpose: each database is its own
// vocabulary (see isTagAllowedForKind).
export const ALL_FOLDER_KINDS = ['document', 'board', 'flashcard', 'photo', 'file', 'link-video', 'link-geo', 'link-other', 'shortcut'];
