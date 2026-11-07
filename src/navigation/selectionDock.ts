import type { DockAction } from './navDock';

// THE ONE SELECTION DOCK (the shared set of the survey of 2026-10-10, built 2026-10-12): every
// screen that lets you choose things - the five bases through DatabaseChrome, the Documents
// screen, the single explorer - builds the dock from here, so the buttons, their words, their
// icons and their ORDER are the same everywhere. A screen passes only what it can do; a row it
// does not pass is not there. Rows that make sense for one thing only («Перейменувати») are
// passed by the caller only when exactly one is chosen.
export type SelectionDockRows = {
  onExit: () => void;
  // «Вибрати всі / Зняти всі»: the number on screen, how many of them are chosen.
  all?: { shown: number; chosen: number; onAll: () => void; onNone: () => void };
  // How many are chosen at all (the action rows appear from one).
  count: number;
  move?: () => void;
  rename?: () => void;
  tag?: () => void;
  // A base of collections names the same row for what it does there: «У підбірку» / «У плейліст».
  tagLabel?: string;
  tagIcon?: string;
  group?: () => void;
  // «У провідник»: put the chosen things into folders of the explorer (a base's own command).
  explorer?: () => void;
  board?: () => void;
  copyToNote?: () => void;
  copyObject?: () => void;
  share?: () => void;
  link?: () => void;
  wide?: { onPress: () => void; on: boolean };
  remove?: () => void;
  // Another word for «Видалити» when the thing is only taken out of a place (a reference).
  removeLabel?: string;
};

export function selectionDock(r: SelectionDockRows): DockAction[] {
  const out: DockAction[] = [{ key: 'cancel', icon: 'close-outline', label: 'Вийти', onPress: r.onExit }];
  if (r.all && r.all.shown > 0) {
    out.push(
      r.all.chosen >= r.all.shown
        ? { key: 'none', icon: 'remove-circle-outline', label: 'Зняти всі', onPress: r.all.onNone }
        : { key: 'all', icon: 'checkmark-done-outline', label: 'Вибрати всі', onPress: r.all.onAll }
    );
  }
  if (r.count > 0) {
    if (r.move) out.push({ key: 'move', icon: 'arrow-forward-outline', label: 'Перемістити', onPress: r.move });
    if (r.rename) out.push({ key: 'rename', icon: 'pencil-outline', label: 'Перейменувати', onPress: r.rename });
    if (r.tag) out.push({ key: 'tag', icon: r.tagIcon ?? 'pricetag-outline', label: r.tagLabel ?? 'Папки', onPress: r.tag });
    if (r.explorer) out.push({ key: 'explorer', icon: 'folder-open-outline', label: 'У провідник', onPress: r.explorer });
    if (r.group) out.push({ key: 'group', icon: 'folder-outline', label: 'Проєкт', onPress: r.group });
    if (r.board) out.push({ key: 'board', icon: 'easel-outline', label: 'На дошку', onPress: r.board });
    if (r.copyToNote) out.push({ key: 'copy', icon: 'document-text-outline', label: 'У нотатку', onPress: r.copyToNote });
    if (r.copyObject) out.push({ key: 'copyObject', icon: 'clipboard-outline', label: 'Копія', onPress: r.copyObject });
    if (r.share) out.push({ key: 'share', icon: 'share-social-outline', label: 'Поділитись', onPress: r.share });
    if (r.link) out.push({ key: 'address', icon: 'link-outline', label: 'Посилання', onPress: r.link });
    if (r.wide) out.push({ key: 'wide', icon: r.wide.on ? 'contract-outline' : 'tablet-landscape-outline', label: 'Ширина', onPress: r.wide.onPress });
    if (r.remove) out.push({ key: 'delete', icon: 'trash-outline', label: r.removeLabel ?? 'Видалити', onPress: r.remove });
  }
  return out;
}
