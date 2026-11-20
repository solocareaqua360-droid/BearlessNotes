import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Image, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { ScrollView } from "react-native-gesture-handler";

import { Ionicons } from "@/components/icons/Ionicons";
import { StatusToggle } from "@/components/StatusToggle";
import { TagChip } from "@/components/TagChip";
import { formatStamp, useLibraryStore } from "@/store/useLibraryStore";
import { FONT, RADIUS, softCursor, TYPE, useScheme, useSoft } from "@/theme/soft";
import { Video } from "@/types";
import { shareVideoLink } from "@/utils/shareLink";

function Panel({ icon, heading, children }: { icon?: string; heading: string; children: ReactNode }) {
  const S = useSoft();
  return (
    <View style={[styles.panel, { backgroundColor: S.fill }]}>
      <View style={styles.panelHead}>
        {icon ? <Ionicons name={icon as any} size={18} color={S.ink2} /> : null}
        <Text style={[TYPE.cardTitle, { fontSize: 15, color: S.ink }]}>{heading}</Text>
      </View>
      {children}
    </View>
  );
}

// «АРКУШ» that a card opens into. LOOKED AT first; «Редагувати» turns on the
// title, the comment and the tag controls (user rule: view vs edit).
export function VideoSheet({
  video,
  onClose,
  onAddTag,
}: {
  video: Video;
  onClose: () => void;
  onAddTag: () => void;
}) {
  const S = useSoft();
  const scheme = useScheme();
  const tags = useLibraryStore((s) => s.tags);
  const updateVideo = useLibraryStore((s) => s.updateVideo);
  const videoTags = useMemo(() => tags.filter((t) => video.tagIds.includes(t.id)), [tags, video.tagIds]);

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(video.title);
  const [comment, setComment] = useState(video.comment);

  useEffect(() => {
    setEditing(false);
    setTitle(video.title);
    setComment(video.comment);
    // Only when a different video is shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.id]);

  const finish = () => {
    const patch: Partial<Video> = {};
    if (title.trim() && title.trim() !== video.title) patch.title = title.trim();
    if (comment !== video.comment) patch.comment = comment;
    if (Object.keys(patch).length) updateVideo(video.id, patch);
    setEditing(false);
  };

  const site = video.siteName || (video.source === "youtube" ? "YouTube" : video.source === "tiktok" ? "TikTok" : "");

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.kav} pointerEvents="box-none">
      <View style={[styles.sheet, { backgroundColor: S.card, boxShadow: S.popShadow }]}>
        <View style={[styles.grab, { backgroundColor: S.line }]} />
        <View style={styles.header}>
          {editing ? (
            <TextInput
              value={title}
              onChangeText={setTitle}
              multiline
              style={[styles.titleInput, { color: S.ink, backgroundColor: S.fill }]}
              {...softCursor(scheme)}
            />
          ) : (
            <Text style={[styles.title, { color: S.ink }]} numberOfLines={2}>
              {video.title}
            </Text>
          )}
          <Pressable
            onPress={editing ? finish : () => setEditing(true)}
            style={[styles.pill, editing ? { backgroundColor: S.ink } : { backgroundColor: S.fill }]}
          >
            <Ionicons name={editing ? "checkmark" : "create-outline"} size={18} color={editing ? S.chrome : S.ink} />
            <Text style={[TYPE.row, { fontSize: 15, color: editing ? S.chrome : S.ink }]}>{editing ? "Готово" : "Редагувати"}</Text>
          </Pressable>
          <Pressable onPress={onClose} style={[styles.close, { backgroundColor: S.fill }]} accessibilityLabel="Закрити">
            <Ionicons name="close" size={22} color={S.ink} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={[TYPE.meta, { color: S.ink3 }]}>
            {site ? `${site} · ` : ""}Створено {formatStamp(video.createdAt)}
          </Text>

          <Panel icon="play-circle-outline" heading="Відео">
            <View style={[styles.banner, { backgroundColor: S.fillSolid }]}>
              {video.thumbnailUrl ? <Image source={{ uri: video.thumbnailUrl }} style={styles.bannerImg} /> : null}
            </View>
            <Text style={[TYPE.meta, { color: S.ink3 }]} numberOfLines={2}>
              {video.url}
            </Text>
            <View style={[styles.split, { backgroundColor: S.ink }]}>
              <Pressable style={styles.half} onPress={() => Linking.openURL(video.url)}>
                <Ionicons name="play-outline" size={20} color={S.chrome} />
                <Text style={[TYPE.row, { fontSize: 15, color: S.chrome }]}>Відтворити</Text>
              </Pressable>
              <View style={[styles.divider, { backgroundColor: S.chrome }]} />
              <Pressable style={styles.half} onPress={() => shareVideoLink(video.url, video.title)}>
                <Ionicons name="share-outline" size={20} color={S.chrome} />
                <Text style={[TYPE.row, { fontSize: 15, color: S.chrome }]}>Поділитися</Text>
              </Pressable>
            </View>
          </Panel>

          <StatusToggle value={video.status} onChange={(status) => updateVideo(video.id, { status })} />

          <Panel icon="pricetag-outline" heading="Смарт-папки">
            {videoTags.length === 0 && !editing ? (
              <Text style={[TYPE.body, { color: S.ink3 }]}>Поза смарт-папками</Text>
            ) : (
              <View style={styles.tagsRow}>
                {videoTags.map((tag) => (
                  <TagChip
                    key={tag.id}
                    tag={tag}
                    onRemove={editing ? () => updateVideo(video.id, { tagIds: video.tagIds.filter((id) => id !== tag.id) }) : undefined}
                  />
                ))}
              </View>
            )}
            {editing && (
              <Pressable style={[styles.bigBtn, { backgroundColor: S.card }]} onPress={onAddTag}>
                <Ionicons name="add" size={19} color={S.ink} />
                <Text style={[TYPE.row, { color: S.ink }]}>Додати до смарт-папки</Text>
              </Pressable>
            )}
          </Panel>

          <Panel icon="chatbubble-outline" heading="Коментар">
            {editing ? (
              <TextInput
                value={comment}
                onChangeText={setComment}
                placeholder="Коментар…"
                placeholderTextColor={S.ink3}
                multiline
                style={[styles.commentInput, { color: S.ink, backgroundColor: S.card }]}
                {...softCursor(scheme)}
              />
            ) : (
              <Text style={[TYPE.body, { color: video.comment ? S.ink : S.ink3 }]}>{video.comment || "Коментар відсутній"}</Text>
            )}
          </Panel>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  kav: { width: "100%", alignItems: "center", maxHeight: "92%" },
  sheet: { width: "100%", maxWidth: 560, maxHeight: "100%", borderRadius: RADIUS.sheet, paddingHorizontal: 20, paddingTop: 12, overflow: "hidden" },
  grab: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 12 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 10 },
  title: { flex: 1, fontFamily: FONT.bold, fontWeight: "normal", fontSize: 20, lineHeight: 26, letterSpacing: -0.3, paddingTop: 2 },
  titleInput: { flex: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, fontFamily: FONT.semibold, fontWeight: "normal", fontSize: 18, lineHeight: 24 },
  pill: { height: 44, borderRadius: 22, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 6 },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  body: { gap: 14, paddingBottom: 24 },
  panel: { borderRadius: 20, padding: 14, gap: 12 },
  panelHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  banner: { width: "100%", height: 170, borderRadius: 14, overflow: "hidden" },
  bannerImg: { width: "100%", height: "100%" },
  split: { flexDirection: "row", minHeight: 50, borderRadius: 25, overflow: "hidden", alignItems: "center" },
  half: { flex: 1, minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  divider: { width: 1, height: 28, opacity: 0.35 },
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  bigBtn: { height: 48, borderRadius: 24, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  commentInput: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, minHeight: 110, textAlignVertical: "top", fontFamily: FONT.regular, fontWeight: "normal", fontSize: 16, lineHeight: 24 },
});
