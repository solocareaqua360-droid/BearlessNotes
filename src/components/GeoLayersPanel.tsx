import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from './icons/Ionicons';
import { useSoft } from '../theme/soft';
import { SOFT_MEDIUM, SOFT_SEMIBOLD } from '../utils/fonts';

// «ШАРИ» ON THE GEO MAP (2026-10-28, sketch NhS6SVqj1GGGYdsZPYwP7K, the user: «вибравши 2 папки можна побачити на мапі
// тільки те що є в обох - папка кафе і папка ужгород покажуть кафе які є в ужгороді»). A window over the dock, as wide
// as it and of the same material: the folders as a tree, each folder's points under it, a tick on a folder or on a
// single point. Nothing ticked = no filter, every point is on the map. Several folders ticked: «Усі разом» shows what
// is in any of them, «Лише спільні» only what is in all of them. A point ticked by itself is always shown.

export type LayerPoint = { id: string; title: string; folders: string[] };
export type LayerPick = { folders: string[]; points: string[]; mode: 'any' | 'all' };
export const NO_PICK: LayerPick = { folders: [], points: [], mode: 'any' };
// The points without any folder, as a folder of their own.
export const NO_FOLDER = '';

export function pickActive(pick: LayerPick): boolean {
  return pick.folders.length > 0 || pick.points.length > 0;
}

function inFolder(point: LayerPoint, folder: string): boolean {
  if (folder === NO_FOLDER) return point.folders.length === 0;
  return point.folders.some((f) => f === folder || f.startsWith(`${folder}/`));
}

// Whether a point stays on the map under this pick.
export function pointShown(point: LayerPoint, pick: LayerPick): boolean {
  if (!pickActive(pick)) return true;
  if (pick.points.includes(point.id)) return true;
  if (pick.folders.length === 0) return false;
  return pick.mode === 'all' ? pick.folders.every((f) => inFolder(point, f)) : pick.folders.some((f) => inFolder(point, f));
}

