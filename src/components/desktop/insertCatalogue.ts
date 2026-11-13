import { BLOCK_ACTIONS, type BlockAction } from '../blockActions';

// THE MAC'S INSERT CATALOGUE (2026-10-20): what the right panel's «Вставити» tiles and the «/» popup offer, cut into
// shelves. BLOCK_ACTIONS is the phone's list of block types; the phone's insert panel also has what that list lacks -
// the heading LEVELS (Заголовок 2/3/4), the three rules (суцільна, пунктирна, жирна) and the URL link - so those are
// tiles of their own here. Phone-only things are left out on purpose: the camera (a browser has no camera shot, only
// a file picker, which «Зображення» already is) and the document scanner.
export type TileKey = BlockAction | 'h2' | 'h3' | 'h4' | 'rule-solid' | 'rule-dotted' | 'rule-bold' | 'link' | 'mention';

const EXTRA: Record<string, string> = {
  h2: 'Заголовок 2',
  h3: 'Заголовок 3',
  h4: 'Заголовок 4',
  'rule-solid': 'Лінія',
  'rule-dotted': 'Пунктирна лінія',
  'rule-bold': 'Жирна лінія',
  link: 'Посилання',
  // «@» in a sentence: the word that links to another note (typed «@» opens the same picker).
  mention: 'Слово-посилання на нотатку',
};

export const TILE_LABELS: Record<string, string> = {
  ...Object.fromEntries(BLOCK_ACTIONS.map((a) => [a.key, a.label])),
  ...EXTRA,
};

export const INSERT_GROUPS: { title: string; keys: TileKey[] }[] = [
  { title: 'Текст', keys: ['h2', 'h3', 'h4', 'bulleted', 'numbered', 'checkbox', 'toggle', 'code'] },
  { title: 'Лінії', keys: ['rule-solid', 'rule-dotted', 'rule-bold'] },
  { title: 'Медіа', keys: ['image', 'file', 'sketch'] },
  { title: 'Таблиці й посилання', keys: ['table', 'link', 'mention', 'document', 'existing'] },
];
