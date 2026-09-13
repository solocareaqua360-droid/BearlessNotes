import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from '../firestore';
import { db } from '../firebase';
import { CustomDatabase } from '../types';
import { defaultColorFor, tileColorsDoc } from '../constants/databaseTiles';

// What both drawings of the database menu need: the colours the user has
// picked for the built-in tiles, and the databases they have made
// themselves. One hook so the drawer's grid and the Databases screen can
// never show a different set.
export function useDatabaseTiles() {
  const [tileColors, setTileColors] = useState<Record<string, string>>({});
  const [customDatabases, setCustomDatabases] = useState<CustomDatabase[]>([]);

  useEffect(() => {
    return onSnapshot(tileColorsDoc, (snapshot) => {
      setTileColors((snapshot.data() as Record<string, string> | undefined) ?? {});
    });
  }, []);

  useEffect(() => {
    return onSnapshot(query(collection(db, 'customDatabases'), orderBy('name')), (snapshot) => {
      setCustomDatabases(
        snapshot.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            name: data.name,
            icon: data.icon,
            color: data.color,
            fields: data.fields ?? [],
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
          };
        })
      );
    });
  }, []);

  function colorFor(key: string): string {
    return tileColors[key] ?? defaultColorFor(key);
  }

  return { colorFor, customDatabases };
}
