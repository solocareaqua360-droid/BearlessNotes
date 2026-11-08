import { router, useLocalSearchParams } from "expo-router";
import { createRef, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { BackHandler, Linking, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import EdgeFade from "@/components/EdgeFade";
import FolderCanvas, { type Move } from "@/components/FolderCanvas";
import { Ionicons } from "@/components/icons/Ionicons";
import { TagsDrawer } from "@/components/TagsDrawer";
import { VideoCard } from "@/components/VideoCard";
import { VideoSheet } from "@/components/VideoSheet";
import { ask, confirm } from "@/components/ui/Ask";
import { VideoCanvasTile } from "@/components/ui/CanvasTile";
import { Dock, DOCK_CLEARANCE, SelectionDock } from "@/components/ui/Dock";
import { DeskDock } from "@/components/ui/DeskDock";
import { goDesk } from "@/utils/desks";
import { FlipLayer } from "@/components/ui/FlipLayer";
import { FolderTile, FolderTiles } from "@/components/ui/FolderTiles";
import { holdMenu } from "@/components/ui/HoldMenu";
import { Menu, MenuEntry } from "@/components/ui/Menu";
import NamePrompt from "@/components/ui/NamePrompt";
import { BarButton, topBarSpace, TOP_NAV_H, topBarTop, TopBar } from "@/components/ui/TopBar";
import { sortVideos, useLibraryStore } from "@/store/useLibraryStore";
import { SIDE, TYPE, useSoft } from "@/theme/soft";
import type { SortField, Tag, Video, WatchStatus } from "@/types";
import { endFlip, prepareFlip, type FlipFrom } from "@/utils/flipOpen";
import { shareVideoLink } from "@/utils/shareLink";

const BIN = "__bin__";
type PathState = string | null; // null = the root, a tag id = inside that folder, BIN = the bin

const SORT_LABELS: Record<SortField, string> = {
  title: "За алфавітом",
  createdAt: "Дата створення",
  updatedAt: "Дата зміни",
};

function tagPath(tag: Tag, byId: Map<string, Tag>): string {
  const parts = [tag.name];
  let cur = tag;
  while (cur.parentId) {
    const parent = byId.get(cur.parentId);
    if (!parent) break;
    parts.unshift(parent.name);
    cur = parent;
  }
  return parts.join(" / ");
}

export default function HomeScreen() {
  const S = useSoft();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const { unsorted } = useLocalSearchParams<{ unsorted?: string }>();
  const videos = useLibraryStore((s) => s.videos);
  const bin = useLibraryStore((s) => s.bin);
  const tags = useLibraryStore((s) => s.tags);
  const settings = useLibraryStore((s) => s.settings);
  const updateSettings = useLibraryStore((s) => s.updateSettings);
  const updateVideo = useLibraryStore((s) => s.updateVideo);
  const updateTag = useLibraryStore((s) => s.updateTag);
  const addTagPath = useLibraryStore((s) => s.addTagPath);
  const removeTag = useLibraryStore((s) => s.removeTag);
  const moveToBin = useLibraryStore((s) => s.moveToBin);
  const restoreFromBin = useLibraryStore((s) => s.restoreFromBin);
  const purgeBin = useLibraryStore((s) => s.purgeBin);
  const purgeExpiredBin = useLibraryStore((s) => s.purgeExpiredBin);
  const setBulkTagsOnVideos = useLibraryStore((s) => s.setBulkTagsOnVideos);

  const sortField = settings.sortField ?? "updatedAt";
  const sortDir = settings.sortDir ?? "desc";
  const listMode = settings.listMode ?? "folders";
  const cardLayout = settings.cardLayout ?? "grid";

  const [path, setPath] = useState<PathState>(null);
  const [status, setStatus] = useState<WatchStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [tagsDrawerVisible, setTagsDrawerVisible] = useState(false);
  const [activeTagIds, setActiveTagIds] = useState<string[]>([]);
  const [unsortedOnly, setUnsortedOnly] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkTagsVisible, setBulkTagsVisible] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [renameVideo, setRenameVideo] = useState<Video | null>(null);
  const [flipFrom, setFlipFrom] = useState<FlipFrom | null>(null);
  const [sheetTagsVisible, setSheetTagsVisible] = useState(false);
  const lastShown = useRef<Video | null>(null);

  useEffect(() => {
    if (unsorted === "1") {
      setUnsortedOnly(true);
      setActiveTagIds([]);
    }
  }, [unsorted]);

  useEffect(() => {
    purgeExpiredBin();
  }, [purgeExpiredBin]);

  // The card stays turned until the window has finished closing.
  useEffect(() => {
    if (detailId !== null) return;
    const t = setTimeout(() => {
      setFlipFrom(null);
      endFlip();
    }, 700);
    return () => clearTimeout(t);
  }, [detailId]);

  const cardRefs = useRef(new Map<string, RefObject<View | null>>()).current;
  const refFor = (id: string) => {
    let r = cardRefs.get(id);
    if (!r) cardRefs.set(id, (r = createRef<View>()));
    return r;
  };

  const byId = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const inBin = path === BIN;
  const tagFilterActive = activeTagIds.length > 0 || unsortedOnly;
  const searching = query.trim().length > 0;
  const canvasMode = cardLayout === "canvas" && !inBin;
  const explorer = listMode === "folders" && !tagFilterActive && !searching && !inBin && !canvasMode;

  const shown = useMemo(() => {
    let list: Video[];
    if (inBin) list = bin;
    else if (searching) list = videos;
    else if (unsortedOnly) list = videos.filter((v) => v.tagIds.length === 0);
    else if (activeTagIds.length > 0) list = videos.filter((v) => v.tagIds.some((id) => activeTagIds.includes(id)));
    else if (listMode === "folders") list = path === null ? videos.filter((v) => v.tagIds.length === 0) : videos.filter((v) => v.tagIds.includes(path));
    else list = videos;
    if (status !== "all") list = list.filter((v) => v.status === status);
    const needle = query.trim().toLowerCase();
    if (needle) list = list.filter((v) => v.title.toLowerCase().includes(needle) || (v.siteName ?? "").toLowerCase().includes(needle));
    return sortVideos(list, sortField, sortDir);
  }, [inBin, bin, videos, searching, unsortedOnly, activeTagIds, listMode, path, status, query, sortField, sortDir]);

  const folderTiles: FolderTile[] = useMemo(() => {
    if (!explorer) return [];
    const parent = path;
    const tiles: FolderTile[] = tags
      .filter((t) => t.parentId === parent)
      .map((t) => ({
        key: t.id,
        name: t.name,
        icon: t.icon,
        color: t.color,
        docs: videos.filter((v) => v.tagIds.includes(t.id)).length,
        subfolders: tags.filter((c) => c.parentId === t.id).length,
        onPress: () => setPath(t.id),
      }));
    if (parent === null && bin.length > 0) {
      tiles.push({ key: BIN, name: "Кошик", icon: "trash-outline", docs: bin.length, onPress: () => setPath(BIN) });
    }
    return tiles;
  }, [explorer, path, tags, videos, bin]);

  const detailVideo = detailId ? videos.find((v) => v.id === detailId) ?? null : null;
  if (detailVideo) lastShown.current = detailVideo;

  const columns = 2;
  const fillers = cardLayout !== "list" && shown.length % columns !== 0 ? columns - (shown.length % columns) : 0;

  // ----- the canvas: the same smart folders, laid out on a table
  const pathOfTag = useMemo(() => {
    const m = new Map<string, string>();
    const build = (t: Tag, seen = 0): string => {
      const parent = t.parentId && seen < 12 ? byId.get(t.parentId) : undefined;
      return parent ? `${build(parent, seen + 1)}/${t.name}` : t.name;
    };
    tags.forEach((t) => m.set(t.id, build(t)));
    return m;
  }, [tags, byId]);
  const tagByPath = useMemo(() => {
    const m = new Map<string, Tag>();
    tags.forEach((t) => m.set(pathOfTag.get(t.id) ?? t.name, t));
    return m;
  }, [tags, pathOfTag]);
  const canvasVideos = useMemo(() => {
    let list = videos;
    if (unsortedOnly) list = list.filter((v) => v.tagIds.length === 0);
    else if (activeTagIds.length > 0) list = list.filter((v) => v.tagIds.some((id) => activeTagIds.includes(id)));
    if (status !== "all") list = list.filter((v) => v.status === status);
    const needle = query.trim().toLowerCase();
    if (needle) list = list.filter((v) => v.title.toLowerCase().includes(needle) || (v.siteName ?? "").toLowerCase().includes(needle));
    return list;
  }, [videos, unsortedOnly, activeTagIds, status, query]);
  const videoById = useMemo(() => new Map(videos.map((v) => [v.id, v])), [videos]);
  const relocate = async (moves: Move[], to: string | null) => {
    const toTag = to ? tagByPath.get(to) : undefined;
    moves.forEach(({ photo, from }) => {
      const v = videoById.get(photo.id);
      if (!v) return;
      const fromTag = from ? tagByPath.get(from) : undefined;
      let ids = v.tagIds.filter((id) => id !== fromTag?.id);
      if (toTag && !ids.includes(toTag.id)) ids = [...ids, toTag.id];
      updateVideo(v.id, { tagIds: ids });
    });
  };
  const canvasMenu = async (photo: { id: string }) => {
    const v = videoById.get(photo.id);
    if (!v) return;
    const key = await ask({
      title: v.title,
      answers: [
        { key: "folders", label: "Смарт-папки", primary: true },
        { key: "status", label: v.status === "planned" ? "Позначити переглянутим" : "Повернути в «Планую»" },
        { key: "share", label: "Поділитися" },
        { key: "open", label: "Відкрити в YouTube/TikTok" },
        { key: "delete", label: "У кошик", destructive: true },
      ],
    });
    if (key === "folders") {
      setSelectedIds([v.id]);
      setBulkTagsVisible(true);
    } else if (key === "status") updateVideo(v.id, { status: v.status === "planned" ? "watched" : "planned" });
    else if (key === "share") shareVideoLink(v.url, v.title);
    else if (key === "open") Linking.openURL(v.url);
    else if (key === "delete") sendToBin([v.id]);
  };
  const openFromCanvas = (photo: { id: string }) => {
    openWatch(photo.id);
  };

  // ----- navigation inside the explorer
  const goUp = () => {
    if (path === BIN || path === null) return setPath(null);
    setPath(byId.get(path)?.parentId ?? null);
  };

  const canGoBack = path !== null;
  const exitSelect = () => {
    setSelectMode(false);
    setSelectedIds([]);
  };

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (detailId) return false; // the sheet handles it
      if (selectMode) return exitSelect(), true;
      if (query) return setQuery(""), true;
      if (canGoBack) return goUp(), true;
      return false;
    });
    return () => sub.remove();
  });

  // ----- opening a card
  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      return next;
    });

  const openCard = async (v: Video) => {
    if (selectMode) return toggleSelected(v.id);
    if (inBin) return binMenu(v);
    if (settings.openVideoMode === "external") return void Linking.openURL(v.url);
    openWatch(v.id);
  };

  // A tap opens the WATCH SCREEN (video on top, the folder's other videos under
  // it); the old flip-open card stays in the code but is no longer opened by a tap.
  const openWatch = (videoId: string) => {
    router.push({ pathname: "/watch", params: { id: videoId, folder: path && path !== BIN ? path : "" } });
  };

  const binMenu = async (v: Video) => {
    const key = await ask({
      title: v.title,
      answers: [
        { key: "restore", label: "Відновити", primary: true },
        { key: "purge", label: "Видалити назавжди", destructive: true },
      ],
    });
    if (key === "restore") restoreFromBin([v.id]);
    if (key === "purge") purgeBin([v.id]);
  };

  const sendToBin = (ids: string[]) => {
    moveToBin(ids);
  };

  const holdCard = async (v: Video) => {
    if (selectMode) return toggleSelected(v.id);
    if (inBin) return binMenu(v);
    const key = await holdMenu(refFor(v.id), [
      { key: "select", label: "Вибрати", icon: "checkbox-outline" },
      { key: "tags", label: "Смарт-папки", icon: "folder-outline" },
      { key: "rename", label: "Перейменувати", icon: "create-outline" },
      {
        key: "status",
        label: v.status === "planned" ? "Позначити переглянутим" : "Повернути в «Планую»",
        icon: v.status === "planned" ? "checkmark-circle-outline" : "time-outline",
      },
      { key: "share", label: "Поділитися", icon: "share-outline" },
      { key: "open", label: "Відкрити в YouTube/TikTok", icon: "open-outline" },
      { key: "delete", label: "У кошик", icon: "trash-outline", destructive: true },
    ]);
    if (key === "select") {
      setSelectMode(true);
      setSelectedIds([v.id]);
    } else if (key === "tags") {
      setSelectMode(true);
      setSelectedIds([v.id]);
      setBulkTagsVisible(true);
    } else if (key === "rename") setRenameVideo(v);
    else if (key === "status") updateVideo(v.id, { status: v.status === "planned" ? "watched" : "planned" });
    else if (key === "share") shareVideoLink(v.url, v.title);
    else if (key === "open") Linking.openURL(v.url);
    else if (key === "delete") sendToBin([v.id]);
  };

  // ----- bulk tags
  const bulkPresentTagIds = useMemo(() => {
    const set = new Set<string>();
    for (const id of selectedIds) videos.find((v) => v.id === id)?.tagIds.forEach((t) => set.add(t));
    return Array.from(set);
  }, [selectedIds, videos]);

  const handleBulkTagsChange = (nextIds: string[]) => {
    const prev = new Set(bulkPresentTagIds);
    const next = new Set(nextIds);
    const add = nextIds.filter((id) => !prev.has(id));
    const remove = bulkPresentTagIds.filter((id) => !next.has(id));
    if (add.length || remove.length) setBulkTagsBulk(add, remove);
  };
  const setBulkTagsBulk = (add: string[], remove: string[]) => setBulkTagsOnVideos(selectedIds, add, remove);

  const deleteSelected = async () => {
    if (inBin) {
      const ok = await confirm({ title: `Видалити назавжди (${selectedIds.length})?`, message: "Цю дію не можна скасувати.", confirm: "Видалити", destructive: true });
      if (!ok) return;
      purgeBin(selectedIds);
    } else {
      const ok = await confirm({ title: `У кошик (${selectedIds.length})?`, message: "Відео можна буде відновити протягом 30 днів.", confirm: "У кошик", destructive: true });
      if (!ok) return;
      sendToBin(selectedIds);
    }
    exitSelect();
  };

  // ----- the "⋯" menu
  const setSort = (field: SortField) => {
    if (field === sortField) updateSettings({ sortDir: sortDir === "asc" ? "desc" : "asc" });
    else updateSettings({ sortField: field, sortDir: field === "title" ? "asc" : "desc" });
  };

  const menuEntries: MenuEntry[] = [
    {
      key: "layout",
      label: "Змінити вигляд",
      icon: cardLayout === "grid" ? "list-outline" : cardLayout === "list" ? "easel-outline" : "grid-outline",
      onPress: () => updateSettings({ cardLayout: cardLayout === "grid" ? "list" : cardLayout === "list" ? "canvas" : "grid" }),
    },
    {
      key: "mode",
      label: listMode === "folders" ? "Усі відео списком" : "Показати за смарт-папками",
      icon: listMode === "folders" ? "reorder-four-outline" : "folder-outline",
      onPress: () => {
        setPath(null);
        updateSettings({ listMode: listMode === "folders" ? "all" : "folders" });
      },
    },
    { rule: true },
    { section: "Порядок" },
    ...(Object.keys(SORT_LABELS) as SortField[]).map((f) => ({
      key: `sort-${f}`,
      label: SORT_LABELS[f],
      suffix: f === sortField ? (sortDir === "asc" ? "  ↑" : "  ↓") : "",
      checked: f === sortField,
      onPress: () => setSort(f),
    })),
    { rule: true },
    { section: "Статус" },
    { key: "st-all", label: "Усі", checked: status === "all", onPress: () => setStatus("all") },
    { key: "st-planned", label: "Планую", checked: status === "planned", onPress: () => setStatus("planned") },
    { key: "st-watched", label: "Переглянуто", checked: status === "watched", onPress: () => setStatus("watched") },
    { rule: true },
    { key: "tags", label: "Смарт-папки", icon: "folder-outline", checked: tagFilterActive, onPress: () => setTagsDrawerVisible(true) },
    ...(explorer ? [{ key: "newfolder", label: "Нова смарт-папка", icon: "folder-outline", onPress: () => router.push(path ? `/tag-editor?parentId=${path}` : "/tag-editor") } as MenuEntry] : []),
    ...(inBin && bin.length > 0
      ? [{ key: "empty", label: "Очистити кошик", icon: "trash-outline", destructive: true, onPress: async () => {
          if (await confirm({ title: "Очистити кошик?", message: "Усе буде видалено назавжди.", confirm: "Очистити", destructive: true })) purgeBin();
        } } as MenuEntry]
      : []),
    { key: "settings", label: "Налаштування", icon: "settings-outline", onPress: () => router.push("/settings") },
  ];

  // ----- chrome geometry
  const chipRows: string[] = [];
  if (unsortedOnly) chipRows.push("Невідсортоване");
  else if (activeTagIds.length) chipRows.push(`Смарт-папки: ${tags.filter((t) => activeTagIds.includes(t.id)).map((t) => t.name).join(", ")}`);
  if (status !== "all") chipRows.push(status === "planned" ? "Статус: Планую" : "Статус: Переглянуто");
  const clearFilters = () => {
    setActiveTagIds([]);
    setUnsortedOnly(false);
    setStatus("all");
  };
  const headerSpace = topBarSpace(insets.top);
  const chipSpace = chipRows.length ? 40 : 0;

  const title = inBin ? `Кошик · ${bin.length}` : path ? tagPath(byId.get(path) ?? ({ name: "Смарт-папка", parentId: null } as Tag), byId) : "Мої відео";
  const titleIcon = inBin ? "trash-outline" : path ? "folder-outline" : "videocam-outline";

  const bead = selectMode
    ? { icon: "close", label: "Скасувати вибір", onPress: exitSelect }
    : searching
      ? { icon: "chevron-back", label: "Очистити пошук", onPress: () => setQuery("") }
      : canGoBack
        ? { icon: "chevron-back", label: "Назад", onPress: goUp }
        : { icon: "settings-outline", label: "Налаштування", onPress: () => router.push("/settings") };

  const cards = shown.map((v) => (
    <VideoCard
      key={v.id}
      ref={refFor(v.id)}
      video={v}
      tags={v.tagIds.map((id) => byId.get(id)).filter(Boolean) as Tag[]}
      layout={cardLayout === "list" ? "list" : "grid"}
      selectable={selectMode}
      selected={selectedIds.includes(v.id)}
      inBin={inBin}
      onPress={() => openCard(v)}
      onLongPress={() => holdCard(v)}
      onToggleStatus={() => updateVideo(v.id, { status: v.status === "planned" ? "watched" : "planned" })}
    />
  ));

  return (
    <View style={[styles.container, { backgroundColor: S.bg }]}>
      {canvasMode ? (
        <View style={StyleSheet.absoluteFill}>
          <FolderCanvas
            layoutKey="videoCanvas2"
            renderTile={(item) => {
              const v = videoById.get(item.id);
              return <VideoCanvasTile title={v?.title ?? ""} imageUrl={v?.thumbnailUrl} />;
            }}
            titleOf={(item) => videoById.get(item.id)?.title ?? ""}
            photos={canvasVideos}
            folderPaths={Array.from(pathOfTag.values())}
            foldersOf={(item) => (videoById.get(item.id)?.tagIds ?? []).map((id) => pathOfTag.get(id)).filter(Boolean) as string[]}
            onRelocate={relocate}
            onAdd={async (items, to) => {
              const toTag = tagByPath.get(to);
              if (!toTag) return;
              items.forEach((p) => {
                const v = videoById.get(p.id);
                if (v && !v.tagIds.includes(toTag.id)) updateVideo(v.id, { tagIds: [...v.tagIds, toTag.id] });
              });
            }}
            onMoveFolder={async (path, parent) => {
              const tag = tagByPath.get(path);
              if (!tag) return;
              const parentTag = parent ? tagByPath.get(parent) : undefined;
              // Never into itself or one of its own descendants.
              let cur: Tag | undefined = parentTag;
              while (cur) {
                if (cur.id === tag.id) return;
                cur = cur.parentId ? byId.get(cur.parentId) : undefined;
              }
              updateTag(tag.id, { parentId: parentTag?.id ?? null });
            }}
            onCreateFolder={async (name, moves) => {
              addTagPath([name], "folder", "#B0B0B8");
              const created = useLibraryStore.getState().tags.find((t) => t.parentId === null && t.name === name);
              if (!created) return;
              moves.forEach(({ photo, from }) => {
                const v = useLibraryStore.getState().videos.find((x) => x.id === photo.id);
                if (!v) return;
                const fromTag = from ? tagByPath.get(from) : undefined;
                const ids = v.tagIds.filter((id) => id !== fromTag?.id);
                updateVideo(v.id, { tagIds: ids.includes(created.id) ? ids : [...ids, created.id] });
              });
            }}
            onOpenPhoto={openFromCanvas}
            onPhotoMenu={(photo) => canvasMenu(photo)}
            topPad={headerSpace + chipSpace + 4}
          />
        </View>
      ) : (
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: headerSpace + chipSpace + 4,
          paddingHorizontal: SIDE,
          paddingBottom: DOCK_CLEARANCE + insets.bottom + 24,
        }}
      >
        {folderTiles.length > 0 && <FolderTiles tiles={folderTiles} />}

        {shown.length === 0 && folderTiles.length === 0 ? (
          <View style={styles.empty}>
            <Text style={[TYPE.title, { color: S.ink }]}>
              {inBin ? "Кошик порожній" : videos.length === 0 ? "Тут ще немає відео" : "Нічого не знайдено"}
            </Text>
            <Text style={[TYPE.body, { color: S.ink2, textAlign: "center" }]}>
              {inBin ? "Видалені відео зʼявляться тут на 30 днів." : videos.length === 0 ? "Додайте перше посилання кнопкою «+» знизу." : "Спробуйте змінити пошук чи фільтри."}
            </Text>
          </View>
        ) : cardLayout !== "list" ? (
          <View style={styles.grid}>
            {cards}
            {Array.from({ length: fillers }).map((_, i) => (
              <View key={`f${i}`} style={styles.filler} />
            ))}
          </View>
        ) : (
          <View style={styles.list}>{cards}</View>
        )}
      </ScrollView>
      )}

      <EdgeFade edge="top" color={S.bg} height={headerSpace + chipSpace + 14} />
      <EdgeFade edge="bottom" color={S.bg} height={DOCK_CLEARANCE + insets.bottom + 30} />

      <TopBar
        title={title}
        icon={titleIcon}
        onBack={canGoBack && !selectMode ? goUp : undefined}
        right={
          <>
            <BarButton icon="ellipsis-horizontal" label="Меню" onPress={() => setMenuOpen((v) => !v)} />
            {!inBin && <BarButton icon={selectMode ? "checkmark-circle" : "checkmark-circle-outline"} label="Вибір" onPress={() => (selectMode ? exitSelect() : setSelectMode(true))} />}
          </>
        }
      />

      {chipRows.length > 0 && (
        <View style={[styles.chipWrap, { top: topBarTop(insets.top) + TOP_NAV_H + 10 }]} pointerEvents="box-none">
          <View style={[styles.filterChip, { backgroundColor: S.fillSolid }]}>
            <Text style={[TYPE.small, { color: S.ink, flexShrink: 1 }]} numberOfLines={1}>
              {chipRows.join(" · ")}
            </Text>
            <Pressable hitSlop={10} onPress={clearFilters}>
              <Ionicons name="close" size={14} color={S.ink2} />
            </Pressable>
          </View>
        </View>
      )}

      {selectMode ? (
        <SelectionDock
          count={selectedIds.length}
          onCancel={exitSelect}
          actions={
            inBin
              ? [
                  { key: "restore", icon: "refresh-outline", label: "Відновити", onPress: () => { restoreFromBin(selectedIds); exitSelect(); } },
                  { key: "purge", icon: "trash-outline", label: "Видалити", onPress: deleteSelected, destructive: true },
                ]
              : [
                  { key: "tags", icon: "folder-outline", label: "Смарт-папки", onPress: () => selectedIds.length && setBulkTagsVisible(true) },
                  { key: "delete", icon: "trash-outline", label: "Видалити", onPress: () => selectedIds.length && deleteSelected(), destructive: true },
                ]
          }
        />
      ) : (
        // On the start desk (the root, not inside a folder or the bin) the dock shows the DESKS; inside, the plain one.
        path === null ? (
          <DeskDock
            desk="home"
            onDesk={(k) => goDesk("home", k)}
            query={query}
            onChangeQuery={setQuery}
            onAdd={() => router.push("/add-video")}
            bead={bead}
          />
        ) : (
          <Dock query={query} onChangeQuery={setQuery} onAdd={() => router.push("/add-video")} bead={bead} />
        )
      )}

      <Menu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        entries={menuEntries}
        top={topBarTop(insets.top) + TOP_NAV_H + 8}
        right={Math.max(20, (width - Math.min(width - 40, 560)) / 2)}
      />

      <NamePrompt
        visible={renameVideo !== null}
        title="Назва відео"
        initialValue={renameVideo?.title ?? ""}
        onCancel={() => setRenameVideo(null)}
        onSave={(name) => {
          if (renameVideo) updateVideo(renameVideo.id, { title: name.trim() });
          setRenameVideo(null);
        }}
      />
      <FlipLayer visible={detailVideo !== null} onClose={() => setDetailId(null)} flipFrom={flipFrom}>
        {lastShown.current ? (
          <VideoSheet video={detailVideo ?? lastShown.current} onClose={() => setDetailId(null)} onAddTag={() => setSheetTagsVisible(true)} />
        ) : null}
      </FlipLayer>

      <TagsDrawer
        visible={tagsDrawerVisible}
        onClose={() => setTagsDrawerVisible(false)}
        tags={tags}
        videos={videos}
        selectedTagIds={activeTagIds}
        onChangeSelectedTagIds={(ids) => {
          setUnsortedOnly(false);
          setActiveTagIds(ids);
        }}
        onSelectUnsorted={() => {
          setUnsortedOnly(true);
          setActiveTagIds([]);
          setTagsDrawerVisible(false);
        }}
        unsortedSelected={unsortedOnly}
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
      />

      <TagsDrawer
        visible={bulkTagsVisible}
        onClose={() => setBulkTagsVisible(false)}
        tags={tags}
        videos={videos}
        selectedTagIds={bulkPresentTagIds}
        onChangeSelectedTagIds={handleBulkTagsChange}
        onCreateTag={() => router.push("/tag-editor")}
        onEditTag={(tagId) => router.push(`/tag-editor?tagId=${tagId}`)}
        onReparentTag={(tagId) => router.push(`/tag-reparent?tagId=${tagId}`)}
        onDeleteTag={(tagId, mode) => removeTag(tagId, mode)}
        onBulkReparentTags={(tagIds) => {
          setBulkTagsVisible(false);
          router.push(`/tag-reparent?tagIds=${tagIds.join(",")}`);
        }}
        confirmLabel="Готово"
      />

      <TagsDrawer
        visible={sheetTagsVisible}
        onClose={() => setSheetTagsVisible(false)}
        tags={tags}
        videos={videos}
        selectedTagIds={detailVideo?.tagIds ?? []}
        onChangeSelectedTagIds={(ids) => detailVideo && updateVideo(detailVideo.id, { tagIds: ids })}
        onCreateTag={() => router.push("/tag-editor")}
        onEditTag={(tagId) => router.push(`/tag-editor?tagId=${tagId}`)}
        onReparentTag={(tagId) => router.push(`/tag-reparent?tagId=${tagId}`)}
        onDeleteTag={(tagId, mode) => removeTag(tagId, mode)}
        confirmLabel="Готово"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  chipWrap: { position: "absolute", left: SIDE, right: SIDE, zIndex: 4, flexDirection: "row" },
  filterChip: { flexDirection: "row", alignItems: "center", gap: 8, height: 30, borderRadius: 15, paddingHorizontal: 12, maxWidth: "100%" },
  grid: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: 12 },
  filler: { flexBasis: "46%", flexGrow: 1 },
  list: { gap: 12 },
  empty: { alignItems: "center", marginTop: 80, gap: 8, paddingHorizontal: 40 },
});
