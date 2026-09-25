import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useRef, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { StatusToggle } from "@/components/StatusToggle";
import { TagChip } from "@/components/TagChip";
import { TagsDrawer } from "@/components/TagsDrawer";
import { colors, radius, spacing } from "@/constants/theme";
import { useLibraryStore } from "@/store/useLibraryStore";

export default function VideoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const videos = useLibraryStore((s) => s.videos);
  const tags = useLibraryStore((s) => s.tags);
  const updateVideo = useLibraryStore((s) => s.updateVideo);
  const removeTag = useLibraryStore((s) => s.removeTag);

  const video = useMemo(() => videos.find((v) => v.id === id), [videos, id]);
  const videoTags = useMemo(
    () => tags.filter((t) => video?.tagIds.includes(t.id)),
    [tags, video]
  );

  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(video?.title ?? "");
  const [commentEditing, setCommentEditing] = useState(false);
  const [commentDraft, setCommentDraft] = useState(video?.comment ?? "");
  const [tagsDrawerVisible, setTagsDrawerVisible] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  if (!video) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.notFound}>Відео не знайдено</Text>
      </SafeAreaView>
    );
  }

  const startTitleEdit = () => {
    setTitleDraft(video.title);
    setTitleEditing(true);
  };

  const saveTitle = () => {
    const trimmed = titleDraft.trim();
    if (trimmed) updateVideo(video.id, { title: trimmed });
    setTitleEditing(false);
  };

  const startCommentEdit = () => {
    setCommentDraft(video.comment);
    setCommentEditing(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  };

  const saveComment = () => {
    updateVideo(video.id, { comment: commentDraft });
    setCommentEditing(false);
  };

  const removeVideoTag = (tagId: string) => {
    updateVideo(video.id, { tagIds: video.tagIds.filter((id) => id !== tagId) });
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Відео</Text>
        <Pressable onPress={() => Linking.openURL(video.url)} hitSlop={8}>
          <Ionicons name="open-outline" size={20} color={colors.textPrimary} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}
      >
        <ScrollView
          ref={scrollRef}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.playerWrap}>
            {video.thumbnailUrl ? (
              <Image source={{ uri: video.thumbnailUrl }} style={styles.player} />
            ) : (
              <View style={[styles.player, styles.playerPlaceholder]} />
            )}
            <View style={styles.playButton}>
              <Ionicons name="play" size={30} color="#fff" style={{ marginLeft: 3 }} />
            </View>
          </View>

          <View style={styles.body}>
            <View style={styles.titleRow}>
              {titleEditing ? (
                <TextInput
                  value={titleDraft}
                  onChangeText={setTitleDraft}
                  style={[styles.titleText, styles.titleInputActive]}
                  multiline
                  autoFocus
                />
              ) : (
                <Text style={styles.titleText}>{video.title}</Text>
              )}
              <Pressable
                style={styles.editButton}
                onPress={titleEditing ? saveTitle : startTitleEdit}
              >
                {!titleEditing && <Ionicons name="pencil" size={12} color={colors.iconDark} />}
                <Text style={styles.editButtonLabel}>
                  {titleEditing ? "Готово" : "Редагувати"}
                </Text>
              </Pressable>
            </View>

            <StatusToggle
              value={video.status}
              onChange={(status) => updateVideo(video.id, { status })}
            />

            <View style={styles.tagsRow}>
              {videoTags.map((tag) => (
                <TagChip key={tag.id} tag={tag} onRemove={() => removeVideoTag(tag.id)} />
              ))}
              <Pressable style={styles.addTagButton} onPress={() => setTagsDrawerVisible(true)}>
                <Ionicons name="add" size={16} color={colors.textSecondary} />
                <Text style={styles.addTagLabel}>Додати тег</Text>
              </Pressable>
            </View>

            <View>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionLabel}>Коментар</Text>
                <Pressable
                  style={styles.editButton}
                  onPress={commentEditing ? saveComment : startCommentEdit}
                >
                  {!commentEditing && <Ionicons name="pencil" size={12} color={colors.iconDark} />}
                  <Text style={styles.editButtonLabel}>
                    {commentEditing ? "Зберегти" : "Редагувати"}
                  </Text>
                </Pressable>
              </View>

              {commentEditing ? (
                <TextInput
                  value={commentDraft}
                  onChangeText={setCommentDraft}
                  placeholder="Коментар…"
                  placeholderTextColor={colors.textMuted}
                  style={styles.comment}
                  multiline
                  autoFocus
                />
              ) : (
                <Text style={video.comment ? styles.commentText : styles.commentPlaceholder}>
                  {video.comment || "Коментар відсутній"}
                </Text>
              )}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <TagsDrawer
        visible={tagsDrawerVisible}
        onClose={() => setTagsDrawerVisible(false)}
        tags={tags}
        videos={videos}
        selectedTagIds={video.tagIds}
        onChangeSelectedTagIds={(ids) => updateVideo(video.id, { tagIds: ids })}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  notFound: {
    color: colors.textSecondary,
    textAlign: "center",
    marginTop: spacing.xxl,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
  },
  scrollContent: {
    flexGrow: 1,
  },
  playerWrap: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#000",
  },
  player: {
    width: "100%",
    height: "100%",
  },
  playerPlaceholder: {
    backgroundColor: colors.surfaceElevated,
  },
  playButton: {
    position: "absolute",
    top: "50%",
    left: "50%",
    marginTop: -30,
    marginLeft: -30,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  titleText: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 24,
  },
  titleInputActive: {
    padding: 0,
  },
  editButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.neutralActive,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  editButtonLabel: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "700",
  },
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    alignItems: "center",
  },
  addTagButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  addTagLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "600",
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  sectionLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "700",
  },
  commentText: {
    color: colors.textPrimary,
    fontSize: 13,
    lineHeight: 19,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  commentPlaceholder: {
    color: colors.textMuted,
    fontSize: 13,
    fontStyle: "italic",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  comment: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.textPrimary,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.textPrimary,
    fontSize: 13,
    minHeight: 72,
    textAlignVertical: "top",
  },
});
