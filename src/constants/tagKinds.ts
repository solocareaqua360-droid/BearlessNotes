// Every kind of object a folder (a tag, in the code) can hold, and the
// word each one wears on screen - one list, where TagManageScreen and
// TagPicker each kept a copy that had already fallen behind (a folder of
// flashcards read "flashcard"). A custom database mints its own kind,
// `customRow:${id}`, named after the database.
export const TAG_KIND_CHOICES: { kind: string; label: string }[] = [
  { kind: 'document', label: 'Документи' },
  { kind: 'photo', label: 'Фото' },
  { kind: 'file', label: 'Файли' },
  { kind: 'link-other', label: 'Посилання' },
  { kind: 'link-video', label: 'YouTube / TikTok' },
  { kind: 'link-geo', label: 'Геоточки' },
  { kind: 'board', label: 'Дошки' },
  { kind: 'flashcard', label: 'Картки' },
];

export const TAG_KIND_LABELS: Record<string, string> = Object.fromEntries(
  TAG_KIND_CHOICES.map((choice) => [choice.kind, choice.label])
);
