import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { importMarkdown } from './markdownFile';

// «ІМПОРТ З ФАЙЛУ» (2026-11-17, the user: «в трьох крапках додати пункт імпорт, хоча б Markdown і TXT»): a text file from the
// phone's storage (or the laptop's disk) becomes a note. The first «# heading» of a .md is its title, else the file's name;
// the body is read as a paste is (utils/markdownFile). Several files at once, each its own note.
const TEXT_FILE = /\.(md|markdown|txt|text)$/i;

export type ImportedNote = { id: string; name: string };

export async function pickAndImportTextNotes(): Promise<{ made: ImportedNote[]; skipped: string[] }> {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: true });
  if (result.canceled || result.assets.length === 0) return { made: [], skipped: [] };
  const made: ImportedNote[] = [];
  const skipped: string[] = [];
  for (const asset of result.assets) {
    if (!TEXT_FILE.test(asset.name)) {
      skipped.push(asset.name);
      continue;
    }
    const text =
      Platform.OS === 'web'
        ? await (await fetch(asset.uri)).text()
        : await LegacyFileSystem.readAsStringAsync(asset.uri, { encoding: 'utf8' });
    made.push({ id: await importMarkdown(text, asset.name), name: asset.name });
  }
  return { made, skipped };
}
