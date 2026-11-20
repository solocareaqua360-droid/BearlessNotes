import { Ionicons } from "@/components/icons/Ionicons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { StatusToggle } from "@/components/StatusToggle";
import { TagsDrawer } from "@/components/TagsDrawer";
import { Field, SheetScreen } from "@/components/ui/SheetScreen";
import { FONT, softCursor, TYPE, useScheme, useSoft } from "@/theme/soft";
import { fetchVideoMeta, VideoMeta } from "@/services/videoMeta";
import { useLibraryStore } from "@/store/useLibraryStore";
import { WatchStatus } from "@/types";
import { extractUrl } from "@/utils/shareLink";

const META_FETCH_DEBOUNCE_MS = 500;

export default function AddVideoScreen() {
  const S = useSoft();
  const scheme = useScheme();
  const { sharedUrl } = useLocalSearchParams<{ sharedUrl?: string }>();
  const tags = useLibraryStore((s) => s.tags);
  const videos = useLibraryStore((s) => s.videos);
  const addVideo = useLibraryStore((s) => s.addVideo);
  const removeTag = useLibraryStore((s) => s.removeTag);

  const [url, setUrl] = useState(extractUrl(sharedUrl) ?? sharedUrl ?? "");
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [status, setStatus] = useState<WatchStatus>("planned");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [tagsDrawerVisible, setTagsDrawerVisible] = useState(false);

  const latestRequestUrl = useRef<string | null>(null);

  useEffect(() => {
    if (sharedUrl) setUrl(extractUrl(sharedUrl) ?? sharedUrl);
  }, [sharedUrl]);

  useEffect(() => {
    const trimmed = url.trim();
    if (trimmed.length < 8) {
      setMeta(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(async () => {
      latestRequestUrl.current = trimmed;
      const result = await fetchVideoMeta(trimmed);
      // Ignore a response for a link the user has since changed away from.
      if (latestRequestUrl.current === trimmed) {
        setMeta(result);
        setLoading(false);
      }
    }, META_FETCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [url]);

  const handleSave = () => {
    if (!url.trim()) return;
    addVideo({
      id: `v-${Date.now()}`,
      url: url.trim(),
      title: meta?.title ?? "Нове відео",
      thumbnailUrl: meta?.thumbnailUrl ?? "",
      durationSec: meta?.durationSec ?? 0,
      source: meta?.source ?? "unknown",
      siteName: meta?.siteName ?? "",
      updatedAt: Date.now(),
      status,
      tagIds: selectedTagIds,
      comment: "",
      createdAt: Date.now(),
    });
    router.back();
  };

  const selectedNames = tags.filter((t) => selectedTagIds.includes(t.id)).map((t) => t.name);

  return (
    <SheetScreen
      title="Нове відео"
      doneLabel="Зберегти"
      onDone={handleSave}
      doneDisabled={!url.trim()}
      overlay={
        <TagsDrawer
          visible={tagsDrawerVisible}
          onClose={() => setTagsDrawerVisible(false)}
          tags={tags}
          videos={videos}
          selectedTagIds={selectedTagIds}
          onChangeSelectedTagIds={setSelectedTagIds}
          onCreateTag={() => {
            setTagsDrawerVisible(false);
            router.push("/tag-editor");
          }}
          onEditTag={(tagId) => {
            setTagsDrawerVisible(false);
            router.push(`/tag-editor?tagId=${tagId}`);
          }}
          onReparentTag={(tagId) => {
            setTagsDrawerVisible(false);
            router.push(`/tag-reparent?tagId=${tagId}`);
          }}
          onDeleteTag={(tagId, mode) => removeTag(tagId, mode)}
          onBulkReparentTags={(tagIds) => {
            setTagsDrawerVisible(false);
            router.push(`/tag-reparent?tagIds=${tagIds.join(",")}`);
          }}
          confirmLabel="Готово"
        />
      }
    >
      <TextInput
        value={url}
        onChangeText={setUrl}
        placeholder="Встав посилання на YouTube або TikTok"
        placeholderTextColor={S.ink3}
        style={[styles.input, { backgroundColor: S.fill, color: S.ink }]}
        autoCapitalize="none"
        autoCorrect={false}
        {...softCursor(scheme)}
      />

      {(meta || loading) && (
        <View style={[styles.preview, { backgroundColor: S.fill }]}>
          <View style={[styles.previewThumb, { backgroundColor: S.fillSolid }]}>
            {meta?.thumbnailUrl ? <Image source={{ uri: meta.thumbnailUrl }} style={{ width: "100%", height: "100%" }} /> : null}
          </View>
          <Text style={[TYPE.cardTitle, { flex: 1, color: S.ink }]} numberOfLines={3}>
            {loading ? "Завантаження…" : meta?.title}
          </Text>
        </View>
      )}

      <StatusToggle value={status} onChange={setStatus} />

      <Field label="Смарт-папки">
        <Pressable style={[styles.selector, { backgroundColor: S.fill }]} onPress={() => setTagsDrawerVisible(true)}>
          <Ionicons name="pricetag-outline" size={19} color={S.ink2} />
          <Text style={[TYPE.row, { flex: 1, color: selectedNames.length ? S.ink : S.ink3 }]} numberOfLines={1}>
            {selectedNames.length > 0 ? selectedNames.join(", ") : "Обрати смарт-папки"}
          </Text>
          <Ionicons name="chevron-forward" size={17} color={S.ink3} />
        </Pressable>
      </Field>
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  input: { height: 52, borderRadius: 26, paddingHorizontal: 20, fontFamily: FONT.regular, fontWeight: "normal", fontSize: 15.5 },
  preview: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 20, padding: 10 },
  previewThumb: { width: 120, aspectRatio: 16 / 9, borderRadius: 14, overflow: "hidden" },
  selector: { height: 52, borderRadius: 26, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 18 },
});
