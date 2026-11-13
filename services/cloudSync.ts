import { AppState } from "react-native";

import { firebaseSignIn, firebaseToken, pullDocs, pushDocs, type CloudDoc } from "@/services/cloud";
import { getGoogleIdentity } from "@/services/googleAuth";
import { errorMessage } from "@/services/errorMessage";
import { type Channel, type FeedItem, useChannelsStore } from "@/store/useChannelsStore";
import { useLibraryStore } from "@/store/useLibraryStore";
import { type Known, useSyncStore } from "@/store/useSyncStore";
import type { Tag, Video } from "@/types";

// CLOUD SYNC. The phone's own storage stays the truth (the app works offline);
// the cloud is a shared shelf where every phone leaves what it changed and picks
// up what the others changed. Nothing in the stores knows about it: each round
// compares what is in the stores with what this phone remembers agreeing on
// (`known`), sends the differences, takes the cloud's newer things, and the
// NEWER CHANGE WINS. A removal is sent as a «tombstone» so it reaches the
// other phones too.
//
// What goes: videos and folders (tags) of the library, channels with their
// topics + topic icons, and the videos marked «Хочу» / «Не цікаво» in the feed.
// What stays on the phone: the bin, the canvas, settings, the new offers (they
// are simply fetched again).
const KINDS = ["tag", "channel", "video", "feed", "meta"] as const;
type Kind = (typeof KINDS)[number];

// The demo videos every fresh install is seeded with: never sent (a new phone
// would bring them back to life after the old one deleted them).
const SEED_VIDEO_IDS = new Set(["v1", "v2", "v3", "v4"]);

const hashOf = (s: string): string => {
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = (h1 * 33) ^ c;
    h2 = (h2 * 31 + c) | 0;
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + s.length.toString(36);
};

type Snap = Map<string, { kind: Kind; json: string; t0: number }>;

/** Everything that syncs, as it is in the stores right now. */
function collect(): Snap {
  const out: Snap = new Map();
  const lib = useLibraryStore.getState();
  const ch = useChannelsStore.getState();
  for (const t of lib.tags) out.set(`tag:${t.id}`, { kind: "tag", json: JSON.stringify(t), t0: 0 });
  for (const v of lib.videos) {
    if (SEED_VIDEO_IDS.has(v.id)) continue;
    out.set(`video:${v.id}`, { kind: "video", json: JSON.stringify(v), t0: v.updatedAt ?? v.createdAt ?? 0 });
  }
  for (const c of ch.channels) out.set(`channel:${c.id}`, { kind: "channel", json: JSON.stringify(c), t0: c.addedAt ?? 0 });
  for (const f of ch.feed) if (f.state !== "new") out.set(`feed:${f.id}`, { kind: "feed", json: JSON.stringify(f), t0: 0 });
  out.set("meta:topicIcons", { kind: "meta", json: JSON.stringify(ch.topicIcons), t0: 0 });
  return out;
}

const kindOf = (key: string): Kind => key.slice(0, key.indexOf(":")) as Kind;

/** What changed here since the last round: marks it pending in `known`. Returns the new `known`. */
function scan(known: Record<string, Known>, snap: Snap): Record<string, Known> {
  const next: Record<string, Known> = { ...known };
  const now = Date.now();
  snap.forEach((e, key) => {
    const h = hashOf(e.json);
    const k = next[key];
    if (!k) next[key] = { h, t: e.t0, p: true };
    else if (k.del) next[key] = { h, t: now, p: true }; // it came back after a removal
    else if (k.h !== h) next[key] = { h, t: now, p: true };
  });
  for (const key of Object.keys(next)) {
    const k = next[key];
    if (snap.has(key) || k.del) continue;
    const kind = kindOf(key);
    // Feed items drop out on their own (old ones are trimmed): that is not a removal.
    if (kind === "feed" || kind === "meta") continue;
    next[key] = { h: "", t: now, p: true, del: true };
  }
  return next;
}

const upsert = <T extends { id: string }>(list: T[], item: T): T[] => {
  const i = list.findIndex((x) => x.id === item.id);
  if (i < 0) return [...list, item];
  const copy = list.slice();
  copy[i] = item;
  return copy;
};

/** Puts one cloud thing into the stores. */
function applyDoc(doc: CloudDoc): void {
  const id = doc.key.slice(doc.key.indexOf(":") + 1);
  const kind = kindOf(doc.key);
  let value: any = null;
  if (!doc.del) {
    try {
      value = JSON.parse(doc.data);
    } catch {
      return;
    }
  }
  if (kind === "video") {
    useLibraryStore.setState((s) => ({ videos: doc.del ? s.videos.filter((v) => v.id !== id) : upsert<Video>(s.videos, value as Video) }));
  } else if (kind === "tag") {
    useLibraryStore.setState((s) => ({ tags: doc.del ? s.tags.filter((t) => t.id !== id) : upsert<Tag>(s.tags, value as Tag) }));
  } else if (kind === "channel") {
    useChannelsStore.setState((s) =>
      doc.del
        ? { channels: s.channels.filter((c) => c.id !== id), feed: s.feed.filter((f) => f.channelId !== id) }
        : { channels: upsert<Channel>(s.channels, value as Channel) }
    );
  } else if (kind === "feed") {
    if (doc.del) return;
    useChannelsStore.setState((s) => {
      const item = value as FeedItem;
      if (!s.channels.some((c) => c.id === item.channelId)) return s;
      return { feed: upsert<FeedItem>(s.feed, item) };
    });
  } else if (kind === "meta" && id === "topicIcons") {
    if (value && typeof value === "object") useChannelsStore.setState({ topicIcons: value });
  }
}

