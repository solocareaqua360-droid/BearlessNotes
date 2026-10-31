// A FOLDER'S NAME AS TYPED -> ITS PATH (the user, 2026-10-24: «слеш дає вкладеність» - decided in the first days, and broken since by
// four prompts that turned «/» into «-», so a pasted «Служба/РЕР/інформація» became ONE folder with dashes in its name). Each
// segment trimmed, empty ones dropped: «Служба / РЕР//ПК» is «Служба/РЕР/ПК». The folders in the middle need no tags of their own
// (the explorer draws a way to deeper folders by itself).
export function folderPathFromName(name: string): string {
  return name
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/');
}

// A TYPED PATH, WHERE IT LANDS (2026-10-30, the user: «слеш не працює ... створилась нова гілка», and «навіть якщо ти бачиш шлях,
// тобі все одно треба його перенабрати»). A name typed while standing in a folder is that folder's child - but a path typed out
// IN FULL, from its root, is what it says: «розробка/mindEva/нова» typed inside «розробка/mindEva» used to become
// «розробка/mindEva/розробка/mindEva/нова», a second branch that only looked like the first. So the typed path is taken as
// absolute when it starts with the folder you are in or with one of its parents (a whole segment, then «/»), or with «/».
export function resolveFolderPath(typed: string, base: string | null | undefined): string {
  const clean = folderPathFromName(typed);
  if (!clean) return '';
  if (!base || typed.trim().startsWith('/')) return clean;
  if (clean === base) return clean;
  const parts = base.split('/');
  for (let i = 1; i <= parts.length; i += 1) {
    if (clean.startsWith(`${parts.slice(0, i).join('/')}/`)) return clean;
  }
  return `${base}/${clean}`;
}
