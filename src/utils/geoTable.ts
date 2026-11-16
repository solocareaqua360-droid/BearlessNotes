// POINTS FROM A TABLE, SHOWN AND KEPT NOWHERE (2026-11-16, the user: «статистичні геоточки, які потрібні раз на місяць...
// альтернатива excel - не займає місця в firebase»): their colour on both maps, and how a knot of them knows it is one.
export const TABLE_POINT_COLOR = '#4A72B0';
// Clusters count the table's points among theirs, so a knot of nothing else can wear the table's colour.
export const TABLE_CLUSTER_PROPERTIES = { tables: ['+', ['case', ['get', 'table'], 1, 0]] } as const;
