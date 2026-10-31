import { useCallback, useEffect, useState } from 'react';
import { onSnapshot } from '../firestore';
import { ownedQuery } from '../utils/owned';
import { CustomDatabase } from '../types';
import { defaultColorFor, tileColorsDoc, tileIconsDoc } from '../constants/databaseTiles';
import { listenError } from '../utils/listenError';

// What both drawings of the database menu need: the colours the user has
// picked for the built-in tiles, and the databases they have made
// themselves. One hook so the drawer's grid and the Databases screen can
// never show a different set.
export function useDatabaseTiles() {
  const [tileColors, setTileColors] = useState<Record<string, string>>({});
  const [tileIcons, setTileIcons] = useState<Record<string, string>>({});
  useEffect(() => {
    return onSnapshot(tileIconsDoc, (snapshot) => {
      setTileIcons((snapshot.data() as Record<string, string> | undefined) ?? {});
    }, listenError('useDatabaseTiles:icons'));
  }, []);
  const [customDatabases, setCustomDatabases] = useState<CustomDatabase[]>([]);

  useEffect(() => {
    return onSnapshot(tileColorsDoc, (snapshot) => {
      setTileColors((snapshot.data() as Record<string, string> | undefined) ?? {});
    }, listenError('useDatabaseTiles:useDatabaseTiles'));
  }, []);

  useEffect(() => {
    return onSnapshot(ownedQuery('customDatabases'), (snapshot) => {
      setCustomDatabases(
        snapshot.docs
          .map((d) => {
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
          .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))
      );
    }, listenError('useDatabaseTiles:customDatabases'));
  }, []);

  // Stable while the picks do not change: a fresh function each render
  // undid every memo downstream that took it (the desks' bar, rebuilt on
  // every render of the strip).
  const colorFor = useCallback((key: string): string => tileColors[key] ?? defaultColorFor(key), [tileColors]);

  // A built-in database's icon - the user's pick, or the tile's own.
  const iconFor = useCallback((key: string, fallback: string): string => tileIcons[key] ?? fallback, [tileIcons]);

  return { colorFor, iconFor, customDatabases };
}
