// Native: a TextInput is handed plain text only, so there is nothing to convert (see pasteBlocks.ts).
export function installPasteMarkdown(): () => void {
  return () => {};
}
