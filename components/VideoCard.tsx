import { forwardRef } from "react";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";

import { Ionicons } from "@/components/icons/Ionicons";
import { TagChip } from "@/components/TagChip";
import { useTurningCard } from "@/hooks/useTurningCard";
import { formatDuration, formatStamp } from "@/store/useLibraryStore";
import { FONT, RADIUS, useSoft } from "@/theme/soft";
import { Tag, Video } from "@/types";

export const GRID_BASIS = "46%";

interface VideoCardProps {
  video: Video;
  tags: Tag[];
  layout?: "grid" | "list";
  selectable?: boolean;
  selected?: boolean;
  /** Tapped: the card is the flip source. */
  onPress: () => void;
  onLongPress?: () => void;
  /** The «⋯» button (falls back to onLongPress): the hold itself may belong to the carry. */
  onMenu?: () => void;
  onToggleStatus?: () => void;
  /** In the bin: no status toggle, no open icon. */
  inBin?: boolean;
}

const platformOf = (v: Video) => (v.source === "youtube" ? "YouTube" : v.source === "tiktok" ? "TikTok" : "");

// A CARD (not paper): `card` surface, no border, the soft shadow, and it
// TURNS edge-on to open (useTurningCard + FlipLayer). The root is the
// animated view so the rotation takes the shadow with it.
export const VideoCard = forwardRef<View, VideoCardProps>(function VideoCard(
  { video, tags, layout = "grid", selectable = false, selected = false, onPress, onLongPress, onMenu, onToggleStatus, inBin = false },
  ref
) {
  const S = useSoft();
  const turning = useTurningCard(video.id);
  const isList = layout === "list";
  const site = video.siteName || platformOf(video);
  const stamp = formatStamp(video.updatedAt ?? video.createdAt);
  const watched = video.status === "watched";

  const thumb = (
    <View style={[styles.thumb, isList && styles.thumbList, { backgroundColor: S.fillSolid }]}>
      {video.thumbnailUrl ? (
        <Image source={{ uri: video.thumbnailUrl }} style={styles.fill} />
      ) : (
        <View style={[styles.fill, styles.center, { backgroundColor: "rgba(239,68,68,0.10)" }]}>
          <Ionicons name="videocam-outline" size={26} color="#EF4444" />
        </View>
      )}
      {video.durationSec > 0 && !isList ? (
        <View style={styles.duration}>
          <Text style={styles.durationText}>{formatDuration(video.durationSec)}</Text>
        </View>
      ) : null}
      {selectable ? (
        <View
          style={[
            styles.check,
            selected ? { backgroundColor: S.accent, borderColor: S.accent } : { backgroundColor: "rgba(0,0,0,0.25)", borderColor: "#FFFFFF" },
          ]}
        >
          {selected && <Ionicons name="checkmark" size={14} color={S.chrome} />}
        </View>
      ) : !isList ? (
        <View style={styles.overlay} pointerEvents="box-none">
          <Pressable hitSlop={6} onPress={onMenu ?? onLongPress} style={styles.overBtn} accessibilityLabel="Дії">
            <Ionicons name="ellipsis-horizontal" size={15} color="#FFFFFF" />
          </Pressable>
          {!inBin && (
            <Pressable hitSlop={6} onPress={() => Linking.openURL(video.url)} style={styles.overBtn} accessibilityLabel="Відкрити в YouTube/TikTok">
              <Ionicons name="open-outline" size={15} color="#FFFFFF" />
            </Pressable>
          )}
        </View>
      ) : null}
    </View>
  );

  const body = (
    <View style={[styles.body, isList && styles.bodyList]}>
      <Text style={[styles.title, { color: S.ink }]} numberOfLines={2}>
        {video.title}
      </Text>
      <View style={styles.metaRow}>
        <Text style={[styles.meta, { color: S.ink3 }]} numberOfLines={1}>
          {site ? `${site} · ${stamp}` : stamp}
        </Text>
        {!inBin && (
          <Pressable hitSlop={8} onPress={onToggleStatus} style={styles.badge}>
            {watched ? <View style={[styles.dot, { backgroundColor: S.ink2 }]} /> : null}
            <Text style={[styles.badgeText, { color: watched ? S.ink2 : S.ink3 }]} numberOfLines={1}>
              {watched ? "Переглянуто" : "Планую"}
            </Text>
          </Pressable>
        )}
      </View>
      {tags.length > 0 && (
        <View style={styles.tagRow}>
          {tags.map((tag) => (
            <TagChip key={tag.id} tag={tag} compact />
          ))}
        </View>
      )}
    </View>
  );

  return (
    <Animated.View
      ref={ref as any}
      collapsable={false}
      style={[
        isList ? styles.outerList : styles.outerGrid,
        styles.card,
        { backgroundColor: S.card, boxShadow: S.shadow },
        turning.style,
      ]}
    >
      <Pressable {...turning.handlers} onPress={onPress} onLongPress={onLongPress} delayLongPress={380} style={isList ? styles.rowInner : undefined}>
        {thumb}
        {body}
      </Pressable>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  card: { borderRadius: RADIUS.row, padding: 10, overflow: "hidden" },
  outerGrid: { flexBasis: GRID_BASIS, flexGrow: 1 },
  outerList: { width: "100%" },
  rowInner: { flexDirection: "row", alignItems: "center", gap: 12 },
  thumb: { width: "100%", aspectRatio: 16 / 9, borderRadius: 12, overflow: "hidden", marginBottom: 8 },
  thumbList: { width: 112, marginBottom: 0, flexShrink: 0 },
  fill: { width: "100%", height: "100%" },
  center: { alignItems: "center", justifyContent: "center" },
  overlay: { position: "absolute", top: 6, right: 6, gap: 6 },
  overBtn: { width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" },
  duration: { position: "absolute", left: 6, bottom: 6, backgroundColor: "rgba(0,0,0,0.62)", borderRadius: 7, paddingHorizontal: 6, height: 18, justifyContent: "center" },
  durationText: { color: "#FFFFFF", fontFamily: FONT.semibold, fontWeight: "normal", fontSize: 10.5 },
  check: { position: "absolute", top: 6, left: 6, width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  body: { gap: 4, paddingHorizontal: 2, paddingBottom: 2 },
  bodyList: { flex: 1, minWidth: 0, paddingHorizontal: 0 },
  title: { fontFamily: FONT.semibold, fontWeight: "normal", fontSize: 14, lineHeight: 18, letterSpacing: -0.15 },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  meta: { flex: 1, minWidth: 0, fontFamily: FONT.regular, fontWeight: "normal", fontSize: 11.5 },
  badge: { flexDirection: "row", alignItems: "center", gap: 5, maxWidth: 110, flexShrink: 0 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontFamily: FONT.medium, fontWeight: "normal", fontSize: 11.5 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 2 },
});
