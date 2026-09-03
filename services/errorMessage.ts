/**
 * Supabase/PostgREST errors are plain objects with a `message` field, not
 * `instanceof Error` — `String(error)` on them just gives "[object Object]".
 */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) {
    const message = (e as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
