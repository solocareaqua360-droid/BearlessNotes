// POINTS FROM A TABLE, SHOWN AND KEPT NOWHERE (2026-11-16, the user: «статистичні геоточки, які потрібні раз на місяць...
// альтернатива excel - не займає місця в firebase»): their colour on both maps, and how a knot of them knows it is one.
export const TABLE_POINT_COLOR = '#4A72B0';
// Clusters count the table's points among theirs, so a knot of nothing else can wear the table's colour.
export const TABLE_CLUSTER_PROPERTIES = { tables: ['+', ['case', ['get', 'table'], 1, 0]] } as const;

// HANDED FROM A TABLE VIEWER TO THE MAP (2026-11-17, the user: pick cells in a table, «показати на мапі»): the viewer leaves the
// points and the name of the file here and opens the geo base; the base picks them up once and shows them as it shows an imported
// table (blue, kept nowhere).
import { useSyncExternalStore } from 'react';
import type { GeoImportRow } from './geoImport';

export type PendingTable = { name: string; rows: Extract<GeoImportRow, { kind: 'point' }>[] };
let pendingTable: PendingTable | null = null;
const pendingListeners = new Set<() => void>();

export function showTableOnMap(name: string, rows: PendingTable['rows']) {
  pendingTable = { name, rows };
  pendingListeners.forEach((l) => l());
}
export function takePendingTable() {
  pendingTable = null;
  pendingListeners.forEach((l) => l());
}
export function usePendingTable(): PendingTable | null {
  return useSyncExternalStore(
    (listener) => {
      pendingListeners.add(listener);
      return () => {
        pendingListeners.delete(listener);
      };
    },
    () => pendingTable
  );
}
