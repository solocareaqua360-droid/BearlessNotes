export type BlockType = 'paragraph' | 'bulleted' | 'checkbox' | 'divider' | 'image';

export interface Block {
  id: string;
  text: string;
  // Absent/undefined means 'paragraph' - keeps every block already saved in
  // Firestore before block types existed valid without a migration.
  type?: BlockType;
  checked?: boolean; // 'checkbox' blocks only
  imageUri?: string; // 'image' blocks only
}

export interface DocumentItem {
  id: string;
  title: string;
  updatedAt: number;
  blocks?: Block[];
}
