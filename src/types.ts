export interface Block {
  id: string;
  text: string;
}

export interface DocumentItem {
  id: string;
  title: string;
  updatedAt: number;
  blocks?: Block[];
}
