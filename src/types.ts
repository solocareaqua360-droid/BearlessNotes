export type BlockType = 'paragraph' | 'bulleted' | 'numbered' | 'checkbox' | 'divider' | 'image';

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
}

export interface DocumentItem {
  id: string;
  title: string;
  updatedAt: number;
  blocks?: Block[];
}
