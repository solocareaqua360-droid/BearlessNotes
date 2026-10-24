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
