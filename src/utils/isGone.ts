// «ЦЯ РІЧ ВИДАЛЕНА» - one question for every reader of boards and flashcards (the
// single explorer's bin for them, 2026-10-11). A record is gone when it carries
// the bin stamp `deletedAt` (what photos, files, links and now boards and cards
// get) or the old `trashed` flag of boards/stickers. Readers filter with this,
// so a thing in the bin vanishes from lists, counts, search and projects at once.
export function isGone(data: object | null | undefined): boolean {
  const d = data as { deletedAt?: unknown; trashed?: unknown } | null | undefined;
  return !!d && (!!d.deletedAt || !!d.trashed);
}
