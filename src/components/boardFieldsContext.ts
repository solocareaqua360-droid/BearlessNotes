import { createContext, useContext } from 'react';

// WHICH FIELDS a database's cards show ON A BOARD, per database - chosen in
// that database's window (BoardDatabaseWindow, «Поля»), and kept apart from
// the database's own views: what a table needs is not what a board needs
// ("мені доводиться повертатися в таблицю, налаштовувати там інший вигляд,
// щоб воно змінилося в дошці"). databaseId -> the field ids to HIDE.
// Nothing here means the database's own choice, as before.
export const BoardFieldsContext = createContext<Record<string, string[]>>({});

export function useBoardHiddenFields(databaseId: string | undefined): string[] | undefined {
  const all = useContext(BoardFieldsContext);
  return databaseId ? all[databaseId] : undefined;
}
