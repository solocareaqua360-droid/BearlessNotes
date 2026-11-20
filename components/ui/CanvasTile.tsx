import { Image, StyleSheet, Text, View } from "react-native";

import { CANVAS_TILE } from "@/components/FolderCanvas";
import { Ionicons } from "@/components/icons/Ionicons";
import { FONT, useSoft } from "@/theme/soft";

// A video's face on the canvas: one small square - the picture with a title
// band, or an icon and the title when there is no picture.
export function VideoCanvasTile({ title, imageUrl }: { title: string; imageUrl?: string }) {
  const S = useSoft();
  if (imageUrl) {
    return (
      <View style={[styles.face, styles.picture, { backgroundColor: S.fill }]}>
        <Image source={{ uri: imageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        <View style={[styles.band, { backgroundColor: S.card }]}>
          <Text style={[styles.bandText, { color: S.ink }]} numberOfLines={1}>
            {title}
          </Text>
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.face, { backgroundColor: S.card }]}>
      <Ionicons name="videocam-outline" size={26} color="#EF4444" />
      <Text style={[styles.caption, { color: S.ink }]} numberOfLines={2}>
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  face: { width: CANVAS_TILE, height: CANVAS_TILE, alignItems: "center", justifyContent: "center", gap: 6, padding: 8 },
  picture: { padding: 0, justifyContent: "flex-end" },
  band: { alignSelf: "stretch", paddingHorizontal: 6, paddingVertical: 3, opacity: 0.92 },
  bandText: { fontFamily: FONT.semibold, fontWeight: "normal", fontSize: 10 },
  caption: { fontFamily: FONT.medium, fontWeight: "normal", fontSize: 10, textAlign: "center" },
});
