export type BlockType = 'paragraph' | 'bulleted' | 'numbered' | 'checkbox' | 'divider' | 'image' | 'file';

export interface Block {
  id: string;
  text: string;
  // Absent/undefined means 'paragraph' - keeps every block already saved in
  // Firestore before block types existed valid without a migration.
  type?: BlockType;
  checked?: boolean; // 'checkbox' blocks only
  imageUri?: string; // 'image' blocks only
  // 'image' blocks only. Absent means 'contain' (real proportions, pale
  // gray letterboxing) - keeps images saved before this setting existed
  // displaying the same as they already did.
  imageFit?: 'contain' | 'cover';
  // 'file' blocks only. The URI is a local device path (the file picker's
  // own cache copy) - there's no cloud upload yet, so a file block only
  // opens correctly on the device it was attached from.
  fileUri?: string;
  fileName?: string;
  mimeType?: string;
  // 'checkbox' blocks only - standard properties of the "справа" object
  // type (hardcoded, unlike a future user-defined type's properties).
  projectId?: string; // references a doc in the 'projects' collection
  // YYYY-MM-DD of the day it was marked "Сьогодні" - a mismatch with the
  // current date means "not today" without needing an active daily reset.
  todayMarkedDate?: string;
}

export interface Project {
  id: string;
  name: string;
  color: string;
}

export interface DocumentItem {
  id: string;
  title: string;
  updatedAt: number;
  blocks?: Block[];
}