export default function GeoLayersPanel({
  folders,
  points,
  pick,
  onPick,
  onClose,
  bottom,
}: {
  // Every folder path the points can be in («Кафе», «Подорожі/Карпати»).
  folders: string[];
  points: LayerPoint[];
  pick: LayerPick;
  onPick: (next: LayerPick) => void;
  onClose: () => void;
  // Where the dock's top edge is - the window stands just above it.
  bottom: number;
}) {
  const S = useSoft();
  const { height } = useWindowDimensions();
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const rows = useMemo(() => {
    const list = folders.map((path) => ({ path, depth: path.split('/').length - 1, name: path.split('/').pop() ?? path }));
    if (points.some((p) => p.folders.length === 0)) list.push({ path: NO_FOLDER, depth: 0, name: 'Без папки' });
    return list;
  }, [folders, points]);
  const shown = points.filter((p) => pointShown(p, pick)).length;
  const toggleFolder = (path: string) =>
    onPick({ ...pick, folders: pick.folders.includes(path) ? pick.folders.filter((f) => f !== path) : [...pick.folders, path] });
  const togglePoint = (id: string) =>
    onPick({ ...pick, points: pick.points.includes(id) ? pick.points.filter((p) => p !== id) : [...pick.points, id] });
  const tick = (on: boolean) => (
    <View style={[styles.tick, { borderColor: on ? S.ink : S.ink3 }, on && { backgroundColor: S.ink }]}>
      {on && <Ionicons name="checkmark" size={14} color={S.chrome} />}
    </View>
  );
  return (
    <View style={[styles.panel, { bottom, backgroundColor: S.chrome, boxShadow: S.shadow, maxHeight: height * 0.55 }]}>
      <View style={styles.head}>
        <Ionicons name="layers-outline" size={18} color={S.ink} />
        <Text style={[styles.title, { color: S.ink }]}>Шари</Text>
        <Text style={[styles.sub, { color: S.ink3 }]}>
          {shown} з {points.length}
        </Text>
        <View style={{ flex: 1 }} />
        {pickActive(pick) && (
          <Pressable hitSlop={8} onPress={() => onPick(NO_PICK)} style={styles.reset}>
            <Text style={[styles.resetLabel, { color: S.ink2 }]}>Усі</Text>
          </Pressable>
        )}
        <Pressable hitSlop={10} onPress={onClose} accessibilityLabel="Згорнути шари">
          <Ionicons name="chevron-down" size={20} color={S.ink2} />
        </Pressable>
      </View>
      {pick.folders.length > 1 && (
        <View style={[styles.segment, { backgroundColor: S.fill }]}>
          {(
            [
              ['any', 'Усі разом'],
              ['all', 'Лише спільні'],
            ] as const
          ).map(([mode, label]) => (
            <Pressable
              key={mode}
              onPress={() => onPick({ ...pick, mode })}
              style={[styles.segmentOption, pick.mode === mode && { backgroundColor: S.ink }]}
            >
              <Text style={[styles.segmentLabel, { color: pick.mode === mode ? S.chrome : S.ink2 }]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <ScrollView style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled">
        {rows.length === 0 && <Text style={[styles.empty, { color: S.ink3 }]}>Папок ще немає - усі точки на мапі.</Text>}
        {rows.map((row) => {
          const members = points.filter((p) => (row.path === NO_FOLDER ? p.folders.length === 0 : p.folders.includes(row.path)));
          const count = points.filter((p) => inFolder(p, row.path)).length;
          const expanded = open.has(row.path);
          return (
            <View key={row.path || '__none__'}>
              <View style={[styles.row, { paddingLeft: 6 + row.depth * 18 }]}>
                <Pressable
                  hitSlop={6}
                  disabled={members.length === 0}
                  onPress={() =>
                    setOpen((prev) => {
                      const next = new Set(prev);
                      if (next.has(row.path)) next.delete(row.path);
                      else next.add(row.path);
                      return next;
                    })
                  }
                  style={styles.chevron}
                >
                  {members.length > 0 && <Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={15} color={S.ink3} />}
                </Pressable>
                <Pressable style={styles.rowTap} onPress={() => toggleFolder(row.path)}>
                  <Ionicons name={expanded ? 'folder-open-outline' : 'folder-outline'} size={18} color={S.ink2} />
                  <Text style={[styles.rowLabel, { color: S.ink }]} numberOfLines={1}>
                    {row.name}
                  </Text>
                  <Text style={[styles.count, { color: S.ink3 }]}>{count}</Text>
                  {tick(pick.folders.includes(row.path))}
                </Pressable>
              </View>
              {expanded &&
                members.map((p) => (
                  <Pressable key={p.id} style={[styles.row, styles.rowTap, { paddingLeft: 30 + row.depth * 18 }]} onPress={() => togglePoint(p.id)}>
                    <Ionicons name="location-outline" size={17} color={S.ink3} />
                    <Text style={[styles.rowLabel, { color: S.ink }]} numberOfLines={1}>
                      {p.title}
                    </Text>
                    {tick(pick.points.includes(p.id))}
                  </Pressable>
                ))}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 16,
    right: 16,
    borderRadius: 26,
    paddingTop: 10,
    paddingBottom: 8,
    paddingHorizontal: 8,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingBottom: 8 },
  title: { fontSize: 16, fontFamily: SOFT_SEMIBOLD },
  sub: { fontSize: 13, fontFamily: SOFT_MEDIUM, fontVariant: ['tabular-nums'] },
  reset: { paddingHorizontal: 8, paddingVertical: 2 },
  resetLabel: { fontSize: 14, fontFamily: SOFT_MEDIUM },
  segment: { flexDirection: 'row', borderRadius: 14, padding: 3, marginHorizontal: 4, marginBottom: 6 },
  segmentOption: { flex: 1, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segmentLabel: { fontSize: 13, fontFamily: SOFT_SEMIBOLD },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingRight: 8 },
  chevron: { width: 22, height: 44, alignItems: 'center', justifyContent: 'center' },
  rowTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  rowLabel: { flex: 1, fontSize: 15, fontFamily: SOFT_MEDIUM },
  count: { fontSize: 13, fontFamily: SOFT_MEDIUM, fontVariant: ['tabular-nums'] },
  tick: { width: 22, height: 22, borderRadius: 7, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  empty: { fontSize: 14, padding: 12 },
});
