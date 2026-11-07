import { Platform, Share } from "react-native";

/** The first http(s) link in a shared text ("Title https://youtu.be/..." -> the link). */
export function extractUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s<>"')]+/i);
  return match ? match[0].replace(/[.,;!?]+$/, "") : null;
}

/** Hands a video's link to the system Share sheet. */
export function shareVideoLink(url: string, title?: string) {
  return Share.share(Platform.OS === "ios" ? { url, message: title } : { message: url, title }).catch(() => {});
}
