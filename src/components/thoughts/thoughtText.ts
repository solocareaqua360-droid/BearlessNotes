import type { Thought } from '../../hooks/useThoughts';
import { readable } from './ThoughtCapture';

// What a thought is called on its card, and what is read aloud for it - one place, so the card, the reader and the
// voice say the same thing.
export function cardTitle(t: Thought) {
  const src = t.source;
  if (t.ai === 'answer' && t.question) return t.question;
  if (t.ai === 'summary') return 'Резюме';
  if (t.ai === 'deepen') return 'Глибше';
  if (src?.kind === 'link') return src.title || src.siteName || src.url;
  if (src?.kind === 'text') return readable(src.text);
  // A picture alone has no words of its own: the card shows the picture, and the voice says only that it is one.
  return '';
}

export function voiceTextOf(t: Thought): string {
  const src = t.source;
  const parts: string[] = [];
  if (t.ai === 'answer' && t.question) parts.push(`Питання: ${t.question}.`);
  if (src?.kind === 'link') {
    parts.push(src.title || src.siteName || '');
    if (t.videoGist) parts.push(t.videoGist);
  }
  if (src?.kind === 'text') parts.push(readable(src.text));
  if (t.felt) parts.push(src ? `Що зачепило: ${t.felt}` : readable(t.felt));
  return parts.filter(Boolean).join('\n\n');
}

// WHAT A THOUGHT IS, for the inbox's type capsules (2026-11-16, the user's rule): what came in decides the type, and the
// words written with it never change it - «Фото з коментарем» stays a photo, the comment is its caption. Only words alone
// are a document.
export type ThoughtKind = 'doc' | 'photo' | 'video' | 'link';
export const VIDEO_LINK = /(?:youtube\.com\/(?:watch|shorts\/|live\/)|youtu\.be\/|tiktok\.com\/|instagram\.com\/(?:reel|reels)\/|vimeo\.com\/\d)/i;
export function kindOf(t: Thought): ThoughtKind {
  if (t.video) return 'video';
  if (t.source?.kind === 'link') return VIDEO_LINK.test(t.source.url) ? 'video' : 'link';
  if (t.images?.length) return 'photo';
  return 'doc';
}
export const KIND_LABEL: Record<ThoughtKind, string> = { doc: 'Документ', photo: 'Фото', video: 'Відео', link: 'Посилання' };
// The words written with what came in - its caption; a document's words are its body, not a caption.
export function captionOf(t: Thought): string {
  if (t.ai) return '';
  return kindOf(t) === 'doc' ? '' : t.felt.trim();
}
