import { Pressable, StyleSheet, Text, View } from "react-native";

import { Ionicons } from "@/components/icons/Ionicons";
import { FONT, RADIUS, useSoft } from "@/theme/soft";

export type FolderTile = {
  key: string;
  name: string;
  icon: string;
  color?: string;
  /** Videos directly inside. */
  docs: number;
  /** Sub-folders; undefined = not shown (the bin). */
  subfolders?: number;
  onPress: () => void;
};

// Folder tiles, two across (ported from mindEva's ExplorerHead soft look):
// 64 high, radius 20, a 38 round-rect badge, name + a meta line, a chevron.
export function FolderTiles({ tiles }: { tiles: FolderTile[] }) {
  const S = useSoft();
  const rows: FolderTile[][] = [];
  for (let i = 0; i < tiles.length; i += 2) rows.push(tiles.slice(i, i + 2));
  return (
    <View style={styles.wrap}>
      {rows.map((row, i) => (
        <View key={i} style={styles.row}>
          {row.map((t) => (
            <Pressable
              key={t.key}
              onPress={t.onPress}
              style={({ pressed }) => [
                styles.tile,
                { backgroundColor: S.card, boxShadow: S.shadow, transform: [{ scale: pressed ? 0.97 : 1 }] },
              ]}
            >
              <View style={[styles.badge, { backgroundColor: t.color ? `${t.color}24` : S.fill }]}>
                <Ionicons name={t.icon as any} size={20} color={t.color ?? S.ink2} />
              </View>
              <View style={styles.body}>
                <Text style={[styles.name, { color: S.ink }]} numberOfLines={1}>
                  {t.name}
                </Text>
                <View style={styles.meta}>
                  <Ionicons name="link-outline" size={13} color={S.ink3} />
                  <Text style={[styles.count, { color: S.ink3 }]}>{t.docs}</Text>
                  {t.subfolders !== undefined && (
                    <>
                      <Ionicons name="folder-outline" size={13} color={S.ink3} style={{ marginLeft: 6 }} />
                      <Text style={[styles.count, { color: S.ink3 }]}>{t.subfolders}</Text>
                    </>
                  )}
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={S.ink3} />
            </Pressable>
          ))}
          {row.length === 1 && <View style={styles.spacer} />}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12, marginBottom: 12 },
  row: { flexDirection: "row", gap: 12 },
  spacer: { flex: 1 },
  tile: { flex: 1, minWidth: 0, height: 64, borderRadius: RADIUS.row, flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 12, paddingRight: 10 },
  badge: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  body: { flex: 1, minWidth: 0, gap: 3 },
  name: { fontFamily: FONT.semibold, fontWeight: "normal", fontSize: 15, letterSpacing: -0.2 },
  meta: { flexDirection: "row", alignItems: "center", gap: 3 },
  count: { fontFamily: FONT.medium, fontWeight: "normal", fontSize: 12.5 },
});