let running = false;
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;

const hydrated = () => useLibraryStore.persist.hasHydrated() && useChannelsStore.persist.hasHydrated() && useSyncStore.persist.hasHydrated();

async function whenHydrated(): Promise<void> {
  if (hydrated()) return;
  await new Promise<void>((res) => {
    const iv = setInterval(() => {
      if (hydrated()) {
        clearInterval(iv);
        res();
      }
    }, 100);
  });
}

/** Signs in to the cloud with the Google account (or uses the session it already has). Returns the uid. */
async function ensureSession(): Promise<{ uid: string; token: string }> {
  const sync = useSyncStore.getState();
  let token = await firebaseToken();
  if (!token) {
    const g = await getGoogleIdentity();
    if (!g.idToken && !g.accessToken) throw new Error("Спершу увійди через Google в налаштуваннях");
    const before = sync.uid;
    await firebaseSignIn(g);
    token = await firebaseToken();
    // A different account than before: what was remembered about the old one does not apply.
    if (before && useSyncStore.getState().uid !== before) useSyncStore.getState().set({ known: {}, cursor: null });
  }
  const uid = useSyncStore.getState().uid;
  if (!token || !uid) throw new Error("Не вдалося увійти в хмару");
  return { uid, token };
}

export type SyncOutcome = { ok: boolean; sent: number; got: number; error?: string };

/** One round: find the changes here, take the newer ones from the cloud, send the rest. */
export async function syncNow(opts: { quietIfIdle?: boolean } = {}): Promise<SyncOutcome> {
  if (running) {
    again = true;
    return { ok: true, sent: 0, got: 0 };
  }
  running = true;
  const sync = useSyncStore;
  try {
    await whenHydrated();
    if (opts.quietIfIdle && !sync.getState().fbRefresh) return { ok: true, sent: 0, got: 0 };
    // Only look at the network when there is a reason, if this was just a «something changed» nudge.
    let known = scan(sync.getState().known, collect());
    const pendingBefore = Object.values(known).some((k) => k.p);
    if (opts.quietIfIdle && !pendingBefore && Date.now() - sync.getState().lastSyncAt < 2 * 60 * 1000) {
      sync.getState().set({ known });
      return { ok: true, sent: 0, got: 0 };
    }

    sync.getState().set({ status: "working", error: null });
    const { uid, token } = await ensureSession();
    known = scan(sync.getState().known, collect()); // (the account may have changed while signing in)

    // 1. TAKE what is newer in the cloud.
    const docs = await pullDocs(uid, token, sync.getState().cursor);
    // The cloud hands them over oldest-first: the newest moment is the last one (before the sort below).
    const newest = docs.length ? docs[docs.length - 1].ts : null;
    docs.sort((a, b) => KINDS.indexOf(kindOf(a.key)) - KINDS.indexOf(kindOf(b.key)));
    const applied: CloudDoc[] = [];
    for (const d of docs) {
      const k = known[d.key];
      if (k && d.t <= k.t) continue; // this phone's version is the newer (or the same)
      applyDoc(d);
      applied.push(d);
    }
    const after = collect();
    const nextKnown: Record<string, Known> = { ...known };
    for (const d of applied) {
      nextKnown[d.key] = d.del ? { h: "", t: d.t, del: true } : { h: hashOf(after.get(d.key)?.json ?? ""), t: d.t };
    }
    const cursor = newest || sync.getState().cursor;
    // What was taken is remembered at once: if sending fails below, it must not be mistaken for this phone's own change.
    sync.getState().set({ known: nextKnown, cursor });

    // 2. SEND what is changed here and was not beaten by the cloud.
    const out: { key: string; kind: string; t: number; del: boolean; data: string }[] = [];
    for (const [key, k] of Object.entries(nextKnown)) {
      if (!k.p) continue;
      if (k.del) out.push({ key, kind: kindOf(key), t: k.t, del: true, data: "" });
      else {
        const e = after.get(key);
        if (e) out.push({ key, kind: e.kind, t: k.t, del: false, data: e.json });
      }
    }
    if (out.length) await pushDocs(uid, token, out);
    for (const o of out) {
      const k = nextKnown[o.key];
      if (k) nextKnown[o.key] = { h: k.h, t: k.t, del: k.del };
    }
    // Tombstones that were taken from the cloud or sent are kept (they must beat a stale copy), the rest of `known` stays as is.
    sync.getState().set({ known: nextKnown, cursor, lastSyncAt: Date.now(), status: "idle", error: null });
    return { ok: true, sent: out.length, got: applied.length };
  } catch (e) {
    const msg = errorMessage(e);
    sync.getState().set({ status: "error", error: msg });
    return { ok: false, sent: 0, got: 0, error: msg };
  } finally {
    running = false;
    if (again) {
      again = false;
      schedule(3000);
    }
  }
}

function schedule(ms = 10000) {
  if (timer) return; // a round is already planned: do not push it further (a video that is playing changes constantly)
  timer = setTimeout(() => {
    timer = null;
    void syncNow({ quietIfIdle: true });
  }, ms);
}

let started = false;

/** Starts the watching: a round at launch, when the app comes back, and soon after anything changes. */
export function startCloudSync(): void {
  if (started) return;
  started = true;
  void whenHydrated().then(() => {
    void syncNow({ quietIfIdle: true });
    useLibraryStore.subscribe(() => schedule());
    useChannelsStore.subscribe(() => schedule());
  });
  AppState.addEventListener("change", (st) => {
    if (st === "active") void syncNow({ quietIfIdle: true });
  });
}

/** Forgets the cloud session on this phone (the data stays on the phone). */
export function forgetCloud(): void {
  useSyncStore.getState().reset();
}
