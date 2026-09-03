import { useLibraryStore } from "@/store/useLibraryStore";
import { Tag, Video } from "@/types";

import { errorMessage } from "./errorMessage";
import { supabase } from "./supabaseClient";

const SYNC_DEBOUNCE_MS = 800;

function tagToRow(tag: Tag, userId: string) {
  return {
    id: tag.id,
    user_id: userId,
    name: tag.name,
    parent_id: tag.parentId,
    icon: tag.icon,
    color: tag.color,
  };
}

function rowToTag(row: any): Tag {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    icon: row.icon,
    color: row.color,
  };
}

function videoToRow(video: Video, userId: string) {
  return {
    id: video.id,
    user_id: userId,
    url: video.url,
    title: video.title,
    thumbnail_url: video.thumbnailUrl,
    duration_sec: video.durationSec,
    source: video.source,
    status: video.status,
    tag_ids: video.tagIds,
    comment: video.comment,
    created_at: new Date(video.createdAt).toISOString(),
  };
}

function rowToVideo(row: any): Video {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    thumbnailUrl: row.thumbnail_url ?? "",
    durationSec: row.duration_sec ?? 0,
    source: row.source ?? "unknown",
    status: row.status,
    tagIds: row.tag_ids ?? [],
    comment: row.comment ?? "",
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  };
}

/** Replaces remote rows with exactly the given local ones (upsert + delete-the-rest). */
async function reconcileTable(
  table: "videos" | "tags",
  userId: string,
  localRows: { id: string }[]
) {
  const { data: remoteRows, error: selectError } = await supabase
    .from(table)
    .select("id")
    .eq("user_id", userId);
  if (selectError) throw new Error(`[reconcile:${table}:select] ${errorMessage(selectError)}`);

  const localIds = new Set(localRows.map((r) => r.id));
  const toDelete = (remoteRows ?? []).map((r) => r.id).filter((id) => !localIds.has(id));

  if (toDelete.length > 0) {
    const { error } = await supabase.from(table).delete().eq("user_id", userId).in("id", toDelete);
    if (error) throw new Error(`[reconcile:${table}:delete] ${errorMessage(error)}`);
  }
  if (localRows.length > 0) {
    const { error } = await supabase.from(table).upsert(localRows);
    if (error) throw new Error(`[reconcile:${table}:upsert] ${errorMessage(error)}`);
  }
}

export async function pullRemoteIntoLocal(userId: string) {
  const [{ data: tagRows, error: tagsError }, { data: videoRows, error: videosError }] =
    await Promise.all([
      supabase.from("tags").select("*").eq("user_id", userId),
      supabase.from("videos").select("*").eq("user_id", userId),
    ]);
  if (tagsError) throw new Error(`[pull:tags] ${errorMessage(tagsError)}`);
  if (videosError) throw new Error(`[pull:videos] ${errorMessage(videosError)}`);

  useLibraryStore.setState({
    tags: (tagRows ?? []).map(rowToTag),
    videos: (videoRows ?? []).map(rowToVideo),
  });
}

export async function pushLocalToRemote(userId: string) {
  const { tags, videos } = useLibraryStore.getState();
  await Promise.all([
    reconcileTable(
      "tags",
      userId,
      tags.map((t) => tagToRow(t, userId))
    ),
    reconcileTable(
      "videos",
      userId,
      videos.map((v) => videoToRow(v, userId))
    ),
  ]);
}

/** First sign-in on a device: adopt whichever side already has data. */
export async function initialSyncAfterSignIn(userId: string) {
  // Deliberately not `head: true`: a HEAD response can never carry a body,
  // so any server-side error here (expired token, RLS, etc.) would come
  // back with an empty message and no way to tell what actually failed.
  const { count, error } = await supabase
    .from("videos")
    .select("id", { count: "exact" })
    .eq("user_id", userId);
  if (error) throw new Error(`[initialSync:count] ${errorMessage(error)}`);

  if ((count ?? 0) > 0) {
    await pullRemoteIntoLocal(userId);
  } else {
    await pushLocalToRemote(userId);
  }
  useLibraryStore.getState().updateSettings({ lastSyncedAt: Date.now() });
}

let unsubscribeStore: (() => void) | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pushInFlight = false;
let pushQueued = false;

function schedulePush(userId: string) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => runPush(userId), SYNC_DEBOUNCE_MS);
}

async function runPush(userId: string) {
  if (pushInFlight) {
    pushQueued = true;
    return;
  }
  pushInFlight = true;
  try {
    await pushLocalToRemote(userId);
    useLibraryStore.getState().updateSettings({ lastSyncedAt: Date.now() });
  } catch {
    // Offline or a transient error — the next local change (or app restart) retries.
  } finally {
    pushInFlight = false;
    if (pushQueued) {
      pushQueued = false;
      runPush(userId);
    }
  }
}

/** Pushes every subsequent local videos/tags change to the signed-in user's remote rows. */
export function startAutoSync(userId: string) {
  stopAutoSync();
  unsubscribeStore = useLibraryStore.subscribe((state, prevState) => {
    if (state.videos !== prevState.videos || state.tags !== prevState.tags) {
      schedulePush(userId);
    }
  });
}

export function stopAutoSync() {
  unsubscribeStore?.();
  unsubscribeStore = null;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}
