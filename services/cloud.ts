import { FIREBASE_CONFIG } from "@/constants/firebase";
import { useSyncStore } from "@/store/useSyncStore";

// The talking to Firebase, by plain HTTPS (no heavy SDK: the phone's own database
// is the truth, the cloud is only a place to leave and collect changes).
const KEY = FIREBASE_CONFIG.apiKey;
const DOCS = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;
const DOC_ROOT = `projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;

export type CloudDoc = { key: string; kind: string; t: number; del: boolean; data: string; ts: string };

async function postJson(url: string, body: unknown, token?: string): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // not JSON
  }
  if (!res.ok) {
    const msg = json?.error?.message ?? (Array.isArray(json) ? json[0]?.error?.message : null) ?? text.slice(0, 200);
    const err = new Error(`${res.status}: ${msg}`);
    (err as any).status = res.status;
    throw err;
  }
  return json;
}

/** Google's tokens -> a Firebase session (uid + tokens). Tries the id token first, then the access token. */
export async function firebaseSignIn(google: { idToken?: string | null; accessToken?: string | null }): Promise<void> {
  const attempts: string[] = [];
  if (google.idToken) attempts.push(`id_token=${encodeURIComponent(google.idToken)}&providerId=google.com`);
  if (google.accessToken) attempts.push(`access_token=${encodeURIComponent(google.accessToken)}&providerId=google.com`);
  if (!attempts.length) throw new Error("Немає токена Google для входу в хмару");
  let lastErr: unknown = null;
  for (const postBody of attempts) {
    try {
      const r = await postJson(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${KEY}`, {
        postBody,
        requestUri: "http://localhost",
        returnSecureToken: true,
        returnIdpCredential: false,
      });
      useSyncStore.getState().set({
        uid: r.localId,
        email: r.email ?? null,
        fbRefresh: r.refreshToken,
        fbToken: r.idToken,
        fbExpiresAt: Date.now() + (Number(r.expiresIn) || 3600) * 1000 - 60000,
      });
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/** A working Firebase token, refreshed when it ran out; null if there is no session. */
export async function firebaseToken(): Promise<string | null> {
  const s = useSyncStore.getState();
  if (!s.fbRefresh) return null;
  if (s.fbToken && Date.now() < s.fbExpiresAt) return s.fbToken;
  try {
    const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(s.fbRefresh)}`,
    });
    if (!res.ok) {
      if (res.status === 400) s.set({ fbRefresh: null, fbToken: null });
      return null;
    }
    const r = await res.json();
    s.set({ fbToken: r.id_token, fbRefresh: r.refresh_token ?? s.fbRefresh, fbExpiresAt: Date.now() + (Number(r.expires_in) || 3600) * 1000 - 60000 });
    return r.id_token as string;
  } catch {
    return null;
  }
}

const str = (v: string) => ({ stringValue: v });

/** Leaves changes in the cloud (the server stamps the moment in `ts`). */
export async function pushDocs(uid: string, token: string, docs: { key: string; kind: string; t: number; del: boolean; data: string }[]): Promise<void> {
  const CHUNK = 150;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const part = docs.slice(i, i + CHUNK);
    await postJson(
      `${DOCS}:commit`,
      {
        writes: part.map((d) => ({
          update: {
            name: `${DOC_ROOT}/users/${uid}/items/${encodeURIComponent(d.key)}`,
            fields: { k: str(d.key), kind: str(d.kind), t: { integerValue: String(Math.round(d.t)) }, del: { booleanValue: d.del }, d: str(d.data) },
          },
          updateTransforms: [{ fieldPath: "ts", setToServerValue: "REQUEST_TIME" }],
        })),
      },
      token
    );
  }
}

/** Collects what changed in the cloud since `cursor` (a server time), oldest first. */
export async function pullDocs(uid: string, token: string, cursor: string | null): Promise<CloudDoc[]> {
  const out: CloudDoc[] = [];
  const LIMIT = 400;
  let from = cursor;
  let strict = true;
  for (let guard = 0; guard < 50; guard++) {
    const q: any = {
      from: [{ collectionId: "items" }],
      orderBy: [{ field: { fieldPath: "ts" }, direction: "ASCENDING" }],
      limit: LIMIT,
    };
    if (from) q.where = { fieldFilter: { field: { fieldPath: "ts" }, op: strict ? "GREATER_THAN" : "GREATER_THAN_OR_EQUAL", value: { timestampValue: from } } };
    const rows = await postJson(`${DOCS}/users/${uid}:runQuery`, { structuredQuery: q }, token);
    const docs = (rows as any[]).filter((r) => r.document).map((r) => r.document);
    for (const d of docs) {
      const f = d.fields ?? {};
      out.push({
        key: f.k?.stringValue ?? decodeURIComponent(String(d.name).split("/").pop() ?? ""),
        kind: f.kind?.stringValue ?? "",
        t: Number(f.t?.integerValue ?? 0),
        del: !!f.del?.booleanValue,
        data: f.d?.stringValue ?? "",
        ts: f.ts?.timestampValue ?? "",
      });
    }
    if (docs.length < LIMIT) break;
    // A full page: carry on from the newest moment seen (the same moment may repeat; applying is idempotent).
    from = out[out.length - 1].ts;
    strict = false;
  }
  return out;
}
